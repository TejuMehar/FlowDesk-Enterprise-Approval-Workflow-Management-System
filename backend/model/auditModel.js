/*
=========================================================================
  MODEL: AuditLog                                 ( the "M" of MVC )
=========================================================================
  Module 7 - Audit Logs & Activity Tracking.

  ONE DOCUMENT = ONE THING SOMEBODY DID.

      "Priya Nair deactivated Ravi Sharma"      14 Aug 2026, 10:42
      "Ravi Sharma submitted REQ-0007"          14 Aug 2026, 09:15
      "Somebody failed to log in as ravi@..."   14 Aug 2026, 08:58

  WHY THE NAMES ARE COPIED IN, INSTEAD OF ONLY THE IDS
  ----------------------------------------------------
  Every other collection in FlowDesk stores an id and populates the
  name when it needs it. This one stores BOTH: the id in `actor`, and
  the name of the moment in `actorName`.

  That looks like duplication, and it is - deliberately. An audit entry
  is a statement about a moment that has passed, and the moment does
  not change when the data does:

    - a user can be deleted. isAuth() blocks them, populate() gives
      back null, and every entry they ever caused would turn into
      "Somebody did this" - exactly the entries an investigation cares
      about most
    - a user can be renamed, or moved to another role. "Priya Nair
      (Admin) deleted this workflow" must keep saying Admin, even
      after Priya is moved to Employee next month

  So the ids are kept for filtering ("everything this person did") and
  the frozen text is what the screen shows. It is the same reasoning
  notificationModel.js uses for its `title` and `message`.

  WHY THERE IS NO TTL INDEX HERE
  ------------------------------
  notificationModel.js deletes itself after 90 days, because a
  notification is a nudge and nobody misses last quarter's nudges. An
  audit log is the opposite: its whole value is that it still has the
  row when somebody finally asks. Nothing in this module removes an
  entry, and the collection is expected to grow forever.

  If a company one day needs the rows to expire (some data protection
  rules require it), that is a decision for an admin with a documented
  retention period - not a quiet default.
=========================================================================
*/

import mongoose from "mongoose";
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  AUDIT_TARGET_TYPES,
  AUDIT_STATUSES,
} from "../config/auditConstants.js";

/* =====================================================================
   WHAT CHANGED
   ---------------------------------------------------------------------
   One entry per field that was really different, e.g.

       { field: "Role", from: "Employee", to: "Manager" }

   `from` and `to` are TEXT, not the original types, because they are
   only ever displayed - see describeValue() in auditConstants.js.

   _id: false stops mongoose giving each little entry its own ObjectId.
   They are never looked up on their own, so the id would be dead
   weight on every single row.
   ===================================================================== */
const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
  },
  { _id: false }
);

const auditLogSchema = new mongoose.Schema(
  {
    /* ---------------- WHAT HAPPENED ---------------- */

    action: {
      type: String,
      required: [true, "Action is required"],
      enum: {
        values: AUDIT_ACTIONS,
        message: "{VALUE} is not a valid audit action",
      },
    },

    /*
      Which part of FlowDesk the action belongs to. Never sent by a
      controller - auditService.js looks it up from the action itself,
      so the two can never disagree.
    */
    module: {
      type: String,
      required: [true, "Module is required"],
      enum: {
        values: AUDIT_MODULES,
        message: "{VALUE} is not a valid audit module",
      },
    },

    /*
      The whole event as one readable sentence, frozen at the time it
      happened: "Priya Nair changed Ravi Sharma's role to Manager".

      This is what the table shows. Rebuilding it on read would mean
      re-reading four collections for every row, and would quietly
      rewrite history every time somebody was renamed.
    */
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [500, "Description cannot be more than 500 characters"],
    },

    /* ---------------- WHO DID IT ---------------- */

    /*
      Empty when FlowDesk itself did it (the reminder engine) and when
      nobody was logged in yet - a failed login has no actor, which is
      the entire point of recording it.
    */
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // the name and role AS THEY WERE - see the long note at the top
    actorName: {
      type: String,
      default: "FlowDesk",
      trim: true,
      maxlength: [120, "Actor name cannot be more than 120 characters"],
    },

    actorRole: {
      type: String,
      default: "",
      trim: true,
      maxlength: [80, "Actor role cannot be more than 80 characters"],
    },

    /* ---------------- WHAT IT WAS DONE TO ---------------- */

    /*
      The audit log points at nine different collections, so it cannot
      use one mongoose `ref`. It stores the KIND of thing beside the
      id instead, and the controller decides what to load.
    */
    targetType: {
      type: String,
      required: [true, "Target type is required"],
      enum: {
        values: AUDIT_TARGET_TYPES,
        message: "{VALUE} is not a valid audit target type",
      },
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // "REQ-0007 - New laptop", "Ravi Sharma", "Purchase Approval" ...
    targetLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: [200, "Target label cannot be more than 200 characters"],
    },

    /*
      THE REQUEST THIS ENTRY BELONGS TO, when there is one.

      It repeats targetId for the request actions, and that repetition
      is what makes the Activity Timeline cheap: "everything that ever
      happened to REQ-0007" becomes one indexed query on this field.
      Without it, a comment entry (targetType "Comment") could not be
      found from the request it was written on.
    */
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      default: null,
    },

    /* ---------------- THE DETAIL ---------------- */

    // the field-by-field diff, empty for actions that change nothing
    changes: {
      type: [changeSchema],
      default: [],
    },

    status: {
      type: String,
      enum: {
        values: AUDIT_STATUSES,
        message: "{VALUE} is not a valid audit status",
      },
      default: "Success",
    },

    /*
      WHERE IT CAME FROM.

      Both are read straight off the HTTP request. They are the only
      fields here that describe the machine rather than the person, and
      they are what turns "three failed logins" into "three failed
      logins from one address in Latvia".
    */
    ipAddress: {
      type: String,
      default: "",
      trim: true,
      maxlength: [60, "IP address cannot be more than 60 characters"],
    },

    userAgent: {
      type: String,
      default: "",
      trim: true,
      maxlength: [300, "User agent cannot be more than 300 characters"],
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   The audit page asks four questions, and each one gets an index:

     "the newest entries"                  -> createdAt
     "everything in the User module"       -> module + createdAt
     "everything this person did"          -> actor + createdAt
     "everything about THIS request"       -> request + createdAt

   Every one of them is sorted newest-first, which is why createdAt is
   -1 in all four. An index that matches BOTH the filter and the sort
   lets MongoDB answer without loading and re-sorting the collection -
   and this is the one collection that only ever grows.
   ===================================================================== */
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ request: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
