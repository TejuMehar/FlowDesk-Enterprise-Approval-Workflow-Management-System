/*
=========================================================================
  SALARY SCOPE   (Module 12 - Payroll & Salary)
=========================================================================
  "WHOSE PAY IS THIS PERSON ALLOWED TO SEE?"

  Asked once, here, and answered the same way for the payroll screen,
  one payslip, the receipt and the two exports. The same job
  config/reportScope.js does for Module 8 and config/attendanceScope.js
  does for Module 11.

  IT HAS TWO LEVELS, NOT THREE, AND THAT IS THE POINT OF THE FILE
  ---------------------------------------------------------------
    org   everybody's pay.  Needs "salary:read-all".
    own   your own pay.     Everybody, always, with no permission.

  THERE IS NO "team" LEVEL. Module 5, Module 8 and Module 11 all have
  one: a Department whose `manager` field points at you unlocks your
  team's requests, their statistics and their attendance, with no
  permission at all, because managing people means knowing how the work
  is going.

  Pay is not that. A manager needs to know that Ravi was late four
  times; they do not need to know what Ravi earns, and in most companies
  they are specifically not told. Salary is the one thing in FlowDesk
  where being somebody's manager grants NOTHING, and it is worth being
  explicit about, because every other scope file in this project would
  have led a reader to expect the opposite.

  So the only ways to see somebody else's pay are:

    - hold salary:read-all, which is given to payroll on purpose
    - be them

  WHY THIS IS NOT A CALL TO resolveAttendanceScope()
  --------------------------------------------------
  Because the answer would be wrong in exactly the case that matters.
  Attendance's team level is the feature; here it would be the leak.
=========================================================================
*/

import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import { PERMISSIONS } from "./permissions.js";

/* =====================================================================
   1) WHAT SLICE OF THE PAYROLL MAY THIS USER SEE?
   ---------------------------------------------------------------------
   @param req - the express request, after isAuth
   @returns {
     level      "org" | "own"
     label      the sentence printed on the page header and the export
     memberIds  the people in scope, or null for "everybody"
     canProcess may they generate, publish and pay?
   }
   ===================================================================== */
export const resolveSalaryScope = (req) => {
  const permissions = req.user.role?.permissions || [];

  if (permissions.includes(PERMISSIONS.SALARY_READ_ALL)) {
    return {
      level: "org",
      label: "Whole organisation",
      memberIds: null,
      canProcess: permissions.includes(PERMISSIONS.SALARY_PROCESS),
    };
  }

  return {
    level: "own",
    label: "My own salary",
    memberIds: [req.userId],
    /*
      Deliberately false even for somebody who somehow holds
      salary:process without salary:read-all. Running payroll you
      cannot look at is not a job anybody has; the routes check the
      permission properly, and this is only what the page draws.
    */
    canProcess: false,
  };
};

/* =====================================================================
   2) MAY I LOOK AT THIS ONE PERSON'S PAY?
   ---------------------------------------------------------------------
   The payroll screen lists people; this is the check before opening
   one of them, or their receipt. It is a separate question because a
   URL is a thing anybody can type, and "the list did not show them" is
   not a security control.

   YOUR OWN PAY IS FIRST AND NEEDS NO DATABASE, which is the
   overwhelmingly common case - every employee opening their own
   payslip.
   ===================================================================== */
export const canViewSalaryOf = (scope, userId, viewerId) => {
  if (String(userId) === String(viewerId)) {
    return true;
  }

  return scope.level === "org";
};

/* =====================================================================
   3) THE EMPLOYEES A RUN OR A REPORT ACTUALLY COVERS
   ---------------------------------------------------------------------
   The scope says who is allowed; the page may then narrow by
   department or to one person. This works out the final list, and it
   is where the URL-editing attack dies: narrowing is an AND on top of
   the scope, never a replacement for it.

   INACTIVE EMPLOYEES ARE INCLUDED ON PURPOSE. Somebody deactivated on
   the 20th still has to be paid for the twenty days they worked, and a
   payroll run that quietly skipped them would be found out by the
   person, not by the system.

   DELETED ONES ARE NOT. A soft-deleted user is a record somebody
   removed; generating them a new payslip would bring them back to
   life on a screen they were taken off.
   ===================================================================== */
export const resolveScopedEmployees = async (scope, { departmentId, userId } = {}) => {
  const filter = { isDeleted: false };

  if (scope.memberIds) {
    filter._id = { $in: scope.memberIds };
  }

  if (departmentId) {
    filter.department = departmentId;
  }

  if (userId) {
    filter._id = filter._id
      ? { $in: filter._id.$in.filter((id) => String(id) === String(userId)) }
      : userId;
  }

  return await User.find(filter)
    .select(
      "firstName lastName employeeId designation photoUrl department isActive dateOfJoining"
    )
    .populate("department", "name code")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
};

/* =====================================================================
   4) THE DEPARTMENTS THE PAYROLL FILTER MAY OFFER
   ---------------------------------------------------------------------
   Every department for somebody at org level, and none at all for an
   ordinary employee - filtering your own payslips by department is not
   a question anybody asks.
   ===================================================================== */
export const getSelectableDepartments = async (scope) => {
  if (scope.level !== "org") {
    return [];
  }

  return await Department.find({ isDeleted: false })
    .select("name code")
    .sort({ name: 1 })
    .lean();
};
