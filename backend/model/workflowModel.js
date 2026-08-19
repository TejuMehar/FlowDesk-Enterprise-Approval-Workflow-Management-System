/*
=========================================================================
  MODEL: Workflow                                 ( the "M" of MVC )
=========================================================================
  Module 3 - Workflow Builder.

  A Workflow is the APPROVAL ROUTE a request travels, for example:

      Employee  ->  Manager  ->  Finance  ->  Director  ->  Completed
                    |             |            |
                    stage 1       stage 2      stage 3

  "Employee" (the person who raised it) and "Completed" are always the
  first and last step, so we only store the middle part - the STAGES.

  This module only DESIGNS the route. Actually sending a request down
  the route (Approve / Reject buttons, moving from stage to stage) is a
  later module, exactly like Module 2 left approve/reject for later.
=========================================================================
*/

import mongoose from "mongoose";
import {
  APPROVER_TYPES,
  APPROVAL_RULES,
  ESCALATION_ACTIONS,
  AUTO_APPROVAL_FIELDS,
  AUTO_APPROVAL_OPERATORS,
} from "../config/workflowConstants.js";

/* =====================================================================
   SUB-SCHEMA 1 - one auto approval condition
   ---------------------------------------------------------------------
   Reads like a sentence:  amount  <=  5000
   ===================================================================== */
const conditionSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      required: true,
      enum: {
        values: AUTO_APPROVAL_FIELDS,
        message: "{VALUE} is not a valid auto approval field",
      },
    },

    operator: {
      type: String,
      required: true,
      enum: {
        values: AUTO_APPROVAL_OPERATORS,
        message: "{VALUE} is not a valid operator",
      },
    },

    /*
      Mixed = "any type". The value is a number for `amount` but text
      for `priority` / `category`, so we cannot pin it to one type here.
      The controller checks it matches the chosen field.
    */
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false } // these are tiny rows, they do not need their own id
);

/* =====================================================================
   SUB-SCHEMA 2 - one stage of the workflow
   ---------------------------------------------------------------------
   Stages live INSIDE the workflow document (an embedded array) instead
   of in their own collection, for the same reason attachments live
   inside a request: a stage is meaningless without its workflow, and we
   always read every stage together anyway.
   ===================================================================== */
const stageSchema = new mongoose.Schema(
  {
    // position in the chain: 1, 2, 3 ... always set by the controller
    order: {
      type: Number,
      required: true,
      min: [1, "Stage order starts at 1"],
    },

    name: {
      type: String,
      required: [true, "Stage name is required"],
      trim: true,
      minlength: [2, "Stage name must be at least 2 characters"],
      maxlength: [80, "Stage name cannot be more than 80 characters"],
    },

    /* ----------------------------------------------------------------
       WHO APPROVES THIS STAGE
       ----------------------------------------------------------------
       approverType decides WHICH of the three id fields below is used:

         RequesterManager -> none of them (worked out at approval time)
         Role             -> approverRole
         Department       -> approverDepartment
         User             -> approverUser

       The controller (validateStages) makes sure the right one is
       filled in and that it points at something that really exists.
       ---------------------------------------------------------------- */
    approverType: {
      type: String,
      required: [true, "Approver type is required"],
      enum: {
        values: APPROVER_TYPES,
        message: "{VALUE} is not a valid approver type",
      },
    },

    approverRole: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
    },

    approverDepartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    approverUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /* ----------------------------------------------------------------
       APPROVAL RULE - only matters when the stage can have more than
       one approver, e.g. "anyone with the Director role".
       ---------------------------------------------------------------- */
    approvalRule: {
      type: String,
      enum: {
        values: APPROVAL_RULES,
        message: "{VALUE} is not a valid approval rule",
      },
      default: "AnyOne",
    },

    /* ----------------------------------------------------------------
       ESCALATION RULE - what happens when nobody answers in time.
       ---------------------------------------------------------------- */
    escalation: {
      enabled: { type: Boolean, default: false },

      // how long to wait before escalating, in hours
      afterHours: {
        type: Number,
        default: 24,
        min: [1, "Escalation time must be at least 1 hour"],
      },

      // WHO it escalates to - same four options as approverType
      escalateTo: {
        type: String,
        enum: {
          values: APPROVER_TYPES,
          message: "{VALUE} is not a valid escalation target",
        },
        default: "RequesterManager",
      },

      escalateToRole: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
        default: null,
      },

      escalateToDepartment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: null,
      },

      escalateToUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      action: {
        type: String,
        enum: {
          values: ESCALATION_ACTIONS,
          message: "{VALUE} is not a valid escalation action",
        },
        default: "Notify",
      },
    },

    /* ----------------------------------------------------------------
       AUTO APPROVAL RULE - skip this stage automatically when the
       request is small enough that a human is not needed.

       ALL the conditions must be true for the stage to be skipped.
       ---------------------------------------------------------------- */
    autoApproval: {
      enabled: { type: Boolean, default: false },
      conditions: { type: [conditionSchema], default: [] },
    },
  },
  { _id: false }
);

/* =====================================================================
   THE WORKFLOW ITSELF
   ===================================================================== */
const workflowSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Workflow name is required"],
      unique: true,
      trim: true,
      minlength: [3, "Workflow name must be at least 3 characters"],
      maxlength: [80, "Workflow name cannot be more than 80 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot be more than 300 characters"],
      default: "",
    },

    /*
      WHICH kind of request this route is for, e.g. "Purchase".
      Only ONE workflow per type may be active at a time - the
      controller turns the others off when this one is switched on.

      MODULE 9 removed the `enum` here for exactly the reason given in
      requestModel.js: the list of request types is a collection now,
      and an enum frozen at import time cannot know about a type that
      was created after the server started. workflowController.js asks
      config/requestTypeService.js instead.
    */
    requestType: {
      type: String,
      required: [true, "Request type is required"],
      trim: true,
    },

    /*
      A workflow is built as a DRAFT (isActive: false) and only starts
      being used once an admin switches it on. That way a half-finished
      route never catches a real request.
    */
    isActive: {
      type: Boolean,
      default: false,
    },

    // the ordered chain of approval steps
    stages: {
      type: [stageSchema],
      default: [],
    },

    // soft delete, same pattern as Department / User
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
   The question a future approval module asks over and over is
   "which live workflow handles a Purchase request?", so that exact
   combination gets an index.
   ===================================================================== */
workflowSchema.index({ requestType: 1, isActive: 1, isDeleted: 1 });
workflowSchema.index({ isDeleted: 1 });

const Workflow = mongoose.model("Workflow", workflowSchema);

export default Workflow;
