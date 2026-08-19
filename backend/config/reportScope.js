/*
=========================================================================
  REPORT SCOPE   (Module 8 - Reports & Search)
=========================================================================
  "WHICH REQUESTS IS THIS PERSON ALLOWED TO COUNT?"

  Asked once, here, and answered the same way for BOTH halves of the
  module - the six reports and the search page. That is the whole reason
  the file exists: a search that finds a request the report refuses to
  count (or the other way round) is a bug nobody would ever trust the
  numbers again after.

  THE THREE LEVELS
  ----------------
    org   everybody's requests.        Needs "analytics:read".
    team  the departments this user manages, plus their own requests.
          Needs NO permission - a Department whose `manager` field
          points at you is what unlocks it.
    own   only the requests this user raised. Everybody, always.

  WHY analytics:read AND NOT A NEW "SEE EVERYTHING" PERMISSION
  ------------------------------------------------------------
  Because Module 5 already made that decision, and making it twice is
  how two features start disagreeing. analytics:read is defined in
  config/permissions.js as "allowed to see OTHER PEOPLE'S numbers", and
  a company wide report is exactly that. An admin who grants the
  company dashboard has already decided this person may see the whole
  company.

  report:read is a different question - it is the DOOR to the Reports
  page, not the size of the room. See routes/reportRoute.js.

  WHY "team" INCLUDES THE MANAGER'S OWN REQUESTS
  ----------------------------------------------
  getTeamMemberIds() deliberately leaves the manager out (Module 5:
  counting a manager's own paperwork as "team activity" would make a
  busy manager look like a busy team). A REPORT is different - a
  manager running the expense report for their department has to see
  their own expenses in it, or the total is simply wrong. So the
  manager is added back here, in the one place where the total matters.
=========================================================================
*/

import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import { PERMISSIONS } from "./permissions.js";
import {
  getManagedDepartments,
  getTeamMemberIds,
} from "./dashboardStats.js";

/* =====================================================================
   1) WHAT SLICE OF THE COMPANY MAY THIS USER SEE?
   ---------------------------------------------------------------------
   @param req - the express request, after isAuth
   @returns {
     level          "org" | "team" | "own"
     label          the sentence printed on the report header
     requestFilter  drop straight into a Request query / $match
     memberIds      the people in scope, or null for "everybody"
     departments    the departments a team-level user manages
   }
   ===================================================================== */
export const resolveReportScope = async (req) => {
  const permissions = req.user.role?.permissions || [];

  /* ---------------- org ---------------- */
  if (permissions.includes(PERMISSIONS.ANALYTICS_READ)) {
    return {
      level: "org",
      label: "Whole organisation",
      // no filter at all: every request in the company
      requestFilter: {},
      memberIds: null,
      departments: [],
    };
  }

  /* ---------------- team ---------------- */
  const departments = await getManagedDepartments(req.userId);

  if (departments.length > 0) {
    const departmentIds = departments.map((department) => department._id);
    const teamIds = await getTeamMemberIds(departmentIds, req.userId);

    // the manager belongs in their own department's totals - see the note above
    const memberIds = [...teamIds, req.userId];

    return {
      level: "team",
      label: departments.map((department) => department.name).join(", "),
      requestFilter: { requester: { $in: memberIds } },
      memberIds,
      departments,
    };
  }

  /* ---------------- own ---------------- */
  return {
    level: "own",
    label: "My own requests",
    requestFilter: { requester: req.userId },
    memberIds: [req.userId],
    departments: [],
  };
};

/* =====================================================================
   2) NARROWING BY DEPARTMENT
   ---------------------------------------------------------------------
   A Request does not know which department it belongs to - only the
   PERSON who raised it does (see the note on getDepartmentPerformance
   in dashboardStats.js).

   The obvious way to filter by department is therefore a $lookup on
   users inside every pipeline. We do the opposite: turn the department
   into a list of employee ids ONCE, and hand every query a plain
   `requester: { $in: [...] }`. That filter hits the
   { requester, isDeleted } index the requests already have, while a
   $lookup cannot use an index at all.

   @returns an array of user ids, or null when no department was asked
            for (which means "do not narrow anything")
   ===================================================================== */
export const resolveDepartmentMembers = async (departmentId) => {
  if (!departmentId) {
    return null;
  }

  const members = await User.find({
    department: departmentId,
    isDeleted: false,
  })
    .select("_id")
    .lean();

  return members.map((member) => member._id);
};

/*
  Two lists of user ids, narrowed to the people in BOTH.

  This is what stops a manager from reading another department's
  numbers by putting ?department=<other id> in the URL: their scope
  list and the requested department have nobody in common, so the
  answer is an empty report rather than somebody else's data.

  Either side may be null, which means "no opinion".
*/
export const intersectMembers = (scopeIds, departmentIds) => {
  if (!scopeIds) {
    return departmentIds;
  }

  if (!departmentIds) {
    return scopeIds;
  }

  const wanted = new Set(departmentIds.map(String));

  return scopeIds.filter((id) => wanted.has(String(id)));
};

/* =====================================================================
   3) THE DEPARTMENTS A USER MAY CHOOSE FROM
   ---------------------------------------------------------------------
   Fills the "Department" dropdown on the Reports and Search pages.

   An org-level user gets every department; a manager gets only the
   ones they manage, so the dropdown never offers a filter that would
   come back empty; somebody at "own" level gets none, because
   filtering their own five requests by department is not a question
   anybody asks.
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
