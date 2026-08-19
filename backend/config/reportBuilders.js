/*
=========================================================================
  REPORT BUILDERS   (Module 8 - Reports & Search)
=========================================================================
  The same job config/dashboardStats.js does for Module 5: the
  CONTROLLER does the HTTP work, this file does the thinking.

  Everything here is a READ. Not one function writes to the database, so
  running a report can never change a request or an approval.

  ONE FUNCTION PER REPORT, AND THEY ALL ANSWER THE SAME SHAPE
  -----------------------------------------------------------
  Every builder returns the REPORT ENVELOPE described at the top of
  config/reportConstants.js - a title, the filters that were applied,
  the columns, the rows and a short summary. Nothing downstream (the
  CSV writer, the Excel writer, the PDF writer, the React table) knows
  which report it is looking at, which is why there is one of each
  instead of six.

  WHY $lookup ON APPROVALS IS SAFE HERE
  -------------------------------------
  Four of the six reports need to know how LONG something took, and
  that only exists on the Approval document. approvalModel.js declares
  `request` as unique, and a unique field carries an index - so the
  lookup is an indexed point-read per request, not a scan.

  The department filter is the opposite case and is deliberately NOT a
  lookup - see the long note on resolveDepartmentMembers() in
  config/reportScope.js.

  WHICH DATE A REPORT FILTERS ON
  ------------------------------
  Not all six mean the same thing by "March", and getting this wrong is
  the classic way a report quietly lies:

    monthly / employee / department / expense
        the request was RAISED in the period  (createdAt)
    approval time
        a DECISION was made in the period     (completedAt / decidedAt)
    rejection
        the request was REJECTED in the period (the approval's
        completedAt) - a request raised in February and rejected in
        March belongs in the March rejection report, not February's

  Each builder says which one it uses in its own header.
=========================================================================
*/

import Request from "../model/requestModel.js";
import Approval from "../model/approvalModel.js";
import User from "../model/userModel.js";
import { PENDING_REQUEST_STATUSES } from "./dashboardConstants.js";
import {
  MAX_REPORT_ROWS,
  DEFAULT_REPORT_MONTHS,
  MAX_REPORT_MONTHS,
  REPORT_META,
  getReportColumns,
  buildMonthBucketsBetween,
  APPROVAL_TIME_DIMENSION_LABELS,
} from "./reportConstants.js";

/* =====================================================================
   SECTION 1 - SMALL SHARED PIECES
   ===================================================================== */

const MILLISECONDS_PER_HOUR = 1000 * 60 * 60;

// the same "add 1 when true" building block the dashboard uses
const countWhen = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

const isStatus = (status) => ({ $eq: ["$status", status] });
const isPendingStatus = { $in: ["$status", PENDING_REQUEST_STATUSES] };

/*
  "Ravi Sharma" out of two fields, inside a pipeline.

  $trim catches the employee whose last name is empty - without it the
  report would print "Ravi " with a trailing space that shows up as a
  crooked column in the PDF.
*/
const fullNameOf = (prefix) => ({
  $trim: {
    input: { $concat: [`$${prefix}.firstName`, " ", `$${prefix}.lastName`] },
  },
});

/*
  MongoDB has no "hours between two dates", so it is a subtraction and
  a division. `null` in means `null` out, and $avg / $min / $max all
  skip nulls - which is exactly right: a request nobody has decided yet
  must not be averaged in as a zero.
*/
const hoursBetween = (startExpression, endExpression) => ({
  $cond: [
    // $gt against null is the aggregation idiom for "exists and is not null"
    { $and: [{ $gt: [endExpression, null] }, { $gt: [startExpression, null] }] },
    {
      $divide: [
        { $subtract: [endExpression, startExpression] },
        MILLISECONDS_PER_HOUR,
      ],
    },
    null,
  ],
});

/*
  approved / (approved + rejected), as a whole percentage.

  The requests still travelling are deliberately left out of the
  divisor. A department with 20 requests in flight and 1 approved is at
  100%, not 5% - see the same reasoning in dashboardStats.js. `decided`
  is always carried next to the rate so a 100% built on one decision is
  visible for what it is.

  Returns null, never 0, when nothing has been decided: "no rate yet"
  and "rejects everything" are different facts.
*/
const approvalRateOf = (approved, rejected) => {
  const decided = (approved || 0) + (rejected || 0);

  return decided > 0 ? Math.round((approved / decided) * 100) : null;
};

/*
  A number rounded to one decimal, or null.
  Used on every average so a report never prints 6.833333333333333.
*/
const round1 = (value) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10) / 10;

/* =====================================================================
   SECTION 2 - THE DATE RANGE
   ---------------------------------------------------------------------
   Every report has one, and it is always a whole number of days: `from`
   starts at 00:00 and `to` ends at 23:59:59.999.

   The end of the day matters. An admin asking for 14 Aug to 14 Aug
   means that whole day, and a plain $lte on the date would have meant
   the single instant of midnight - an empty report on a busy day, which
   reads as a bug rather than as a filter.
   ===================================================================== */
export const buildReportRange = (query) => {
  const now = new Date();

  const parse = (value) => {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  };

  let from = parse(query.from);
  let to = parse(query.to);

  // no end -> today
  if (!to) {
    to = now;
  }

  // no start -> the default window back from the end
  if (!from) {
    from = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (DEFAULT_REPORT_MONTHS - 1), 1)
    );
  }

  // somebody typed the range backwards - swap it rather than answer nothing
  if (from > to) {
    [from, to] = [to, from];
  }

  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);

  /*
    THE CEILING ON THE RANGE.

    Without it a single URL could ask for every month since the company
    started, and the monthly report would build a bucket for each one.
    Anything longer than MAX_REPORT_MONTHS is pulled back to end where
    it was asked to end, which is the half the reader cares about.
  */
  const monthsApart =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());

  if (monthsApart >= MAX_REPORT_MONTHS) {
    from = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (MAX_REPORT_MONTHS - 1), 1)
    );
    from.setUTCHours(0, 0, 0, 0);
  }

  return { from, to };
};

/* =====================================================================
   SECTION 3 - THE FILTER EVERY REPORT SHARES
   ---------------------------------------------------------------------
   Built ONCE and handed to the rows, the summary and the export alike.
   That is what guarantees the file holds what was on the screen - the
   same promise config/auditController.js makes with buildAuditFilter().
   ===================================================================== */

/*
  @param options
    memberIds  the people in scope, or null for everybody
    from / to  the range
    type       one request type
    status     one request status
    priority   one priority
  @returns a plain object to drop into $match or find()
*/
export const buildRequestMatch = ({
  memberIds,
  from,
  to,
  type,
  status,
  priority,
  dateField = "createdAt",
}) => {
  const match = {
    isDeleted: false,
    [dateField]: { $gte: from, $lte: to },
  };

  if (memberIds) {
    match.requester = { $in: memberIds };
  }

  if (type) {
    match.type = type;
  }

  if (status) {
    match.status = status;
  }

  if (priority) {
    match.priority = priority;
  }

  return match;
};

/*
  The line printed under the report title, so a printed page still says
  what it was filtered by three weeks later. A PDF on somebody's desk
  with no filter line on it is a PDF nobody can check.
*/
export const describeFilters = ({ from, to, scope, departmentName, type, status, priority }) => {
  const filters = [
    { label: "Period", value: `${from.toISOString().split("T")[0]} to ${to.toISOString().split("T")[0]}` },
    { label: "Scope", value: scope.label },
  ];

  if (departmentName) {
    filters.push({ label: "Department", value: departmentName });
  }

  if (type) {
    filters.push({ label: "Request type", value: type });
  }

  if (status) {
    filters.push({ label: "Status", value: status });
  }

  if (priority) {
    filters.push({ label: "Priority", value: priority });
  }

  return filters;
};

/*
  Wraps rows and a summary in the envelope every exporter expects.
  Nothing else in this file builds that object by hand.
*/
const makeReport = ({ key, rows, summary, filters, columnOptions = {}, subtitle }) => {
  const meta = REPORT_META[key];

  return {
    key,
    title: meta.title,
    subtitle: subtitle || meta.subtitle,
    orientation: meta.orientation,
    generatedAt: new Date(),
    filters,
    columns: getReportColumns(key, columnOptions),
    rows,
    summary,
    truncated: rows.length >= MAX_REPORT_ROWS,
  };
};

/*
  The two stages that hang a request's approval off it.

  preserveNullAndEmptyArrays keeps the requests that have NO approval
  at all - a draft, or a request of a type nobody built a workflow for.
  Dropping them would make "requests raised" quietly smaller than the
  Requests page says, and a report that disagrees with the page it came
  from is worse than no report.
*/
const LOOKUP_APPROVAL = [
  {
    $lookup: {
      from: "approvals",
      localField: "_id",
      foreignField: "request",
      as: "approvalDoc",
    },
  },
  { $unwind: { path: "$approvalDoc", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      decisionHours: hoursBetween("$approvalDoc.startedAt", "$approvalDoc.completedAt"),
    },
  },
];

// the counters shared by the monthly, employee and department reports
const OUTCOME_COUNTERS = {
  total: { $sum: 1 },
  approved: countWhen(isStatus("Approved")),
  rejected: countWhen(isStatus("Rejected")),
  pending: countWhen(isPendingStatus),
  returned: countWhen(isStatus("Returned")),
  cancelled: countWhen(isStatus("Cancelled")),
  draft: countWhen(isStatus("Draft")),
  totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
  avgDecisionHours: { $avg: "$decisionHours" },
};

/*
  The headline numbers under the title of the three "how did things go"
  reports. Written once because they must read identically on all
  three - a reader comparing the employee report with the department
  report should not have to check whether "Approved" means the same
  thing in both.
*/
const buildOutcomeSummary = (rows) => {
  const sum = (field) => rows.reduce((total, row) => total + (row[field] || 0), 0);

  const total = sum("total");
  const approved = sum("approved");
  const rejected = sum("rejected");
  const totalAmount = sum("totalAmount");

  /*
    The average of the averages would be wrong - a month with 1 request
    would weigh as much as a month with 400. So the overall average is
    weighted by how many decisions each row actually holds.
  */
  const weighted = rows.reduce(
    (carry, row) => {
      const decided = (row.approved || 0) + (row.rejected || 0);

      if (row.avgDecisionHours === null || decided === 0) {
        return carry;
      }

      return {
        hours: carry.hours + row.avgDecisionHours * decided,
        decided: carry.decided + decided,
      };
    },
    { hours: 0, decided: 0 }
  );

  return [
    { label: "Requests raised", value: total, type: "number" },
    { label: "Approved", value: approved, type: "number" },
    { label: "Rejected", value: rejected, type: "number" },
    { label: "Still in progress", value: sum("pending"), type: "number" },
    { label: "Approval rate", value: approvalRateOf(approved, rejected), type: "percent" },
    {
      label: "Average time to decide",
      value: weighted.decided > 0 ? round1(weighted.hours / weighted.decided) : null,
      type: "duration",
    },
    { label: "Total amount", value: totalAmount, type: "money" },
  ];
};

/* =====================================================================
   SECTION 4 - REPORT 1: MONTHLY
   ---------------------------------------------------------------------
   "How much came in each month, and how did it turn out?"

   One row per month of the range, INCLUDING the quiet ones. MongoDB
   only sends back the months that have data, so the full list of months
   is built first and the numbers are dropped into it - without that a
   month with no requests would simply disappear and the reader would
   think the report was broken rather than the month.

   Filters on: the month the request was RAISED (createdAt).
   ===================================================================== */
export const buildMonthlyReport = async ({ match, from, to, filters }) => {
  const rows = await Request.aggregate([
    { $match: match },
    ...LOOKUP_APPROVAL,
    {
      $group: {
        // "2026-07" - the same text buildMonthBucketsBetween() produces
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        ...OUTCOME_COUNTERS,
      },
    },
  ]);

  const rowsByMonth = new Map(rows.map((row) => [row._id, row]));

  const filled = buildMonthBucketsBetween(from, to).map((bucket) => {
    const row = rowsByMonth.get(bucket.key) || {};

    const approved = row.approved || 0;
    const rejected = row.rejected || 0;

    return {
      month: bucket.key,
      label: bucket.label,
      total: row.total || 0,
      approved,
      rejected,
      pending: row.pending || 0,
      returned: row.returned || 0,
      cancelled: row.cancelled || 0,
      totalAmount: row.totalAmount || 0,
      approvalRate: approvalRateOf(approved, rejected),
      avgDecisionHours: round1(row.avgDecisionHours),
    };
  });

  return makeReport({
    key: "monthly",
    rows: filled,
    summary: buildOutcomeSummary(filled),
    filters,
  });
};

/* =====================================================================
   SECTION 5 - REPORT 2: EMPLOYEE
   ---------------------------------------------------------------------
   "Who raises what, and how does it go for them?"

   One row per employee who raised at least one request in the range.
   Somebody with nothing in the period is NOT given an empty row - a
   report about requests should not turn into a staff list, and 400
   rows of zeroes would bury the twelve rows that matter.

   Filters on: the month the request was RAISED (createdAt).
   ===================================================================== */
export const buildEmployeeReport = async ({ match, filters }) => {
  const rows = await Request.aggregate([
    { $match: match },
    ...LOOKUP_APPROVAL,

    { $group: { _id: "$requester", ...OUTCOME_COUNTERS } },
    { $sort: { total: -1 } },
    { $limit: MAX_REPORT_ROWS },

    /*
      The two joins happen AFTER the grouping on purpose. Grouping
      first turns 4000 requests into 40 employees, so this is 40
      lookups rather than 4000 - the single biggest difference between
      a report that answers instantly and one that times out.
    */
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "departments",
        localField: "userDoc.department",
        foreignField: "_id",
        as: "departmentDoc",
      },
    },
    { $unwind: { path: "$departmentDoc", preserveNullAndEmptyArrays: true } },

    {
      $project: {
        _id: 0,
        userId: "$_id",
        // a user who was hard deleted still has requests; they are not nameless
        employeeId: { $ifNull: ["$userDoc.employeeId", "-"] },
        name: { $ifNull: [fullNameOf("userDoc"), "Removed employee"] },
        designation: { $ifNull: ["$userDoc.designation", ""] },
        departmentName: { $ifNull: ["$departmentDoc.name", "No department"] },
        total: 1,
        approved: 1,
        rejected: 1,
        pending: 1,
        returned: 1,
        cancelled: 1,
        totalAmount: 1,
        avgDecisionHours: 1,
      },
    },
  ]);

  const shaped = rows.map((row) => ({
    ...row,
    approvalRate: approvalRateOf(row.approved, row.rejected),
    avgDecisionHours: round1(row.avgDecisionHours),
  }));

  return makeReport({
    key: "employee",
    rows: shaped,
    summary: [
      { label: "Employees listed", value: shaped.length, type: "number" },
      ...buildOutcomeSummary(shaped),
    ],
    filters,
  });
};

/* =====================================================================
   SECTION 6 - REPORT 3: DEPARTMENT
   ---------------------------------------------------------------------
   "Which departments get their paperwork through?"

   A request does not know its department - only the PERSON who raised
   it does, so the pipeline joins each request to its requester and
   groups by that person's department.

   Requests from employees with no department land in one "No
   department" row rather than being dropped, because a total that
   quietly ignores some of the data is worse than an untidy row.

   Filters on: the month the request was RAISED (createdAt).
   ===================================================================== */
export const buildDepartmentReport = async ({ match, filters }) => {
  const [rows, headcount] = await Promise.all([
    Request.aggregate([
      { $match: match },

      {
        $lookup: {
          from: "users",
          localField: "requester",
          foreignField: "_id",
          as: "requesterDoc",
        },
      },
      { $unwind: { path: "$requesterDoc", preserveNullAndEmptyArrays: true } },

      ...LOOKUP_APPROVAL,

      { $group: { _id: "$requesterDoc.department", ...OUTCOME_COUNTERS } },

      {
        $lookup: {
          from: "departments",
          localField: "_id",
          foreignField: "_id",
          as: "departmentDoc",
        },
      },
      { $unwind: { path: "$departmentDoc", preserveNullAndEmptyArrays: true } },

      { $sort: { total: -1 } },
      { $limit: MAX_REPORT_ROWS },
    ]),

    /*
      HOW MANY PEOPLE EACH DEPARTMENT HAS.

      Counted over the USERS, not over the requests, and that is the
      whole reason it is a second query: counting distinct requesters
      would call a department of 30 people "3 employees" simply
      because only three of them raised anything this month.

      Deleted employees are left out, the way they are everywhere else
      in FlowDesk - so a department CAN honestly show "0 employees, 14
      requests" once the person who raised them has left. That is not a
      contradiction: the requests are still real and still have to be
      counted, which is why the two numbers come from two questions.
    */
    User.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$department", employees: { $sum: 1 } } },
    ]),
  ]);

  const headcountByDepartment = new Map(
    headcount.map((row) => [String(row._id), row.employees])
  );

  const shaped = rows.map((row) => ({
    departmentId: row._id,
    name: row.departmentDoc?.name || "No department",
    code: row.departmentDoc?.code || "-",
    employees: headcountByDepartment.get(String(row._id)) || 0,
    total: row.total,
    approved: row.approved,
    rejected: row.rejected,
    pending: row.pending,
    returned: row.returned,
    cancelled: row.cancelled,
    totalAmount: row.totalAmount,
    approvalRate: approvalRateOf(row.approved, row.rejected),
    avgDecisionHours: round1(row.avgDecisionHours),
  }));

  return makeReport({
    key: "department",
    rows: shaped,
    summary: [
      { label: "Departments listed", value: shaped.length, type: "number" },
      ...buildOutcomeSummary(shaped),
    ],
    filters,
  });
};

/* =====================================================================
   SECTION 7 - REPORT 4: APPROVAL TIME
   ---------------------------------------------------------------------
   "How long does this actually take, and where does it wait?"

   The one report that reads the same data three ways, because "too
   slow" means three different things (see APPROVAL_TIME_DIMENSIONS in
   config/reportConstants.js):

     type      a whole Leave request takes 4 days
     stage     Finance Review is where they all pile up
     approver  one person answers in an hour, another in a week

   Filters on: when the DECISION was made, not when the request was
   raised. A report of "March approvals" is about what was decided in
   March, whatever month the requests came from.

   THE THREE CUTS ALSO MEASURE THREE DIFFERENT CLOCKS, on purpose:
     type      submitted   -> finally decided   (what the employee feels)
     stage     arrived at the stage -> left it  (where the queue is)
     approver  arrived at the stage -> this person answered
   ===================================================================== */

/*
  The stages every cut starts with: narrow the approvals, hang the
  request off them, and apply the request-level filters.

  `startedAt: { $lte: to }` is a cheap, indexed pre-filter that is
  always safe - an approval that only began after the end of the range
  cannot possibly hold a decision made inside it.
*/
const approvalTimeBase = ({ scopeFilter, to, type, priority }) => {
  const stages = [
    { $match: { startedAt: { $lte: to }, ...scopeFilter } },
    {
      $lookup: {
        from: "requests",
        localField: "request",
        foreignField: "_id",
        as: "requestDoc",
      },
    },
    { $unwind: "$requestDoc" },
  ];

  const requestMatch = { "requestDoc.isDeleted": false };

  if (type) {
    requestMatch["requestDoc.type"] = type;
  }

  if (priority) {
    requestMatch["requestDoc.priority"] = priority;
  }

  stages.push({ $match: requestMatch });

  return stages;
};

// the four numbers every cut produces, so the columns can stay identical
const TIMING_COUNTERS = {
  decided: { $sum: 1 },
  avgHours: { $avg: "$hours" },
  fastestHours: { $min: "$hours" },
  slowestHours: { $max: "$hours" },
};

export const buildApprovalTimeReport = async ({
  scopeFilter,
  from,
  to,
  type,
  priority,
  dimension,
  filters,
}) => {
  const base = approvalTimeBase({ scopeFilter, to, type, priority });

  let decidedRows = [];
  let pendingRows = [];

  if (dimension === "stage") {
    /* ---------- by workflow stage ---------- */
    [decidedRows, pendingRows] = await Promise.all([
      Approval.aggregate([
        ...base,
        { $unwind: "$stages" },
        {
          $match: {
            "stages.completedAt": { $gte: from, $lte: to },
            // Skipped stages took no time and had no decision to measure
            "stages.status": { $in: ["Approved", "Rejected", "Returned"] },
          },
        },
        {
          $addFields: {
            hours: hoursBetween("$stages.startedAt", "$stages.completedAt"),
          },
        },
        { $group: { _id: "$stages.name", ...TIMING_COUNTERS } },
      ]),

      Approval.aggregate([
        ...base,
        { $match: { status: "InProgress" } },
        { $unwind: "$stages" },
        { $match: { "stages.status": "Pending" } },
        { $group: { _id: "$stages.name", pending: { $sum: 1 } } },
      ]),
    ]);
  } else if (dimension === "approver") {
    /* ---------- by the person who answered ---------- */
    [decidedRows, pendingRows] = await Promise.all([
      Approval.aggregate([
        ...base,
        { $unwind: "$stages" },
        { $unwind: "$stages.decisions" },
        { $match: { "stages.decisions.decidedAt": { $gte: from, $lte: to } } },
        {
          $addFields: {
            // from the moment it landed on their desk to the moment they answered
            hours: hoursBetween("$stages.startedAt", "$stages.decisions.decidedAt"),
          },
        },
        { $group: { _id: "$stages.decisions.approver", ...TIMING_COUNTERS } },

        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "userDoc",
          },
        },
        { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            name: { $ifNull: [fullNameOf("userDoc"), "Removed employee"] },
          },
        },
      ]),

      /*
        WHAT IS STILL SITTING ON EACH PERSON'S DESK.

        A stage can name five approvers under an "AnyOne" rule, and two
        of them may already have answered. The $expr drops those two,
        so "still waiting" means waiting on YOU - the same question
        countMyPendingApprovals() asks in dashboardStats.js, and the
        same one the Approvals page answers with $elemMatch.
      */
      Approval.aggregate([
        ...base,
        { $match: { status: "InProgress" } },
        { $unwind: "$stages" },
        { $match: { "stages.status": "Pending" } },
        { $unwind: "$stages.approvers" },
        {
          $match: {
            $expr: {
              $not: { $in: ["$stages.approvers", "$stages.decisions.approver"] },
            },
          },
        },
        { $group: { _id: "$stages.approvers", pending: { $sum: 1 } } },

        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "userDoc",
          },
        },
        { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            name: { $ifNull: [fullNameOf("userDoc"), "Removed employee"] },
          },
        },
      ]),
    ]);
  } else {
    /* ---------- by request type (the default) ---------- */
    [decidedRows, pendingRows] = await Promise.all([
      Approval.aggregate([
        ...base,
        {
          $match: {
            completedAt: { $gte: from, $lte: to },
            status: { $in: ["Approved", "Rejected"] },
          },
        },
        { $addFields: { hours: hoursBetween("$startedAt", "$completedAt") } },
        { $group: { _id: "$requestDoc.type", ...TIMING_COUNTERS } },
      ]),

      Approval.aggregate([
        ...base,
        { $match: { status: "InProgress" } },
        { $group: { _id: "$requestDoc.type", pending: { $sum: 1 } } },
      ]),
    ]);
  }

  /*
    MERGE THE TWO SIDES.

    A stage that is nothing but a bottleneck has 40 waiting and 0
    decided, so it appears ONLY in the pending list. Merging on the key
    rather than looping over the decided rows is what keeps that row -
    and it is the single most interesting row in the whole report.
  */
  const byKey = new Map();

  const keyOf = (row) => String(row._id ?? "");

  const labelOf = (row) => {
    if (dimension === "approver") {
      return row.name || "Removed employee";
    }

    return row._id || "Not set";
  };

  decidedRows.forEach((row) => {
    byKey.set(keyOf(row), {
      key: keyOf(row),
      label: labelOf(row),
      decided: row.decided,
      avgHours: round1(row.avgHours),
      fastestHours: round1(row.fastestHours),
      slowestHours: round1(row.slowestHours),
      pending: 0,
    });
  });

  pendingRows.forEach((row) => {
    const existing = byKey.get(keyOf(row));

    if (existing) {
      existing.pending = row.pending;
      return;
    }

    byKey.set(keyOf(row), {
      key: keyOf(row),
      label: labelOf(row),
      decided: 0,
      avgHours: null,
      fastestHours: null,
      slowestHours: null,
      pending: row.pending,
    });
  });

  // slowest first: a report about delay should open with the worst delay
  const rows = [...byKey.values()].sort(
    (a, b) => (b.avgHours ?? -1) - (a.avgHours ?? -1)
  );

  /* ---------------- the headline numbers ---------------- */
  const totalDecided = rows.reduce((sum, row) => sum + row.decided, 0);

  const weightedHours = rows.reduce(
    (sum, row) => sum + (row.avgHours ?? 0) * row.decided,
    0
  );

  // the slowest row that actually decided something - a row with no
  // decisions has no average, and "null is the slowest" helps nobody
  const slowest = rows.find((row) => row.decided > 0);

  return makeReport({
    key: "approval-time",
    rows,
    columnOptions: { dimension },
    subtitle: `${REPORT_META["approval-time"].subtitle} - ${
      APPROVAL_TIME_DIMENSION_LABELS[dimension] || APPROVAL_TIME_DIMENSION_LABELS.type
    }`,
    summary: [
      { label: "Decisions measured", value: totalDecided, type: "number" },
      {
        label: "Average time",
        value: totalDecided > 0 ? round1(weightedHours / totalDecided) : null,
        type: "duration",
      },
      { label: "Slowest", value: slowest ? slowest.label : null, type: "text" },
      { label: "Slowest average", value: slowest ? slowest.avgHours : null, type: "duration" },
      {
        label: "Still waiting",
        value: rows.reduce((sum, row) => sum + row.pending, 0),
        type: "number",
      },
    ],
    filters,
  });
};

/* =====================================================================
   SECTION 8 - REPORT 5: REJECTION
   ---------------------------------------------------------------------
   "What was turned down, by whom, and why?"

   One row per rejected request, with the actual sentence the approver
   typed. That last column is the entire point of the report: a count of
   rejections tells you there is a problem, the reasons tell you what it
   is.

   IT STARTS FROM THE APPROVAL, NOT FROM THE REQUEST, for two reasons:
   the rejection DATE lives there (a request rejected in March may have
   been raised in January, and belongs in the March report), and so does
   the stage it died at.

   Filters on: when the request was REJECTED (the approval's completedAt).
   ===================================================================== */
export const buildRejectionReport = async ({
  scopeFilter,
  from,
  to,
  type,
  priority,
  filters,
}) => {
  const rows = await Approval.aggregate([
    {
      $match: {
        status: "Rejected",
        completedAt: { $gte: from, $lte: to },
        ...scopeFilter,
      },
    },

    {
      $lookup: {
        from: "requests",
        localField: "request",
        foreignField: "_id",
        as: "requestDoc",
      },
    },
    { $unwind: "$requestDoc" },

    {
      $match: {
        "requestDoc.isDeleted": false,
        ...(type ? { "requestDoc.type": type } : {}),
        ...(priority ? { "requestDoc.priority": priority } : {}),
      },
    },

    /*
      THE LINE THAT KILLED IT.

      A request can be returned, corrected and rejected later, so the
      timeline may hold more than one refusal-shaped entry. We keep the
      LAST "Rejected" line, because that is the one that is still true.
      $arrayElemAt with -1 is "the last one" and works on every server
      version we support.
    */
    {
      $addFields: {
        rejection: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$history",
                as: "entry",
                cond: { $eq: ["$$entry.action", "Rejected"] },
              },
            },
            -1,
          ],
        },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "rejection.actor",
        foreignField: "_id",
        as: "actorDoc",
      },
    },
    { $unwind: { path: "$actorDoc", preserveNullAndEmptyArrays: true } },

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
      $lookup: {
        from: "departments",
        localField: "requesterDoc.department",
        foreignField: "_id",
        as: "departmentDoc",
      },
    },
    { $unwind: { path: "$departmentDoc", preserveNullAndEmptyArrays: true } },

    { $sort: { completedAt: -1 } },
    { $limit: MAX_REPORT_ROWS },

    {
      $project: {
        _id: 0,
        requestId: "$requestDoc.requestId",
        title: "$requestDoc.title",
        type: "$requestDoc.type",
        priority: "$requestDoc.priority",
        amount: "$requestDoc.amount",
        requesterName: { $ifNull: [fullNameOf("requesterDoc"), "Removed employee"] },
        departmentName: { $ifNull: ["$departmentDoc.name", "No department"] },
        submittedAt: "$startedAt",
        rejectedAt: "$completedAt",
        // empty when a rule rejected it rather than a person
        rejectedBy: { $ifNull: [fullNameOf("actorDoc"), "FlowDesk"] },
        stageName: { $ifNull: ["$rejection.stageName", "-"] },
        reason: { $ifNull: ["$rejection.comment", ""] },
        hoursToReject: hoursBetween("$startedAt", "$completedAt"),
        submissionCount: 1,
      },
    },
  ]);

  const shaped = rows.map((row) => ({
    ...row,
    hoursToReject: round1(row.hoursToReject),
  }));

  /* ---------------- the headline numbers ----------------
     The rejection RATE needs a second question - how many requests
     were decided at all in the same period - because "31 rejections"
     means nothing without knowing whether it was out of 40 or 4000. */
  const decidedTotal = await Approval.countDocuments({
    status: { $in: ["Approved", "Rejected"] },
    completedAt: { $gte: from, $lte: to },
    ...scopeFilter,
  });

  // which stage kills the most requests, and which type gets killed most
  const tally = (field) => {
    const counts = new Map();

    shaped.forEach((row) => {
      const key = row[field] || "-";
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

    return best ? `${best[0]} (${best[1]})` : null;
  };

  const averageHours =
    shaped.length > 0
      ? round1(
          shaped.reduce((sum, row) => sum + (row.hoursToReject || 0), 0) /
            shaped.length
        )
      : null;

  return makeReport({
    key: "rejection",
    rows: shaped,
    summary: [
      { label: "Rejected", value: shaped.length, type: "number" },
      { label: "Decisions in period", value: decidedTotal, type: "number" },
      {
        label: "Rejection rate",
        value: decidedTotal > 0 ? Math.round((shaped.length / decidedTotal) * 100) : null,
        type: "percent",
      },
      { label: "Average time to rejection", value: averageHours, type: "duration" },
      { label: "Most rejections at", value: tally("stageName"), type: "text" },
      { label: "Most rejected type", value: tally("type"), type: "text" },
    ],
    filters,
  });
};

/* =====================================================================
   SECTION 9 - REPORT 6: EXPENSE
   ---------------------------------------------------------------------
   "What did all this cost?"

   Every request that carries an amount, whatever its type. It is NOT
   restricted to the types whose `needsAmount` flag is on: that flag
   only decides which types SHOW the amount field in the form, and a
   Custom request with a real amount typed into it is real money that a
   finance report must not quietly drop.

   (Module 9 moved that flag out of a constant and onto the request
   type itself - see model/requestTypeModel.js - which makes the point
   above stronger, not weaker: an admin can now turn the flag off on a
   type, and every amount already recorded under it still has to be
   counted.)

   THE FOUR TOTALS ARE THE REPORT.
   "Total requested" is what people asked for; "approved" is what was
   actually committed; "pending" is what is about to land if everything
   goes through - and that last number is the one a budget holder
   opens this report for.

   Filters on: the month the request was RAISED (createdAt).
   ===================================================================== */
export const buildExpenseReport = async ({ match, filters }) => {
  // a request with no amount, or a zero one, is not an expense
  const expenseMatch = { ...match, amount: { $gt: 0 } };

  const [rows, [totals] = []] = await Promise.all([
    Request.aggregate([
      { $match: expenseMatch },

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
        $lookup: {
          from: "departments",
          localField: "requesterDoc.department",
          foreignField: "_id",
          as: "departmentDoc",
        },
      },
      { $unwind: { path: "$departmentDoc", preserveNullAndEmptyArrays: true } },

      { $sort: { createdAt: -1 } },
      { $limit: MAX_REPORT_ROWS },

      {
        $project: {
          _id: 0,
          requestId: 1,
          title: 1,
          type: 1,
          category: { $ifNull: ["$category", "-"] },
          status: 1,
          priority: 1,
          amount: 1,
          createdAt: 1,
          requesterName: { $ifNull: [fullNameOf("requesterDoc"), "Removed employee"] },
          departmentName: { $ifNull: ["$departmentDoc.name", "No department"] },
        },
      },
    ]),

    /*
      The totals are their OWN aggregation rather than a sum of the rows
      above, so they stay honest even when the row list hits
      MAX_REPORT_ROWS. A truncated table with a truthful total is a
      usable report; a truncated total is a wrong one.
    */
    Request.aggregate([
      { $match: expenseMatch },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          approvedAmount: {
            $sum: { $cond: [isStatus("Approved"), "$amount", 0] },
          },
          rejectedAmount: {
            $sum: { $cond: [isStatus("Rejected"), "$amount", 0] },
          },
          pendingAmount: { $sum: { $cond: [isPendingStatus, "$amount", 0] } },
          averageAmount: { $avg: "$amount" },
          largestAmount: { $max: "$amount" },
        },
      },
    ]),
  ]);

  const empty = {
    count: 0,
    totalAmount: 0,
    approvedAmount: 0,
    rejectedAmount: 0,
    pendingAmount: 0,
    averageAmount: null,
    largestAmount: null,
  };

  const figures = totals || empty;

  return makeReport({
    key: "expense",
    rows,
    summary: [
      { label: "Requests with an amount", value: figures.count, type: "number" },
      { label: "Total requested", value: figures.totalAmount, type: "money" },
      { label: "Approved", value: figures.approvedAmount, type: "money" },
      { label: "Still in progress", value: figures.pendingAmount, type: "money" },
      { label: "Rejected", value: figures.rejectedAmount, type: "money" },
      { label: "Average request", value: round1(figures.averageAmount), type: "money" },
      { label: "Largest request", value: figures.largestAmount, type: "money" },
    ],
    filters,
  });
};

/* =====================================================================
   SECTION 10 - THE ONE DOOR THE CONTROLLER KNOCKS ON
   ---------------------------------------------------------------------
   The controller does not know six builders - it knows one function and
   a report type. Adding a seventh report is one entry here and one
   entry in REPORT_COLUMNS, and neither the controller nor any of the
   three exporters has to be touched.
   ===================================================================== */
export const buildReport = async (reportType, options) => {
  switch (reportType) {
    case "monthly":
      return await buildMonthlyReport(options);

    case "employee":
      return await buildEmployeeReport(options);

    case "department":
      return await buildDepartmentReport(options);

    case "approval-time":
      return await buildApprovalTimeReport(options);

    case "rejection":
      return await buildRejectionReport(options);

    case "expense":
      return await buildExpenseReport(options);

    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
};

/*
  A NOTE ON IDS, because it is the trap this whole file would fall into
  silently.

  An aggregation pipeline does NOT cast a string to an ObjectId the way
  find() does, so an id that arrived as text would match nothing at all
  and the report would simply come back empty - no error, no clue.

  Nothing in this file has to convert anything, and that is on purpose:
  every id it receives is ALREADY an ObjectId, because they all come out
  of the database rather than out of the URL. The department filter is
  turned into real user documents by resolveDepartmentMembers(), and the
  scope ids come from getTeamMemberIds() and req.userId - which isAuth
  sets from a loaded user, not from the token.

  If a future filter ever takes an id straight from req.query into a
  $match, it has to be cast first - see toObjectId() in
  config/dashboardStats.js.
*/
