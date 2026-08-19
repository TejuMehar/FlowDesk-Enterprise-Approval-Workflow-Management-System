/*
=========================================================================
  APPROVAL CONSTANTS   (Module 4 - Approval Engine)
=========================================================================
  A frontend copy of backend/config/approvalConstants.js, plus the
  Tailwind classes the timeline and the badges use.

  WHAT THIS MODULE SHOWS
  ----------------------
  A request travels down the route an admin designed in Module 3:

      Employee -> Manager -> Finance -> Director -> Completed

  The pages here show WHERE a request is standing, WHO has to answer,
  and WHAT everybody said on the way.
=========================================================================
*/

export const APPROVAL_STATUSES = [
  "InProgress",
  "Approved",
  "Rejected",
  "Returned",
  "Cancelled",
];

export const APPROVAL_STATUS_LABELS = {
  InProgress: "In Progress",
  Approved: "Approved",
  Rejected: "Rejected",
  Returned: "Returned",
  Cancelled: "Cancelled",
};

/* =====================================================================
   ONE STAGE OF THE ROUTE
   ===================================================================== */

export const STAGE_STATUS_LABELS = {
  Waiting: "Not reached yet",
  Pending: "Waiting for a decision",
  Approved: "Approved",
  Rejected: "Rejected",
  Returned: "Returned for correction",
  Skipped: "Skipped",
};

/*
  The colour of the little dot next to each stage in the timeline.
  Kept in one place so the same state always looks the same.
*/
export const STAGE_DOT_STYLES = {
  Waiting: "bg-slate-200 text-slate-500",
  Pending: "bg-amber-100 text-amber-700 ring-4 ring-amber-50",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-600",
  Returned: "bg-orange-100 text-orange-700",
  Skipped: "bg-slate-100 text-slate-400",
};

export const STAGE_BADGE_STYLES = {
  Waiting: "bg-slate-100 text-slate-500",
  Pending: "bg-amber-50 text-amber-700",
  Approved: "bg-green-50 text-green-700",
  Rejected: "bg-red-50 text-red-600",
  Returned: "bg-orange-50 text-orange-700",
  Skipped: "bg-slate-100 text-slate-500",
};

/* =====================================================================
   THE TIMELINE
   ===================================================================== */

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

// the colour of the dot in the "what happened" list
export const HISTORY_DOT_STYLES = {
  Submitted: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-600",
  Returned: "bg-orange-100 text-orange-700",
  Resubmitted: "bg-blue-100 text-blue-700",
  AutoApproved: "bg-green-50 text-green-600",
  SkippedSelfApproval: "bg-slate-100 text-slate-500",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-slate-100 text-slate-500",
};

/*
  The shortest a Reject / Return comment may be. The backend refuses
  anything shorter, so the button is disabled until this is reached -
  that is friendlier than letting the user press it and get an error.
*/
export const MIN_COMMENT_LENGTH = 5;

export const MAX_COMMENT_LENGTH = 1000;

/* =====================================================================
   SMALL HELPERS
   ===================================================================== */

/*
  Turns a populated user into a readable name.
  The backend sometimes sends only the id (when nothing was populated),
  and the system itself has no user at all, so both cases get a fallback.
*/
export const describePerson = (user, fallback = "System") => {
  if (!user || typeof user !== "object") {
    return fallback;
  }

  const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();

  return name || user.employeeId || fallback;
};

/*
  Explains in one line WHO a stage points at, e.g.
  "Requester's Manager" or "Anyone with the Director role".

  The workflow only stores a description ("anyone with a role"), so this
  reads the populated role / department / user to make it concrete.
*/
export const describeStageApprover = (stage) => {
  if (!stage) {
    return "";
  }

  if (stage.approverType === "RequesterManager") {
    return "The requester's manager";
  }

  if (stage.approverType === "Role") {
    return `Anyone with the "${stage.approverRole?.name || "?"}" role`;
  }

  if (stage.approverType === "Department") {
    return `The manager of ${stage.approverDepartment?.name || "?"}`;
  }

  if (stage.approverType === "User") {
    return describePerson(stage.approverUser, "A specific person");
  }

  return "";
};

/*
  "Any one approver" / "Everyone must approve" / "Majority must approve".
  Only worth showing when a stage really has more than one approver.
*/
export const describeApprovalRule = (stage) => {
  if (!stage || (stage.approvers?.length || 0) < 2) {
    return "";
  }

  if (stage.approvalRule === "Everyone") {
    return "everyone must approve";
  }

  if (stage.approvalRule === "Majority") {
    return "a majority must approve";
  }

  return "any one of them can approve";
};
