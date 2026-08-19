/*
=========================================================================
  ATTENDANCE CONSTANTS   (Module 11 - Attendance Management)
=========================================================================
  The fixed lists behind attendance: the states a working day can be in,
  the shape of a break policy, the arithmetic that turns punches into
  minutes, and the columns of the four attendance reports.

  Same idea as requestConstants.js, auditConstants.js and
  reportConstants.js - the model's `enum`, the service that writes the
  records, the exporters and the React pages all read from THIS file, so
  they can never drift apart.

  WHAT MODULE 11 IS FOR
  ---------------------
  Modules 1 to 10 are about PAPERWORK: an employee asks for something,
  somebody decides. Attendance is the other half of a working day, and
  it is the half nothing in FlowDesk recorded:

      "was Ravi at work on Tuesday, and for how long?"
      "who in my department is on a break right now?"
      "which of my fifteen people actually keeps to the shift?"
      "give me Engineering's attendance for March as a spreadsheet"

  TWO CLOCKS, AND ONLY ONE OF THEM IS TRUSTED
  -------------------------------------------
  Every moment in this module is stamped by the SERVER (new Date()),
  never by the browser. A punch is a claim about time, and a claim the
  clocking-in device can set is not a record - somebody with a laptop
  clock two hours slow would file a perfect nine-to-five every day.

  The browser's clock is still used for one thing: drawing the ticking
  "3h 12m" on screen between two punches. That is a display, and being
  a minute out costs nothing.

  A DAY IS A NAME, NOT A MOMENT
  -----------------------------
  Attendance is filed under a dateKey - "2026-08-02" - and never under
  a Date. The same reason settingsConstants.js gives for holidays: a
  working day is a day on the company's calendar, and only text
  survives a trip through a timezone unchanged. A shift that starts at
  09:00 in Mumbai and a server running in UTC must still agree on which
  day Monday is.

  WHICH day that is comes from config/workingCalendar.js, which already
  owns the answer to "what time is it AT THE COMPANY". Nothing in this
  module ever calls getHours() or new Date(string).
=========================================================================
*/

/* =====================================================================
   1) HOW A FINISHED DAY IS CLASSIFIED
   ---------------------------------------------------------------------
   The SETTLED outcome of a day, worked out from the minutes actually
   worked against the policy that applied. It is recomputed on every
   punch, so it is always the truth about the record as it stands.

     Present   worked a full day
     Late      worked a full day, but arrived after the grace period
     HalfDay   turned up, but worked less than a full day
     Absent    a working day with no record at all
     Holiday   a company holiday (from the Module 9 calendar)
     Weekend   not a working day for this company

   ABSENT, HOLIDAY AND WEEKEND ARE NEVER STORED.
   --------------------------------------------
   They are worked out when a range is read (see fillCalendarDays in
   config/attendanceStats.js). A stored "Absent" row would need a
   nightly job to write it, and that job would be wrong the moment
   somebody joined, left, or the working days were changed in
   Settings - it would leave behind rows nobody can explain. Deriving
   them means the calendar is always consistent with the calendar.
   ===================================================================== */
export const ATTENDANCE_STATUSES = [
  "Present",
  "Late",
  "HalfDay",
  "Absent",
  "Holiday",
  "Weekend",
];

// only these three are ever written to a document
export const STORED_ATTENDANCE_STATUSES = ["Present", "Late", "HalfDay"];

/*
  The statuses that mean "this person was at work today". Used
  everywhere a rate is worked out, so "present days" means the same
  thing on the dashboard, in the report and in the score.
*/
export const PRESENT_STATUSES = ["Present", "Late", "HalfDay"];

export const ATTENDANCE_STATUS_LABELS = {
  Present: "Present",
  Late: "Late",
  HalfDay: "Half day",
  Absent: "Absent",
  Holiday: "Holiday",
  Weekend: "Week off",
};

/* =====================================================================
   2) WHERE THE EMPLOYEE IS RIGHT NOW
   ---------------------------------------------------------------------
   This is the LIVE state, and it is deliberately not a stored field.
   It is a reading of two facts the document already holds - is there a
   clockInAt, is there a clockOutAt, is there a break with no end - so
   it can never disagree with them.

   A stored "OnBreak" flag is the classic way this feature breaks: the
   process dies between "write the break" and "write the flag", and the
   employee is stuck on a break they cannot end.
   ===================================================================== */
export const ATTENDANCE_STATES = ["NotStarted", "Working", "OnBreak", "Finished"];

export const ATTENDANCE_STATE_LABELS = {
  NotStarted: "Not started",
  Working: "Working",
  OnBreak: "On break",
  Finished: "Day finished",
};

/* =====================================================================
   3) THE KINDS OF BREAK
   ---------------------------------------------------------------------
   A short fixed list rather than free text, for the same reason the
   request TYPE is a fixed list and the category is not: a report
   grouped by free text grows a new row every time somebody types
   "lunch " with a space on the end.
   ===================================================================== */
export const BREAK_TYPES = ["Lunch", "Tea", "Personal", "Other"];

export const DEFAULT_BREAK_TYPE = "Lunch";

/* =====================================================================
   4) THE POLICY
   ---------------------------------------------------------------------
   What a working day is SUPPOSED to look like. Every number a record
   is judged against lives here and nowhere else, so "late" means one
   thing across the punch screen, the summary, the report and the score.

   EVERY TIME IS MINUTES FROM LOCAL MIDNIGHT.
   ------------------------------------------
   09:30 is 570. Not a Date, not "09:30", not an hour count.

   A Date would be a moment, and a shift start is not a moment - it
   happens again tomorrow. The text "09:30" would have to be parsed
   before every comparison, and a parse is where a bug hides. A plain
   number can be compared, subtracted and averaged with nothing in
   between, and the two helpers at the bottom of this file are the only
   place it ever becomes text.
   ===================================================================== */

export const DEFAULT_ATTENDANCE_POLICY = {
  // 09:00 -> 18:00
  shiftStartMinutes: 9 * 60,
  shiftEndMinutes: 18 * 60,

  /*
    The minutes of REAL WORK a full day needs - breaks already taken
    out. It is deliberately not (shiftEnd - shiftStart): that would be
    9 hours, and nobody works nine hours in a nine hour shift.
  */
  fullDayMinutes: 8 * 60,

  // below this the day is not counted as attendance at all
  halfDayMinutes: 4 * 60,

  /*
    THE GRACE PERIOD. Arriving at 09:07 is not being late, it is
    traffic. A policy with no grace period turns a punctuality figure
    into a measure of how close somebody lives to the office.
  */
  graceMinutes: 15,

  /*
    THE BREAK ALLOWANCE - the number a department manager actually
    comes to this screen to change. Total paid break in one day,
    across every break taken.
  */
  breakAllowanceMinutes: 60,

  // one break may not swallow the whole allowance in a single sitting
  maxSingleBreakMinutes: 45,

  // a day with eleven breaks in it is not a day of work
  maxBreaksPerDay: 6,

  /*
    Work beyond this counts as overtime. Same as a full day by
    default, so overtime starts the moment the day is complete.
  */
  overtimeAfterMinutes: 8 * 60,

  /*
    THE SAFETY NET FOR THE FORGOTTEN CLOCK-OUT, and the one policy
    value that exists because of how people really behave.

    An employee who closes the laptop without clocking out would
    otherwise leave a record open for ever, and tomorrow's first punch
    would have to decide what yesterday meant. Instead, an open record
    from a previous day is closed at the shift end (see
    autoCloseStaleDays in config/attendanceService.js) and flagged, so
    the day is visibly a system guess rather than silently a fact.
  */
  autoCloseAtShiftEnd: true,
};

/*
  What each policy field may be set to.

  These are not decoration. The policy is edited by a department
  manager, and a shift of minus four hours or a break allowance of
  9999 minutes would not throw anywhere - it would quietly poison
  every rate, every score and every report built on it afterwards.
*/
export const POLICY_LIMITS = {
  shiftStartMinutes: { min: 0, max: 24 * 60 - 1 },
  shiftEndMinutes: { min: 1, max: 24 * 60 },
  fullDayMinutes: { min: 60, max: 16 * 60 },
  halfDayMinutes: { min: 30, max: 12 * 60 },
  graceMinutes: { min: 0, max: 120 },
  breakAllowanceMinutes: { min: 0, max: 4 * 60 },
  maxSingleBreakMinutes: { min: 5, max: 4 * 60 },
  maxBreaksPerDay: { min: 1, max: 12 },
  overtimeAfterMinutes: { min: 60, max: 16 * 60 },
};

/*
  The fields a manager may send, with the label the audit log prints.
  Anything not named here is ignored by the controller - the same
  "explicit list" guard the settings and report controllers use.
*/
export const POLICY_FIELD_LABELS = {
  shiftStartMinutes: "Shift starts",
  shiftEndMinutes: "Shift ends",
  fullDayMinutes: "Full day",
  halfDayMinutes: "Half day",
  graceMinutes: "Grace period",
  breakAllowanceMinutes: "Break allowance",
  maxSingleBreakMinutes: "Longest single break",
  maxBreaksPerDay: "Breaks per day",
  overtimeAfterMinutes: "Overtime after",
  autoCloseAtShiftEnd: "Auto close forgotten days",
};

/*
  The three checks that only make sense across two fields at once, so
  they cannot live in POLICY_LIMITS.

  @returns "" when the policy is coherent, or the sentence to show.
*/
export const describePolicyConflict = (policy) => {
  if (policy.shiftEndMinutes <= policy.shiftStartMinutes) {
    return "The shift must end after it starts";
  }

  if (policy.halfDayMinutes >= policy.fullDayMinutes) {
    return "A half day must be shorter than a full day";
  }

  if (policy.maxSingleBreakMinutes > policy.breakAllowanceMinutes && policy.breakAllowanceMinutes > 0) {
    return "One break cannot be longer than the whole day's break allowance";
  }

  /*
    The shift has to be long enough to contain a full day of work plus
    the breaks the same policy hands out, or every single employee is
    marked as leaving early for ever - through no fault of their own.
  */
  const shiftLength = policy.shiftEndMinutes - policy.shiftStartMinutes;

  if (policy.fullDayMinutes > shiftLength) {
    return "A full day of work does not fit inside the shift";
  }

  return "";
};

/* =====================================================================
   5) THE PERIODS A SUMMARY CAN BE ASKED FOR
   ---------------------------------------------------------------------
   Daily, weekly and monthly are the three questions an employee asks
   about their own attendance, and they are three ways of BUCKETING the
   same records rather than three different queries.
   ===================================================================== */
export const SUMMARY_PERIODS = ["daily", "weekly", "monthly"];

export const SUMMARY_PERIOD_LABELS = {
  daily: "Day by day",
  weekly: "Week by week",
  monthly: "Month by month",
};

/*
  How far back each period looks when nobody picked a range.

  A month of days, three months of weeks, a year of months - each one
  is roughly thirty rows, which is what a table can be read at a
  glance.
*/
export const DEFAULT_PERIOD_DAYS = {
  daily: 30,
  weekly: 90,
  monthly: 365,
};

/*
  The longest range one call may cover.

  A range is expanded into one entry per calendar day before anything
  is counted (that is what makes an absent day visible at all), so an
  unbounded range is an unbounded array. Two years is longer than any
  honest attendance question and short enough to build in one go.
*/
export const MAX_RANGE_DAYS = 732;

/* =====================================================================
   6) THE PERFORMANCE SCORE
   ---------------------------------------------------------------------
   "Who is the top performing employee in my department?"

   THIS SCORE IS ABOUT ATTENDANCE AND NOTHING ELSE. It cannot see code
   shipped, deals closed or tickets answered, and a manager must never
   read it as a measure of how good somebody is at their job. It
   answers one narrow question - who keeps to the working pattern the
   department agreed - and the UI prints the four parts NEXT TO the
   total so nobody has to trust a single number they cannot take apart.

   THE FOUR PARTS, AND WHY THESE WEIGHTS
   -------------------------------------
     presence     40   being there at all is the largest single fact
                       about attendance, so it carries the most weight
     punctuality  25   arriving on time, of the days that were worked
     hours        25   actually working the hours, not just being
                       clocked in - which is why it is measured
                       against worked minutes, breaks removed
     breaks       10   staying inside the allowance. The smallest
                       weight on purpose: a manager who wants a stick
                       to beat people with should not find it here

   HOURS ARE CAPPED AT 100%
   ------------------------
   Somebody who works 12 hours a day does not score above somebody who
   works their 8. Rewarding overtime in a score turns the score into an
   instruction to burn out, and the overtime figure is reported
   separately for the manager who genuinely needs to see it.

   A DAY NOBODY WORKED HAS NO SCORE
   --------------------------------
   Not zero - null. Zero says "this person is terrible"; null says "we
   have nothing to judge yet", which is the truth for a joiner in their
   first week. Every rate in this module keeps that distinction, the
   same way approvalRate does in Module 5.
   ===================================================================== */
export const SCORE_WEIGHTS = {
  presence: 40,
  punctuality: 25,
  hours: 25,
  breaks: 10,
};

/*
  @param parts {
    workingDays      how many days the person was expected
    presentDays      how many of those they were at work
    onTimeDays       of the present days, how many were not Late
    workedMinutes    real work, breaks already removed
    expectedMinutes  workingDays * the policy's full day
    breakCompliantDays  present days that stayed inside the allowance
  }
  @returns { score, presence, punctuality, hours, breaks } - every
           value a percentage, or null when there is nothing to judge.
*/
export const computePerformanceScore = ({
  workingDays = 0,
  presentDays = 0,
  onTimeDays = 0,
  workedMinutes = 0,
  expectedMinutes = 0,
  breakCompliantDays = 0,
}) => {
  const empty = {
    score: null,
    presence: null,
    punctuality: null,
    hours: null,
    breaks: null,
  };

  // nothing was ever expected of this person in this range
  if (workingDays <= 0) {
    return empty;
  }

  const presence = Math.min(presentDays / workingDays, 1);

  /*
    Punctuality and break discipline are measured against the days
    actually WORKED, never against the days expected. Somebody who was
    on leave for a fortnight has not been unpunctual; they have simply
    not been at work, and presence has already counted that once.
    Counting it twice would punish leave.
  */
  const punctuality = presentDays > 0 ? onTimeDays / presentDays : null;

  /*
    CAPPED AT 1, and the cap is not paranoia.

    `presentDays` arrives as the days the company was OPEN and this
    person was here, while breakCompliantDays counts every day they
    took a sensible break - including the Saturday they came in to fix
    something. Somebody who worked a weekend therefore has more
    compliant days than expected days, and an uncapped ratio would
    quietly hand them 110% for one of the four parts.
  */
  const breaks =
    presentDays > 0 ? Math.min(breakCompliantDays / presentDays, 1) : null;

  const hours =
    expectedMinutes > 0 ? Math.min(workedMinutes / expectedMinutes, 1) : null;

  /*
    A part with no data does not drag the score down - its weight is
    taken out of the total and the rest are scaled back up. Otherwise a
    joiner whose first day is tomorrow would score 40 out of 100 for
    having done nothing wrong.
  */
  const parts = [
    { value: presence, weight: SCORE_WEIGHTS.presence },
    { value: punctuality, weight: SCORE_WEIGHTS.punctuality },
    { value: hours, weight: SCORE_WEIGHTS.hours },
    { value: breaks, weight: SCORE_WEIGHTS.breaks },
  ].filter((part) => part.value !== null);

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);

  const score =
    totalWeight > 0
      ? Math.round(
          parts.reduce((sum, part) => sum + part.value * part.weight, 0) /
            totalWeight *
            100
        )
      : null;

  const asPercent = (value) =>
    value === null ? null : Math.round(value * 100);

  return {
    score,
    presence: asPercent(presence),
    punctuality: asPercent(punctuality),
    hours: asPercent(hours),
    breaks: asPercent(breaks),
  };
};

/* =====================================================================
   7) MINUTES, CLOCKS AND CALENDAR DAYS
   ---------------------------------------------------------------------
   The small arithmetic every other file in the module leans on. It is
   here rather than in the service because the React pages need the
   exact same answers, and a duration that reads "7h 45m" on screen and
   "7.75" in the export is a bug report waiting to happen.
   ===================================================================== */

/*
  465 -> "7h 45m",  45 -> "45m",  480 -> "8h"

  Zero comes back as "0m" and not as "-": zero minutes worked is a
  FACT about a day somebody clocked in and straight back out again,
  and it must not look like missing data.
*/
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

// 570 -> "09:30". The one place a policy time becomes text.
export const minutesToClock = (minutes) => {
  const value = Number(minutes);

  if (!Number.isFinite(value)) {
    return "--:--";
  }

  const whole = ((Math.round(value) % (24 * 60)) + 24 * 60) % (24 * 60);

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

/* ---------------------------------------------------------------------
   DATE KEYS

   Every helper below works on the TEXT "2026-08-02" and goes through
   Date.UTC to do its arithmetic. That is safe where new Date("2026-08-02")
   would not be: the UTC route can never slide a day backwards because
   the server happens to sit west of Greenwich.
   --------------------------------------------------------------------- */

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isValidDateKey = (value) => {
  if (!DATE_KEY_PATTERN.test(String(value || ""))) {
    return false;
  }

  const date = dateKeyToUtcDate(value);

  // catches "2026-02-31", which matches the pattern and is not a day
  return !isNaN(date.getTime()) && dateKeyFromUtcDate(date) === value;
};

// "2026-08-02" -> the Date at 00:00 UTC on that day
export const dateKeyToUtcDate = (dateKey) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);

  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};

// the other way round
export const dateKeyFromUtcDate = (date) => date.toISOString().split("T")[0];

// "2026-08-02" + 1 -> "2026-08-03", and it knows about month ends
export const addDaysToDateKey = (dateKey, days) => {
  const date = dateKeyToUtcDate(dateKey);

  date.setUTCDate(date.getUTCDate() + days);

  return dateKeyFromUtcDate(date);
};

// 0 = Sunday ... 6 = Saturday, the same numbering Settings uses
export const weekdayOfDateKey = (dateKey) => dateKeyToUtcDate(dateKey).getUTCDay();

/*
  Every day from `from` to `to`, both included.

  Capped at MAX_RANGE_DAYS so a hand-edited URL cannot ask the server
  to build a ten year array before it notices.
*/
export const listDateKeys = (from, to) => {
  const keys = [];

  let current = from;

  while (current <= to && keys.length < MAX_RANGE_DAYS) {
    keys.push(current);
    current = addDaysToDateKey(current, 1);
  }

  return keys;
};

/*
  The Monday of the week a day falls in, as a dateKey.

  Weeks run Monday to Sunday because that is how a working week is
  read, whatever Settings says about which days are worked - the
  bucket is a LABEL, not a claim about who was at work.
*/
export const startOfWeekKey = (dateKey) => {
  const weekday = weekdayOfDateKey(dateKey);

  // Sunday (0) belongs to the week that started six days ago
  const back = weekday === 0 ? 6 : weekday - 1;

  return addDaysToDateKey(dateKey, -back);
};

// "2026-08-02" -> "2026-08"
export const monthKeyOfDateKey = (dateKey) => String(dateKey).slice(0, 7);

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

// "2026-08-02" -> "02 Aug 2026", the same shape Module 8 prints
export const formatDateKey = (dateKey) => {
  if (!DATE_KEY_PATTERN.test(String(dateKey || ""))) {
    return "-";
  }

  const [year, month, day] = String(dateKey).split("-");

  return `${day} ${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

// "2026-08" -> "Aug 2026"
export const formatMonthKey = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-");

  if (!year || !month) {
    return "-";
  }

  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

/*
  Is anybody at work on this DAY NAME?

  config/workingCalendar.js answers the same question for a MOMENT
  (describeDay), which is what the reminder engine needs. A calendar
  range has no moments in it - only day names - so it asks here
  instead, handing in the calendar it already loaded.

  A holiday beats a working day, exactly as it does in describeDay().
*/
export const describeDateKey = (calendar, dateKey) => {
  if (calendar.holidayDates.has(dateKey)) {
    const holiday = calendar.holidays.find((entry) => entry.date === dateKey);

    return { isWorkingDay: false, status: "Holiday", reason: holiday?.name || "Holiday" };
  }

  if (!calendar.workingDays.includes(weekdayOfDateKey(dateKey))) {
    return { isWorkingDay: false, status: "Weekend", reason: "Week off" };
  }

  return { isWorkingDay: true, status: "", reason: "" };
};

/* =====================================================================
   8) THE FOUR ATTENDANCE REPORTS
   ---------------------------------------------------------------------
   These drop straight into the Module 8 exporters. config/reportExport.js
   does not know which report it is holding - it reads `columns`, `rows`
   and `summary` from the envelope - so attendance gets a PDF, an Excel
   file and a CSV without a line of new export code.

   That is the whole payoff of the envelope described at the top of
   config/reportConstants.js, and this file is the first thing to
   collect on it.
   ===================================================================== */
export const ATTENDANCE_REPORT_TYPES = ["daily", "employee", "department", "breaks"];

export const ATTENDANCE_REPORT_META = {
  daily: {
    title: "Daily Attendance Report",
    subtitle: "One row per employee per day, with every punch and break",
    orientation: "landscape",
  },
  employee: {
    title: "Employee Attendance Report",
    subtitle: "Presence, punctuality and hours worked, per employee",
    orientation: "landscape",
  },
  department: {
    title: "Department Attendance Report",
    subtitle: "How each department keeps to its own working pattern",
    orientation: "landscape",
  },
  breaks: {
    title: "Break Report",
    subtitle: "Break time taken against the allowance, per employee",
    orientation: "portrait",
  },
};

/*
  DURATIONS ARE DECLARED IN HOURS, NOT MINUTES.

  The "duration" column type already exists in Module 8 and is measured
  in hours everywhere - the Excel writer labels the column "(hours)"
  and the PDF prints "7.8 h". Attendance stores minutes because a
  punch is minutes; the builders divide by 60 on the way out, so a
  spreadsheet holding both kinds of report can still add a column up.
*/
export const ATTENDANCE_REPORT_COLUMNS = {
  daily: [
    { key: "dateKey", label: "Date", type: "date", width: 1.2, align: "left" },
    { key: "employeeId", label: "Employee ID", type: "text", width: 1.1, align: "left" },
    { key: "name", label: "Employee", type: "text", width: 1.8, align: "left" },
    { key: "departmentName", label: "Department", type: "text", width: 1.4, align: "left" },
    { key: "status", label: "Status", type: "text", width: 1, align: "left" },
    { key: "clockIn", label: "Clock in", type: "text", width: 1, align: "left" },
    { key: "clockOut", label: "Clock out", type: "text", width: 1, align: "left" },
    { key: "workedHours", label: "Worked", type: "duration", width: 1, align: "right" },
    { key: "breakHours", label: "Break", type: "duration", width: 1, align: "right" },
    { key: "lateMinutes", label: "Late by (min)", type: "number", width: 1.1, align: "right" },
    { key: "overtimeHours", label: "Overtime", type: "duration", width: 1, align: "right" },
  ],

  employee: [
    { key: "employeeId", label: "Employee ID", type: "text", width: 1.1, align: "left" },
    { key: "name", label: "Employee", type: "text", width: 1.8, align: "left" },
    { key: "departmentName", label: "Department", type: "text", width: 1.4, align: "left" },
    { key: "designation", label: "Designation", type: "text", width: 1.4, align: "left" },
    { key: "workingDays", label: "Expected", type: "number", width: 1, align: "right" },
    { key: "presentDays", label: "Present", type: "number", width: 1, align: "right" },
    { key: "absentDays", label: "Absent", type: "number", width: 1, align: "right" },
    { key: "lateDays", label: "Late", type: "number", width: 0.9, align: "right" },
    { key: "halfDays", label: "Half days", type: "number", width: 1, align: "right" },
    { key: "workedHours", label: "Worked", type: "duration", width: 1.1, align: "right" },
    { key: "overtimeHours", label: "Overtime", type: "duration", width: 1.1, align: "right" },
    { key: "attendanceRate", label: "Attendance", type: "percent", width: 1.1, align: "right" },
    { key: "punctualityRate", label: "Punctuality", type: "percent", width: 1.1, align: "right" },
    { key: "score", label: "Score", type: "number", width: 0.9, align: "right" },
  ],

  department: [
    { key: "code", label: "Code", type: "text", width: 0.9, align: "left" },
    { key: "name", label: "Department", type: "text", width: 2, align: "left" },
    { key: "employees", label: "Employees", type: "number", width: 1, align: "right" },
    { key: "workingDays", label: "Expected days", type: "number", width: 1.2, align: "right" },
    { key: "presentDays", label: "Present", type: "number", width: 1, align: "right" },
    { key: "absentDays", label: "Absent", type: "number", width: 1, align: "right" },
    { key: "lateDays", label: "Late", type: "number", width: 0.9, align: "right" },
    { key: "workedHours", label: "Worked", type: "duration", width: 1.1, align: "right" },
    { key: "avgDayHours", label: "Avg day", type: "duration", width: 1.1, align: "right" },
    { key: "attendanceRate", label: "Attendance", type: "percent", width: 1.1, align: "right" },
    { key: "punctualityRate", label: "Punctuality", type: "percent", width: 1.1, align: "right" },
    { key: "score", label: "Score", type: "number", width: 0.9, align: "right" },
  ],

  breaks: [
    { key: "employeeId", label: "Employee ID", type: "text", width: 1.1, align: "left" },
    { key: "name", label: "Employee", type: "text", width: 2, align: "left" },
    { key: "departmentName", label: "Department", type: "text", width: 1.5, align: "left" },
    { key: "presentDays", label: "Days worked", type: "number", width: 1.1, align: "right" },
    { key: "breakCount", label: "Breaks", type: "number", width: 1, align: "right" },
    { key: "breakHours", label: "Break time", type: "duration", width: 1.2, align: "right" },
    { key: "avgBreakMinutes", label: "Avg per day (min)", type: "number", width: 1.4, align: "right" },
    { key: "allowanceMinutes", label: "Allowance (min)", type: "number", width: 1.3, align: "right" },
    { key: "overBreakDays", label: "Days over", type: "number", width: 1.1, align: "right" },
  ],
};

export const getAttendanceReportColumns = (reportType) =>
  ATTENDANCE_REPORT_COLUMNS[reportType] || [];

/*
  Minutes -> the hours a "duration" column expects.
  null stays null, because "no data" and "zero hours" are not the same
  fact - the same rule formatReportValue() follows in Module 8.
*/
export const minutesToHours = (minutes) => {
  const value = Number(minutes);

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round((value / 60) * 100) / 100;
};
