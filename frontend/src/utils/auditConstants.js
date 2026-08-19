/*
=========================================================================
  AUDIT CONSTANTS   (Module 7 - Audit Logs & Activity Tracking)
=========================================================================
  A frontend copy of backend/config/auditConstants.js.

  It fills the two dropdowns on the Audit Logs page (module and action),
  and gives every action a colour and an icon so a long table can be
  scanned without reading every line - a red row is somebody being
  removed, a green one somebody being approved.

  WHY THIS IS A COPY AND NOT A DOWNLOAD
  -------------------------------------
  The permission list IS downloaded (GET /api/role/permissions), because
  the Roles page has to tick boxes for permissions it has never heard
  of. These are different: they are labels and Tailwind classes, the
  frontend needs them before the first request finishes, and a missing
  one only means a plain grey row instead of a coloured one.

  Keep the lists in step with the backend file. Anything that is not
  listed here still WORKS - the helpers below fall back to the raw
  action name and a grey badge.
=========================================================================
*/

/* =====================================================================
   1) THE MODULES AN ACTION CAN BELONG TO
   ---------------------------------------------------------------------
   The "Module" dropdown. Same order as the backend, so the two files
   are easy to read side by side.
   ===================================================================== */
export const AUDIT_MODULES = [
  "Auth",
  "Request",
  "Approval",
  "Workflow",
  "User",
  "Role",
  "Department",
  "Comment",
  "Settings",
];

/* =====================================================================
   2) EVERY ACTION, GROUPED THE WAY THE DROPDOWN SHOWS THEM
   ---------------------------------------------------------------------
   The backend keeps one flat list; here they are grouped, because a
   dropdown with 35 items in a row is unusable. Each group becomes an
   <optgroup>, so the browser draws the headings for us.
   ===================================================================== */
export const AUDIT_ACTION_GROUPS = [
  {
    label: "Authentication",
    actions: ["Login", "LoginFailed", "Logout", "PasswordChanged", "PasswordReset"],
  },
  {
    label: "Requests",
    actions: [
      "RequestCreated",
      "RequestUpdated",
      "RequestDeleted",
      "RequestSubmitted",
      "AttachmentUploaded",
      "AttachmentDeleted", // Module 10
    ],
  },
  {
    label: "Approvals",
    actions: ["RequestApproved", "RequestRejected", "RequestReturned"],
  },
  {
    label: "Workflows",
    actions: [
      "WorkflowCreated",
      "WorkflowUpdated",
      "WorkflowDeleted",
      "WorkflowStagesSaved",
      "WorkflowActivated",
      "WorkflowDeactivated",
    ],
  },
  {
    label: "User management",
    actions: [
      "UserCreated",
      "UserUpdated",
      "UserDeleted",
      "UserActivated",
      "UserDeactivated",
      "UserRoleAssigned",
    ],
  },
  {
    label: "Roles",
    actions: ["RoleCreated", "RoleUpdated", "RoleDeleted"],
  },
  {
    label: "Departments",
    actions: [
      "DepartmentCreated",
      "DepartmentUpdated",
      "DepartmentDeleted",
      "DepartmentManagerAssigned",
    ],
  },
  {
    label: "Comments",
    actions: ["CommentAdded", "CommentDeleted"],
  },
  {
    label: "Settings",
    actions: ["SettingsUpdated"],
  },
];

/* =====================================================================
   3) HOW EACH ACTION IS WRITTEN IN ENGLISH
   ---------------------------------------------------------------------
   The badge in the "Action" column and the label in the dropdown. The
   full sentence next to it comes from the backend, frozen into the
   entry when it was written.
   ===================================================================== */
export const AUDIT_ACTION_LABELS = {
  Login: "Logged in",
  LoginFailed: "Failed login",
  Logout: "Logged out",
  PasswordChanged: "Changed password",
  PasswordReset: "Reset password",

  RequestCreated: "Created request",
  RequestUpdated: "Updated request",
  RequestDeleted: "Deleted request",
  RequestSubmitted: "Submitted request",
  AttachmentUploaded: "Uploaded attachment",
  AttachmentDeleted: "Removed attachment",

  RequestApproved: "Approved request",
  RequestRejected: "Rejected request",
  RequestReturned: "Returned request",

  WorkflowCreated: "Created workflow",
  WorkflowUpdated: "Updated workflow",
  WorkflowDeleted: "Deleted workflow",
  WorkflowStagesSaved: "Saved workflow stages",
  WorkflowActivated: "Activated workflow",
  WorkflowDeactivated: "Deactivated workflow",

  UserCreated: "Created user",
  UserUpdated: "Updated user",
  UserDeleted: "Deleted user",
  UserActivated: "Activated user",
  UserDeactivated: "Deactivated user",
  UserRoleAssigned: "Changed user role",

  RoleCreated: "Created role",
  RoleUpdated: "Updated role",
  RoleDeleted: "Deleted role",

  DepartmentCreated: "Created department",
  DepartmentUpdated: "Updated department",
  DepartmentDeleted: "Deleted department",
  DepartmentManagerAssigned: "Assigned department manager",

  CommentAdded: "Wrote a comment",
  CommentDeleted: "Deleted a comment",

  SettingsUpdated: "Updated settings",
};

/* =====================================================================
   4) THE COLOUR OF THE ACTION BADGE
   ---------------------------------------------------------------------
   Only the actions worth NOTICING get a colour; everything ordinary
   stays grey on purpose. A table where every row is coloured is a table
   where no colour means anything.

   The language is the same one the approvals already use:
     green = something was allowed    red = something was refused or lost
     orange = something came back     amber = something needs attention
   ===================================================================== */
export const AUDIT_ACTION_STYLES = {
  // the ones an admin scans for
  LoginFailed: "bg-red-50 text-red-700",
  RequestApproved: "bg-green-50 text-green-700",
  RequestRejected: "bg-red-50 text-red-700",
  RequestReturned: "bg-orange-50 text-orange-700",

  // anything that destroys something
  RequestDeleted: "bg-red-50 text-red-700",
  WorkflowDeleted: "bg-red-50 text-red-700",
  UserDeleted: "bg-red-50 text-red-700",
  RoleDeleted: "bg-red-50 text-red-700",
  DepartmentDeleted: "bg-red-50 text-red-700",
  CommentDeleted: "bg-red-50 text-red-700",

  // anything that changes what somebody is allowed to do
  UserRoleAssigned: "bg-amber-50 text-amber-700",
  UserDeactivated: "bg-amber-50 text-amber-700",
  UserActivated: "bg-green-50 text-green-700",
  RoleUpdated: "bg-amber-50 text-amber-700",
  SettingsUpdated: "bg-amber-50 text-amber-700",
  WorkflowActivated: "bg-green-50 text-green-700",
  WorkflowDeactivated: "bg-amber-50 text-amber-700",
};

/*
  The colour of the little pill in the "Module" column. These are all
  quiet on purpose - the module is context, not news.
*/
export const AUDIT_MODULE_STYLES = {
  Auth: "bg-slate-100 text-slate-600",
  Request: "bg-indigo-50 text-indigo-700",
  Approval: "bg-green-50 text-green-700",
  Workflow: "bg-purple-50 text-purple-700",
  User: "bg-blue-50 text-blue-700",
  Role: "bg-amber-50 text-amber-700",
  Department: "bg-teal-50 text-teal-700",
  Comment: "bg-slate-100 text-slate-600",
  Settings: "bg-slate-100 text-slate-600",
};

/* =====================================================================
   5) THE MERGED ACTIVITY TIMELINE
   ---------------------------------------------------------------------
   getRequestActivity returns entries from four sources. The source is
   what decides the icon and the colour of the dot, so a reader can tell
   a comment from a decision without reading either.
   ===================================================================== */
export const ACTIVITY_SOURCE_STYLES = {
  Audit: "bg-slate-100 text-slate-600",
  Approval: "bg-indigo-50 text-indigo-600",
  Comment: "bg-blue-50 text-blue-600",
  Attachment: "bg-teal-50 text-teal-600",
};

/*
  An approval entry is the one place where the SOURCE is not enough:
  approved, rejected and returned are three very different pieces of
  news and they all arrive as source "Approval". So the action wins
  when we know it.
*/
export const ACTIVITY_ACTION_STYLES = {
  Approved: "bg-green-50 text-green-600",
  Rejected: "bg-red-50 text-red-600",
  Returned: "bg-orange-50 text-orange-600",
  RequestDeleted: "bg-red-50 text-red-600",
  CommentDeleted: "bg-red-50 text-red-600",
};

/*
  Works out the colour of one timeline dot: the action if it is one of
  the loud ones, otherwise the source, otherwise grey.
*/
export const activityDotStyle = (entry) =>
  ACTIVITY_ACTION_STYLES[entry?.action] ||
  ACTIVITY_SOURCE_STYLES[entry?.source] ||
  "bg-slate-100 text-slate-600";

/* =====================================================================
   6) SMALL HELPERS
   ===================================================================== */

/*
  The label for an action, falling back to the raw name.

  The fallback is what lets the backend add an action without this file
  being updated first: the row still appears, just with "SomethingNew"
  written on it instead of a sentence.
*/
export const describeAction = (action) =>
  AUDIT_ACTION_LABELS[action] || action || "Unknown action";

/*
  "14 Aug 2026, 10:42".

  An audit log always needs the TIME as well as the day - "who changed
  this on Tuesday" is rarely the question; "what happened in the ten
  minutes before it broke" is. This is the same format
  ApprovalTimeline.jsx uses, so the two read alike.
*/
export const formatMoment = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
