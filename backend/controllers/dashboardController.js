/*
=========================================================================
  CONTROLLER: Dashboard                           ( the "C" of MVC )
=========================================================================
  Module 5 - Dashboard & Analytics.

  FUNCTIONS IN THIS FILE
    getEmployeeDashboard  GET  /api/dashboard/employee
    getManagerDashboard   GET  /api/dashboard/manager
    getAdminDashboard     GET  /api/dashboard/admin
    getDashboardCharts    GET  /api/dashboard/charts?scope=org&months=6

  The COUNTING all lives in config/dashboardStats.js. This file only does
  the HTTP work: read the query, work out which slice of the company the
  caller is allowed to see, hand over to the helpers, answer.

  ONE DASHBOARD PER QUESTION, NOT ONE PER ROLE
  --------------------------------------------
  There is no "role" column anywhere in FlowDesk - a role is just a bag
  of permissions an admin can rebuild at any time. So these endpoints are
  not named after roles, they are named after the QUESTION they answer,
  and each one decides for itself who may ask it:

    /employee -> "my own requests". Everybody, always. No permission
                 needed: you are allowed to see your own paperwork.
    /manager  -> "my team". Allowed when at least one department points
                 at you as its manager. That comes from the DATA, so it
                 keeps working even if the "Manager" role is renamed.
    /admin    -> "the whole company". Needs "analytics:read".

  The React dashboard simply calls all three; the ones the user has no
  business seeing answer with an empty shape instead of an error, so the
  page can just leave that section out.
=========================================================================
*/

import Request from "../model/requestModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import Workflow from "../model/workflowModel.js";
import Approval from "../model/approvalModel.js";
import { PERMISSIONS } from "../config/permissions.js";
import {
  CHART_SCOPES,
  DEFAULT_CHART_MONTHS,
  MIN_CHART_MONTHS,
  MAX_CHART_MONTHS,
  RECENT_REQUEST_LIMIT,
  RECENT_ACTIVITY_LIMIT,
  MY_APPROVAL_DAYS,
} from "../config/dashboardConstants.js";
import {
  countRequestsByStatus,
  countMyPendingApprovals,
  getManagedDepartments,
  getTeamMemberIds,
  getRecentActivity,
  getTopRequesters,
  getCharts,
  getMyDecisionCounts,
  getMyRecentDecisions,
} from "../config/dashboardStats.js";

/* =====================================================================
   HELPERS
   ===================================================================== */

// a request row only needs this much to fill a dashboard list
const RECENT_REQUEST_FIELDS =
  "requestId title type category priority status amount createdAt submittedAt";

// what "count the requests" answers when there is nobody to count them for
const EMPTY_TEAM_STATS = {
  total: 0,
  draft: 0,
  pending: 0,
  returned: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
};

const hasAnalyticsPermission = (req) =>
  (req.user.role?.permissions || []).includes(PERMISSIONS.ANALYTICS_READ);

/*
  ?months=6 -> 6, but never less than 3 and never more than 24.
  A bad value falls back to the default instead of erroring: a dashboard
  that refuses to draw because somebody typed months=abc in the URL is
  worse than a dashboard showing its normal six months.
*/
const readMonths = (value) => {
  const months = Number(value);

  if (!Number.isFinite(months)) {
    return DEFAULT_CHART_MONTHS;
  }

  return Math.min(Math.max(Math.round(months), MIN_CHART_MONTHS), MAX_CHART_MONTHS);
};

/* =====================================================================
   1) THE EMPLOYEE DASHBOARD   <- "what is happening with MY requests?"
   ---------------------------------------------------------------------
   GET /api/dashboard/employee

   Everything here is filtered by "requester: me", exactly like the
   Requests page, so this endpoint can never leak somebody else's data.

   pendingApprovals is included even though this is the EMPLOYEE
   dashboard: a workflow stage may name any employee as its approver
   (see config/permissions.js), so an ordinary employee can perfectly
   well have three requests waiting on their answer.
   ===================================================================== */
export const getEmployeeDashboard = async (req, res) => {
  try {
    const [stats, pendingApprovals, recentRequests, recentActivity] =
      await Promise.all([
        countRequestsByStatus({ requester: req.userId }),

        countMyPendingApprovals(req.userId),

        Request.find({ requester: req.userId, isDeleted: false })
          .select(RECENT_REQUEST_FIELDS)
          .sort({ createdAt: -1 })
          .limit(RECENT_REQUEST_LIMIT)
          .lean(),

        // the timeline of my own requests: who did what to them, newest first
        getRecentActivity({ requester: req.userId }, RECENT_ACTIVITY_LIMIT),
      ]);

    return res.status(200).json({
      message: "Employee dashboard fetched successfully",
      stats,
      pendingApprovals,
      recentRequests,
      recentActivity,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Employee Dashboard Error ${error}` });
  }
};

/* =====================================================================
   2) THE MANAGER DASHBOARD   <- "how is my team doing?"
   ---------------------------------------------------------------------
   GET /api/dashboard/manager

   A user is a manager here because a department points at them, not
   because of their role name (see dashboardStats.js). Somebody who
   manages nothing gets isManager:false and empty lists rather than a
   403 - the React dashboard calls this for everybody and simply hides
   the section when isManager is false.
   ===================================================================== */
export const getManagerDashboard = async (req, res) => {
  try {
    const departments = await getManagedDepartments(req.userId);

    // not a manager of anything -> nothing to show, and nothing to count
    if (!departments.length) {
      return res.status(200).json({
        message: "This user does not manage any department",
        isManager: false,
        departments: [],
        teamSize: 0,
        pendingApprovals: 0,
        teamStats: null,
        teamRequests: [],
        topRequesters: [],
        recentActivity: [],
      });
    }

    const departmentIds = departments.map((department) => department._id);
    const memberIds = await getTeamMemberIds(departmentIds, req.userId);

    /*
      A department with no employees in it yet is a real answer, not an
      error. We stop here so we never send MongoDB a "requester is one of
      []" filter, which matches nothing and only costs a round trip.
    */
    if (!memberIds.length) {
      const pendingApprovals = await countMyPendingApprovals(req.userId);

      return res.status(200).json({
        message: "Manager dashboard fetched successfully",
        isManager: true,
        departments,
        teamSize: 0,
        pendingApprovals,
        teamStats: EMPTY_TEAM_STATS,
        teamRequests: [],
        topRequesters: [],
        recentActivity: [],
      });
    }

    const teamFilter = { requester: { $in: memberIds } };

    const [teamStats, pendingApprovals, teamRequests, topRequesters, recentActivity] =
      await Promise.all([
        countRequestsByStatus(teamFilter),

        // "Pending Approvals" means the ones waiting for MY decision
        countMyPendingApprovals(req.userId),

        /*
          A draft is deliberately left out: it has never been sent to
          anybody, so it is still private to the employee who wrote it.
        */
        Request.find({ ...teamFilter, isDeleted: false, status: { $ne: "Draft" } })
          .select(RECENT_REQUEST_FIELDS)
          .populate("requester", "firstName lastName employeeId photoUrl")
          .sort({ createdAt: -1 })
          .limit(RECENT_REQUEST_LIMIT)
          .lean(),

        getTopRequesters(memberIds),

        getRecentActivity(teamFilter, RECENT_ACTIVITY_LIMIT),
      ]);

    return res.status(200).json({
      message: "Manager dashboard fetched successfully",
      isManager: true,
      departments,
      teamSize: memberIds.length,
      pendingApprovals,
      teamStats,
      teamRequests,
      topRequesters,
      recentActivity,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Manager Dashboard Error ${error}` });
  }
};

/* =====================================================================
   2b) THE APPROVER DASHBOARD   <- "what am I being asked to decide?"
   ---------------------------------------------------------------------
   GET /api/dashboard/approver

   The fourth question, and the one the first three could not answer.

   /manager is about a DEPARTMENT: the requests raised by the people who
   report to you. That works for an Engineering Manager, because the
   things they approve and the people they manage are the same set.

   It does not work for anybody who reviews a KIND of thing rather than a
   team. A Finance Manager approves purchases from Engineering, Sales and
   R&D; a Director signs off budgets from everywhere. None of those
   requests are raised by their own department, so before this endpoint
   existed a Finance Manager could approve twenty requests in a morning
   and watch their dashboard show nothing at all.

   NO PERMISSION, for the same reason /employee needs none: this only
   ever reports on the caller's OWN decisions. The filter is
   "history.actor: me", so there is nothing here to leak.
   ===================================================================== */
export const getApproverDashboard = async (req, res) => {
  try {
    /*
      The window is counted back from NOW in UTC, matching every other
      date in the dashboard module (see the note at the top of
      dashboardStats.js about why both sides must agree on UTC).
    */
    const since = new Date(
      Date.now() - MY_APPROVAL_DAYS * 24 * 60 * 60 * 1000
    );

    const [pendingApprovals, decisionCounts, recentDecisions] =
      await Promise.all([
        countMyPendingApprovals(req.userId),
        getMyDecisionCounts(req.userId, since),
        getMyRecentDecisions(req.userId),
      ]);

    const decidedTotal =
      decisionCounts.approved + decisionCounts.rejected + decisionCounts.returned;

    return res.status(200).json({
      message: "Approver dashboard fetched successfully",
      /*
        The flag the React page switches the whole section on. Somebody
        with nothing waiting and nothing ever decided is not an approver
        yet, and showing them three empty zeroes would only be noise -
        exactly how isManager:false hides the team section.
      */
      isApprover: pendingApprovals > 0 || decidedTotal > 0,
      windowDays: MY_APPROVAL_DAYS,
      pendingApprovals,
      decisionCounts,
      recentDecisions,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Approver Dashboard Error ${error}` });
  }
};

/* =====================================================================
   3) THE ADMIN DASHBOARD   <- "how is the whole company doing?"
   ---------------------------------------------------------------------
   GET /api/dashboard/admin        (needs "analytics:read")

   Six numbers, all counted straight in MongoDB with countDocuments()
   instead of loading the rows and measuring the array - the difference
   matters the moment the company has more than a handful of employees.

   Every count skips the soft-deleted rows, because a deleted user is
   hidden everywhere else in the app and a dashboard that still counts
   them would quietly disagree with the Employees page.
   ===================================================================== */
export const getAdminDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalDepartments,
      activeWorkflows,
      totalWorkflows,
      pendingApprovals,
      requestStats,
      recentRequests,
      recentActivity,
    ] = await Promise.all([
      User.countDocuments({ isDeleted: false }),
      User.countDocuments({ isDeleted: false, isActive: true }),
      Department.countDocuments({ isDeleted: false }),

      // a workflow is a draft until somebody switches it on (Module 3)
      Workflow.countDocuments({ isDeleted: false, isActive: true }),
      Workflow.countDocuments({ isDeleted: false }),

      // every approval standing at a stage, whoever it is waiting for
      Approval.countDocuments({ status: "InProgress" }),

      countRequestsByStatus(),

      Request.find({ isDeleted: false, status: { $ne: "Draft" } })
        .select(RECENT_REQUEST_FIELDS)
        .populate("requester", "firstName lastName employeeId photoUrl")
        .sort({ createdAt: -1 })
        .limit(RECENT_REQUEST_LIMIT)
        .lean(),

      getRecentActivity({}, RECENT_ACTIVITY_LIMIT),
    ]);

    return res.status(200).json({
      message: "Admin dashboard fetched successfully",
      stats: {
        totalUsers,
        activeUsers,
        totalDepartments,
        totalWorkflows,
        activeWorkflows,
        pendingApprovals,
        totalRequests: requestStats.total,
      },
      requestStats,
      recentRequests,
      recentActivity,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Admin Dashboard Error ${error}` });
  }
};

/* =====================================================================
   4) THE CHARTS
   ---------------------------------------------------------------------
   GET /api/dashboard/charts?scope=org&months=6

   All four charts come from ONE endpoint on purpose. They are always
   drawn together and they must always describe the SAME slice of the
   company over the SAME months - four separate endpoints could answer
   at four slightly different moments and show four different totals.

   THE TWO SCOPES
     org  -> everybody. Needs "analytics:read".
     team -> only the departments the caller manages. Needs no
             permission, because managing a department already means
             being responsible for it.

   The scope is checked HERE and turned into a filter, so a manager
   cannot ask for scope=org by editing the URL.
   ===================================================================== */
export const getDashboardCharts = async (req, res) => {
  try {
    const months = readMonths(req.query.months);
    const scope = CHART_SCOPES.includes(req.query.scope)
      ? req.query.scope
      : "org";

    /* ---------------- team scope ---------------- */
    if (scope === "team") {
      const departments = await getManagedDepartments(req.userId);

      if (!departments.length) {
        return res.status(403).json({
          message: "You do not manage any department",
        });
      }

      const departmentIds = departments.map((department) => department._id);
      const memberIds = await getTeamMemberIds(departmentIds, req.userId);

      const charts = await getCharts({
        requestFilter: { requester: { $in: memberIds } },
        approvalFilter: { requester: { $in: memberIds } },
        months,
      });

      return res.status(200).json({
        message: "Charts fetched successfully",
        scope,
        charts,
      });
    }

    /* ---------------- organisation scope ---------------- */
    if (!hasAnalyticsPermission(req)) {
      return res.status(403).json({
        message: "You do not have permission to view company wide analytics",
      });
    }

    const charts = await getCharts({
      requestFilter: {},
      approvalFilter: {},
      months,
    });

    return res.status(200).json({
      message: "Charts fetched successfully",
      scope,
      charts,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Dashboard Charts Error ${error}` });
  }
};
