/*
=========================================================================
  DASHBOARD CONSTANTS   (Module 5 - Dashboard & Analytics)
=========================================================================
  Small fixed lists used by the dashboard controller, the statistics
  helpers and (as a matching copy) the React frontend.

  Same idea as requestConstants.js / approvalConstants.js: keeping them
  in ONE file means the aggregation, the API validation and the labels in
  the UI can never drift apart.

  WHAT MODULE 5 IS
  ----------------
  Modules 2-4 gave every employee a way to raise a request and every
  approver a way to answer it. Module 5 does not add any new action - it
  only READS what those modules wrote and answers the three questions a
  dashboard exists for:

      "what is waiting for me?"        -> the employee dashboard
      "how is my team doing?"          -> the manager dashboard
      "how is the company doing?"      -> the admin dashboard + charts
=========================================================================
*/

/*
  THE THREE BUCKETS A DASHBOARD COUNTS IN.

  A request has seven possible statuses, but a dashboard card only wants
  to know "is it still moving, did it pass, or did it fail". These lists
  are that translation, written once.

    pending  -> somebody still has to look at it
                ("Submitted" only appears on requests made before
                 Module 4 existed, see requestConstants.js)
    approved -> it passed every stage
    rejected -> an approver said no

  Draft / Returned / Cancelled sit with the EMPLOYEE, not with an
  approver, so they are counted separately and never inside "pending".
*/
export const PENDING_REQUEST_STATUSES = ["Submitted", "InProgress"];
export const APPROVED_REQUEST_STATUSES = ["Approved"];
export const REJECTED_REQUEST_STATUSES = ["Rejected"];

/*
  The timeline actions that mean "an approver moved this request along".
  Used by the Approval Trends chart.

  "AutoApproved" is included on purpose: the request really did pass that
  stage, it just did not need a human. Leaving it out would make a
  company with good auto approval rules look like it approves nothing.
*/
export const APPROVED_HISTORY_ACTIONS = ["Approved", "AutoApproved"];
export const REJECTED_HISTORY_ACTIONS = ["Rejected"];
export const RETURNED_HISTORY_ACTIONS = ["Returned"];

/*
  THE THREE LINES A PERSON CAN WRITE IN A TIMELINE, used by the approver
  dashboard ("what have I decided?").

  "AutoApproved" is deliberately NOT here, which is the opposite choice
  from APPROVED_HISTORY_ACTIONS just above - and both are right, because
  the two lists answer different questions. The trends chart asks "did
  this request get through the stage?", where a rule counts. This list
  asks "what did I personally decide?", and a rule is not something
  anybody did. The distinction is free in practice: the system writes
  those lines with no actor at all, so a filter on actor could never
  have matched one.
*/
export const MY_DECISION_HISTORY_ACTIONS = ["Approved", "Rejected", "Returned"];

/*
  How far back the approver dashboard counts, and how many decisions it
  lists underneath. 30 days is the window that makes "24 approved" mean
  something - a lifetime total only ever grows and stops being news.
*/
export const MY_APPROVAL_DAYS = 30;
export const MY_DECISION_LIMIT = 6;

/*
  WHICH SLICE OF THE COMPANY A CHART IS ABOUT.

    org  -> everybody. Needs the "analytics:read" permission.
    team -> only the employees of the departments the caller manages.
            Needs no permission: being the manager of a department IS
            the permission, and that comes from the data itself.
*/
export const CHART_SCOPES = ["org", "team"];

/*
  How many months the charts look back.
  6 fits a dashboard card without the columns becoming hairlines; 24 is
  the most we let anybody ask for, so one URL cannot scan years of
  history in a single aggregation.
*/
export const DEFAULT_CHART_MONTHS = 6;
export const MIN_CHART_MONTHS = 3;
export const MAX_CHART_MONTHS = 24;

/*
  A donut stops being readable past about six slices, so the smaller
  request types are folded into one "Other" slice.
*/
export const MAX_CATEGORY_SLICES = 6;

// how many rows the "Recent Activity" and "Recent Requests" lists show
export const RECENT_ACTIVITY_LIMIT = 8;
export const RECENT_REQUEST_LIMIT = 5;

// how many people the manager dashboard lists under "most requests"
export const TOP_REQUESTER_LIMIT = 5;
