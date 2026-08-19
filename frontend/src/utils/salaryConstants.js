/*
=========================================================================
  SALARY CONSTANTS  (frontend copy)   - Module 12 - Payroll & Salary
=========================================================================
  The matching copy of backend/config/salaryConstants.js, kept small on
  purpose: only the things the BROWSER has to know to draw a page.

  WHY IT IS A COPY AND NOT A DOWNLOAD
  -----------------------------------
  The same answer utils/attendanceConstants.js and utils/reportConstants.js
  give: these are labels and colours, not rules. Every decision that
  matters - what a payslip is worth, who may see it, when it may be
  published - is made on the server, where it cannot be edited by
  somebody with the developer tools open.

  What IS downloaded is the component list (GET /api/salary/options),
  because a component added to the backend has to appear in the forms
  without a frontend release.
=========================================================================
*/

/* =====================================================================
   1) THE LIFE OF A PAYSLIP, AS COLOURS
   ---------------------------------------------------------------------
   The same four states the backend stores. Cancelled is the only one
   drawn in red, and it is deliberately the loudest thing on the page:
   an employee looking at their own history has to be able to tell at a
   glance which month was withdrawn.
   ===================================================================== */
export const PAYSLIP_STATUS_STYLES = {
  Draft: {
    label: "Draft",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    hint: "Only payroll can see this. It has not been released yet.",
  },
  Published: {
    label: "Published",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
    hint: "Released to the employee. The payment has not been recorded yet.",
  },
  Paid: {
    label: "Paid",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    hint: "The transfer has been recorded.",
  },
  Cancelled: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border-red-200",
    hint: "This payslip was withdrawn. The reason is on the slip.",
  },
};

export const payslipStatusStyle = (status) =>
  PAYSLIP_STATUS_STYLES[status] || PAYSLIP_STATUS_STYLES.Draft;

/* =====================================================================
   2) MONEY
   ---------------------------------------------------------------------
   The rupee sign is used HERE and never in a PDF - see the note on
   CURRENCY_CODE in backend/config/reportConstants.js: PDFKit's built-in
   Helvetica has no glyph for it, and a missing character in a finance
   document is worse than three plain letters. A browser has no such
   problem.
   ===================================================================== */
export const CURRENCY_SYMBOL = "₹";

/*
  1284500.5 -> "₹12,84,500.50"

  Indian grouping, because the audience is: a lakh has to look like a
  lakh. Two decimals always, even when they are zero, so a column of
  amounts can be read down the decimal point.
*/
export const formatMoney = (value, { withSymbol = true } = {}) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  const text = number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return withSymbol ? `${CURRENCY_SYMBOL}${text}` : text;
};

/*
  The SHORT form, for cards and table headers where the full number
  would wrap: 1284500 -> "₹12.8L", 25000000 -> "₹2.5Cr".

  Only ever used where the exact figure is one hover or one click away.
  A payslip never uses it - a document about somebody's money says the
  whole number.
*/
export const formatMoneyShort = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  if (Math.abs(number) >= 10000000) {
    return `${CURRENCY_SYMBOL}${(number / 10000000).toFixed(1)}Cr`;
  }

  if (Math.abs(number) >= 100000) {
    return `${CURRENCY_SYMBOL}${(number / 100000).toFixed(1)}L`;
  }

  if (Math.abs(number) >= 1000) {
    return `${CURRENCY_SYMBOL}${Math.round(number / 1000)}K`;
  }

  return formatMoney(number);
};

/* =====================================================================
   3) MONTHS
   ---------------------------------------------------------------------
   The same "YYYY-MM" text the backend stores, so nothing here ever
   turns a payroll month into a Date - see the note in the backend copy
   for why that would drift across a timezone.
   ===================================================================== */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const formatMonthLong = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-");

  if (!year || !MONTH_NAMES[Number(month) - 1]) {
    return "-";
  }

  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

/*
  The file the receipt is saved as, matching what the server puts in
  its Content-Disposition header. Both are set, because either one
  alone can be defeated by a browser setting - see utils/download.js.
*/
export const payslipFileName = (payslip) =>
  `flowdesk-payslip-${(payslip.employeeCode || "employee").toLowerCase()}-${
    payslip.monthKey
  }.pdf`;

/* =====================================================================
   4) THE THREE EXPORT FORMATS
   ---------------------------------------------------------------------
   The same list the Reports and Attendance pages offer, in the same
   order, because a third page of the same application that ordered
   them differently is a page somebody has to read twice.
   ===================================================================== */
export const EXPORT_FORMATS = [
  { key: "pdf", label: "PDF", extension: "pdf" },
  { key: "excel", label: "Excel", extension: "xlsx" },
  { key: "csv", label: "CSV", extension: "csv" },
];

export const SALARY_REPORTS = [
  { key: "register", label: "Salary register" },
  { key: "department", label: "By department" },
];
