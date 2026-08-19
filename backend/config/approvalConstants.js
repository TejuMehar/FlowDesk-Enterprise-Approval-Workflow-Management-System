/*
=========================================================================
  APPROVAL CONSTANTS   (Module 4 - Approval Engine)
=========================================================================
  Small fixed lists used by the Approval model, the approval engine, the
  controller and (as a matching copy) the React frontend.

  Same idea as requestConstants.js and workflowConstants.js: keeping them
  in ONE file means the model's `enum` check, the controller's validation
  and the labels in the UI can never drift apart.

  WHAT IS AN APPROVAL?
  --------------------
  Module 3 DESIGNED the route a request travels:

      Employee  ->  Manager  ->  Finance  ->  Director  ->  Completed

  An Approval is one request actually TRAVELLING down that route. It
  remembers which stage the request is standing at right now, who is
  allowed to decide, and every decision that was already made.
=========================================================================
*/

/*
  THE STATE OF THE WHOLE APPROVAL

  InProgress -> waiting at one of the stages
  Approved   -> every stage said yes. Final.
  Rejected   -> somebody said no. Final.
  Returned   -> somebody handed it back to the employee for a correction.
                Not final: the employee can fix it and submit again.
  Cancelled  -> the employee withdrew the request while it was running.
*/
export const APPROVAL_STATUSES = [
  "InProgress",
  "Approved",
  "Rejected",
  "Returned",
  "Cancelled",
];

/*
  THE STATE OF ONE SINGLE STAGE

  Waiting  -> the request has not reached this stage yet
  Pending  -> the request is standing HERE, somebody must decide
  Approved -> this stage said yes, the request moved on
  Rejected -> this stage said no
  Returned -> this stage handed the request back to the employee
  Skipped  -> nobody had to look at it, because either
                - the stage's auto approval rule matched, or
                - the only approver was the requester themselves
*/
export const STAGE_STATUSES = [
  "Waiting",
  "Pending",
  "Approved",
  "Rejected",
  "Returned",
  "Skipped",
];

/*
  WHAT AN APPROVER CAN DO with the request in front of them.
  These are the three buttons on the "Pending Approvals" page.
*/
export const APPROVAL_ACTIONS = ["Approve", "Reject", "Return"];

/*
  Reject and Return must always say WHY, otherwise the employee has no
  idea what to fix. Approve may be silent.
*/
export const ACTIONS_THAT_NEED_A_COMMENT = ["Reject", "Return"];

/*
  EVERY LINE THAT CAN APPEAR IN THE TIMELINE.

  The first four are written by a person, the rest by the system itself
  (actor stays empty for those).
*/
export const HISTORY_ACTIONS = [
  "Submitted",
  "Approved",
  "Rejected",
  "Returned",
  "Resubmitted",
  "AutoApproved",
  "SkippedSelfApproval",
  "Completed",
  "Cancelled",
];

// friendly text for the timeline in the UI
export const HISTORY_ACTION_LABELS = {
  Submitted: "Request submitted",
  Approved: "Approved",
  Rejected: "Rejected",
  Returned: "Returned for correction",
  Resubmitted: "Corrected and submitted again",
  AutoApproved: "Approved automatically by a rule",
  SkippedSelfApproval: "Stage skipped (nobody else could approve it)",
  Completed: "Final approval - request completed",
  Cancelled: "Request cancelled by the employee",
};

/*
  The shortest a Reject / Return comment may be. Long enough to stop a
  lazy "no", short enough not to be annoying.
*/
export const MIN_COMMENT_LENGTH = 5;

export const MAX_COMMENT_LENGTH = 1000;
