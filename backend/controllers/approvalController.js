/*
=========================================================================
  CONTROLLER: Approval                            ( the "C" of MVC )
=========================================================================
  Module 4 - Approval Engine.

  FUNCTIONS IN THIS FILE
    getPendingApprovals   GET   /api/approval/pending
    getMyApprovalHistory  GET   /api/approval/history
    getApprovalByRequest  GET   /api/approval/request/:requestId
    approveRequest        POST  /api/approval/:requestId/approve
    rejectRequest         POST  /api/approval/:requestId/reject
    returnRequest         POST  /api/approval/:requestId/return

  The RULES all live in config/approvalEngine.js. This file only does
  the HTTP work: read the request, check that the person in front of us
  is really allowed to do this, hand over to the engine, save, answer.

  THE THREE BUTTONS
    Approve -> the stage is done, the engine routes to the next stage
    Reject  -> final. The request is dead and cannot be revived.
    Return  -> NOT final. The request goes back to the employee, who can
               correct it and submit it again.
=========================================================================
*/

import Approval from "../model/approvalModel.js";
import Request from "../model/requestModel.js";
import { isValidObjectId } from "../config/validation.js";
import { PERMISSIONS } from "../config/permissions.js";
import {
  REQUEST_PRIORITIES,
} from "../config/requestConstants.js";
/*
  MODULE 9 - the types are a collection now. This file only ever
  FILTERS by type, so it asks the loose question: a request raised
  under a type an admin has since retired must still be findable by
  the approver who has to decide it.
*/
import { isKnownRequestType } from "../config/requestTypeService.js";
import {
  ACTIONS_THAT_NEED_A_COMMENT,
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
} from "../config/approvalConstants.js";
import {
  addHistory,
  isStageSatisfied,
  runApprovalFrom,
} from "../config/approvalEngine.js";
import {
  notifyApproversOfPendingRequest,
  notifyRequesterApproved,
  notifyRequesterRejected,
  notifyRequesterReturned,
} from "../config/notificationService.js";
import {
  recordAudit,
  describePerson,
  describeRequest,
} from "../config/auditService.js";

/* =====================================================================
   HELPERS
   ===================================================================== */

/*
  The lists only need enough to fill a table row, so they populate the
  request and the person who raised it and nothing else.
*/
const LIST_POPULATE = [
  {
    path: "request",
    select:
      "requestId title type category priority status amount startDate endDate submittedAt createdAt",
  },
  {
    path: "requester",
    select: "firstName lastName employeeId email designation photoUrl",
  },
];

/*
  The timeline pop-up shows names everywhere - who may approve, who
  already did, who wrote which comment - so it populates far more.
*/
const DETAIL_POPULATE = [
  { path: "request" },
  {
    path: "requester",
    select: "firstName lastName employeeId email designation photoUrl",
  },
  { path: "stages.approvers", select: "firstName lastName employeeId photoUrl" },
  {
    path: "stages.decisions.approver",
    select: "firstName lastName employeeId photoUrl",
  },
  { path: "stages.approverRole", select: "name" },
  { path: "stages.approverDepartment", select: "name code" },
  { path: "stages.approverUser", select: "firstName lastName employeeId" },
  { path: "history.actor", select: "firstName lastName employeeId photoUrl" },
];

/*
  Search and the type / priority filters are about the REQUEST, not about
  the approval. So we first ask the Request collection which requests
  match, and then keep only the approvals that belong to them.

  Returns null when nothing needs filtering, so the caller can leave the
  approval filter untouched.
*/
const buildRequestIdFilter = async ({ search, type, priority }) => {
  const isRealType = Boolean(type) && (await isKnownRequestType(type));

  const hasFilter =
    (search && search.trim()) ||
    isRealType ||
    (priority && REQUEST_PRIORITIES.includes(priority));

  if (!hasFilter) {
    return null;
  }

  const requestFilter = { isDeleted: false };

  if (search && search.trim()) {
    const searchText = search.trim();
    requestFilter.$or = [
      { title: { $regex: searchText, $options: "i" } },
      { requestId: { $regex: searchText, $options: "i" } },
      { category: { $regex: searchText, $options: "i" } },
    ];
  }

  if (isRealType) {
    requestFilter.type = type;
  }

  if (priority && REQUEST_PRIORITIES.includes(priority)) {
    requestFilter.priority = priority;
  }

  const matches = await Request.find(requestFilter).select("_id").lean();

  return matches.map((request) => request._id);
};

/* =====================================================================
   1) PENDING APPROVALS   <- "what is waiting for ME?"
   ---------------------------------------------------------------------
   GET /api/approval/pending?page=1&limit=10&search=laptop&type=Laptop&priority=High

   $elemMatch means "ONE stage inside the array must match ALL of these
   at the same time". Without it Mongo would happily accept an approval
   where stage 1 is Pending and stage 3 happens to list me - which is
   somebody else's turn, not mine.

   The last line ("decisions.approver is not me") matters for stages with
   the rule "Everyone must approve": once I have answered, the stage is
   still Pending for my colleagues but it is no longer MY job.
   ===================================================================== */
export const getPendingApprovals = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    const filter = {
      status: "InProgress",
      stages: {
        $elemMatch: {
          status: "Pending",
          approvers: req.userId,
          "decisions.approver": { $ne: req.userId },
        },
      },
    };

    const requestIds = await buildRequestIdFilter(req.query);

    if (requestIds) {
      filter.request = { $in: requestIds };
    }

    const skip = (page - 1) * limit;

    const [approvals, totalApprovals] = await Promise.all([
      Approval.find(filter)
        .populate(LIST_POPULATE)
        .sort({ updatedAt: 1 }) // the one waiting the longest comes first
        .skip(skip)
        .limit(limit)
        // MODULE 10 - read-only list, see the note in requestController.js
        .lean(),
      Approval.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Pending approvals fetched successfully",
      approvals,
      pagination: {
        page,
        limit,
        totalApprovals,
        totalPages: Math.ceil(totalApprovals / limit),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Pending Approvals Error ${error}` });
  }
};

/* =====================================================================
   2) MY APPROVAL HISTORY   <- "what have I already decided?"
   ---------------------------------------------------------------------
   GET /api/approval/history?page=1&limit=10&search=&type=&priority=

   We look in the TIMELINE instead of in the stages, because the stages
   are rebuilt from scratch every time a returned request is submitted
   again - the timeline is the part that is never overwritten.
   ===================================================================== */
export const getMyApprovalHistory = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    const filter = {
      history: {
        $elemMatch: {
          actor: req.userId,
          action: { $in: ["Approved", "Rejected", "Returned"] },
        },
      },
    };

    const requestIds = await buildRequestIdFilter(req.query);

    if (requestIds) {
      filter.request = { $in: requestIds };
    }

    const skip = (page - 1) * limit;

    const [approvals, totalApprovals] = await Promise.all([
      Approval.find(filter)
        .populate(LIST_POPULATE)
        .sort({ updatedAt: -1 }) // most recently touched first
        .skip(skip)
        .limit(limit)
        // MODULE 10 - read-only list, see the note in requestController.js
        .lean(),
      Approval.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Approval history fetched successfully",
      approvals,
      pagination: {
        page,
        limit,
        totalApprovals,
        totalPages: Math.ceil(totalApprovals / limit),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Approval History Error ${error}` });
  }
};

/* =====================================================================
   3) THE FULL TIMELINE OF ONE REQUEST
   ---------------------------------------------------------------------
   GET /api/approval/request/:requestId

   WHO IS ALLOWED TO READ IT
     - the employee who raised the request
     - anybody the workflow points at, at any stage
     - anybody who already wrote a line in the timeline
     - an admin who may manage workflows (they have to be able to see
       why a route behaved the way it did)
   ===================================================================== */
export const getApprovalByRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const approval = await Approval.findOne({ request: requestId }).populate(
      DETAIL_POPULATE
    );

    if (!approval) {
      return res.status(404).json({
        message: "This request has not been sent through a workflow yet",
      });
    }

    const userId = String(req.userId);

    const isRequester = String(approval.requester?._id) === userId;

    const isApprover = approval.stages.some((stage) =>
      stage.approvers.some((approver) => String(approver?._id) === userId)
    );

    const wroteHistory = approval.history.some(
      (entry) => String(entry.actor?._id) === userId
    );

    const isWorkflowAdmin = (req.user.role?.permissions || []).includes(
      PERMISSIONS.WORKFLOW_READ
    );

    if (!isRequester && !isApprover && !wroteHistory && !isWorkflowAdmin) {
      return res
        .status(403)
        .json({ message: "You are not part of this approval" });
    }

    return res.status(200).json({
      message: "Approval fetched successfully",
      approval,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Approval Error ${error}` });
  }
};

/* =====================================================================
   4) THE DECISION ITSELF  -  shared by all three buttons
   ---------------------------------------------------------------------
   Approve / Reject / Return only differ in what happens AFTER the
   decision is written down, so everything before that is done once here.

   @param action - "Approve" | "Reject" | "Return"
   ===================================================================== */

// the timeline uses the past tense of the button
const HISTORY_ACTION_FOR = {
  Approve: "Approved",
  Reject: "Rejected",
  Return: "Returned",
};

const handleDecision = async (req, res, action) => {
  const { requestId } = req.params;
  const { comment } = req.body;

  if (!isValidObjectId(requestId)) {
    return res.status(400).json({ message: "Invalid request id" });
  }

  const cleanComment = String(comment || "").trim();

  /* ---- saying no must always say why ---- */
  if (
    ACTIONS_THAT_NEED_A_COMMENT.includes(action) &&
    cleanComment.length < MIN_COMMENT_LENGTH
  ) {
    return res.status(400).json({
      message:
        action === "Reject"
          ? `Please write at least ${MIN_COMMENT_LENGTH} characters explaining why you are rejecting this request`
          : `Please write at least ${MIN_COMMENT_LENGTH} characters explaining what the employee has to correct`,
    });
  }

  if (cleanComment.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({
      message: `Comment cannot be more than ${MAX_COMMENT_LENGTH} characters`,
    });
  }

  const approval = await Approval.findOne({ request: requestId });

  if (!approval) {
    return res.status(404).json({
      message: "This request is not going through an approval workflow",
    });
  }

  /* ---- is there anything to decide at all? ---- */
  if (approval.status !== "InProgress") {
    return res.status(400).json({
      message: `This request is not waiting for a decision any more (it is ${approval.status})`,
    });
  }

  const stage = approval.getCurrentStage();

  if (!stage || stage.status !== "Pending") {
    return res
      .status(400)
      .json({ message: "This request is not standing at any stage right now" });
  }

  /* ---- nobody approves their own request ---- */
  if (String(approval.requester) === String(req.userId)) {
    return res
      .status(403)
      .json({ message: "You cannot decide on your own request" });
  }

  /* ---- is it really this user's turn? ---- */
  if (!approval.isCurrentApprover(req.userId)) {
    return res
      .status(403)
      .json({ message: "This request is not waiting for your decision" });
  }

  /* ---- one answer per person per stage ---- */
  const alreadyAnswered = stage.decisions.some(
    (decision) => String(decision.approver) === String(req.userId)
  );

  if (alreadyAnswered) {
    return res.status(400).json({
      message: "You have already given your decision at this stage",
    });
  }

  const request = await Request.findOne({ _id: requestId, isDeleted: false });

  if (!request) {
    return res.status(404).json({ message: "Request not found" });
  }

  /* ---- write the decision down, whatever it is ---- */
  stage.decisions.push({
    approver: req.userId,
    action,
    comment: cleanComment,
    decidedAt: new Date(),
  });

  addHistory(approval, {
    stageOrder: stage.order,
    stageName: stage.name,
    action: HISTORY_ACTION_FOR[action],
    actor: req.userId,
    comment: cleanComment,
  });

  let message = "";

  /* =================================================================
     WHAT HAPPENS NEXT
     ================================================================= */
  if (action === "Reject") {
    /*
      A rejection is FINAL and does not wait for the other approvers -
      one "no" is enough, exactly like a veto on paper.
    */
    stage.status = "Rejected";
    stage.completedAt = new Date();

    approval.status = "Rejected";
    approval.currentStage = 0;
    approval.completedAt = new Date();
    request.status = "Rejected";

    message = "Request rejected";
  } else if (action === "Return") {
    /*
      Returning is NOT final: the request goes back to the employee, who
      may edit it and submit it again. Submitting again starts the route
      from stage 1 (see approvalEngine.js), because the second version is
      a different document from the one that was already approved.
    */
    stage.status = "Returned";
    stage.completedAt = new Date();

    approval.status = "Returned";
    approval.currentStage = 0;
    approval.completedAt = null;
    request.status = "Returned";

    message = "Request returned to the employee for correction";
  } else if (isStageSatisfied(stage)) {
    /* ---- this stage has collected enough yeses ---- */
    stage.status = "Approved";
    stage.completedAt = new Date();

    // the engine walks on and finds the next stage that needs a human
    await runApprovalFrom(approval, request, stage.order + 1);

    if (approval.status === "Approved") {
      message = "Final approval given. This request is now fully approved.";
    } else {
      const nextStage = approval.getCurrentStage();
      message = `Approved. The request has moved to "${nextStage.name}".`;
    }
  } else {
    /*
      The rule is "Everyone" or "Majority" and we are not there yet, so
      the stage stays open and waits for the other approvers.
    */
    const yesCount = stage.decisions.filter(
      (decision) => decision.action === "Approve"
    ).length;

    message = `Your approval was recorded (${yesCount} of ${stage.approvers.length}). Waiting for the other approvers.`;
  }

  await approval.save();
  await request.save({ validateBeforeSave: false });

  // read it back with all the names filled in, for the timeline in the UI
  const savedApproval = await Approval.findById(approval._id).populate(
    DETAIL_POPULATE
  );

  /* =====================================================================
     MODULE 6 - TELL THE PEOPLE THIS DECISION AFFECTS
     ---------------------------------------------------------------------
     Exactly ONE of these four things is true after a decision, and each
     one has a different audience:

       Rejected  -> the employee, with the reason. Final.
       Returned  -> the employee, with what to correct. Not final.
       Approved and finished -> the employee: it is done.
       Approved and moved on -> the approvers of the NEXT stage, who
                                until this second knew nothing about it.

     When the rule is "Everyone" and we are still waiting for a
     colleague, none of the four is true and nobody is told anything -
     which is right: nothing has changed for anybody outside this stage.

     NOTE which approval object goes where. The notifications read raw
     ids out of `approval`, while `savedApproval.requester` is used only
     for the NAME in the sentence - savedApproval has everything
     populated, and populated documents are objects, not ids.
     ===================================================================== */
  if (action === "Reject") {
    await notifyRequesterRejected(request, req.user, cleanComment);
  } else if (action === "Return") {
    await notifyRequesterReturned(request, req.user, cleanComment);
  } else if (approval.status === "Approved") {
    await notifyRequesterApproved(request);
  } else if (approval.status === "InProgress" && stage.status === "Approved") {
    // the stage we just answered is done, so the request has moved on
    await notifyApproversOfPendingRequest(
      request,
      approval,
      savedApproval.requester
    );
  }

  /* =====================================================================
     MODULE 7 - WRITE THE DECISION INTO THE AUDIT LOG
     ---------------------------------------------------------------------
     The decision is already in TWO places by now: on the stage as a
     `decision`, and in the approval's own `history`. So why a third?

     Because those two live INSIDE the approval, and an approval is
     rebuilt from stage 1 every time a returned request is corrected
     and sent down the route again. The audit log sits outside all of
     that: it is the only copy nothing in FlowDesk ever rewrites, and
     the only one that can be searched next to a role change and a
     login from the same afternoon.

     The stage name goes into the description because "approved" means
     very little on its own - "approved at stage 2: Finance Review"
     is the sentence somebody is actually looking for.
     ===================================================================== */
  const AUDIT_ACTION_FOR = {
    Approve: "RequestApproved",
    Reject: "RequestRejected",
    Return: "RequestReturned",
  };

  const PAST_TENSE = {
    Approve: "approved",
    Reject: "rejected",
    Return: "returned for correction",
  };

  await recordAudit(req, {
    action: AUDIT_ACTION_FOR[action],
    targetType: "Request",
    targetId: request._id,
    targetLabel: describeRequest(request),
    request: request._id,
    description: `${describePerson(req.user)} ${
      PAST_TENSE[action]
    } ${describeRequest(request)} at stage ${stage.order}: ${stage.name}${
      cleanComment ? ` - "${cleanComment}"` : ""
    }`,
  });

  return res.status(200).json({
    message,
    approval: savedApproval,
  });
};

/* =====================================================================
   5) THE THREE BUTTONS
   ---------------------------------------------------------------------
   They are separate routes (and separate permissions) so an admin can
   build a role that may approve but never reject, for example.
   ===================================================================== */
export const approveRequest = async (req, res) => {
  try {
    return await handleDecision(req, res, "Approve");
  } catch (error) {
    return res.status(500).json({ message: `Approve Request Error ${error}` });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    return await handleDecision(req, res, "Reject");
  } catch (error) {
    return res.status(500).json({ message: `Reject Request Error ${error}` });
  }
};

export const returnRequest = async (req, res) => {
  try {
    return await handleDecision(req, res, "Return");
  } catch (error) {
    return res.status(500).json({ message: `Return Request Error ${error}` });
  }
};
