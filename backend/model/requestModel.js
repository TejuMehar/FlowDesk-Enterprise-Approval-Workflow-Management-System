/*
=========================================================================
  MODEL: Request                                  ( the "M" of MVC )
=========================================================================
  Module 2 - Request Management.

  A Request is created by an employee when they need something approved,
  for example "3 days of Sick Leave" or "a new Laptop".

  This module only covers CREATING and MANAGING the request itself
  (draft, edit, delete, submit, attachments). The actual APPROVE /
  REJECT step by a manager is a later module.
=========================================================================
*/

import mongoose from "mongoose";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
} from "../config/requestConstants.js";

const requestSchema = new mongoose.Schema(
  {
    // A readable id like "REQ-0001". Created automatically (see hook below)
    requestId: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
    },

    // WHO raised this request
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Requester is required"],
    },

    /*
      WHO THE EMPLOYEE ASKED FOR, when they wanted somebody particular.

      A workflow stage of type "RequesterManager" normally works the
      approver out from the org chart: the manager of the department the
      requester belongs to. That is right almost always and wrong in the
      cases everybody actually runs into - a matrix team, somebody
      covering while a manager is on leave, a request that belongs to the
      project lead rather than the line manager.

      So this is an OVERRIDE for that one stage, and nothing more. It
      cannot redirect a Finance or Director stage, because those exist
      precisely so that somebody other than the requester's own chain
      looks at the request - an employee who could choose their own
      Finance reviewer could choose the most agreeable one, which is the
      thing an approval system exists to prevent.

      null means "use the org chart", which is what every request made
      before this field existed does.

      WHO MAY BE PUT HERE is not decided in the model but in the
      controller (listSelectableApprovers), because the answer comes from
      the DATA - a user some department points at as its manager - in the
      same way dashboardStats.js and reportScope.js decide who is a
      manager. A role name would be a second, competing definition.
    */
    chosenApprover: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
      WHAT kind of request this is, e.g. "Leave", "Purchase" ...

      MODULE 9 REMOVED THE `enum` THAT USED TO BE HERE, and it is worth
      knowing why rather than assuming the check was forgotten.

      Request types now live in their own collection, so an admin can
      add "Overtime" at ten in the morning. A mongoose enum is fixed at
      IMPORT TIME - it would still be holding the eight names that were
      in the database when the server last started, and would reject
      the new type until somebody restarted the process.

      So the check moved one layer up, into the controllers, which ask
      config/requestTypeService.js for the live list. Everything that
      writes a request goes through them (there is no route that saves
      a Request without one), so nothing lost a guard - the guard just
      moved somewhere it can be told the truth.

      The type is stored as TEXT and not as a reference on purpose: a
      request is a historical record, and renaming a type must not
      rewrite what a request approved two years ago claims to be. See
      the long note in requestTypeModel.js.
    */
    type: {
      type: String,
      required: [true, "Request type is required"],
      trim: true,
    },

    /*
      A more specific label inside the type, e.g. type "Leave" with
      category "Sick Leave". Free text, so it stays flexible - the
      frontend only SUGGESTS values from config/requestConstants.js.
    */
    category: {
      type: String,
      trim: true,
      default: "",
      maxlength: [80, "Category cannot be more than 80 characters"],
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters"],
      maxlength: [120, "Title cannot be more than 120 characters"],
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [2000, "Description cannot be more than 2000 characters"],
    },

    priority: {
      type: String,
      enum: {
        values: REQUEST_PRIORITIES,
        message: "{VALUE} is not a valid priority",
      },
      default: "Medium",
    },

    /*
      Draft      -> still being written, only the owner can see it
      Submitted  -> locked, waiting to be handled
      Cancelled  -> the employee withdrew it themselves
    */
    status: {
      type: String,
      enum: {
        values: REQUEST_STATUSES,
        message: "{VALUE} is not a valid status",
      },
      default: "Draft",
    },

    // used by types like Purchase / Expense / Budget. Optional otherwise.
    amount: {
      type: Number,
      min: [0, "Amount cannot be negative"],
      default: null,
    },

    // used by types like Leave / Travel. Optional otherwise.
    startDate: {
      type: Date,
      default: null,
    },

    endDate: {
      type: Date,
      default: null,
    },

    /*
      FILES attached to the request (bills, medical certificate, quotation
      ...). Each entry is one uploaded file. We keep this as an array
      INSIDE the request instead of its own collection because attachments
      never make sense without their parent request.
    */
    attachments: {
      type: [
        {
          fileName: { type: String, required: true }, // the original name
          filePath: { type: String, required: true }, // e.g. "/uploads/requests/172-bill.pdf"
          fileSize: { type: Number, required: true }, // in bytes
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    // filled in the moment the request moves from Draft to Submitted
    submittedAt: {
      type: Date,
      default: null,
    },

    // soft delete, same pattern as the other modules
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   Almost every query filters "my own, not-deleted requests" and often
   also by status, so those are the combinations worth indexing.
   ===================================================================== */
requestSchema.index({ requester: 1, isDeleted: 1 });
requestSchema.index({ status: 1 });

/* ---------------------------------------------------------------------
   MODULE 10 - three more, and they are here because of what Modules 5,
   8 and 2 turned out to ASK, which was not obvious when this collection
   only had to answer "show me my requests".

   AN INDEX IS THE ORDER THE ROWS ARE ALREADY IN. Without a matching
   one, mongodb reads every request in the company and sorts them in
   memory to answer a page of ten - which is instant on a demo database
   and gets slower every week a real one is used.

   The ORDER OF THE FIELDS INSIDE EACH INDEX IS THE WHOLE SKILL: the
   fields being matched exactly come first, and the field being SORTED
   on comes last. An index on { createdAt, status } cannot help a query
   that filters by status, but { status, createdAt } can do both jobs at
   once - find the matching rows, and find them already in order.
   --------------------------------------------------------------------- */

/*
  The list every employee opens: their own requests, newest first, with
  a status filter on top. The two indexes above could each do half of
  this; together they still could not, because mongodb uses one index
  per query.
*/
requestSchema.index({ requester: 1, isDeleted: 1, createdAt: -1 });

/*
  Module 8. Every report groups by type and by month, and the advanced
  search filters on the same pair. isDeleted leads because every one of
  those queries carries it.
*/
requestSchema.index({ isDeleted: 1, type: 1, status: 1, createdAt: -1 });

/*
  Module 5. The dashboards and the charts count by status over a date
  window ("how many were submitted this month?"), which is a different
  question from the one above and deserves its own order.
*/
requestSchema.index({ isDeleted: 1, status: 1, submittedAt: -1 });

/* =====================================================================
   HOOK - create a readable requestId like REQ-0001 for new requests
   ---------------------------------------------------------------------
   Same idea as the employeeId hook in userModel.js: look up the HIGHEST
   existing id and add 1, instead of counting documents (counting breaks
   once a request is ever really deleted).
   ===================================================================== */
requestSchema.pre("save", async function (next) {
  try {
    if (!this.isNew || this.requestId) {
      return next();
    }

    const lastRequest = await this.constructor
      .findOne({ requestId: { $regex: /^REQ-\d+$/ } })
      .sort({ requestId: -1 })
      .select("requestId")
      .lean();

    const lastNumber = lastRequest
      ? Number(lastRequest.requestId.split("-")[1])
      : 0;

    this.requestId = `REQ-${String(lastNumber + 1).padStart(4, "0")}`;

    return next();
  } catch (error) {
    return next(error);
  }
});

const Request = mongoose.model("Request", requestSchema);

export default Request;
