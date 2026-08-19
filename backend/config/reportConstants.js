/*
=========================================================================
  REPORT CONSTANTS   (Module 8 - Reports & Search)
=========================================================================
  The fixed lists behind the six reports: what they are called, which
  columns each one has, and how a value is turned into text.

  Same idea as requestConstants.js and auditConstants.js - one file the
  aggregation, the three exporters and the React table all read from, so
  they can never drift apart.

  WHAT MODULE 8 IS FOR
  --------------------
  Module 5 already draws the numbers a dashboard needs: four charts and
  a handful of cards, all about "how are things going right now". What
  it cannot do is answer a question somebody has to ANSWER TO SOMEBODY
  ELSE:

      "how much did we spend on purchases last quarter?"
      "why were 14 requests rejected in March?"
      "which department sits on requests the longest?"

  Those are not charts, they are TABLES with a date range, a filter and
  a file at the end of them. That is what a report is.

  THE ONE IDEA THAT MAKES THIS FILE WORTH HAVING
  ----------------------------------------------
  Every report - however different the question - comes back in the same
  shape:

      {
        key, title, subtitle,
        generatedAt, scope, filters: [ { label, value } ],
        columns: [ { key, label, type, width, align } ],
        rows:    [ { ...one object per column key } ],
        summary: [ { label, value, type } ],
      }

  We call that the REPORT ENVELOPE, and it is why Module 8 has ONE CSV
  writer, ONE Excel writer, ONE PDF writer and ONE React table instead
  of six of each. Adding a seventh report means writing one aggregation
  and one COLUMNS entry below - nothing in the exporters has to change.

  THE COLUMN TYPE IS THE WHOLE TRICK
  ----------------------------------
  A column says what KIND of value it holds (money, percent, duration,
  date ...), never how to draw it. Each output then decides for itself:

      CSV / PDF / screen -> human text        "2d 4h",  "68%"
      Excel              -> the raw number + a number format

  which is exactly what each one needs. Nobody wants to do arithmetic on
  the string "2d 4h" in a spreadsheet.
=========================================================================
*/

/* =====================================================================
   1) THE SIX REPORTS
   ---------------------------------------------------------------------
   The slug is what appears in the URL (/api/report/monthly), so it is
   lowercase and hyphenated like the rest of the API.
   ===================================================================== */
export const REPORT_TYPES = [
  "monthly",
  "employee",
  "department",
  "approval-time",
  "rejection",
  "expense",
];

/*
  The title and the one-line explanation printed at the top of the page,
  the PDF and the Excel sheet.

  `orientation` is only read by the PDF writer. A report with nine
  narrow columns fits a portrait page; one with a title and a rejection
  reason in it does not, and squeezing it would produce a column three
  characters wide.
*/
export const REPORT_META = {
  monthly: {
    title: "Monthly Report",
    subtitle: "Requests raised each month, and how they turned out",
    orientation: "portrait",
  },
  employee: {
    title: "Employee Report",
    subtitle: "How many requests each employee raised, and how they went",
    orientation: "landscape",
  },
  department: {
    title: "Department Report",
    subtitle: "Request volume and approval performance per department",
    orientation: "landscape",
  },
  "approval-time": {
    title: "Approval Time Report",
    subtitle: "How long approvals actually take, and where they wait",
    orientation: "portrait",
  },
  rejection: {
    title: "Rejection Report",
    subtitle: "Every rejected request, with who rejected it and why",
    orientation: "landscape",
  },
  expense: {
    title: "Expense Report",
    subtitle: "Every request that carries an amount, and what it cost",
    orientation: "landscape",
  },
};

/* =====================================================================
   2) THE THREE WAYS TO READ "HOW LONG DOES APPROVAL TAKE?"
   ---------------------------------------------------------------------
   The Approval Time report is the one report that answers a question
   three different ways, because "too slow" can mean three things:

     type      a whole Leave request takes 4 days   -> is that normal?
     stage     Finance Review is where they all sit -> the bottleneck
     approver  Ravi answers in an hour, Anita in a week

   They are three cuts of the same data, not three reports, so they
   share one endpoint and one page - only ?by= changes.
   ===================================================================== */
export const APPROVAL_TIME_DIMENSIONS = ["type", "stage", "approver"];

export const APPROVAL_TIME_DIMENSION_LABELS = {
  type: "By request type",
  stage: "By workflow stage",
  approver: "By approver",
};

/* =====================================================================
   3) THE THREE FILE FORMATS
   ===================================================================== */
export const EXPORT_FORMATS = ["pdf", "excel", "csv"];

/*
  What each format is called on disk and which Content-Type turns it
  into a download rather than something the browser tries to show.
*/
export const EXPORT_FILE_META = {
  csv: {
    extension: "csv",
    contentType: "text/csv; charset=utf-8",
  },
  excel: {
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pdf: {
    extension: "pdf",
    contentType: "application/pdf",
  },
};

/* =====================================================================
   4) HOW MUCH A REPORT MAY HOLD
   ---------------------------------------------------------------------
   A report is built in ONE go - the whole result set is held in memory
   so the file and the screen can never disagree about what was in it.
   That only stays safe with a ceiling on it.

   5000 rows is the same limit the audit export uses. The aggregate
   reports (monthly, department, approval time) can never come close;
   the two detail reports (rejection, expense) list one row per request
   and are the reason the ceiling exists at all.
   ===================================================================== */
export const MAX_REPORT_ROWS = 5000;

// how many rows one page of the on-screen table shows
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/*
  How far back a report looks when nobody picked a date range.

  12 months rather than the dashboard's 6: a report is usually opened to
  compare this period with the same period last year, and a range that
  cannot reach last year cannot answer that.
*/
export const DEFAULT_REPORT_MONTHS = 12;

// the most months one report may span, so a single URL cannot scan a decade
export const MAX_REPORT_MONTHS = 60;

/*
  FlowDesk has no multi-currency support and no currency field on a
  request - every amount is in one currency, decided by the company.

  It is written as a CODE and not as a symbol on purpose: the PDF is
  drawn in Helvetica, whose built-in character set has no rupee sign,
  and a missing glyph in a finance report is worse than three plain
  letters. The React pages may of course show whatever symbol they like.
*/
export const CURRENCY_CODE = "INR";

/* =====================================================================
   5) THE COLUMNS OF EACH REPORT
   ---------------------------------------------------------------------
   type   decides how the value is formatted (see SECTION 6)
   width  is a WEIGHT, not a pixel count: the PDF writer shares the page
          out in proportion, so { 3, 1, 1 } means the first column gets
          three fifths of the width. Excel turns the same weight into a
          character count.
   align  "left" for words, "right" for anything you would add up. A
          column of numbers that is not right aligned cannot be scanned
          for the biggest one.
   ===================================================================== */

/*
  The four columns that describe a request, repeated by the two detail
  reports. Written once so "Raised by" never becomes "Requester" on the
  other report.
*/
const REQUEST_IDENTITY_COLUMNS = [
  { key: "requestId", label: "Request ID", type: "text", width: 1.1, align: "left" },
  { key: "title", label: "Title", type: "text", width: 2.6, align: "left" },
  { key: "type", label: "Type", type: "text", width: 1, align: "left" },
  { key: "requesterName", label: "Raised by", type: "text", width: 1.6, align: "left" },
  { key: "departmentName", label: "Department", type: "text", width: 1.4, align: "left" },
];

export const REPORT_COLUMNS = {
  monthly: [
    { key: "label", label: "Month", type: "text", width: 1.4, align: "left" },
    { key: "total", label: "Raised", type: "number", width: 1, align: "right" },
    { key: "approved", label: "Approved", type: "number", width: 1, align: "right" },
    { key: "rejected", label: "Rejected", type: "number", width: 1, align: "right" },
    { key: "pending", label: "In progress", type: "number", width: 1.1, align: "right" },
    { key: "returned", label: "Returned", type: "number", width: 1, align: "right" },
    { key: "cancelled", label: "Cancelled", type: "number", width: 1, align: "right" },
    { key: "approvalRate", label: "Approval rate", type: "percent", width: 1.2, align: "right" },
    { key: "avgDecisionHours", label: "Avg time to decide", type: "duration", width: 1.4, align: "right" },
  ],

  employee: [
    { key: "employeeId", label: "Employee ID", type: "text", width: 1.1, align: "left" },
    { key: "name", label: "Employee", type: "text", width: 1.8, align: "left" },
    { key: "departmentName", label: "Department", type: "text", width: 1.4, align: "left" },
    { key: "designation", label: "Designation", type: "text", width: 1.4, align: "left" },
    { key: "total", label: "Raised", type: "number", width: 0.9, align: "right" },
    { key: "approved", label: "Approved", type: "number", width: 0.9, align: "right" },
    { key: "rejected", label: "Rejected", type: "number", width: 0.9, align: "right" },
    { key: "pending", label: "In progress", type: "number", width: 1, align: "right" },
    { key: "approvalRate", label: "Approval rate", type: "percent", width: 1.1, align: "right" },
    { key: "totalAmount", label: "Amount", type: "money", width: 1.2, align: "right" },
    { key: "avgDecisionHours", label: "Avg time", type: "duration", width: 1.1, align: "right" },
  ],

  department: [
    { key: "code", label: "Code", type: "text", width: 0.9, align: "left" },
    { key: "name", label: "Department", type: "text", width: 2, align: "left" },
    { key: "employees", label: "Employees", type: "number", width: 1, align: "right" },
    { key: "total", label: "Raised", type: "number", width: 0.9, align: "right" },
    { key: "approved", label: "Approved", type: "number", width: 0.9, align: "right" },
    { key: "rejected", label: "Rejected", type: "number", width: 0.9, align: "right" },
    { key: "pending", label: "In progress", type: "number", width: 1, align: "right" },
    { key: "approvalRate", label: "Approval rate", type: "percent", width: 1.1, align: "right" },
    { key: "totalAmount", label: "Amount", type: "money", width: 1.2, align: "right" },
    { key: "avgDecisionHours", label: "Avg time", type: "duration", width: 1.1, align: "right" },
  ],

  /*
    The Approval Time report swaps its FIRST column depending on ?by=,
    and keeps the rest. The three first columns live in their own map
    below, and buildApprovalTimeColumns() glues them together.
  */
  "approval-time": [
    { key: "label", label: "Request type", type: "text", width: 1.8, align: "left" },
    { key: "decided", label: "Decisions", type: "number", width: 1, align: "right" },
    { key: "avgHours", label: "Average", type: "duration", width: 1.2, align: "right" },
    { key: "fastestHours", label: "Fastest", type: "duration", width: 1.2, align: "right" },
    { key: "slowestHours", label: "Slowest", type: "duration", width: 1.2, align: "right" },
    { key: "pending", label: "Still waiting", type: "number", width: 1.1, align: "right" },
  ],

  rejection: [
    ...REQUEST_IDENTITY_COLUMNS,
    { key: "submittedAt", label: "Submitted", type: "date", width: 1.1, align: "left" },
    { key: "rejectedAt", label: "Rejected on", type: "date", width: 1.1, align: "left" },
    { key: "rejectedBy", label: "Rejected by", type: "text", width: 1.5, align: "left" },
    { key: "stageName", label: "At stage", type: "text", width: 1.4, align: "left" },
    { key: "hoursToReject", label: "Time taken", type: "duration", width: 1.1, align: "right" },
    { key: "reason", label: "Reason", type: "text", width: 2.8, align: "left" },
  ],

  expense: [
    ...REQUEST_IDENTITY_COLUMNS,
    { key: "category", label: "Category", type: "text", width: 1.4, align: "left" },
    { key: "createdAt", label: "Raised on", type: "date", width: 1.1, align: "left" },
    { key: "status", label: "Status", type: "text", width: 1.1, align: "left" },
    { key: "priority", label: "Priority", type: "text", width: 1, align: "left" },
    { key: "amount", label: "Amount", type: "money", width: 1.3, align: "right" },
  ],
};

/*
  The first column of the Approval Time report, per dimension.
  Everything after it is identical, which is the point.
*/
const APPROVAL_TIME_FIRST_COLUMN = {
  type: { key: "label", label: "Request type", type: "text", width: 1.8, align: "left" },
  stage: { key: "label", label: "Workflow stage", type: "text", width: 2.2, align: "left" },
  approver: { key: "label", label: "Approver", type: "text", width: 2.2, align: "left" },
};

/*
  @param dimension - "type" | "stage" | "approver"
  @returns the column list for that cut of the report
*/
export const buildApprovalTimeColumns = (dimension) => {
  const [, ...rest] = REPORT_COLUMNS["approval-time"];

  return [
    APPROVAL_TIME_FIRST_COLUMN[dimension] || APPROVAL_TIME_FIRST_COLUMN.type,
    ...rest,
  ];
};

/*
  The columns of a report, ready to use.
  Only the Approval Time report needs an argument; the others ignore it.
*/
export const getReportColumns = (reportType, options = {}) => {
  if (reportType === "approval-time") {
    return buildApprovalTimeColumns(options.dimension);
  }

  return REPORT_COLUMNS[reportType] || [];
};

/* =====================================================================
   6) TURNING A VALUE INTO TEXT
   ---------------------------------------------------------------------
   Used by the CSV writer, the PDF writer and (as a matching copy) the
   React table. The Excel writer deliberately does NOT use this - see
   the note at the top of the file.
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
  Hours -> the shortest sentence that is still honest.

      0.4  -> "24 min"
      6.5  -> "6.5 h"
      52   -> "2d 4h"

  A report full of "52.31 hours" makes the reader do the division in
  their head, and a report full of "2 days" alone throws away the half
  day that was the whole point of the question.
*/
export const formatDuration = (hours) => {
  const value = Number(hours);

  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }

  if (value < 1) {
    return `${Math.round(value * 60)} min`;
  }

  if (value < 48) {
    // one decimal, but "6.0 h" reads worse than "6 h"
    const rounded = Math.round(value * 10) / 10;
    return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} h`;
  }

  const days = Math.floor(value / 24);
  const restHours = Math.round(value % 24);

  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
};

/*
  A date, always as "14 Aug 2026".

  Built by hand from the UTC parts rather than with toLocaleDateString,
  because the server's locale is not the reader's and a report that
  says 08/14/2026 to one person and 14/08/2026 to another is a report
  nobody can quote in an email.
*/
export const formatReportDate = (value) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return "-";
  }

  return `${String(date.getUTCDate()).padStart(2, "0")} ${
    MONTH_NAMES[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
};

/*
  1284.5 -> "1,284.50" for money, "1,285" for a plain count.

  Money always keeps its two decimals even when they are zero, because
  a column where some rows have them and some do not cannot be read
  down the decimal point.
*/
const formatAmount = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatCount = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return Math.round(number).toLocaleString("en-IN");
};

/*
  One cell, as text.

  null is written as "-" everywhere and never as "0". They are
  different facts: a department with no decided requests has NO
  approval rate, and printing 0% would say it rejects everything.
*/
export const formatReportValue = (value, type) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  switch (type) {
    case "number":
      return formatCount(value);

    case "money":
      return formatAmount(value);

    case "percent":
      return `${Math.round(Number(value))}%`;

    case "duration":
      return formatDuration(value);

    case "date":
      return formatReportDate(value);

    default:
      return String(value);
  }
};

/* =====================================================================
   7) THE SEARCH SIDE OF THE MODULE
   ---------------------------------------------------------------------
   The Search page offers SIX status filters, not the seven statuses a
   request can really have, because "Pending" is the word people
   actually use and it covers two of them:

       Submitted    a request from before Module 4, which had no
                    workflow to travel down
       InProgress   standing at a stage right now

   Nobody searching for "pending" means one of those and not the other,
   and a filter that quietly leaves out the old requests would be a
   filter that hides data.

   The map goes from the word on the button to the statuses it means,
   so the controller never writes a status string by hand.
   ===================================================================== */
export const SEARCH_STATUS_FILTERS = {
  Pending: ["Submitted", "InProgress"],
  Approved: ["Approved"],
  Rejected: ["Rejected"],
  Returned: ["Returned"],
  Draft: ["Draft"],
  Cancelled: ["Cancelled"],
};

/*
  How the results may be ordered.

  Newest first is the default because a search is nearly always about
  something recent, and the two amount orderings exist because "find
  the big ones" is the second most common reason to open the page.
*/
export const SEARCH_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  amountHigh: { amount: -1, createdAt: -1 },
  amountLow: { amount: 1, createdAt: -1 },
};

export const SEARCH_SORT_LABELS = {
  newest: "Newest first",
  oldest: "Oldest first",
  amountHigh: "Highest amount",
  amountLow: "Lowest amount",
};

/*
  How many employees the search dropdowns hold.

  The Employee and Approver pickers are plain <select> menus, which stop
  being usable somewhere around a few hundred entries - and a company
  bigger than that needs a type-ahead, not a longer list. The cap is
  here rather than hidden in a query so it is obvious where to change
  it when that day comes.
*/
export const MAX_SEARCH_PEOPLE = 300;

/* =====================================================================
   8) THE MONTH BUCKETS OF A REPORT
   ---------------------------------------------------------------------
   dashboardStats.js has buildMonthBuckets(n), which counts n months
   back from today - right for a dashboard, wrong here: a report is
   asked for a RANGE ("April to June"), and it must show April, May and
   June even if two of them are empty.

   Everything is built in UTC, the same way MongoDB groups by default,
   so both sides agree on where a month starts.
   ===================================================================== */
export const buildMonthBucketsBetween = (startDate, endDate) => {
  const buckets = [];

  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();

  const lastYear = endDate.getUTCFullYear();
  const lastMonth = endDate.getUTCMonth();

  /*
    The guard is not paranoia: without it a bad date range (an end
    before its start, or an invalid date that became NaN) would spin
    this loop forever and take the server with it.
  */
  while (
    buckets.length < MAX_REPORT_MONTHS &&
    (year < lastYear || (year === lastYear && month <= lastMonth))
  ) {
    buckets.push({
      // the same text $dateToString produces with format "%Y-%m"
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: `${MONTH_NAMES[month]} ${year}`,
    });

    month += 1;

    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return buckets;
};
