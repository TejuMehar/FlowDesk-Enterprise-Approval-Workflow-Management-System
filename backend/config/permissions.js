/*
=========================================================================
  PERMISSIONS  (the rules behind RBAC = Role Based Access Control)
=========================================================================
  PERMISSION -> one single action, written as "module:action"
                example: "user:create" = allowed to create users

  ROLE       -> a named group of permissions
                example: Manager = ["user:read", "department:read"]

  Every user has exactly ONE role, and that role decides:
    - which API routes the user can call   (backend, checkPermission.js)
    - which menu items the user can see    (frontend, Sidebar.jsx)

  Keeping every permission string in THIS ONE FILE means we can never
  mistype it somewhere else.
=========================================================================
*/

export const PERMISSIONS = {
  // ---- User module ----
  USER_CREATE: "user:create",
  USER_READ: "user:read",
  USER_UPDATE: "user:update",
  USER_DELETE: "user:delete",
  USER_STATUS: "user:status", // activate / deactivate
  USER_ASSIGN_ROLE: "user:assign-role",

  // ---- Role module ----
  ROLE_CREATE: "role:create",
  ROLE_READ: "role:read",
  ROLE_UPDATE: "role:update",
  ROLE_DELETE: "role:delete",

  // ---- Department module ----
  DEPARTMENT_CREATE: "department:create",
  DEPARTMENT_READ: "department:read",
  DEPARTMENT_UPDATE: "department:update",
  DEPARTMENT_DELETE: "department:delete",
  DEPARTMENT_ASSIGN_MANAGER: "department:assign-manager",

  // ---- Request module (Module 2 - approval requests) ----
  REQUEST_CREATE: "request:create",
  REQUEST_READ: "request:read",
  REQUEST_UPDATE: "request:update",
  REQUEST_DELETE: "request:delete",
  REQUEST_SUBMIT: "request:submit",

  // ---- Workflow module (Module 3 - approval workflow builder) ----
  WORKFLOW_CREATE: "workflow:create",
  WORKFLOW_READ: "workflow:read",
  WORKFLOW_UPDATE: "workflow:update",
  WORKFLOW_DELETE: "workflow:delete",

  // ---- Approval module (Module 4 - approval engine) ----
  APPROVAL_READ: "approval:read", // see my pending approvals + timelines
  APPROVAL_APPROVE: "approval:approve",
  APPROVAL_REJECT: "approval:reject",
  APPROVAL_RETURN: "approval:return", // hand back for correction

  /*
    ---- Analytics module (Module 5 - dashboards & charts) ----

    There is only ONE permission here, and it is about OTHER PEOPLE'S
    numbers. Two dashboards deliberately need no permission at all:

      "my own requests"  - you are always allowed to see your own
                           paperwork, so the controller filters by
                           requester instead of asking for a permission
      "my team"          - allowed because a department points at you as
                           its manager. That is a fact in the data, so it
                           keeps working even if the "Manager" role is
                           renamed or rebuilt

    analytics:read is what unlocks the company wide dashboard and the
    four charts across every department.
  */
  ANALYTICS_READ: "analytics:read",

  /*
    ---- Comments module (Module 6 - Notification & Communication) ----

    The talking half of Module 6. An employee and their approvers write
    to each other ON the request itself, instead of in a separate email
    thread nobody can find again later.

    NOTIFICATIONS have no permission on purpose: your own bell is like
    your own requests - nobody has to be given the right to read what was
    sent to them, so notificationRoute.js only asks for a login.
  */
  COMMENT_CREATE: "comment:create",
  COMMENT_READ: "comment:read",
  COMMENT_DELETE: "comment:delete", // only your own, and only for a few minutes

  /*
    ---- Audit module (Module 7 - Audit Logs & Activity Tracking) ----

    TWO permissions, and they are deliberately not one.

    audit:read    opens the company wide log on screen
    audit:export  downloads the same rows as a spreadsheet

    Reading the log while sitting in the application and walking out
    with a file listing every action every employee has ever taken are
    different levels of trust, so an admin can grant the first without
    the second.

    THE ACTIVITY TIMELINE OF ONE REQUEST NEEDS NEITHER, exactly like
    notifications need none: it is your own paperwork, and the
    controller lets in only the people who are really part of that
    request (config/requestAccess.js).
  */
  AUDIT_READ: "audit:read",
  AUDIT_EXPORT: "audit:export",

  /*
    ---- Report module (Module 8 - Reports & Search) ----

    Two permissions again, and split for exactly the same reason as the
    audit pair above:

      report:read    open the Reports page and run any of the six
      report:export  download one as a PDF, an Excel file or a CSV

    Looking at last quarter's numbers on screen and walking out of the
    building with a spreadsheet of every request in the company are
    different levels of trust.

    report:read IS THE DOOR, NOT THE SIZE OF THE ROOM. How much of the
    company a report actually covers is never decided here - it is
    worked out per user in config/reportScope.js, which reuses
    analytics:read for "may see other people's numbers" and the
    department manager relationship for "may see my own team". A
    Manager with report:read therefore gets a real Reports page about
    their team without any permission that could leak the rest of the
    company.

    SEARCH HAS NO PERMISSION AT ALL, like notifications and the request
    activity timeline: it runs through the same reportScope.js, so an
    ordinary employee's search can only ever find their own requests.
    Nobody should need to be granted the right to find their own
    paperwork.
  */
  REPORT_READ: "report:read",
  REPORT_EXPORT: "report:export",

  /*
    ---- System configuration (Module 9) ----

    FOUR permissions, and the split is the same argument the audit and
    report pairs make one more time: opening a page, changing what it
    shows, and holding a credential are three different levels of
    trust.

      settings:read      open the Settings page
      settings:update    change the company name, logo, timezone,
                         working days, holidays, employee ID format
      settings:smtp      see and change the MAIL SERVER
      request-type:manage  create / rename / retire request types

    WHY SMTP IS NOT PART OF settings:update
    ---------------------------------------
    Everything else on that page is a label. The SMTP block is a
    USERNAME AND PASSWORD FOR A REAL MAILBOX, and whoever holds it can
    send email as the company - to anybody, saying anything, from an
    address employees have been trained to trust. That is a phishing
    kit, not a preference, so it stays with the Super Admin while an
    Admin still runs the rest of the page.

    WHY REQUEST TYPES ARE NOT PART OF settings:update EITHER
    -------------------------------------------------------
    For the opposite reason: not danger, but blast radius. Renaming or
    retiring a type reaches into Module 2 (what employees may raise),
    Module 3 (which workflows are legal) and Module 8 (what every
    report is grouped by). It belongs to whoever owns the approval
    process - usually the same person who owns workflows - rather than
    to whoever was allowed to upload a logo.

    READING the request types needs NO permission at all, the same
    decision notifications and search made: every employee needs that
    list to fill in the form on the page they are already allowed to
    open.
  */
  SETTINGS_READ: "settings:read",
  SETTINGS_UPDATE: "settings:update",
  SETTINGS_SMTP: "settings:smtp",
  REQUEST_TYPE_MANAGE: "request-type:manage",

  /*
    ---- Attendance module (Module 11 - Attendance Management) ----

    FOUR permissions, and the shape of the split is the same argument
    the audit, report and settings groups all make: seeing, changing,
    downloading and configuring are four different levels of trust.

      attendance:read-all  see EVERY employee's attendance
      attendance:correct   edit somebody's punches by hand
      attendance:policy    set the COMPANY-WIDE working pattern
      attendance:export    download attendance as a file

    CLOCKING IN AND OUT NEEDS NO PERMISSION AT ALL, the fourth time
    FlowDesk makes that decision after notifications, search and the
    request activity timeline. Your own working day is your own
    paperwork; nobody should have to be granted the right to say they
    have arrived. The controller only ever writes the caller's own
    record, so there is nothing here for an admin to hand out.

    NEITHER DOES "MY TEAM'S ATTENDANCE", and that is the important one.
    A Department whose `manager` field points at you is what unlocks
    your team - the same fact-about-the-data rule Module 5 uses for the
    team dashboard and Module 8 uses for team-scoped reports. So a
    manager gets their department's attendance the moment they are
    given the department, and loses it the moment they are replaced,
    without an admin having to remember either.

    WHY attendance:read-all IS NOT JUST analytics:read
    --------------------------------------------------
    config/reportScope.js deliberately REUSES analytics:read, because a
    report and a dashboard ask the same question about the same thing:
    how the work is going. Attendance is not that. It is a record of
    PEOPLE - when they arrived, how long they were away from their
    desk, how often they were late - and it belongs with audit:read
    rather than with last quarter's purchase totals.

    Somebody who may see every department's approval statistics should
    not thereby learn when every employee in the company took lunch.
    An admin who wants to grant that grants it on purpose.

    WHY attendance:policy IS ONLY THE COMPANY-WIDE PATTERN
    ------------------------------------------------------
    A DEPARTMENT's shift and break allowance are set by its manager,
    with no permission, for the reason above - it is their department.
    The company default is different: it reaches every department that
    has not set its own, including the ones whose managers have never
    opened the screen, so changing it is an act with a blast radius and
    it needs a permission to match.
  */
  ATTENDANCE_READ_ALL: "attendance:read-all",
  ATTENDANCE_CORRECT: "attendance:correct",
  ATTENDANCE_POLICY: "attendance:policy",
  ATTENDANCE_EXPORT: "attendance:export",

  /*
    ---- Salary module (Module 12 - Payroll & Salary) ----

    FOUR permissions again, and the split follows the same shape the
    audit, report, settings and attendance groups all use: seeing,
    setting, processing and downloading are four different levels of
    trust.

      salary:read-all   see EVERY employee's pay
      salary:structure  set what somebody earns
      salary:process    run payroll, publish it, mark it paid
      salary:export     download the payroll as a file

    READING YOUR OWN PAYSLIPS NEEDS NO PERMISSION, the fifth time
    FlowDesk makes that decision after notifications, search, the
    request activity timeline and clocking in. Your own salary is your
    own paperwork - more obviously so than anything else in this
    application - so the routes that serve it read req.userId and there
    is nothing here for an admin to hand out, or to take away.

    THE ONE THING MODULE 12 DOES DIFFERENTLY FROM EVERY MODULE BEFORE
    IT: BEING A MANAGER GRANTS NOTHING.
    ------------------------------------------------------------------
    Module 5 gives a department manager their team's dashboard, Module
    8 gives them team-scoped reports and Module 11 gives them their
    team's attendance - all without a permission, because a Department
    whose `manager` field points at them is a fact about the data.

    config/salaryScope.js deliberately has NO team level. A manager
    needs to know that somebody was late four times; they do not need
    to know what that person earns, and in most companies they are
    specifically not told. Pay is the one thing in FlowDesk where the
    manager relationship unlocks nothing at all.

    WHY salary:structure IS NOT PART OF salary:process
    ---------------------------------------------------
    Deciding what somebody is paid and pressing the button that pays
    them are different jobs, and in a company of any size they are
    different people. A payroll officer runs the month; they do not
    give themselves a raise on the way past. Splitting them is what
    makes "who changed this number?" a question with an answer.

    WHY THE ADMIN ROLE GETS NONE OF THESE
    -------------------------------------
    The Admin gets the whole attendance module, because chasing a
    missing clock out IS the job. Payroll is not: an admin manages
    accounts, departments and workflows, and none of that requires
    knowing what anybody earns. The Super Admin holds these four by
    virtue of holding everything, and `npm run seed:salary` hands them
    to the finance and HR roles on purpose. An admin who genuinely
    runs payroll can be given them - deliberately, by somebody, which
    is the entire point.
  */
  SALARY_READ_ALL: "salary:read-all",
  SALARY_STRUCTURE: "salary:structure",
  SALARY_PROCESS: "salary:process",
  SALARY_EXPORT: "salary:export",
};

/*
  A flat array of every permission value:
  ["user:create", "user:read", ...]
  Object.values() takes all the values out of the object above.
*/
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/*
  The same permissions grouped by module.
  The React "Roles" page uses this to draw a neat checkbox list
  instead of one long flat list.
*/
export const PERMISSION_GROUPS = [
  {
    module: "User Management",
    permissions: [
      { key: PERMISSIONS.USER_CREATE, label: "Create User" },
      { key: PERMISSIONS.USER_READ, label: "View Users" },
      { key: PERMISSIONS.USER_UPDATE, label: "Update User" },
      { key: PERMISSIONS.USER_DELETE, label: "Delete User" },
      { key: PERMISSIONS.USER_STATUS, label: "Activate / Deactivate User" },
      { key: PERMISSIONS.USER_ASSIGN_ROLE, label: "Assign Role" },
    ],
  },
  {
    module: "Role Management",
    permissions: [
      { key: PERMISSIONS.ROLE_CREATE, label: "Create Role" },
      { key: PERMISSIONS.ROLE_READ, label: "View Roles" },
      { key: PERMISSIONS.ROLE_UPDATE, label: "Update Role" },
      { key: PERMISSIONS.ROLE_DELETE, label: "Delete Role" },
    ],
  },
  {
    module: "Department Management",
    permissions: [
      { key: PERMISSIONS.DEPARTMENT_CREATE, label: "Create Department" },
      { key: PERMISSIONS.DEPARTMENT_READ, label: "View Departments" },
      { key: PERMISSIONS.DEPARTMENT_UPDATE, label: "Update Department" },
      { key: PERMISSIONS.DEPARTMENT_DELETE, label: "Delete Department" },
      { key: PERMISSIONS.DEPARTMENT_ASSIGN_MANAGER, label: "Assign Manager" },
    ],
  },
  {
    module: "Request Management",
    permissions: [
      { key: PERMISSIONS.REQUEST_CREATE, label: "Create Request" },
      { key: PERMISSIONS.REQUEST_READ, label: "View Requests" },
      { key: PERMISSIONS.REQUEST_UPDATE, label: "Edit Draft Request" },
      { key: PERMISSIONS.REQUEST_DELETE, label: "Delete Draft Request" },
      { key: PERMISSIONS.REQUEST_SUBMIT, label: "Submit Request" },
    ],
  },
  {
    module: "Workflow Management",
    permissions: [
      { key: PERMISSIONS.WORKFLOW_CREATE, label: "Create Workflow" },
      { key: PERMISSIONS.WORKFLOW_READ, label: "View Workflows" },
      { key: PERMISSIONS.WORKFLOW_UPDATE, label: "Update Workflow" },
      { key: PERMISSIONS.WORKFLOW_DELETE, label: "Delete Workflow" },
    ],
  },
  {
    module: "Approvals",
    permissions: [
      { key: PERMISSIONS.APPROVAL_READ, label: "View Pending Approvals" },
      { key: PERMISSIONS.APPROVAL_APPROVE, label: "Approve" },
      { key: PERMISSIONS.APPROVAL_REJECT, label: "Reject" },
      { key: PERMISSIONS.APPROVAL_RETURN, label: "Return for Correction" },
    ],
  },
  {
    module: "Dashboard & Analytics",
    permissions: [
      {
        key: PERMISSIONS.ANALYTICS_READ,
        label: "View Company Wide Analytics",
      },
    ],
  },
  {
    module: "Comments",
    permissions: [
      { key: PERMISSIONS.COMMENT_CREATE, label: "Write a Comment" },
      { key: PERMISSIONS.COMMENT_READ, label: "Read Comments" },
      { key: PERMISSIONS.COMMENT_DELETE, label: "Delete Own Comment" },
    ],
  },
  {
    module: "Audit & Activity",
    permissions: [
      { key: PERMISSIONS.AUDIT_READ, label: "View Audit Logs" },
      { key: PERMISSIONS.AUDIT_EXPORT, label: "Export Audit Logs" },
    ],
  },
  {
    module: "Reports & Search",
    permissions: [
      { key: PERMISSIONS.REPORT_READ, label: "View Reports" },
      { key: PERMISSIONS.REPORT_EXPORT, label: "Export Reports (PDF / Excel / CSV)" },
    ],
  },
  {
    module: "System Configuration",
    permissions: [
      { key: PERMISSIONS.SETTINGS_READ, label: "View Settings" },
      { key: PERMISSIONS.SETTINGS_UPDATE, label: "Update Settings" },
      { key: PERMISSIONS.SETTINGS_SMTP, label: "Configure Mail Server (SMTP)" },
      { key: PERMISSIONS.REQUEST_TYPE_MANAGE, label: "Manage Request Types" },
    ],
  },
  {
    module: "Attendance",
    permissions: [
      {
        key: PERMISSIONS.ATTENDANCE_READ_ALL,
        label: "View Everyone's Attendance",
      },
      { key: PERMISSIONS.ATTENDANCE_CORRECT, label: "Correct Attendance Records" },
      { key: PERMISSIONS.ATTENDANCE_POLICY, label: "Set Company Working Pattern" },
      { key: PERMISSIONS.ATTENDANCE_EXPORT, label: "Export Attendance" },
    ],
  },
  {
    module: "Payroll & Salary",
    permissions: [
      { key: PERMISSIONS.SALARY_READ_ALL, label: "View Everyone's Salary" },
      { key: PERMISSIONS.SALARY_STRUCTURE, label: "Set Salary Structures" },
      { key: PERMISSIONS.SALARY_PROCESS, label: "Run, Publish and Pay Payroll" },
      { key: PERMISSIONS.SALARY_EXPORT, label: "Export Payroll" },
    ],
  },
];

/*
  Every employee is allowed to manage their OWN requests, so this small
  list is added to every role below instead of repeating it four times.
*/
const REQUEST_PERMISSIONS_FOR_EVERYONE = [
  PERMISSIONS.REQUEST_CREATE,
  PERMISSIONS.REQUEST_READ,
  PERMISSIONS.REQUEST_UPDATE,
  PERMISSIONS.REQUEST_DELETE,
  PERMISSIONS.REQUEST_SUBMIT,
];

/*
  The approval permissions are given to EVERY role for the same reason.

  A workflow stage may name ANY employee as its approver ("A Specific
  Person"), so an ordinary Employee can perfectly well be the person who
  has to approve something. If these permissions belonged only to
  managers, that stage could never be answered.

  Being ALLOWED to approve is not the same as HAVING something to
  approve: the controller only ever shows a user the requests where the
  workflow really did land on them.
*/
const APPROVAL_PERMISSIONS_FOR_EVERYONE = [
  PERMISSIONS.APPROVAL_READ,
  PERMISSIONS.APPROVAL_APPROVE,
  PERMISSIONS.APPROVAL_REJECT,
  PERMISSIONS.APPROVAL_RETURN,
];

/*
  The comment permissions belong to every role for the third time for the
  same reason: a conversation only works if BOTH sides can talk. The
  employee who raised the request and the approvers standing in its way
  can be any role at all.

  Having the permission does not mean you can read every conversation in
  the company - the controller only lets you near a request you are
  really part of (config/requestAccess.js).
*/
const COMMENT_PERMISSIONS_FOR_EVERYONE = [
  PERMISSIONS.COMMENT_CREATE,
  PERMISSIONS.COMMENT_READ,
  PERMISSIONS.COMMENT_DELETE,
];

/*
  The 4 roles created by "npm run seed" on a fresh database.

  isSystem: true means the role is PROTECTED and cannot be deleted.
  Without this an admin could delete the role they are using and lock
  everybody out of the application.
*/
export const DEFAULT_ROLES = [
  {
    name: "Super Admin",
    description: "Full access to every feature of FlowDesk.",
    permissions: ALL_PERMISSIONS,
    isSystem: true,
  },
  {
    name: "Admin",
    description: "Manages users and departments, but cannot edit roles.",
    permissions: [
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.USER_STATUS,
      PERMISSIONS.USER_ASSIGN_ROLE,
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.DEPARTMENT_CREATE,
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.DEPARTMENT_UPDATE,
      PERMISSIONS.DEPARTMENT_DELETE,
      PERMISSIONS.DEPARTMENT_ASSIGN_MANAGER,
      PERMISSIONS.WORKFLOW_CREATE,
      PERMISSIONS.WORKFLOW_READ,
      PERMISSIONS.WORKFLOW_UPDATE,
      PERMISSIONS.WORKFLOW_DELETE,
      PERMISSIONS.ANALYTICS_READ,
      /*
        An Admin may READ the audit log but not EXPORT it - the one
        place the two audit permissions are handed out separately, and
        the reason they are two permissions at all. Investigating what
        happened is an everyday admin job; taking a copy of every
        action in the company out of the building is not, so that one
        stays with the Super Admin.
      */
      PERMISSIONS.AUDIT_READ,
      /*
        The report pair, on the other hand, is handed over WHOLE - the
        opposite of the audit split just above, and worth being clear
        about why.

        The audit log is a record of PEOPLE: every login, every failed
        login, every change anybody made. A report is a record of
        WORK: how many purchase requests Engineering raised last
        quarter and how long they took. Putting last quarter's numbers
        in a spreadsheet is the ordinary shape of an admin's job, and
        an admin who may run a report but not save it would simply
        retype it into Excel by hand.
      */
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_UPDATE,
      /*
        MODULE 9. The Admin gets the Settings page and the request
        types, but NOT settings:smtp - the third place in FlowDesk
        where a pair of permissions is deliberately split between two
        roles, after audit:export and for a stronger reason.

        The mail server credential lets its holder send email AS THE
        COMPANY. An Admin who needs it can be given it; they should
        not receive it by accident along with the ability to change
        the company name.

        request-type:manage does come with the role, because an Admin
        already owns the workflows those types are routed by - owning
        one without the other is half a job.
      */
      PERMISSIONS.REQUEST_TYPE_MANAGE,
      /*
        MODULE 11. The Admin gets the whole attendance module, and this
        is the one group where nothing is held back from them.

        The audit split (read but not export) was about walking out of
        the building with a record of every action every employee has
        ever taken. Attendance is smaller than that and far more
        operational: chasing a missing clock out, fixing the day
        somebody's laptop died, and sending HR a spreadsheet at the end
        of the month IS the job. An admin who could see attendance but
        not correct or export it would simply ask a manager to do both,
        which moves the trust without reducing it.

        attendance:policy is here for the same reason
        request-type:manage is: an admin already owns the working
        calendar in Settings that attendance is counted against, and
        owning the calendar without the shift is half a job.
      */
      PERMISSIONS.ATTENDANCE_READ_ALL,
      PERMISSIONS.ATTENDANCE_CORRECT,
      PERMISSIONS.ATTENDANCE_POLICY,
      PERMISSIONS.ATTENDANCE_EXPORT,
      /*
        MODULE 12 ADDED NOTHING HERE, and it is the first module that
        has held something back from the Admin.

        Attendance is operational and belongs to whoever runs the
        office. Payroll belongs to finance: managing accounts,
        departments and workflows never requires knowing what anybody
        earns, so an admin does not receive that by accident along with
        the ability to reset a password. `npm run seed:salary` gives
        the four salary permissions to the finance and HR roles, and an
        admin who really does run payroll can be granted them on
        purpose.
      */
      ...REQUEST_PERMISSIONS_FOR_EVERYONE,
      ...APPROVAL_PERMISSIONS_FOR_EVERYONE,
      ...COMMENT_PERMISSIONS_FOR_EVERYONE,
    ],
    isSystem: true,
  },
  {
    name: "Manager",
    description: "Can view and update their team members.",
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.DEPARTMENT_READ,
      /*
        A Manager gets BOTH report permissions and still cannot see
        another department's numbers - because report:read is only the
        door, and config/reportScope.js decides the room. Without
        analytics:read this role is resolved to "team" scope, so every
        report and every file it can produce is already about nobody
        but its own department.

        That is the whole reason the scope is worked out from the DATA
        (a department pointing at you as its manager) instead of from a
        permission: the moment somebody stops managing Engineering,
        their reports stop covering it, without an admin having to
        remember to take anything away.
      */
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
      /*
        MODULE 11. Notice what is NOT here: attendance:read-all.

        A Manager needs no permission to see their own department's
        attendance - the department pointing at them is what unlocks
        it (config/attendanceScope.js), exactly as it unlocks their
        team dashboard and their team reports. Granting read-all would
        not add their team, it would add everybody else's, which is
        precisely the thing a department manager should not have.

        The two that ARE here are the everyday half of running a team:
        fixing the day somebody's laptop died, and sending the month's
        attendance to HR. Both are still bounded by the scope, so a
        manager can only ever correct or export their own people.
      */
      PERMISSIONS.ATTENDANCE_CORRECT,
      PERMISSIONS.ATTENDANCE_EXPORT,
      ...REQUEST_PERMISSIONS_FOR_EVERYONE,
      ...APPROVAL_PERMISSIONS_FOR_EVERYONE,
      ...COMMENT_PERMISSIONS_FOR_EVERYONE,
    ],
    isSystem: true,
  },
  {
    name: "Employee",
    description: "Normal employee. Can manage their own profile and requests.",
    /*
      every employee can create and manage their own approval requests,
      answer any approval that lands on them, and talk about both

      MODULE 11 ADDED NOTHING TO THIS LIST, which is the whole point of
      how attendance was gated. Clocking in, taking a break, clocking
      out and reading their own daily, weekly and monthly attendance
      all need no permission - it is their own working day, the same
      way their notifications and their own requests are their own.

      MODULE 12 ADDED NOTHING EITHER, for the same reason and even more
      plainly: an employee's payslips, their whole salary history and
      the PDF receipt of every one of them are their own paperwork.
      Nobody should have to be granted the right to read what they were
      paid.
    */
    permissions: [
      ...REQUEST_PERMISSIONS_FOR_EVERYONE,
      ...APPROVAL_PERMISSIONS_FOR_EVERYONE,
      ...COMMENT_PERMISSIONS_FOR_EVERYONE,
    ],
    isSystem: true,
  },
];
