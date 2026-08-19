/*
=========================================================================
  REPORT CONSTANTS   (Module 8 - Reports & Search)
=========================================================================
  A frontend copy of the parts of backend/config/reportConstants.js the
  React pages need: the six report names, the labels for the filters,
  and - the important half - the SAME value formatters the backend uses.

  WHY THE FORMATTERS ARE COPIED AND NOT DOWNLOADED
  ------------------------------------------------
  Because the numbers have to match. A duration shown as "2d 4h" in the
  PDF and "52.3" on the screen it was exported from is the kind of
  difference that makes somebody stop trusting both. So formatValue()
  below is a deliberate mirror of formatReportValue() in the backend,
  and the two must be changed together.

  Everything else about a report DOES come down the wire: the columns,
  the rows and the summary all arrive inside the report envelope, which
  is why this file has no table layout in it at all. Add a seventh
  report to the backend and this file needs no change whatsoever - the
  page will draw it.
=========================================================================
*/

/* =====================================================================
   1) THE SIX REPORTS
   ---------------------------------------------------------------------
   The list really comes from GET /api/report/options; these are only
   the ICONS and the one-line hints, which are presentation and have no
   business on the server.

   The key is the slug in the URL, so it must match REPORT_TYPES in the
   backend file exactly.
   ===================================================================== */
export const REPORT_TABS = [
  {
    key: "monthly",
    label: "Monthly",
    hint: "Requests raised each month, and how they turned out",
  },
  {
    key: "employee",
    label: "Employee",
    hint: "Who raises what, and how it goes for them",
  },
  {
    key: "department",
    label: "Department",
    hint: "Volume and approval performance per department",
  },
  {
    key: "approval-time",
    label: "Approval Time",
    hint: "How long approvals take, and where they wait",
  },
  {
    key: "rejection",
    label: "Rejection",
    hint: "What was turned down, by whom, and why",
  },
  {
    key: "expense",
    label: "Expense",
    hint: "Every request that carries an amount",
  },
];

/*
  The three cuts of the Approval Time report. Same keys as
  APPROVAL_TIME_DIMENSIONS in the backend.
*/
export const APPROVAL_TIME_DIMENSIONS = [
  { key: "type", label: "By request type" },
  { key: "stage", label: "By workflow stage" },
  { key: "approver", label: "By approver" },
];

/* =====================================================================
   2) THE THREE FILE FORMATS
   ---------------------------------------------------------------------
   `extension` is what the downloaded file is called on disk. The
   backend sends the same name in its Content-Disposition header, but
   the browser only uses that when the download is a plain link - and
   ours is not (see handleExport in Reports.jsx), so the name has to be
   known on this side too.
   ===================================================================== */
export const EXPORT_FORMATS = [
  { key: "pdf", label: "PDF", extension: "pdf", hint: "For printing and sharing" },
  { key: "excel", label: "Excel", extension: "xlsx", hint: "For sorting and charts" },
  { key: "csv", label: "CSV", extension: "csv", hint: "For any other tool" },
];

/* =====================================================================
   3) THE SEARCH FILTERS
   ---------------------------------------------------------------------
   "Pending" is one button covering two statuses (Submitted and
   InProgress) - see SEARCH_STATUS_FILTERS in the backend file for why.
   These are the words on the buttons; the backend owns the translation.
   ===================================================================== */
export const SEARCH_STATUS_FILTERS = [
  "Pending",
  "Approved",
  "Rejected",
  "Returned",
  "Draft",
  "Cancelled",
];

/*
  How a search result set may be ordered. Keys must match SEARCH_SORTS
  in the backend.
*/
export const SEARCH_SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "amountHigh", label: "Highest amount" },
  { key: "amountLow", label: "Lowest amount" },
];

/*
  What the scope badge in the page header says.

  It is shown on BOTH pages, always, and never hidden - a screen of
  numbers whose reader is not certain whether they are looking at the
  whole company or only their own team is a screen that invites a wrong
  decision.
*/
export const SCOPE_STYLES = {
  org: { label: "Whole organisation", className: "bg-indigo-50 text-indigo-700" },
  team: { label: "My team", className: "bg-teal-50 text-teal-700" },
  own: { label: "My own requests", className: "bg-slate-100 text-slate-600" },
};

/* =====================================================================
   4) FORMATTING A VALUE
   ---------------------------------------------------------------------
   The mirror of formatReportValue() in the backend. See the note at the
   top of this file for why it is a copy.
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
      0.4 -> "24 min"   6.5 -> "6.5 h"   52 -> "2d 4h"
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
    const rounded = Math.round(value * 10) / 10;
    return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} h`;
  }

  const days = Math.floor(value / 24);
  const restHours = Math.round(value % 24);

  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
};

/*
  "14 Aug 2026", built from the UTC parts.

  Deliberately NOT toLocaleDateString: the backend writes the same date
  into the PDF the same way, and a page that says 14 Aug next to a file
  that says 08/14 is a page somebody will file a bug about.
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
  Money keeps its two decimals even when they are zero, so a column can
  be read down the decimal point. The symbol is added here and never on
  the server - see CURRENCY_CODE in the backend file for why the
  exported files use "INR" instead.
*/
export const CURRENCY_SYMBOL = "₹";

export const formatMoney = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return `${CURRENCY_SYMBOL}${number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatCount = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return Math.round(number).toLocaleString("en-IN");
};

/*
  One cell.

  null becomes "-" and never "0". They are different facts: a
  department with nothing decided yet has NO approval rate, and drawing
  0% would say it rejects everything.
*/
export const formatValue = (value, type) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  switch (type) {
    case "number":
      return formatCount(value);

    case "money":
      return formatMoney(value);

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
   5) SMALL DATE HELPERS FOR THE FILTER BAR
   ---------------------------------------------------------------------
   <input type="date"> only speaks "YYYY-MM-DD", so the quick range
   buttons have to hand it exactly that.
   ===================================================================== */
export const toInputDate = (date) => date.toISOString().split("T")[0];

/*
  The quick ranges above the filters.

  They exist because typing two dates is four clicks and a calendar
  each, and nine times out of ten the answer wanted is "this month" or
  "this year". The months are counted in UTC, the same way the backend
  buckets them, so "Last 6 months" means the same six months on both
  sides.
*/
export const QUICK_RANGES = [
  {
    key: "thisMonth",
    label: "This month",
    build: () => {
      const now = new Date();
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: now,
      };
    },
  },
  {
    key: "last3",
    label: "Last 3 months",
    build: () => {
      const now = new Date();
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)),
        to: now,
      };
    },
  },
  {
    key: "last6",
    label: "Last 6 months",
    build: () => {
      const now = new Date();
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)),
        to: now,
      };
    },
  },
  {
    key: "last12",
    label: "Last 12 months",
    build: () => {
      const now = new Date();
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
        to: now,
      };
    },
  },
  {
    key: "thisYear",
    label: "This year",
    build: () => {
      const now = new Date();
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now };
    },
  },
];
