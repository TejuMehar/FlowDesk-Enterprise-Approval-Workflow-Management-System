/*
=========================================================================
  DASHBOARD STATISTICS   (Module 5 - Dashboard & Analytics)
=========================================================================
  The same job config/approvalEngine.js does for Module 4: the CONTROLLER
  does the HTTP work, this file does the thinking.

  Everything here is a READ. Not one function in this file writes to the
  database, so a dashboard can never change a request or an approval.

  WHY AGGREGATIONS INSTEAD OF find()
  ----------------------------------
  A dashboard asks questions like "how many requests per month, split by
  outcome". Doing that with find() would mean pulling every request into
  node and counting them in JavaScript - fine with 50 requests, hopeless
  with 50,000. An aggregation pipeline asks MongoDB to do the counting
  and sends back only the handful of numbers we actually draw.

  A PIPELINE IS A LIST OF STEPS, each one feeding the next:

      $match   keep only the documents we care about   (like a WHERE)
      $unwind  turn one document with an array of 5 into 5 documents
      $group   squash many documents into one row per key (like GROUP BY)
      $lookup  fetch the matching document from another collection (JOIN)
      $project choose and rename the fields we send back (like SELECT)
      $sort / $limit   exactly what they sound like

  ABOUT TIME ZONES
  ----------------
  Every month bucket is built in UTC, and MongoDB also groups in UTC by
  default. Both sides therefore agree on where a month starts, which is
  the whole point - a request made at 23:00 on the 31st must not land in
  two different months depending on who is looking.
=========================================================================
*/

import mongoose from "mongoose";

import Request from "../model/requestModel.js";
import Approval from "../model/approvalModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
/*
  MODULE 9 - the fixed order the donut is drawn in comes from the
  database now (the  column of the request types), not from a
  constant. Everything the note below says about WHY the order is fixed
  is unchanged: the UI gives every type a colour, so a type must not
  move because it had a quiet month.
*/
import { getRequestTypeNames } from "./requestTypeService.js";
import {
  PENDING_REQUEST_STATUSES,
  APPROVED_HISTORY_ACTIONS,
  REJECTED_HISTORY_ACTIONS,
  RETURNED_HISTORY_ACTIONS,
  MAX_CATEGORY_SLICES,
  RECENT_ACTIVITY_LIMIT,
  TOP_REQUESTER_LIMIT,
  MY_DECISION_HISTORY_ACTIONS,
  MY_DECISION_LIMIT,
} from "./dashboardConstants.js";

/* =====================================================================
   SECTION 1 - SMALL SHARED HELPERS
   ===================================================================== */

/*
  An aggregation pipeline does NOT cast strings to ObjectIds the way
  find() does, so an id that arrived as text would silently match
  nothing. Every id goes through here first.
*/
export const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(String(value));
};

/*
  The building block of every "count by status" number:
      { $sum: { $cond: [ <is it this status?>, 1, 0 ] } }
  which reads as "add 1 when the condition is true, otherwise add 0".
*/
const countWhen = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

const isStatus = (status) => ({ $eq: ["$status", status] });
const isPendingStatus = { $in: ["$status", PENDING_REQUEST_STATUSES] };

/* =====================================================================
   SECTION 2 - THE MONTH BUCKETS
   ---------------------------------------------------------------------
   A chart must show EVERY month in its range, including the quiet ones.
   MongoDB only sends back the months that have data, so we build the
   full list of months first and then drop the numbers into it. Without
   this a month with no requests would simply disappear and the line
   would jump straight from May to July.
   ===================================================================== */

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/*
  @param months - how many months to go back, including this one
  @returns [{ key: "2026-07", label: "Jul", fullLabel: "Jul 2026" }, ...]
           oldest first, plus the Date the range starts at.
*/
export const buildMonthBuckets = (months) => {
  const now = new Date();

  // the first day of the OLDEST month in the range, at 00:00 UTC
  const startDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)
  );

  const buckets = [];

  for (let index = 0; index < months; index++) {
    const date = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + index, 1)
    );

    const year = date.getUTCFullYear();
    const monthNumber = date.getUTCMonth(); // 0 - 11

    buckets.push({
      // the same text $dateToString produces below, so the two can be matched
      key: `${year}-${String(monthNumber + 1).padStart(2, "0")}`,
      label: MONTH_NAMES[monthNumber],
      fullLabel: `${MONTH_NAMES[monthNumber]} ${year}`,
    });
  }

  return { startDate, buckets };
};

/*
  Turns the rows MongoDB sent back into one row per month bucket.

  @param buckets   from buildMonthBuckets()
  @param rows      [{ _id: "2026-07", approved: 3, ... }]
  @param emptyRow  what a month with no data looks like
*/
const fillMonthBuckets = (buckets, rows, emptyRow) => {
  // a Map gives us "find the row for 2026-07" without scanning the array
  const rowsByMonth = new Map(rows.map((row) => [row._id, row]));

  return buckets.map((bucket) => {
    const row = rowsByMonth.get(bucket.key) || {};

    const filled = {
      month: bucket.key,
      label: bucket.label,
      fullLabel: bucket.fullLabel,
    };

    // copy every number of the empty row, using the real value when we have one
    Object.keys(emptyRow).forEach((field) => {
      filled[field] = row[field] ?? emptyRow[field];
    });

    return filled;
  });
};

/* =====================================================================
   SECTION 3 - COUNTING REQUESTS BY STATUS
   ---------------------------------------------------------------------
   Used by all three dashboards. Only the filter changes:

     employee -> { requester: me }
     manager  -> { requester: { $in: my team } }
     admin    -> {}                       (everybody)
   ===================================================================== */

const EMPTY_STATUS_COUNTS = {
  total: 0,
  draft: 0,
  pending: 0,
  returned: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
};

/*
  @param filter - anything that narrows down which requests to count
  @returns { total, draft, pending, returned, approved, rejected, cancelled }
*/
export const countRequestsByStatus = async (filter = {}) => {
  const [row] = await Request.aggregate([
    { $match: { isDeleted: false, ...filter } },
    {
      $group: {
        // one single row for everything that matched
        _id: null,
        total: { $sum: 1 },
        draft: countWhen(isStatus("Draft")),
        pending: countWhen(isPendingStatus),
        returned: countWhen(isStatus("Returned")),
        approved: countWhen(isStatus("Approved")),
        rejected: countWhen(isStatus("Rejected")),
        cancelled: countWhen(isStatus("Cancelled")),
      },
    },
    { $project: { _id: 0 } },
  ]);

  // no requests at all -> the aggregation sends back nothing, not zeros
  return row || { ...EMPTY_STATUS_COUNTS };
};

/* =====================================================================
   SECTION 4 - WHO IS ON MY TEAM?
   ---------------------------------------------------------------------
   "Manager" is not a role here, it is a FACT about the data: a user is a
   manager because some department points at them.

   That deliberately does not use a permission. An admin can rename or
   delete the "Manager" role at any time, but the moment somebody is set
   as the manager of Engineering they must be able to see Engineering -
   and the moment they are replaced, they must stop seeing it.
   ===================================================================== */

/*
  The departments this user manages.
  @returns [{ _id, name, code }]
*/
export const getManagedDepartments = async (userId) => {
  return await Department.find({ manager: userId, isDeleted: false })
    .select("name code")
    .sort({ name: 1 })
    .lean();
};

/*
  The employees inside those departments.

  The manager themselves is left OUT: their own requests already have a
  home on their personal dashboard, and counting them under "team" would
  make a manager who raises a lot of requests look like a busy team.
*/
export const getTeamMemberIds = async (departmentIds, managerId) => {
  if (!departmentIds.length) {
    return [];
  }

  const members = await User.find({
    department: { $in: departmentIds },
    _id: { $ne: managerId },
    isDeleted: false,
  })
    .select("_id")
    .lean();

  return members.map((member) => member._id);
};

/* =====================================================================
   SECTION 5 - HOW MANY APPROVALS ARE WAITING?
   ---------------------------------------------------------------------
   The same $elemMatch the Approvals page uses (see approvalController),
   kept identical on purpose: the number on the dashboard card and the
   number of rows on the Approvals page must always be the same, or the
   dashboard is lying.
   ===================================================================== */
export const countMyPendingApprovals = async (userId) => {
  return await Approval.countDocuments({
    status: "InProgress",
    stages: {
      $elemMatch: {
        status: "Pending",
        approvers: userId,
        "decisions.approver": { $ne: userId },
      },
    },
  });
};

/* =====================================================================
   SECTION 5b - WHAT HAVE I DECIDED? (the approver dashboard)
   ---------------------------------------------------------------------
   countMyPendingApprovals() above answers "what is waiting for me". This
   pair answers the other half: "what did I already deal with".

   The gap they close is a real one. A Finance Manager approves purchases
   from Engineering, Sales and R&D all day, but the team dashboard counts
   requests RAISED BY their own department - so none of that work ever
   appeared anywhere on their dashboard.

   BOTH READ THE TIMELINE, NOT stages.decisions, for the reason
   getApprovalTrends() gives further down: a returned request that is
   corrected and submitted again has its stages rebuilt from scratch, and
   the decisions on them are wiped. The timeline is never overwritten, so
   it is the only place a decision is safe. It is also the indexed one -
   approvalModel declares { "history.actor": 1 } for exactly these two
   queries.
   ===================================================================== */

/*
  How many requests I approved / rejected / returned since `startDate`.

  @returns { approved, rejected, returned }
*/
export const getMyDecisionCounts = async (userId, startDate) => {
  const [row] = await Approval.aggregate([
    // narrow on the indexed field BEFORE unwinding, so Mongo can use it
    { $match: { "history.actor": toObjectId(userId) } },
    { $unwind: "$history" },
    {
      $match: {
        "history.actor": toObjectId(userId),
        "history.createdAt": { $gte: startDate },
        "history.action": { $in: MY_DECISION_HISTORY_ACTIONS },
      },
    },
    {
      $group: {
        _id: null,
        approved: countWhen({ $eq: ["$history.action", "Approved"] }),
        rejected: countWhen({ $eq: ["$history.action", "Rejected"] }),
        returned: countWhen({ $eq: ["$history.action", "Returned"] }),
      },
    },
    { $project: { _id: 0 } },
  ]);

  // nothing decided yet -> the aggregation sends back no row at all
  return row || { approved: 0, rejected: 0, returned: 0 };
};

/*
  The last few decisions I made, newest first, with enough of the request
  and the person who raised it to fill a list row.
*/
export const getMyRecentDecisions = async (
  userId,
  limit = MY_DECISION_LIMIT
) => {
  return await Approval.aggregate([
    { $match: { "history.actor": toObjectId(userId) } },
    { $unwind: "$history" },
    {
      $match: {
        "history.actor": toObjectId(userId),
        "history.action": { $in: MY_DECISION_HISTORY_ACTIONS },
      },
    },
    { $sort: { "history.createdAt": -1 } },
    { $limit: limit },

    {
      $lookup: {
        from: "requests",
        localField: "request",
        foreignField: "_id",
        as: "requestDoc",
      },
    },
    { $unwind: { path: "$requestDoc", preserveNullAndEmptyArrays: true } },

    /*
      WHO ASKED. The whole point of this list for a Finance Manager is
      that the names are from departments they do not manage, so the
      requester has to be joined in - the approval only carries an id.
    */
    {
      $lookup: {
        from: "users",
        localField: "requester",
        foreignField: "_id",
        as: "requesterDoc",
      },
    },
    { $unwind: { path: "$requesterDoc", preserveNullAndEmptyArrays: true } },

    {
      $project: {
        _id: 0,
        action: "$history.action",
        comment: "$history.comment",
        stageName: "$history.stageName",
        decidedAt: "$history.createdAt",
        request: {
          _id: "$requestDoc._id",
          requestId: "$requestDoc.requestId",
          title: "$requestDoc.title",
          type: "$requestDoc.type",
          amount: "$requestDoc.amount",
          // the CURRENT status, which may have moved on since I decided
          status: "$requestDoc.status",
        },
        requester: {
          $cond: [
            { $ifNull: ["$requesterDoc", false] },
            {
              _id: "$requesterDoc._id",
              firstName: "$requesterDoc.firstName",
              lastName: "$requesterDoc.lastName",
              employeeId: "$requesterDoc.employeeId",
              photoUrl: "$requesterDoc.photoUrl",
            },
            null,
          ],
        },
      },
    },
  ]);
};

/* =====================================================================
   SECTION 6 - RECENT ACTIVITY
   ---------------------------------------------------------------------
   The timeline of an approval is the honest record of what happened to a
   request (see approvalModel.js). "Recent Activity" is simply the newest
   lines of those timelines, whoever wrote them.

   $unwind is the interesting step: an approval with 6 timeline lines
   becomes 6 documents, one per line, so we can sort ALL lines of ALL
   approvals against each other by date.
   ===================================================================== */

/*
  @param approvalFilter - which approvals to read the timeline of
  @param limit          - how many lines to send back
*/
export const getRecentActivity = async (
  approvalFilter = {},
  limit = RECENT_ACTIVITY_LIMIT
) => {
  /*
    NARROW BEFORE UNWINDING.

    Unwinding first and sorting afterwards would be correct but would
    make MongoDB sort EVERY timeline line of EVERY approval that matched
    - and an unindexed sort that big eventually hits Mongo's 100MB sort
    limit and fails outright.

    Writing a timeline line always saves the approval, so the newest
    lines can only live in the most recently updated approvals. Reading
    a generous window of those first (indexed, cheap) and unwinding only
    those keeps the work bounded whatever the company's size.
  */
  const APPROVAL_WINDOW = limit * 5;

  return await Approval.aggregate([
    { $match: approvalFilter },
    { $sort: { updatedAt: -1 } },
    { $limit: APPROVAL_WINDOW },

    { $unwind: "$history" },
    { $sort: { "history.createdAt": -1 } },
    { $limit: limit },

    // the request this line is about
    {
      $lookup: {
        from: "requests",
        localField: "request",
        foreignField: "_id",
        as: "requestDoc",
      },
    },
    { $unwind: { path: "$requestDoc", preserveNullAndEmptyArrays: true } },

    /*
      WHO did it. The actor is empty when the SYSTEM did it (an auto
      approval rule), so preserveNullAndEmptyArrays keeps that line
      instead of quietly dropping it.
    */
    {
      $lookup: {
        from: "users",
        localField: "history.actor",
        foreignField: "_id",
        as: "actorDoc",
      },
    },
    { $unwind: { path: "$actorDoc", preserveNullAndEmptyArrays: true } },

    {
      $project: {
        _id: 0,
        action: "$history.action",
        comment: "$history.comment",
        stageName: "$history.stageName",
        createdAt: "$history.createdAt",
        request: {
          _id: "$requestDoc._id",
          requestId: "$requestDoc.requestId",
          title: "$requestDoc.title",
          type: "$requestDoc.type",
          status: "$requestDoc.status",
        },
        // null stays null, so the UI can print "System"
        actor: {
          $cond: [
            { $ifNull: ["$actorDoc", false] },
            {
              _id: "$actorDoc._id",
              firstName: "$actorDoc.firstName",
              lastName: "$actorDoc.lastName",
              employeeId: "$actorDoc.employeeId",
              photoUrl: "$actorDoc.photoUrl",
            },
            null,
          ],
        },
      },
    },
  ]);
};

/* =====================================================================
   SECTION 7 - CHART 1: MONTHLY REQUESTS
   ---------------------------------------------------------------------
   "How many requests were raised each month, and how did they end up?"

   The split is by the CURRENT status of the request, so a request raised
   in May and approved in July counts as an approved May request. That is
   the honest reading of "requests raised in May" - the month says when
   it was asked for, the colour says how it turned out.
   ===================================================================== */
export const getMonthlyRequests = async (filter, startDate, buckets) => {
  const rows = await Request.aggregate([
    { $match: { isDeleted: false, createdAt: { $gte: startDate }, ...filter } },
    {
      $group: {
        // "2026-07" - the same text buildMonthBuckets() produced
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        total: { $sum: 1 },
        approved: countWhen(isStatus("Approved")),
        rejected: countWhen(isStatus("Rejected")),
        pending: countWhen(isPendingStatus),
      },
    },
  ]);

  return fillMonthBuckets(buckets, rows, {
    total: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
  });
};

/* =====================================================================
   SECTION 8 - CHART 2: APPROVAL TRENDS
   ---------------------------------------------------------------------
   "How many DECISIONS were made each month?"

   Chart 1 counts requests by the month they were RAISED. This one counts
   decisions by the month they were MADE, which is a different question:
   a slow month for decisions with a normal month for requests is exactly
   the backlog an admin wants to see.

   We read the timeline again rather than the stages, because the stages
   are rebuilt from scratch when a returned request is submitted a second
   time - the timeline is the part that is never overwritten.
   ===================================================================== */
export const getApprovalTrends = async (filter, startDate, buckets) => {
  const rows = await Approval.aggregate([
    { $match: filter },
    { $unwind: "$history" },
    {
      $match: {
        "history.createdAt": { $gte: startDate },
        "history.action": {
          $in: [
            ...APPROVED_HISTORY_ACTIONS,
            ...REJECTED_HISTORY_ACTIONS,
            ...RETURNED_HISTORY_ACTIONS,
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m", date: "$history.createdAt" },
        },
        approved: countWhen({
          $in: ["$history.action", APPROVED_HISTORY_ACTIONS],
        }),
        rejected: countWhen({
          $in: ["$history.action", REJECTED_HISTORY_ACTIONS],
        }),
        returned: countWhen({
          $in: ["$history.action", RETURNED_HISTORY_ACTIONS],
        }),
      },
    },
  ]);

  return fillMonthBuckets(buckets, rows, {
    approved: 0,
    rejected: 0,
    returned: 0,
  });
};

/* =====================================================================
   SECTION 9 - CHART 3: DEPARTMENT PERFORMANCE
   ---------------------------------------------------------------------
   "Which departments get their requests through, and which get stuck?"

   A request does not know which department it belongs to - only the
   PERSON who raised it does. So the pipeline joins each request to its
   requester ($lookup on users) and groups by that person's department.

   Requests from employees with no department land under one "No
   department" row instead of being thrown away, because a number that
   quietly ignores some of the data is worse than an untidy row.
   ===================================================================== */
export const getDepartmentPerformance = async (filter = {}) => {
  const rows = await Request.aggregate([
    { $match: { isDeleted: false, ...filter } },

    {
      $lookup: {
        from: "users",
        localField: "requester",
        foreignField: "_id",
        as: "requesterDoc",
      },
    },
    { $unwind: "$requesterDoc" },

    {
      $group: {
        _id: "$requesterDoc.department", // null = no department
        total: { $sum: 1 },
        approved: countWhen(isStatus("Approved")),
        rejected: countWhen(isStatus("Rejected")),
        pending: countWhen(isPendingStatus),
      },
    },

    {
      $lookup: {
        from: "departments",
        localField: "_id",
        foreignField: "_id",
        as: "departmentDoc",
      },
    },
    { $unwind: { path: "$departmentDoc", preserveNullAndEmptyArrays: true } },

    {
      $project: {
        _id: 0,
        departmentId: "$_id",
        name: { $ifNull: ["$departmentDoc.name", "No department"] },
        code: { $ifNull: ["$departmentDoc.code", "-"] },
        total: 1,
        approved: 1,
        rejected: 1,
        pending: 1,
      },
    },

    { $sort: { total: -1, name: 1 } },
  ]);

  /*
    THE APPROVAL RATE is worked out here rather than in the pipeline,
    because it must not count requests nobody has decided on yet:

        rate = approved / (approved + rejected)

    A department with 20 requests still travelling and 1 approved is at
    100%, not 5%. The chart shows the "decided" number next to the bar so
    a rate built on one decision is obvious for what it is.
  */
  return rows.map((row) => {
    const decided = row.approved + row.rejected;

    return {
      ...row,
      decided,
      approvalRate: decided > 0 ? Math.round((row.approved / decided) * 100) : null,
    };
  });
};

/* =====================================================================
   SECTION 10 - CHART 4: REQUEST CATEGORIES
   ---------------------------------------------------------------------
   "What do people actually ask for?"

   Grouped by request TYPE (Leave, Purchase, Laptop ...) and not by the
   free-text category field, because the type is a fixed list - a donut
   built on free text would grow a new slice every time somebody typed
   "sick leave" instead of "Sick Leave".

   The types are returned in the admin's configured order, never by
   size: the UI gives every type a fixed colour, so "Leave" has to stay
   the same colour whether it is the biggest slice this month or the
   smallest. Only the small tail is folded into one "Other" slice.
   ===================================================================== */
export const getRequestCategories = async (filter = {}) => {
  const rows = await Request.aggregate([
    { $match: { isDeleted: false, ...filter } },
    { $group: { _id: "$type", total: { $sum: 1 } } },
  ]);

  const totalsByType = new Map(rows.map((row) => [row._id, row.total]));

  // every type that really has requests, in the admin's chosen order
  const typeOrder = await getRequestTypeNames();

  const withData = typeOrder
    .filter((type) => totalsByType.get(type) > 0)
    .map((type) => ({ type, total: totalsByType.get(type) }));

  if (withData.length <= MAX_CATEGORY_SLICES) {
    return withData;
  }

  /*
    Too many slices to read. We keep the biggest ones and add up the
    rest, but we put the survivors back into the configured order
    afterwards so the colours stay where they were.
  */
  const biggest = [...withData]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_CATEGORY_SLICES - 1);

  const keptTypes = new Set(biggest.map((slice) => slice.type));

  const otherTotal = withData
    .filter((slice) => !keptTypes.has(slice.type))
    .reduce((sum, slice) => sum + slice.total, 0);

  return [
    ...withData.filter((slice) => keptTypes.has(slice.type)),
    { type: "Other", total: otherTotal },
  ];
};

/* =====================================================================
   SECTION 11 - THE FOUR CHARTS TOGETHER
   ---------------------------------------------------------------------
   The dashboard draws all four at once, so they are fetched together
   with Promise.all - four questions asked in parallel instead of one
   after the other.

   @param requestFilter  narrows the requests  (e.g. only my team's)
   @param approvalFilter narrows the approvals (the same slice)
   @param months         how far back to look
   ===================================================================== */
export const getCharts = async ({ requestFilter, approvalFilter, months }) => {
  const { startDate, buckets } = buildMonthBuckets(months);

  const [monthlyRequests, approvalTrends, departmentPerformance, requestCategories] =
    await Promise.all([
      getMonthlyRequests(requestFilter, startDate, buckets),
      getApprovalTrends(approvalFilter, startDate, buckets),
      getDepartmentPerformance(requestFilter),
      getRequestCategories(requestFilter),
    ]);

  /*
    The one headline number that belongs with the trends chart. It is a
    percentage while the chart plots counts, and two different scales
    must never share one y-axis - so it is a number beside the chart,
    not a fifth line inside it.
  */
  const decidedTotal = approvalTrends.reduce(
    (sum, month) => sum + month.approved + month.rejected,
    0
  );

  const approvedTotal = approvalTrends.reduce(
    (sum, month) => sum + month.approved,
    0
  );

  return {
    months,
    monthlyRequests,
    approvalTrends,
    departmentPerformance,
    requestCategories,
    approvalRate:
      decidedTotal > 0 ? Math.round((approvedTotal / decidedTotal) * 100) : null,
  };
};

/* =====================================================================
   SECTION 12 - WHO RAISES THE MOST? (manager dashboard)
   ---------------------------------------------------------------------
   The five busiest people on the team, so a manager can see at a glance
   where the paperwork is coming from.
   ===================================================================== */
export const getTopRequesters = async (memberIds, limit = TOP_REQUESTER_LIMIT) => {
  if (!memberIds.length) {
    return [];
  }

  return await Request.aggregate([
    {
      $match: {
        isDeleted: false,
        requester: { $in: memberIds },
        status: { $ne: "Draft" }, // a draft was never sent to anybody
      },
    },
    {
      $group: {
        _id: "$requester",
        total: { $sum: 1 },
        approved: countWhen(isStatus("Approved")),
        pending: countWhen(isPendingStatus),
      },
    },
    { $sort: { total: -1 } },
    { $limit: limit },

    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    { $unwind: "$userDoc" },

    {
      $project: {
        _id: 0,
        userId: "$_id",
        firstName: "$userDoc.firstName",
        lastName: "$userDoc.lastName",
        employeeId: "$userDoc.employeeId",
        designation: "$userDoc.designation",
        photoUrl: "$userDoc.photoUrl",
        total: 1,
        approved: 1,
        pending: 1,
      },
    },
  ]);
};
