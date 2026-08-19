/*
=========================================================================
  PERMISSION HELPERS  (used for Role Based Navigation)
=========================================================================
  The backend already blocks anything a user is not allowed to do.
  The frontend uses these helpers for a nicer experience: we simply hide
  the buttons and menu items the user cannot use.

  IMPORTANT: hiding a button is NOT security. The real check always
  happens on the backend (middleware/checkPermission.js).
=========================================================================
*/

/*
  The same permission names as the backend file config/permissions.js.
  Keeping them here as well means we never type the raw string
  "user:create" inside a component by hand.
*/
export const PERMISSIONS = {
  USER_CREATE: "user:create",
  USER_READ: "user:read",
  USER_UPDATE: "user:update",
  USER_DELETE: "user:delete",
  USER_STATUS: "user:status",
  USER_ASSIGN_ROLE: "user:assign-role",

  ROLE_CREATE: "role:create",
  ROLE_READ: "role:read",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",

  DEPARTMENT_CREATE: "department:create",
  DEPARTMENT_READ: "department:read",
  DEPARTMENT_UPDATE: "department:update",
  DEPARTMENT_DELETE: "department:delete",
  DEPARTMENT_ASSIGN_MANAGER: "department:assign-manager",

  REQUEST_CREATE: "request:create",
  REQUEST_READ: "request:read",
  REQUEST_UPDATE: "request:update",
  REQUEST_DELETE: "request:delete",
  REQUEST_SUBMIT: "request:submit",

  WORKFLOW_CREATE: "workflow:create",
  WORKFLOW_READ: "workflow:read",
  WORKFLOW_UPDATE: "workflow:update",
  WORKFLOW_DELETE: "workflow:delete",

  APPROVAL_READ: "approval:read",
  APPROVAL_APPROVE: "approval:approve",
  APPROVAL_REJECT: "approval:reject",
  APPROVAL_RETURN: "approval:return",

  /*
    Module 5. The only dashboard permission there is, and it is about
    OTHER PEOPLE'S numbers: it unlocks the "Organisation" tab and the
    company wide charts.

    "My Requests" needs no permission (it is your own paperwork) and
    "My Team" needs none either (a department pointing at you as its
    manager is what unlocks it) - so neither has an entry here.
  */
  ANALYTICS_READ: "analytics:read",

  /*
    Module 6. The comments on a request - the talking half of the
    module.

    NOTIFICATIONS have no permission at all, in the backend either: your
    own bell is your own paperwork, so <NotificationBell /> is drawn for
    every logged in user without asking anything.
  */
  COMMENT_CREATE: "comment:create",
  COMMENT_READ: "comment:read",
  COMMENT_DELETE: "comment:delete",

  /*
    Module 9. The Settings page, and the two things on it that are not
    ordinary preferences.

    settings:read    open the page
    settings:update  the company card, the calendar, the employee ID
    settings:smtp    the MAIL SERVER card - a live mailbox credential,
                     whose holder can send email as the company to
                     anybody. Split off for the same reason
                     audit:export is, only more so. Without it the
                     backend does not even send the host and username
                     to the browser, and the page draws a locked card.
    request-type:manage
                     create / rename / retire the kinds of request
                     employees can raise. Reaches into Modules 2, 3
                     and 8, so it belongs to whoever owns the approval
                     process rather than to whoever may upload a logo.

    READING the request types needs no permission, in the backend
    either - every employee needs that list to fill in the form on the
    Requests page they can already open.
  */
  SETTINGS_READ: "settings:read",
  SETTINGS_UPDATE: "settings:update",
  SETTINGS_SMTP: "settings:smtp",
  REQUEST_TYPE_MANAGE: "request-type:manage",

  /*
    Module 7. The company wide audit log.

    Reading it and DOWNLOADING it are two separate permissions on
    purpose: looking at the log on screen and walking out with a
    spreadsheet of every action in the company are different levels of
    trust, so an admin can grant the first without the second.

    The ACTIVITY TIMELINE of a single request has no permission here,
    in the backend either - it is guarded by "are you part of this
    request?", the same question the comments already ask, so an
    employee can follow their own paperwork without being allowed to
    read everybody else's.
  */
  AUDIT_READ: "audit:read",
  AUDIT_EXPORT: "audit:export",

  /*
    Module 8. The Reports page, and the files it can produce.

    Split for the same reason the audit pair is: looking at last
    quarter's numbers on screen and downloading a spreadsheet of every
    request in the company are different levels of trust.

    report:read IS THE DOOR, NOT THE SIZE OF THE ROOM. How much of the
    company a report covers is never decided by a permission - the
    backend works it out per user (config/reportScope.js) from
    analytics:read and from whether a department points at them as its
    manager. So a Manager and an Admin can both hold report:read and
    see completely different reports, which is the intended answer.

    SEARCH HAS NO PERMISSION HERE, in the backend either: it runs
    through the same scope rules, so an ordinary employee's search can
    only ever find their own requests. Nobody should have to be granted
    the right to find their own paperwork - the same reasoning that
    leaves notifications and the request activity timeline ungated.
  */
  REPORT_READ: "report:read",
  REPORT_EXPORT: "report:export",

  /*
    Module 11. The attendance module, and the shape of its gating is
    worth reading next to Module 8's above, because it deliberately
    goes the other way in two places.

    attendance:read-all   see EVERY employee's attendance
    attendance:correct    edit somebody's punches by hand
    attendance:policy     set the COMPANY-WIDE working pattern
    attendance:export     download attendance as a file

    THREE THINGS HAVE NO PERMISSION HERE, in the backend either.

    CLOCKING IN AND OUT. Your own working day is your own paperwork, the
    same decision notifications, search and the request activity
    timeline already made. Nobody should have to be granted the right to
    say they have arrived.

    MY TEAM'S ATTENDANCE. A department pointing at you as its manager is
    what unlocks it - a fact about the data, not a permission - so
    /attendance/team is open to everybody and simply shrinks to one row
    for an ordinary employee. That is why <Sidebar> shows the Team
    Attendance link on the same rule, and why there is no
    PermissionRoute around it in App.jsx.

    A DEPARTMENT'S WORKING PATTERN, for the same reason: its manager
    sets it. Only the company-wide default needs attendance:policy,
    because that one reaches every department at once.

    WHY attendance:read-all IS NOT analytics:read
    ---------------------------------------------
    report:read reuses analytics:read because a report and a dashboard
    ask the same question about the same thing. Attendance is a record
    of PEOPLE - when they arrived, how long they were away from their
    desk - and it belongs with audit:read rather than with last
    quarter's purchase totals. Somebody who may see every department's
    approval statistics should not thereby learn when every employee in
    the company took lunch.
  */
  ATTENDANCE_READ_ALL: "attendance:read-all",
  ATTENDANCE_CORRECT: "attendance:correct",
  ATTENDANCE_POLICY: "attendance:policy",
  ATTENDANCE_EXPORT: "attendance:export",

  /*
    Module 12. Payroll, and the one module whose gating goes the
    OPPOSITE way to Module 11's above.

    salary:read-all   see EVERY employee's pay
    salary:structure  set what somebody earns
    salary:process    run payroll, publish it, mark it paid
    salary:export     download the payroll as a file

    MY OWN SALARY NEEDS NO PERMISSION, in the backend either, which is
    why <Sidebar> draws "My Salary" for everybody and App.jsx puts no
    PermissionRoute around /salary. Your own payslips, your whole
    salary history and the PDF receipt of every one of them are your
    own paperwork - the fifth time FlowDesk has made that call, and
    the most obvious one.

    BEING A MANAGER UNLOCKS NOTHING HERE, and that is the difference
    worth reading twice. Module 5, Module 8 and Module 11 all give a
    department manager their team - the dashboard, the reports, the
    attendance board - because a Department pointing at them is a fact
    about the data. Pay is the one thing that fact does not reach:
    knowing somebody was late four times is managing them, knowing what
    they earn is not. So there is no "team payroll" page, and
    /api/salary has no equivalent of /attendance/team.
  */
  SALARY_READ_ALL: "salary:read-all",
  SALARY_STRUCTURE: "salary:structure",
  SALARY_PROCESS: "salary:process",
  SALARY_EXPORT: "salary:export",
};

/*
  Does this user have that one permission?

  @param {object} user       - the logged in user from Redux
  @param {string} permission - e.g. "user:create"
  @returns {boolean}
*/
export const hasPermission = (user, permission) => {
  // "?." stops the code from crashing when user or role is still null
  const list = user?.role?.permissions || [];

  return list.includes(permission);
};

/*
  Does this user have AT LEAST ONE of these permissions?
*/
export const hasAnyPermission = (user, permissionList = []) => {
  const list = user?.role?.permissions || [];

  return permissionList.some((permission) => list.includes(permission));
};

/*
  The name of the user's role, e.g. "Admin".
  Used to show the little badge next to the name in the navbar.
*/
export const getRoleName = (user) => {
  return user?.role?.name || "No Role";
};
