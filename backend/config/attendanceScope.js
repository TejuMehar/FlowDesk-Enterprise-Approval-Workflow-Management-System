/*
=========================================================================
  ATTENDANCE SCOPE   (Module 11 - Attendance Management)
=========================================================================
  "WHOSE ATTENDANCE IS THIS PERSON ALLOWED TO SEE?"

  Asked once, here, and answered the same way for the team board, the
  employee drill-down, the department summary, the top performers and
  the four exports. The same job config/reportScope.js does for Module 8,
  and deliberately the same SHAPE, so the two files can be read
  side by side.

  THE THREE LEVELS
  ----------------
    org   everybody in the company.   Needs "attendance:read-all".
    team  the departments this user manages, plus themselves.
          Needs NO permission - a Department whose `manager` field
          points at you is what unlocks it.
    own   only their own days. Everybody, always, with no permission
          at all.

  WHY ATTENDANCE HAS ITS OWN PERMISSION RATHER THAN REUSING analytics:read
  -----------------------------------------------------------------------
  reportScope.js reuses analytics:read because a report and a dashboard
  ask the same question about the same thing: how the WORK is going.
  Attendance is not that. It is a record of PEOPLE - when they arrived,
  how long they were away from their desk, how often they were late -
  and it belongs to the small family of data that includes the audit log,
  not to the family that includes last quarter's purchase totals.

  So somebody who may see every department's approval statistics does
  NOT automatically get to see when every employee in the company took
  lunch. An admin who wants to grant that grants it on purpose. That is
  the same argument audit:read makes in config/permissions.js, and it is
  the reason this file exists instead of a one line call to
  resolveReportScope().

  WHY "team" IS DECIDED BY THE DATA AND NOT BY A ROLE
  --------------------------------------------------
  Because a manager is not a role here, it is a fact: a department
  points at you. Rename the "Manager" role, delete it, invent three new
  ones - the person Engineering calls its manager still has to be able
  to see Engineering's attendance, and the person who was replaced last
  week has to stop. A permission cannot express "and only theirs";
  the data already does.
=========================================================================
*/

import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import { PERMISSIONS } from "./permissions.js";
import { getManagedDepartments } from "./dashboardStats.js";

/* =====================================================================
   1) WHAT SLICE OF THE COMPANY MAY THIS USER SEE?
   ---------------------------------------------------------------------
   @param req - the express request, after isAuth
   @returns {
     level        "org" | "team" | "own"
     label        the sentence printed on the page header and the export
     memberIds    the people in scope, or null for "everybody"
     departments  the departments a team-level user manages
   }
   ===================================================================== */
export const resolveAttendanceScope = async (req) => {
  const permissions = req.user.role?.permissions || [];

  /* ---------------- org ---------------- */
  if (permissions.includes(PERMISSIONS.ATTENDANCE_READ_ALL)) {
    return {
      level: "org",
      label: "Whole organisation",
      memberIds: null,
      departments: [],
    };
  }

  /* ---------------- team ---------------- */
  const departments = await getManagedDepartments(req.userId);

  if (departments.length > 0) {
    const departmentIds = departments.map((department) => department._id);

    /*
      THE MANAGER IS IN THEIR OWN TEAM'S NUMBERS.

      getTeamMemberIds() in dashboardStats.js deliberately leaves them
      out, because a manager's own REQUESTS are not team activity. A
      manager's own ATTENDANCE is a different matter: a department's
      attendance rate that quietly excludes the one person who is
      hardest to hold to it is not a department's attendance rate.

      The same correction reportScope.js makes, for the same reason -
      the total has to be the total.
    */
    const members = await User.find({
      department: { $in: departmentIds },
      isDeleted: false,
    })
      .select("_id")
      .lean();

    const memberIds = members.map((member) => member._id);

    if (!memberIds.some((id) => String(id) === String(req.userId))) {
      // a manager who is not filed under the department they manage
      memberIds.push(req.userId);
    }

    return {
      level: "team",
      label: departments.map((department) => department.name).join(", "),
      memberIds,
      departments,
    };
  }

  /* ---------------- own ---------------- */
  return {
    level: "own",
    label: "My own attendance",
    memberIds: [req.userId],
    departments: [],
  };
};

/* =====================================================================
   2) MAY I LOOK AT THIS ONE PERSON?
   ---------------------------------------------------------------------
   The team board lists people; this is the check before opening one of
   them. It is a separate question because a URL is a thing anybody can
   type, and "the list did not show them" is not a security control.

   ORDER MATTERS, AND THE CHEAPEST CHECK IS FIRST: looking at yourself
   needs no database at all, which is the overwhelmingly common case
   (every employee opening their own history page).

   @returns true when the caller may see that person's attendance
   ===================================================================== */
export const canViewAttendanceOf = (scope, userId, viewerId) => {
  // your own days, always, whatever your role
  if (String(userId) === String(viewerId)) {
    return true;
  }

  if (scope.level === "org") {
    return true;
  }

  if (scope.level === "team") {
    return scope.memberIds.some((id) => String(id) === String(userId));
  }

  return false;
};

/* =====================================================================
   3) THE PEOPLE A REPORT OR A BOARD ACTUALLY COVERS
   ---------------------------------------------------------------------
   The scope says which employees are allowed; the page may then narrow
   further by department or by one employee. This works out the final
   list, and it is where the URL-editing attack dies.

   A MANAGER WHO ASKS FOR ANOTHER DEPARTMENT GETS AN EMPTY BOARD, not
   somebody else's data - the requested department and their own scope
   simply have nobody in common. Exactly the intersection trick
   reportScope.js uses, and it is worth having in both places rather
   than being clever about sharing it: the two modules narrow by
   different things.

   @param scope         from resolveAttendanceScope()
   @param departmentId  optional, the department filter from the URL
   @param userId        optional, one employee
   @returns [{ _id, firstName, lastName, employeeId, designation,
               photoUrl, department }]
   ===================================================================== */
export const resolveScopedEmployees = async (scope, { departmentId, userId } = {}) => {
  const filter = { isDeleted: false };

  // "everybody" only when the scope really said everybody
  if (scope.memberIds) {
    filter._id = { $in: scope.memberIds };
  }

  if (departmentId) {
    filter.department = departmentId;
  }

  if (userId) {
    /*
      Narrowing to one person is an AND on top of the scope, never a
      replacement for it: the _id filter set above still applies, so
      asking for somebody outside the scope returns nobody.
    */
    filter._id = filter._id
      ? { $in: filter._id.$in.filter((id) => String(id) === String(userId)) }
      : userId;
  }

  /*
    dateOfJoining is in the list because of ONE line in
    config/attendanceStats.js: a day before somebody joined is not an
    absence. Without it a joiner's first week shows a month of
    absences, which is the first number their manager ever sees about
    them.
  */
  return await User.find(filter)
    .select(
      "firstName lastName employeeId designation photoUrl department isActive dateOfJoining"
    )
    .populate("department", "name code")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
};

/* =====================================================================
   4) THE DEPARTMENTS A USER MAY CHOOSE FROM
   ---------------------------------------------------------------------
   Fills the "Department" dropdown on the attendance pages.

   An org-level user gets every department; a manager gets only the ones
   they manage, so the dropdown never offers a filter that can only come
   back empty; somebody at "own" level gets none, because filtering your
   own attendance by department is not a question anybody asks.

   The same shape getSelectableDepartments() has in reportScope.js, on
   purpose: two dropdowns that behave differently on two pages of the
   same application are two dropdowns somebody has to learn twice.
   ===================================================================== */
export const getSelectableDepartments = async (scope) => {
  if (scope.level === "org") {
    return await Department.find({ isDeleted: false })
      .select("name code")
      .sort({ name: 1 })
      .lean();
  }

  if (scope.level === "team") {
    return scope.departments;
  }

  return [];
};
