/*
=========================================================================
  MODEL: Approval                                 ( the "M" of MVC )
=========================================================================
  Module 4 - Approval Engine.

  Module 3 DESIGNED the route a request travels:

      Employee  ->  Manager  ->  Finance  ->  Director  ->  Completed

  An Approval is one request actually TRAVELLING down that route. There
  is exactly ONE Approval document per request, and it answers three
  questions at any moment:

      1. WHERE is the request standing right now?   -> currentStage
      2. WHO may decide at that stage?              -> stages[].approvers
      3. WHAT already happened to it?               -> history[]

  WHY THE STAGES ARE COPIED INSTEAD OF LOOKED UP
  ----------------------------------------------
  We do NOT read the workflow again every time somebody presses Approve.
  Instead the whole chain of stages is COPIED into this document the
  moment the request is submitted.

  An admin is allowed to rebuild or switch off a workflow at any time,
  and a request that is halfway down the old route must not suddenly
  change shape underneath the people approving it. Copying the stages
  freezes the rules that applied on the day the employee pressed Submit,
  which is exactly how a paper approval form works.
=========================================================================
*/

import mongoose from "mongoose";
import {
  APPROVER_TYPES,
  APPROVAL_RULES,
} from "../config/workflowConstants.js";
import {
  APPROVAL_STATUSES,
  STAGE_STATUSES,
  APPROVAL_ACTIONS,
  HISTORY_ACTIONS,
  MAX_COMMENT_LENGTH,
} from "../config/approvalConstants.js";

/* =====================================================================
   SUB-SCHEMA 1 - one decision made by one person
   ---------------------------------------------------------------------
   A stage can need more than one answer ("Everyone must approve"), so
   every stage keeps a small list of the answers it has collected.
   ===================================================================== */
const decisionSchema = new mongoose.Schema(
  {
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    action: {
      type: String,
      required: true,
      enum: {
        values: APPROVAL_ACTIONS,
        message: "{VALUE} is not a valid approval action",
      },
    },

    comment: {
      type: String,
      trim: true,
      default: "",
      maxlength: [
        MAX_COMMENT_LENGTH,
        `Comment cannot be more than ${MAX_COMMENT_LENGTH} characters`,
      ],
    },

    decidedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* =====================================================================
   SUB-SCHEMA 2 - one stage of the running approval
   ---------------------------------------------------------------------
   The top half is the frozen COPY of the workflow stage (who should
   approve, under which rule). The bottom half is the LIVE state: has
   this stage been reached, who did it resolve to, what did they say.
   ===================================================================== */
const approvalStageSchema = new mongoose.Schema(
  {
    /* ---------- the frozen copy of the workflow stage ---------- */
    order: {
      type: Number,
      required: true,
      min: [1, "Stage order starts at 1"],
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    approverType: {
      type: String,
      required: true,
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

    approvalRule: {
      type: String,
      enum: {
        values: APPROVAL_RULES,
        message: "{VALUE} is not a valid approval rule",
      },
      default: "AnyOne",
    },

    // the frozen copy of the auto approval rule, e.g. "amount <= 5000"
    autoApproval: {
      enabled: { type: Boolean, default: false },
      conditions: {
        type: [
          {
            field: String,
            operator: String,
            value: mongoose.Schema.Types.Mixed,
          },
        ],
        default: [],
      },
    },

    /* ---------- the live state of this stage ---------- */

    /*
      THE REAL PEOPLE this stage points at.

      "Anyone with the Director role" is only a description - here we
      store the actual employees it worked out to. The list is filled in
      when the request is submitted and refreshed again the moment the
      request reaches this stage, so somebody who joined the Finance team
      last week is included too.
    */
    approvers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    status: {
      type: String,
      enum: {
        values: STAGE_STATUSES,
        message: "{VALUE} is not a valid stage status",
      },
      default: "Waiting",
    },

    decisions: { type: [decisionSchema], default: [] },

    // when the request arrived here / left again
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    /* ---------- Module 6: what the reminder engine has done here ----------

       The engine wakes up every half hour and looks at every stage that
       is still Pending. Without these three fields it would have no
       memory at all, and would send the same nudge every single time it
       ran.

         lastReminderAt - when the approvers were last nudged, so the
                          next nudge waits a full REMINDER_REPEAT_HOURS
         reminderCount  - only for the "3rd reminder" wording and to see
                          at a glance how badly a stage is stuck
         escalatedAt    - the moment somebody above the approver was
                          told. It is set once and never again, because
                          escalating the same stage every day would train
                          people to ignore it.                          */
    lastReminderAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },
    escalatedAt: { type: Date, default: null },
  },
  { _id: false }
);

/* =====================================================================
   SUB-SCHEMA 3 - one line of the timeline
   ---------------------------------------------------------------------
   The timeline is written once and never changed, so it is the honest
   record of what happened even after the request was re-submitted and
   the stages were reset.
   ===================================================================== */
const historySchema = new mongoose.Schema(
  {
    // which stage this line belongs to. null = the request as a whole
    stageOrder: { type: Number, default: null },
    stageName: { type: String, default: "" },

    action: {
      type: String,
      required: true,
      enum: {
        values: HISTORY_ACTIONS,
        message: "{VALUE} is not a valid history action",
      },
    },

    // WHO did it. Empty when the system itself did it (auto approval)
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    comment: {
      type: String,
      trim: true,
      default: "",
      maxlength: [
        MAX_COMMENT_LENGTH,
        `Comment cannot be more than ${MAX_COMMENT_LENGTH} characters`,
      ],
    },

    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* =====================================================================
   THE APPROVAL ITSELF
   ===================================================================== */
const approvalSchema = new mongoose.Schema(
  {
    // one approval per request, so this is unique
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      required: [true, "Request is required"],
      unique: true,
    },

    /*
      The workflow this came from. Kept only so an admin can see WHICH
      route was used - the stages above are already a frozen copy, so
      nothing here reads the workflow again.
    */
    workflow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workflow",
      default: null,
    },

    // the workflow name as it was on submit day, in case it is renamed
    workflowName: { type: String, default: "" },

    /*
      A copy of the requester. It is already on the Request, but having
      it here lets the engine check "you cannot approve your own request"
      without loading the request first.
    */
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Requester is required"],
    },

    /*
      The approver the employee asked for on the day they submitted,
      copied from request.chosenApprover.

      COPIED, for exactly the reason the stages above are copied: this
      document has to be able to answer "who decides here?" without
      reading anything else, and the request is editable while it sits in
      Draft. Freezing the choice on submit day means a request cannot
      quietly change who is judging it after it has started moving.

      Only ever used by a "RequesterManager" stage. null = use the org
      chart, which is what every approval made before this existed does.
    */
    chosenApprover: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: {
        values: APPROVAL_STATUSES,
        message: "{VALUE} is not a valid approval status",
      },
      default: "InProgress",
    },

    /*
      WHERE THE REQUEST IS STANDING, as a stage order (1, 2, 3 ...).
      0 means "not standing anywhere" - it is either finished, rejected
      or sitting back with the employee after a Return.
    */
    currentStage: {
      type: Number,
      default: 0,
      min: [0, "Current stage cannot be negative"],
    },

    stages: { type: [approvalStageSchema], default: [] },

    history: { type: [historySchema], default: [] },

    // how many times the employee submitted it (1 = never corrected)
    submissionCount: { type: Number, default: 1 },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   The question the Pending Approvals page asks over and over is
   "which running approvals are waiting on ME right now?", so we index
   the overall status together with the approver ids inside the stages.

   NOTE: "stages.status" is deliberately NOT part of that index. MongoDB
   refuses a compound index that would have to expand TWO arrays of the
   same document ("cannot index parallel arrays"), and stages.approvers
   is already the selective half of the pair.
   ===================================================================== */
approvalSchema.index({ status: 1, "stages.approvers": 1 });
approvalSchema.index({ requester: 1 });
approvalSchema.index({ "history.actor": 1 });

/* =====================================================================
   HELPER METHOD - the stage the request is standing at right now
   ---------------------------------------------------------------------
   Written as a method so the controller can say

       const stage = approval.getCurrentStage();

   instead of repeating the same .find() in five places.
   ===================================================================== */
approvalSchema.methods.getCurrentStage = function () {
  if (!this.currentStage) {
    return null;
  }

  return this.stages.find((stage) => stage.order === this.currentStage) || null;
};

/* =====================================================================
   HELPER METHOD - may this user decide on the current stage?
   ---------------------------------------------------------------------
   Two things must be true: the request is really standing at a stage,
   and that stage's approver list contains the user.
   ===================================================================== */
approvalSchema.methods.isCurrentApprover = function (userId) {
  const stage = this.getCurrentStage();

  if (!stage || stage.status !== "Pending") {
    return false;
  }

  // the ids are ObjectIds, so we compare them as text
  return stage.approvers.some(
    (approverId) => String(approverId) === String(userId)
  );
};

const Approval = mongoose.model("Approval", approvalSchema);

export default Approval;
