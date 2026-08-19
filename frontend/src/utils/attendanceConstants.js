/*
=========================================================================
  ATTENDANCE CONSTANTS  (Module 11 - the React side)
=========================================================================
  The matching copy of backend/config/attendanceConstants.js, exactly
  the way utils/permissions.js mirrors the backend permission list and
  utils/reportConstants.js mirrors the report one.

  Only the parts a SCREEN needs are here: the labels, the colours, and
  the two formatters. The policy limits, the score weights and the day
  arithmetic stay on the server, because they are decisions rather than
  presentation - and a decision that exists in two places is a decision
  that will one day be made twice, differently.

  THE ONE RULE ABOUT DURATIONS
  ----------------------------
  Everything on the wire is MINUTES. Not "7h 45m", not 7.75, not a
  Date. The server counts in minutes because a punch is minutes, and
  formatMinutes() below is the only thing in the whole React app that
  turns one into words - so a duration reads the same on the punch
  card, in the history table, on the team board and in the tooltip.
=========================================================================
*/

/* =====================================================================
   1) THE STATUS OF A DAY
   ---------------------------------------------------------------------
   The colours are not decoration. They are the SAME tones the rest of
   FlowDesk already uses for these ideas - green for "went through",
   amber for "waiting/attention", red for "did not happen", slate for
   "nothing to say" - so a badge here means what a badge means on the
   Requests page without anybody having to learn a second language.
   ===================================================================== */
export const ATTENDANCE_STATUS_META = {
  Present: {
    label: "Present",
    badge: "text-green-700 bg-green-50 border-green-200",
    dot: "#16a34a",
  },
  Late: {
    label: "Late",
    badge: "text-amber-700 bg-amber-50 border-amber-200",
    dot: "#d97706",
  },
  HalfDay: {
    label: "Half day",
    badge: "text-orange-700 bg-orange-50 border-orange-200",
    dot: "#ea580c",
  },
  Absent: {
    label: "Absent",
    badge: "text-red-700 bg-red-50 border-red-200",
    dot: "#dc2626",
  },
  Holiday: {
    label: "Holiday",
    badge: "text-violet-700 bg-violet-50 border-violet-200",
    dot: "#7c3aed",
  },
  Weekend: {
    label: "Week off",
    badge: "text-slate-600 bg-slate-100 border-slate-200",
    dot: "#94a3b8",
  },
};

export const statusMeta = (status) =>
  ATTENDANCE_STATUS_META[status] || ATTENDANCE_STATUS_META.Weekend;

/* =====================================================================
   2) WHERE SOMEBODY IS RIGHT NOW
   ---------------------------------------------------------------------
   The live state, which the backend derives from the punches and never
   stores. Four states, four looks, and the wording is the wording a
   person would use out loud.
   ===================================================================== */
export const STATE_META = {
  NotStarted: {
    label: "Not started",
    badge: "text-slate-600 bg-slate-100 border-slate-200",
    dot: "#94a3b8",
  },
  Working: {
    label: "Working",
    badge: "text-green-700 bg-green-50 border-green-200",
    dot: "#16a34a",
  },
  OnBreak: {
    label: "On break",
    badge: "text-amber-700 bg-amber-50 border-amber-200",
    dot: "#d97706",
  },
  Finished: {
    label: "Day finished",
    badge: "text-indigo-700 bg-indigo-50 border-indigo-200",
    dot: "#4f46e5",
  },
};

export const stateMeta = (state) => STATE_META[state] || STATE_META.NotStarted;

/* =====================================================================
   3) MINUTES INTO WORDS
   ---------------------------------------------------------------------
   The exact twin of formatMinutes() in the backend constants file. It
   is duplicated rather than imported for the same reason
   formatReportValue() is duplicated in Module 8: the browser and the
   server do not share code, and a table whose screen says "7h 45m"
   while its CSV says something else is a bug report.

   ZERO IS "0m", NOT "-". Somebody who clocked in and straight back out
   worked zero minutes, and that is a fact about their day - it must not
   look like missing data.
   ===================================================================== */
export const formatMinutes = (minutes) => {
  const value = Number(minutes);

  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }

  const whole = Math.round(value);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  if (hours === 0) {
    return `${rest}m`;
  }

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

// 570 -> "09:30", for the policy form
export const minutesToClock = (minutes) => {
  const value = Number(minutes);

  if (!Number.isFinite(value)) {
    return "";
  }

  const whole = ((Math.round(value) % 1440) + 1440) % 1440;

  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(
    whole % 60
  ).padStart(2, "0")}`;
};

// "09:30" -> 570, and null for anything that is not a time of day
export const clockToMinutes = (text) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

/*
  A rate, as text.

  null becomes "-" and never "0%", the same rule the backend keeps and
  for the same reason: a joiner with no expected days yet has NO
  attendance rate, and printing 0% would say they never turn up.
*/
export const formatRate = (value) =>
  value === null || value === undefined ? "-" : `${Math.round(value)}%`;

/*
  A score, and the colour that goes with it.

  The bands are wide on purpose. A score of 91 and a score of 93 are the
  same month, and a scale that changed colour between them would invite
  a conversation neither number can support.
*/
export const scoreTone = (score) => {
  if (score === null || score === undefined) {
    return { label: "-", text: "text-slate-500", bg: "bg-slate-100" };
  }

  if (score >= 90) {
    return { label: "Excellent", text: "text-green-700", bg: "bg-green-500" };
  }

  if (score >= 75) {
    return { label: "Good", text: "text-sky-700", bg: "bg-sky-500" };
  }

  if (score >= 60) {
    return { label: "Needs a look", text: "text-amber-700", bg: "bg-amber-500" };
  }

  return { label: "Needs attention", text: "text-red-700", bg: "bg-red-500" };
};

/* =====================================================================
   4) THE FOUR EXPORTS
   ---------------------------------------------------------------------
   The slug goes straight into the URL
   (/api/attendance/export/employee), so it matches
   ATTENDANCE_REPORT_TYPES on the server exactly.
   ===================================================================== */
export const ATTENDANCE_REPORTS = [
  {
    key: "employee",
    label: "Per employee",
    hint: "Presence, punctuality, hours and score - one row per person",
  },
  {
    key: "daily",
    label: "Day by day",
    hint: "Every punch and every absence, one row per person per day",
  },
  {
    key: "department",
    label: "Per department",
    hint: "How each department keeps to its own working pattern",
  },
  {
    key: "breaks",
    label: "Breaks",
    hint: "Break time taken against the allowance",
  },
];

/*
  The three shapes an export can arrive in.

  `extension` is what the file is CALLED on disk, and it is not always
  the same word as `key`: the key is the slug the backend route
  understands ("excel"), the extension is what Windows needs to see
  before it will open the thing in Excel ("xlsx"). Naming it
  attendance.excel produces a file the operating system has never heard
  of and opens with nothing.

  The same three lines as EXPORT_FORMATS in reportConstants.js, and
  deliberately so - the two modules export in the same three formats
  and a person downloading both should get two files they can treat the
  same way.
*/
export const EXPORT_FORMATS = [
  { key: "pdf", label: "PDF", extension: "pdf" },
  { key: "excel", label: "Excel", extension: "xlsx" },
  { key: "csv", label: "CSV", extension: "csv" },
];

/* =====================================================================
   5) THE DATE HELPERS THE FILTERS NEED
   ---------------------------------------------------------------------
   <input type="date"> speaks "YYYY-MM-DD", which is the same dateKey
   the backend files attendance under - so no conversion is needed
   anywhere, which is exactly why the backend chose that shape.
   ===================================================================== */

// today, as the browser sees it. Only ever a DEFAULT for a filter box:
// the company's own "today" comes from the server with every answer.
export const todayKey = () => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
};

export const shiftDateKey = (dateKey, days) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().split("T")[0];
};

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

// "2026-08-02" -> "02 Aug 2026", the shape the whole app prints dates in
export const formatDateKey = (dateKey) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    return "-";
  }

  const [year, month, day] = String(dateKey).split("-");

  return `${day} ${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

// "2026-08-02" -> "Sun"
export const weekdayOfDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);

  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
};

/*
  The four ranges the filter bar offers as one-click buttons.

  They are the four periods people actually ask for, and having them as
  buttons rather than two date boxes is the difference between a filter
  somebody uses and a filter somebody avoids.
*/
export const QUICK_RANGES = [
  { key: "week", label: "This week", days: 7 },
  { key: "fortnight", label: "Last 14 days", days: 14 },
  { key: "month", label: "Last 30 days", days: 30 },
  { key: "quarter", label: "Last 90 days", days: 90 },
];
