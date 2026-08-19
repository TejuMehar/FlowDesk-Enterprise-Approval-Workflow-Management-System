/*
=========================================================================
  WHO IS PART OF A REQUEST?   (Module 6 - Notification & Communication)
=========================================================================
  Two different features need to answer exactly the same question, and
  they must never answer it differently:

    COMMENTS      "may this user read and write on this request?"
    NOTIFICATIONS "who has to be told that somebody just wrote on it?"

  If those two lists ever drifted apart we would get the worst possible
  bug: a notification telling somebody about a conversation they are not
  allowed to open.

  So the list is worked out ONCE, here, and both sides use it.

  THE PEOPLE ON A REQUEST
  -----------------------
    1. the employee who raised it
    2. everybody the workflow points at, at ANY stage - not only the
       stage it is standing at, because an approver who said yes
       yesterday still has an interest in what happens next
    3. everybody who already wrote a line in the timeline (an approver
       whose role was taken away still owns what they said)

  ADMINS ARE DELIBERATELY NOT ON THAT LIST.
  An admin with workflow:read may READ any conversation (that is how
  they debug a route that behaved strangely), but they are not part of
  it, so they are not notified about every comment in the company. The
  two ideas are kept apart below: canViewRequest() vs getParticipants().
=========================================================================
*/

import Approval from "../model/approvalModel.js";
import Request from "../model/requestModel.js";
import { PERMISSIONS } from "./permissions.js";

/* =====================================================================
   1) LOAD THE REQUEST AND ITS APPROVAL TOGETHER
   ---------------------------------------------------------------------
   Almost everything below needs both, and a request that was never
   submitted has no approval at all - which is normal, not an error.

   @returns { request, approval } - either can be null
   ===================================================================== */
export const loadRequestWithApproval = async (requestId) => {
  const request = await Request.findOne({
    _id: requestId,
    isDeleted: false,
  })
    .populate("requester", "firstName lastName employeeId email")
    .lean();

  if (!request) {
    return { request: null, approval: null };
  }

  const approval = await Approval.findOne({ request: request._id }).lean();

  return { request, approval };
};

/* =====================================================================
   2) THE PEOPLE WHO BELONG TO THIS REQUEST
   ---------------------------------------------------------------------
   @returns an array of user ids as TEXT (not ObjectIds), because the
            only thing anybody does with them is compare and de-duplicate

   A Set is used instead of an array so the same person cannot appear
   twice - an approver who is named at two stages is still one person.
   ===================================================================== */
export const getParticipants = (request, approval) => {
  const people = new Set();

  if (request?.requester) {
    // the requester may be populated (an object) or just an id
    people.add(String(request.requester._id || request.requester));
  }

  if (approval) {
    approval.stages?.forEach((stage) => {
      stage.approvers?.forEach((approverId) => people.add(String(approverId)));
    });

    approval.history?.forEach((entry) => {
      if (entry.actor) {
        people.add(String(entry.actor));
      }
    });
  }

  return [...people];
};

/* =====================================================================
   3) THE PEOPLE THE REQUEST IS WAITING FOR RIGHT NOW
   ---------------------------------------------------------------------
   Only the stage it is standing at, and only the approvers who have not
   answered yet. This is the list that gets "a request needs your
   approval" and every reminder.

   The "already answered" part matters for a stage with the rule
   "Everyone must approve": once I have said yes the stage is still
   Pending for my colleagues, but it is no longer MY job, so nudging me
   about it would be wrong.
   ===================================================================== */
export const getWaitingApprovers = (approval) => {
  if (!approval || approval.status !== "InProgress") {
    return [];
  }

  const stage = approval.stages?.find(
    (item) => item.order === approval.currentStage
  );

  if (!stage || stage.status !== "Pending") {
    return [];
  }

  const answered = new Set(
    (stage.decisions || []).map((decision) => String(decision.approver))
  );

  return (stage.approvers || [])
    .map((approverId) => String(approverId))
    .filter((approverId) => !answered.has(approverId));
};

/* =====================================================================
   4) MAY THIS USER OPEN THE CONVERSATION?
   ---------------------------------------------------------------------
   Being part of the request is the normal way in. An admin who may read
   workflows gets in as well, for the reason explained at the top of the
   file - it is the same rule approvalController.js already uses for the
   timeline, so a person who can see the decisions can also see the
   conversation that led to them.

   @param user - req.user, so we can read their role's permissions
   ===================================================================== */
export const canViewRequest = (request, approval, user) => {
  const userId = String(user?._id || "");

  if (!userId) {
    return false;
  }

  if (getParticipants(request, approval).includes(userId)) {
    return true;
  }

  return (user.role?.permissions || []).includes(PERMISSIONS.WORKFLOW_READ);
};
