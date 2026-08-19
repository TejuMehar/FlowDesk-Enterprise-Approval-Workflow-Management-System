/*
=========================================================================
  REQUEST CONSTANTS   (Module 2 - Request Management)
=========================================================================
  A frontend copy of backend/config/requestConstants.js.
  Used to fill the dropdowns on the Requests page and to pick the right
  colour for the little status/priority badges.

  THE REQUEST TYPES ARE NOT HERE ANY MORE   (Module 9)
  ----------------------------------------------------
  REQUEST_TYPES, REQUEST_CATEGORY_SUGGESTIONS, REQUEST_TYPES_WITH_AMOUNT
  and REQUEST_TYPES_WITH_DATES used to live in this file as a copy of
  four arrays that also lived in the backend - eight places to keep in
  step for one idea.

  An administrator owns them now, so they are DOWNLOADED instead:

      import useRequestTypes from "../CustomHooks/useRequestTypes.js";

  See that file. It is the same decision the Roles page has always
  made about the permission list: a list the backend validates against
  should only exist on the backend.

  WHAT STAYED, AND WHY IT IS DIFFERENT
  ------------------------------------
  Priorities and statuses are still written out below, because they are
  not configuration. "Approved" is a word the code BRANCHES ON - the
  badge colours here, the approval engine there - and a value the
  software has opinions about cannot be a value an admin edits.
=========================================================================
*/

export const REQUEST_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

/*
  The full life of a request. "Submitted" only appears on requests that
  were created before Module 4 existed - since then submitting starts the
  workflow, so a request goes straight from Draft to InProgress.
*/
export const REQUEST_STATUSES = [
  "Draft",
  "Submitted",
  "InProgress",
  "Returned",
  "Approved",
  "Rejected",
  "Cancelled",
];

// "InProgress" is not a word, so the UI shows these labels instead
export const REQUEST_STATUS_LABELS = {
  Draft: "Draft",
  Submitted: "Submitted",
  InProgress: "In Progress",
  Returned: "Returned",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
};

/*
  The statuses in which the owner may still edit and submit the request:
  a brand new draft, or one an approver handed back for a correction.
  Must match EDITABLE_REQUEST_STATUSES in the backend.
*/
export const EDITABLE_REQUEST_STATUSES = ["Draft", "Returned"];

/*
  Tailwind classes for each status badge.
  Kept in one place so every part of the UI shows the same colour for
  the same status.
*/
export const STATUS_BADGE_STYLES = {
  Draft: "bg-slate-100 text-slate-600",
  Submitted: "bg-blue-50 text-blue-700",
  InProgress: "bg-amber-50 text-amber-700",
  Returned: "bg-orange-50 text-orange-700",
  Approved: "bg-green-50 text-green-700",
  Rejected: "bg-red-50 text-red-600",
  Cancelled: "bg-slate-100 text-slate-500",
};

export const PRIORITY_BADGE_STYLES = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-blue-50 text-blue-700",
  High: "bg-orange-50 text-orange-700",
  Urgent: "bg-red-50 text-red-700",
};
