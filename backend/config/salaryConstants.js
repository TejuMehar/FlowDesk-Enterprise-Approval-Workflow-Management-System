/*
=========================================================================
  SALARY CONSTANTS   (Module 12 - Payroll & Salary)
=========================================================================
  The fixed lists behind payroll: what a salary is MADE OF, what states
  a payslip can be in, and how a month is written down.

  Same idea as attendanceConstants.js and reportConstants.js - the two
  models, the calculator, the PDF receipt, the exports and the React
  pages all read from THIS file, so they can never drift apart.

  WHAT MODULE 12 IS FOR
  ---------------------
  Every module before this one is about WORK: what was asked for, who
  approved it, who was at their desk. None of them says what anybody was
  PAID for any of it.

  Module 12 closes that with two collections and one rule:

    SalaryStructure  what an employee earns per month, standing. One
                     per person, changed when their pay changes.
    Payslip          what they were actually paid in ONE month, frozen
                     the moment it is generated and never recomputed.

  THE RULE: A PAYSLIP IS A DOCUMENT, NOT A VIEW
  ---------------------------------------------
  It would be shorter to store nothing and work last March's pay out
  from the structure whenever somebody asks. It would also be wrong.

  A payslip is a statement the company HAS ALREADY MADE - somebody was
  paid that number, and it may have been quoted to a bank, a landlord
  or an assessing officer. If it were a view, giving somebody a raise in
  April would quietly rewrite every payslip they had ever downloaded,
  and nobody would ever know.

  So every payslip carries its own frozen copy of the components, of the
  employee's name and department, and of the days it was counted
  against. That is the same decision attendanceModel.js makes with
  appliedPolicy and auditModel.js makes with actorName, for the third
  time and the strongest reason.

  EVERY AMOUNT IN THIS MODULE IS A MONTHLY AMOUNT, IN WHOLE CURRENCY
  ------------------------------------------------------------------
  Not annual, not paise. An annual figure would have to be divided by
  twelve somewhere, and "somewhere" eventually means "in two places that
  round differently". The annual CTC shown on screen is derived from the
  monthly total, never stored.
=========================================================================
*/

/* =====================================================================
   1) WHAT A SALARY IS MADE OF
   ---------------------------------------------------------------------
   Two lists, and the ORDER of each one is the order they are printed
   on the payslip. A component is never referred to by its position -
   only by its `key` - so a line can be renamed without touching a
   single stored document.

   WHY THE COMPONENTS ARE A FIXED LIST AND NOT A FREE-FORM TABLE
   -------------------------------------------------------------
   Module 9 turned the request types from a constant into a collection,
   because an admin genuinely invents new kinds of request. Salary
   components are the opposite: Basic, HRA and PF mean something
   specific to a payroll officer, to an auditor and to the employee
   reading the slip, and a company that invents a component called
   "Extra" has a problem no schema can fix.

   The two "Other" lines exist for the honest remainder, and the
   per-payslip ADJUSTMENTS below cover the one-off bonus or recovery
   that would otherwise tempt somebody to invent a component.
   ===================================================================== */

export const EARNING_COMPONENTS = [
  {
    key: "basic",
    label: "Basic Salary",
    /*
      The one component that is not just a number: PF, gratuity and
      most statutory calculations are a percentage OF BASIC, so a
      structure where basic is zero is a structure that is wrong.
      saveStructure() refuses one.
    */
    required: true,
  },
  { key: "hra", label: "House Rent Allowance" },
  { key: "conveyance", label: "Conveyance Allowance" },
  { key: "medical", label: "Medical Allowance" },
  { key: "specialAllowance", label: "Special Allowance" },
  { key: "otherEarning", label: "Other Earnings" },
];

export const DEDUCTION_COMPONENTS = [
  { key: "providentFund", label: "Provident Fund" },
  { key: "professionalTax", label: "Professional Tax" },
  { key: "incomeTax", label: "Income Tax (TDS)" },
  { key: "insurance", label: "Health Insurance" },
  { key: "otherDeduction", label: "Other Deductions" },
];

// the keys alone, for the model's defaults and for validation
export const EARNING_KEYS = EARNING_COMPONENTS.map((item) => item.key);
export const DEDUCTION_KEYS = DEDUCTION_COMPONENTS.map((item) => item.key);

// "basic" -> "Basic Salary", for the payslip and the exports
export const COMPONENT_LABELS = [...EARNING_COMPONENTS, ...DEDUCTION_COMPONENTS].reduce(
  (labels, item) => ({ ...labels, [item.key]: item.label }),
  {}
);

/*
  THE TWO LINES THAT ARE NOT COMPONENTS.

  Loss of pay and the one-off adjustment are worked out per MONTH, so
  they can never live on a standing structure - but they are printed on
  the payslip beside the components, and every screen needs the same
  words for them.
*/
export const LOSS_OF_PAY_LABEL = "Loss of Pay";
export const BONUS_LABEL = "Bonus / Incentive";

/* =====================================================================
   2) THE LIFE OF A PAYSLIP
   ---------------------------------------------------------------------
       Draft  ->  Published  ->  Paid
         \             \
          -------------->  Cancelled

   Draft      generated by the payroll run. Only the finance team can
              see it, and it is the ONLY state in which the numbers can
              still be edited.
   Published  released to the employee. It appears on their Salary page
              and the receipt can be downloaded. The numbers are now
              frozen for good.
   Paid       the money has actually left the company, with the date and
              the transfer reference on the slip.
   Cancelled  a mistake, kept forever rather than deleted - see below.

   WHY "Draft" IS A STATE AND NOT A MISSING DOCUMENT
   -------------------------------------------------
   Payroll is run once and checked before anybody is told. The run has
   to produce something a human can read, correct and re-read, and that
   something must not be visible to 300 employees while it still says
   the wrong number. A draft payslip IS the check.

   WHY A CANCELLED PAYSLIP IS NOT DELETED
   --------------------------------------
   By the time anybody wants to cancel one, the employee has usually
   already seen it - and a payslip that silently disappears is the
   single most alarming thing this module could do to somebody. It stays
   on their page, struck through and labelled, with the corrected one
   beside it. The same argument auditModel.js makes for never deleting a
   log entry.
   ===================================================================== */
export const PAYSLIP_STATUSES = ["Draft", "Published", "Paid", "Cancelled"];

export const PAYSLIP_STATUS_LABELS = {
  Draft: "Draft",
  Published: "Published",
  Paid: "Paid",
  Cancelled: "Cancelled",
};

/*
  WHAT THE EMPLOYEE MAY SEE.

  Everything except a Draft. Not a permission and not a scope - a
  filter, applied in the controller to the employee's own payslips,
  because "my own pay, once the company has told me about it" is not a
  question an admin should be able to answer differently.
*/
export const EMPLOYEE_VISIBLE_STATUSES = ["Published", "Paid", "Cancelled"];

// the states whose numbers may still be edited
export const EDITABLE_STATUSES = ["Draft"];

/* =====================================================================
   3) HOW A PAYROLL MONTH IS WRITTEN
   ---------------------------------------------------------------------
   "2026-07", the same TEXT shape Module 11 uses for a day - and text
   for the same reason spelled out in attendanceConstants.js: a payroll
   month is a page of a calendar, not a moment, and a Date would drift
   across a timezone the first time somebody in another office opened
   the page.

   It also sorts and groups as text exactly as it does as a date, which
   is what makes "this employee's year" a prefix match.
   ===================================================================== */
export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isValidMonthKey = (value) => MONTH_KEY_PATTERN.test(String(value || ""));

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

// "2026-07" -> "July 2026". The payslip prints the month in full: a
// document somebody keeps for seven years should not say "Jul".
export const formatMonthLong = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-");

  if (!year || !month || !MONTH_NAMES[Number(month) - 1]) {
    return "-";
  }

  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

// "2026-08-02" -> "2026-08"
export const monthKeyOfDateKey = (dateKey) => String(dateKey || "").slice(0, 7);

/*
  The first and last day of a payroll month, as dateKeys.

  Built by hand rather than with a Date, because `new Date(2026, 7, 0)`
  answers in the SERVER's timezone - and the server is not where the
  company is. The only arithmetic here is "how many days does this
  month have", which is a fact about the calendar and not about a
  clock.
*/
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const daysInMonth = (monthKey) => {
  const [yearText, monthText] = String(monthKey).split("-");

  const year = Number(yearText);
  const month = Number(monthText);

  if (month === 2) {
    // the full leap rule, not the "divisible by 4" half of it
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

    return isLeap ? 29 : 28;
  }

  return DAYS_IN_MONTH[month - 1];
};

export const monthRange = (monthKey) => ({
  from: `${monthKey}-01`,
  to: `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, "0")}`,
});

// "2026-01" shifted by -1 -> "2025-12"
export const shiftMonthKey = (monthKey, months) => {
  const [yearText, monthText] = String(monthKey).split("-");

  // months since year 0, which makes the wrap arithmetic a single line
  const total = Number(yearText) * 12 + (Number(monthText) - 1) + months;

  const year = Math.floor(total / 12);
  const month = total % 12;

  return `${year}-${String(month + 1).padStart(2, "0")}`;
};

/*
  Every month of one calendar year, newest first - the order the
  employee's own history is read in.
*/
export const monthsOfYear = (year) =>
  Array.from({ length: 12 }, (_, index) => `${year}-${String(12 - index).padStart(2, "0")}`);

/* =====================================================================
   4) MONEY
   ---------------------------------------------------------------------
   Everything is rounded to two decimals AT THE POINT IT IS WORKED OUT,
   never on the way to the screen. A gross that is stored as
   45000.000000001 and printed as 45,000.00 is a number that will one
   day fail to add up against its own components, in a document somebody
   is holding.
   ===================================================================== */
export const roundMoney = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  // the +Number.EPSILON is the standard guard against 1.005 rounding down
  return Math.round((number + Number.EPSILON) * 100) / 100;
};

/*
  A single amount typed into the payroll forms.

  Negative pay is refused rather than clamped: a negative allowance is
  always a typo or a sign error, and quietly turning it into zero hides
  the mistake in a document about somebody's money. Money that should
  come OFF has a deductions column of its own.
*/
export const MAX_COMPONENT_AMOUNT = 100000000; // ten crore, a sanity ceiling

export const isValidAmount = (value) =>
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= MAX_COMPONENT_AMOUNT;

/*
  1284.5 -> "1,284.50", in the Indian grouping (12,84,500 not
  1,284,500). The payslip, the exports and the React pages all print
  money through this, so a lakh is a lakh everywhere.
*/
export const formatMoney = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/* =====================================================================
   5) THE NET PAY, IN WORDS
   ---------------------------------------------------------------------
   "Forty Five Thousand Two Hundred and Thirty Only"

   Every payslip and every cheque in India carries the amount in words,
   and it is not decoration: it is the check digit of a handwritten
   world. A figure with a digit added to it reads as a completely
   different sentence, so the two halves of the same number have to
   agree before anybody accepts the document.

   The Indian scale is used (thousand, lakh, crore) because the
   grouping above already is - a slip that groups as 12,84,500 and then
   says "one million" would be two answers on one page.
   ===================================================================== */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

// 0-99, the only piece the Indian scale ever needs to spell
const twoDigitsInWords = (value) => {
  if (value < 20) {
    return ONES[value];
  }

  const tens = TENS[Math.floor(value / 10)];
  const ones = ONES[value % 10];

  return ones ? `${tens} ${ones}` : tens;
};

const threeDigitsInWords = (value) => {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  const parts = [];

  if (hundreds > 0) {
    parts.push(`${ONES[hundreds]} Hundred`);
  }

  if (rest > 0) {
    // "One Hundred and Five", not "One Hundred Five"
    parts.push(hundreds > 0 ? `and ${twoDigitsInWords(rest)}` : twoDigitsInWords(rest));
  }

  return parts.join(" ");
};

export const amountInWords = (value) => {
  const number = Math.abs(roundMoney(value));

  const whole = Math.floor(number);
  const paise = Math.round((number - whole) * 100);

  if (whole === 0 && paise === 0) {
    return "Zero Only";
  }

  const chunks = [
    { size: 10000000, name: "Crore" },
    { size: 100000, name: "Lakh" },
    { size: 1000, name: "Thousand" },
  ];

  let rest = whole;
  const words = [];

  chunks.forEach((chunk) => {
    const count = Math.floor(rest / chunk.size);

    if (count > 0) {
      /*
        A chunk can itself be up to 99 (ninety-nine lakh) or, for
        crores, any size at all - "One Hundred and Twenty Crore" is a
        real sentence - so the biggest one is spelled with the three
        digit helper and the rest with the two digit one.
      */
      words.push(
        `${chunk.size === 10000000 ? threeDigitsInWords(count) : twoDigitsInWords(count)} ${
          chunk.name
        }`
      );

      rest %= chunk.size;
    }
  });

  if (rest > 0) {
    words.push(threeDigitsInWords(rest));
  }

  const rupees = words.join(" ").replace(/\s+/g, " ").trim();

  /*
    "Rupees" is only spelled out when there are paise, and it is not
    decoration there either: without it the sentence ends "...Five
    Hundred and Fifty Paise", which reads as five hundred AND fifty
    paise rather than five hundred rupees and fifty paise. The unit has
    to be named at the point the two halves meet.
  */
  if (paise > 0) {
    return `${rupees} Rupees and ${twoDigitsInWords(paise)} Paise Only`;
  }

  return `${rupees} Only`;
};

/* =====================================================================
   6) HOW BIG ONE PAYROLL RUN MAY BE
   ---------------------------------------------------------------------
   A run builds every payslip in memory before writing any of them, so
   the month is either generated or it is not. That only stays safe with
   a ceiling, and the ceiling is the same 5000 rows Module 8 puts on a
   report - a company past it needs a queue, not a bigger number.
   ===================================================================== */
export const MAX_PAYROLL_EMPLOYEES = 5000;

/* =====================================================================
   7) THE TWO SALARY REPORTS
   ---------------------------------------------------------------------
   Both drop straight into Module 8's envelope, so they get a PDF, an
   Excel file and a CSV without a line of new export code - the third
   module to collect on that after Modules 8 and 11.

   THE PAYSLIP RECEIPT IS NOT ONE OF THEM. A register is a table and a
   payslip is a document with a company on top of it and a signature
   block underneath - see config/payslipDocument.js.
   ===================================================================== */
export const SALARY_REPORT_TYPES = ["register", "department"];

export const SALARY_REPORT_META = {
  register: {
    title: "Salary Register",
    subtitle: "One row per employee, with every component of the month's pay",
    orientation: "landscape",
  },
  department: {
    title: "Department Salary Report",
    subtitle: "What each department cost in the month, and how many people",
    orientation: "portrait",
  },
};

export const SALARY_REPORT_COLUMNS = {
  register: [
    { key: "employeeId", label: "Employee ID", type: "text", width: 1.1, align: "left" },
    { key: "name", label: "Employee", type: "text", width: 1.8, align: "left" },
    { key: "departmentName", label: "Department", type: "text", width: 1.4, align: "left" },
    { key: "designation", label: "Designation", type: "text", width: 1.5, align: "left" },
    { key: "payableDays", label: "Payable days", type: "number", width: 1, align: "right" },
    { key: "lopDays", label: "LOP days", type: "number", width: 0.9, align: "right" },
    { key: "grossEarnings", label: "Gross", type: "money", width: 1.3, align: "right" },
    { key: "totalDeductions", label: "Deductions", type: "money", width: 1.3, align: "right" },
    { key: "netPay", label: "Net pay", type: "money", width: 1.3, align: "right" },
    { key: "status", label: "Status", type: "text", width: 1, align: "left" },
    { key: "paidOn", label: "Paid on", type: "date", width: 1.1, align: "left" },
  ],

  department: [
    { key: "code", label: "Code", type: "text", width: 0.9, align: "left" },
    { key: "name", label: "Department", type: "text", width: 2, align: "left" },
    { key: "employees", label: "Employees", type: "number", width: 1, align: "right" },
    { key: "grossEarnings", label: "Gross", type: "money", width: 1.4, align: "right" },
    { key: "totalDeductions", label: "Deductions", type: "money", width: 1.4, align: "right" },
    { key: "netPay", label: "Net pay", type: "money", width: 1.4, align: "right" },
  ],
};

export const getSalaryReportColumns = (reportType) =>
  SALARY_REPORT_COLUMNS[reportType] || [];
