/*
=========================================================================
  AUDIT CONSTANTS   (Module 7 - Audit Logs & Activity Tracking)
=========================================================================
  The fixed lists behind the audit log: every action FlowDesk records,
  which module it belongs to, and how it is written in English.

  Same idea as requestConstants.js and notificationConstants.js - the
  model's `enum`, the service that writes the entries and the labels in
  the React table all read from THIS file, so they can never drift
  apart.

  WHAT MODULE 7 IS FOR
  --------------------
  Modules 1 to 6 all write down the RESULT of what people do: a request
  ends up Approved, a user ends up deactivated, a workflow ends up
  active. What none of them keep is the ANSWER TO "WHO DID THAT, AND
  WHEN?".

  The moment somebody asks "why is Ravi's role suddenly Employee?" or
  "who deleted that workflow last Tuesday?", the data can only shrug.
  Module 7 is the missing witness:

    AUDIT LOG          one row per action, for the whole company, kept
                       forever and never edited
    ACTIVITY TIMELINE  the same rows for ONE request, merged with its
                       comments, its attachments and its approval
                       history, so a single request tells its whole
                       story on one screen

  THE ONE RULE OF THE AUDIT LOG
  -----------------------------
  IT IS WRITE ONCE. There is no update route and no delete route
  anywhere in this module, and there is no TTL index on the collection.
  A record that the person being investigated could edit is not a
  record at all - see the long note at the bottom of auditModel.js.
=========================================================================
*/

/* =====================================================================
   1) THE MODULES AN ACTION CAN BELONG TO
   ---------------------------------------------------------------------
   Only used for grouping and filtering ("show me everything that
   happened to users"), never for a security decision.
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
  "Attendance",
  "Salary",
];

/* =====================================================================
   2) EVERY ACTION FLOWDESK RECORDS
   ---------------------------------------------------------------------
   The names are written in the PAST TENSE ("RequestCreated", not
   "CreateRequest") because an audit entry is always a statement about
   something that has already happened.

   Adding a new one is a three step job: put the name here, give it a
   module in ACTION_MODULE and a sentence in AUDIT_ACTION_LABELS below.
   The model, the filters and the UI then pick it up on their own.
   ===================================================================== */
export const AUDIT_ACTIONS = [
  // ---- Auth (Module 1) ----
  "Login",
  "LoginFailed",
  "Logout",
  "PasswordChanged",
  "PasswordReset",

  // ---- Requests (Module 2) ----
  "RequestCreated",
  "RequestUpdated",
  "RequestDeleted",
  "RequestSubmitted",
  "AttachmentUploaded",
  /*
    MODULE 10. The other half of AttachmentUploaded, and the reason it
    was worth adding: after a file is removed, NOTHING on screen shows
    that it was ever there. An upload at least leaves the file behind
    as evidence of itself; a delete leaves an absence.

    There is deliberately no "AttachmentDownloaded" next to it - see
    the note above downloadAttachment() in controllers/fileController.js.
  */
  "AttachmentDeleted",

  // ---- Approvals (Module 4) ----
  "RequestApproved",
  "RequestRejected",
  "RequestReturned",

  // ---- Workflows (Module 3) ----
  "WorkflowCreated",
  "WorkflowUpdated",
  "WorkflowDeleted",
  "WorkflowStagesSaved",
  "WorkflowActivated",
  "WorkflowDeactivated",

  // ---- User management (Module 1) ----
  "UserCreated",
  "UserUpdated",
  "UserDeleted",
  "UserActivated",
  "UserDeactivated",
  "UserRoleAssigned",

  // ---- Roles (Module 1) ----
  "RoleCreated",
  "RoleUpdated",
  "RoleDeleted",

  // ---- Departments (Module 1) ----
  "DepartmentCreated",
  "DepartmentUpdated",
  "DepartmentDeleted",
  "DepartmentManagerAssigned",

  // ---- Comments (Module 6) ----
  "CommentAdded",
  "CommentDeleted",

  /*
    ---- System configuration (Module 9) ----

    These are the quietest changes anybody can make in FlowDesk, and
    the reason the audit log was built. Nothing on a settings screen
    announces itself: retiring a request type simply makes an option
    stop appearing, and pointing the mail server somewhere new changes
    nothing an employee can see at all. Without a row here, the only
    record that any of it happened would be somebody's memory.
  */
  "SettingsUpdated",
  "CompanyLogoUpdated",
  "SmtpUpdated",
  "SmtpTested",
  "RequestTypeCreated",
  "RequestTypeUpdated",
  "RequestTypeDeleted",

  /*
    ---- Attendance (Module 11) ----

    THREE ACTIONS, AND NOT ONE OF THEM IS A PUNCH.

    Clocking in, taking a break and clocking out are deliberately NOT
    audited. An attendance record is already its own audit trail: it
    stores the exact instant of every punch and every break, an
    ordinary punch never overwrites an earlier one, and the Attendance
    page shows all of it. Copying each punch in here would double the
    busiest write in the application to record something that is
    already recorded, and would bury the log under a thousand rows a
    day that say nothing new.

    What IS audited is everything that happens TO a record without its
    owner doing it:

      AttendanceCorrected      a manager changed somebody's hours
      AttendancePolicyUpdated  the shift or the break allowance moved
      AttendanceExported       somebody took the file out of the building

    Those three are the ones nobody could otherwise prove afterwards -
    and the ones an employee would want proof of.
  */
  "AttendanceCorrected",
  "AttendancePolicyUpdated",
  "AttendanceExported",

  /*
    ---- Salary (Module 12) ----

    SIX ACTIONS, AND EVERY ONE OF THEM IS ABOUT SOMEBODY'S MONEY.

    Module 11 audits only what happens TO a record without its owner
    doing it, and leaves the punches out because the attendance record
    is already its own trail. Payroll gets the opposite treatment: a
    payslip is frozen and never rewritten, so the DOCUMENT can never
    say who released it, who changed the number before it was released
    or who cancelled it afterwards. The log is the only place any of
    that can live.

      SalaryStructureUpdated  somebody's standing pay changed
      PayrollGenerated        a month was run
      PayslipAdjusted         a draft's numbers were edited before
                              anybody was told
      PayrollPublished        the month was released to employees
      PayslipPaid             the money went out
      PayslipCancelled        a slip an employee may already have seen
                              was withdrawn
      SalaryExported          somebody took the payroll out of the
                              building

    THERE IS NO "PayslipDownloaded", the same decision Module 10 made
    about attachments: an employee opening their own payslip for the
    fourth time is not an event, and a log full of it would bury the
    six above.
  */
  "SalaryStructureUpdated",
  "PayrollGenerated",
  "PayslipAdjusted",
  "PayrollPublished",
  "PayslipPaid",
  "PayslipCancelled",
  "SalaryExported",
];

/* =====================================================================
   3) WHICH MODULE EACH ACTION BELONGS TO
   ---------------------------------------------------------------------
   The module is worked out HERE rather than being passed in by every
   caller. Two reasons:

     - a controller cannot accidentally file "UserDeleted" under
       "Request" and hide it from the wrong filter
     - moving an action to another module is one line in this file
       instead of a hunt through nine controllers
   ===================================================================== */
export const ACTION_MODULE = {
  Login: "Auth",
  LoginFailed: "Auth",
  Logout: "Auth",
  PasswordChanged: "Auth",
  PasswordReset: "Auth",

  RequestCreated: "Request",
  RequestUpdated: "Request",
  RequestDeleted: "Request",
  RequestSubmitted: "Request",
  AttachmentUploaded: "Request",
  AttachmentDeleted: "Request",

  RequestApproved: "Approval",
  RequestRejected: "Approval",
  RequestReturned: "Approval",

  WorkflowCreated: "Workflow",
  WorkflowUpdated: "Workflow",
  WorkflowDeleted: "Workflow",
  WorkflowStagesSaved: "Workflow",
  WorkflowActivated: "Workflow",
  WorkflowDeactivated: "Workflow",

  UserCreated: "User",
  UserUpdated: "User",
  UserDeleted: "User",
  UserActivated: "User",
  UserDeactivated: "User",
  UserRoleAssigned: "User",

  RoleCreated: "Role",
  RoleUpdated: "Role",
  RoleDeleted: "Role",

  DepartmentCreated: "Department",
  DepartmentUpdated: "Department",
  DepartmentDeleted: "Department",
  DepartmentManagerAssigned: "Department",

  CommentAdded: "Comment",
  CommentDeleted: "Comment",

  SettingsUpdated: "Settings",
  CompanyLogoUpdated: "Settings",
  SmtpUpdated: "Settings",
  SmtpTested: "Settings",
  RequestTypeCreated: "Settings",
  RequestTypeUpdated: "Settings",
  RequestTypeDeleted: "Settings",

  AttendanceCorrected: "Attendance",
  AttendancePolicyUpdated: "Attendance",
  AttendanceExported: "Attendance",

  SalaryStructureUpdated: "Salary",
  PayrollGenerated: "Salary",
  PayslipAdjusted: "Salary",
  PayrollPublished: "Salary",
  PayslipPaid: "Salary",
  PayslipCancelled: "Salary",
  SalaryExported: "Salary",
};

/* =====================================================================
   4) HOW EACH ACTION IS WRITTEN IN ENGLISH
   ---------------------------------------------------------------------
   The short label for the table column and the filter dropdown. The
   full sentence ("Ravi Sharma submitted REQ-0007 - New laptop") is
   built by auditService.js, because only it knows the names involved.
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
  CompanyLogoUpdated: "Changed the company logo",
  SmtpUpdated: "Changed the mail server",
  SmtpTested: "Sent a test email",
  RequestTypeCreated: "Created request type",
  RequestTypeUpdated: "Updated request type",
  RequestTypeDeleted: "Deleted request type",

  AttendanceCorrected: "Corrected an attendance record",
  AttendancePolicyUpdated: "Changed the working pattern",
  AttendanceExported: "Exported attendance",

  SalaryStructureUpdated: "Changed a salary structure",
  PayrollGenerated: "Generated payroll",
  PayslipAdjusted: "Adjusted a draft payslip",
  PayrollPublished: "Published payroll",
  PayslipPaid: "Marked a payslip paid",
  PayslipCancelled: "Cancelled a payslip",
  SalaryExported: "Exported payroll",
};

/* =====================================================================
   5) WHAT AN ACTION WAS DONE TO
   ---------------------------------------------------------------------
   The audit log points at documents in nine different collections, so
   it cannot use a single mongoose `ref`. Instead it stores the KIND of
   thing next to its id - the pattern databases usually call a
   "polymorphic reference".

   "Auth" is in the list because logging in is done to nothing at all;
   the target of a login is the person themselves.
   ===================================================================== */
export const AUDIT_TARGET_TYPES = [
  "Request",
  "User",
  "Role",
  "Department",
  "Workflow",
  "Comment",
  "Settings",
  "RequestType",
  "Auth",
  /*
    MODULE 11. "Attendance" points at one day of one employee.
    "AttendancePolicy" points at a department's working pattern - or at
    the COMPANY default, whose targetId is deliberately null, because
    the company is the one thing in this list that is not a document.
  */
  "Attendance",
  "AttendancePolicy",
  /*
    MODULE 12. "Payslip" points at one month of one employee.
    "SalaryStructure" points at what somebody is paid, standing - and
    a payroll RUN points at the whole month, so its targetId is null
    and its label is the month itself ("July 2026"), the same way the
    company-wide working pattern has no document to point at.
  */
  "Payslip",
  "SalaryStructure",
];

/* =====================================================================
   6) DID IT WORK?
   ---------------------------------------------------------------------
   Almost every entry is a Success, because a controller only records
   an action AFTER it has been saved.

   "Failure" exists for the one case that is worth keeping even though
   nothing happened: a wrong password. Five failed logins in a minute
   is the single most useful thing an audit log can show an admin, and
   a log that only remembers successful logins can never show it.
   ===================================================================== */
export const AUDIT_STATUSES = ["Success", "Failure"];

/* =====================================================================
   7) THE KINDS OF ENTRY IN THE MERGED TIMELINE
   ---------------------------------------------------------------------
   The Activity Timeline of one request is built from FOUR sources, and
   the UI draws a different icon for each:

     Audit       the request's own life: created, edited, submitted
     Approval    every decision, with the stage it was made at
     Comment     the conversation, with what was actually said
     Attachment  each file, with the moment it arrived

   EACH SOURCE CONTRIBUTES ONLY WHAT ONLY IT KNOWS, and that is the
   whole trick of this feature. The audit log also has a row for every
   approval and every comment, so merging all of it blindly would show
   each decision twice - once thinly ("Approved request REQ-0007") and
   once properly ("Approved at stage 2: Finance Review - 'budget is
   fine'").

   So the merge asks each source for the part it tells best, and the
   audit slice is deliberately narrow (see below).
   ===================================================================== */
export const ACTIVITY_SOURCES = ["Audit", "Approval", "Comment", "Attachment"];

/* =====================================================================
   8) THE AUDIT ACTIONS THE TIMELINE TAKES
   ---------------------------------------------------------------------
   Only the four events in a request's life that NO other collection
   records. Everything else about a request is already told better
   somewhere else:

     approvals   -> Approval.history knows the stage and the decision
     comments    -> the Comment collection knows the actual words
     attachments -> request.attachments knows each file by name

   Those three are left out here on purpose, so nothing appears twice.
   The company-wide audit page still shows all of them, because there
   the question is "what did this person do?", not "what happened to
   this request?".
   ===================================================================== */
export const REQUEST_TIMELINE_ACTIONS = [
  "RequestCreated",
  "RequestUpdated",
  "RequestSubmitted",
  "RequestDeleted",
];

/*
  The overlap runs the other way for exactly one pair of entries.

  Approval.history opens with "Submitted" (and "Resubmitted" when a
  returned request comes back), which is the same event the audit log
  already recorded as RequestSubmitted. The audit row is the better of
  the two here - it exists even for a request type with no workflow at
  all, and it carries the submitter's name frozen in place - so the
  approval side gives these two up instead.
*/
export const TIMELINE_SKIPPED_APPROVAL_ACTIONS = ["Submitted", "Resubmitted"];

/* =====================================================================
   9) SMALL HELPERS
   ===================================================================== */

/*
  How many rows the CSV export may contain.

  An export is one query with no pagination, so without a ceiling an
  admin could ask for two years of logs and hold the whole collection
  in memory. 5000 rows is far more than anybody reads in a spreadsheet
  and still small enough to build in one go.
*/
export const MAX_EXPORT_ROWS = 5000;

/*
  Values longer than this are cut down before being stored in a
  `changes` entry.

  A change is meant to be READ ("Description: 'Old text' -> 'New
  text'"), not to be a second copy of the document. Without a limit,
  editing a 2000 character description would store 4000 characters in
  a log row that nobody will ever read to the end.
*/
export const MAX_CHANGE_VALUE_LENGTH = 120;

/*
  Turns any value into the short text a `changes` entry stores.

  Everything ends up as text on purpose: `from` and `to` are only ever
  DISPLAYED, and one type keeps the model simple. An empty value is
  written as "(empty)" so a change reads "Phone: (empty) -> 98765..."
  instead of "Phone:  -> 98765...".
*/
export const describeValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return "(empty)";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "(empty)" : `${value.length} item(s)`;
  }

  const text = String(value);

  return text.length > MAX_CHANGE_VALUE_LENGTH
    ? `${text.slice(0, MAX_CHANGE_VALUE_LENGTH - 3)}...`
    : text;
};
