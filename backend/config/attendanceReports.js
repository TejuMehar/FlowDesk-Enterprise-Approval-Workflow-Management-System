/*
=========================================================================
  ATTENDANCE REPORTS   (Module 11 - Attendance Management)
=========================================================================
  Turns the numbers config/attendanceStats.js counted into a REPORT
  ENVELOPE - the exact shape described at the top of
  config/reportConstants.js:

      { key, title, subtitle, generatedAt, scope, orientation,
        filters, columns, rows, summary, truncated }

  And that is the whole file. Nothing here writes a PDF, an Excel sheet
  or a CSV, because Module 8 already did: config/reportExport.js reads
  the envelope and has never known which report it is holding.

  FOUR REPORTS TIMES THREE FORMATS = TWELVE DOWNLOADS, AND NO NEW
  EXPORT CODE. That is the payoff the envelope was designed for, and
  this is the first module to collect on it. If a fifth attendance
  report is ever wanted, it is one COLUMNS entry in
  attendanceConstants.js and one builder below.

  THE ONE PROMISE, INHERITED FROM MODULE 8
  ----------------------------------------
  THE FILE HOLDS WHAT THE SCREEN HELD. The exports below are built from
  the same summariseEmployees() / summariseDepartments() output the team
  board draws, over the same range and the same scope - so a manager who
  filters a board and presses Export gets the board.

  DURATIONS LEAVE HERE IN HOURS
  -----------------------------
  Attendance stores minutes, because a punch is minutes. The "duration"
  column type in Module 8 is hours everywhere - the Excel writer labels
  the column "(hours)" and the PDF prints "7.8 h". So every duration is
  divided on the way out, by minutesToHours(), and a spreadsheet holding
  an attendance report next to an approval-time report can still add a
  column up.
=========================================================================
*/

import {
  ATTENDANCE_REPORT_META,
  getAttendanceReportColumns,
  ATTENDANCE_STATUS_LABELS,
  minutesToHours,
  minutesToClock,
  formatDateKey,
} from "./attendanceConstants.js";

/* =====================================================================
   SECTION 1 - THE ENVELOPE
   ---------------------------------------------------------------------
   Every builder ends here, so the four reports cannot disagree about
   what a header looks like.
   ===================================================================== */
const buildEnvelope = ({ key, scope, filters, rows, summary }) => {
  const meta = ATTENDANCE_REPORT_META[key];

  return {
    key: `attendance-${key}`,
    title: meta.title,
    subtitle: meta.subtitle,
    orientation: meta.orientation,
    generatedAt: new Date(),
    scope: scope.label,
    filters,
    columns: getAttendanceReportColumns(key),
    rows,
    summary,
    /*
      Attendance reports are bounded by the range, and the range is
      bounded by MAX_RANGE_DAYS, so they cannot run away the way the
      rejection and expense reports can. The field is still here
      because the exporters read it - an envelope missing a field the
      PDF writer expects is a crash at download time.
    */
    truncated: false,
  };
};

/*
  The line printed under every title, and the most important line on a
  printed report after the title itself.

  A report with no record of what it covered is a page of numbers
  nobody can check, and somebody always asks "is this the whole company
  or just our department?" three weeks later. The same reasoning
  describeFilters() follows in Module 8.
*/
const describeAttendanceFilters = ({ scope, from, to, departmentName, employeeName }) => {
  const filters = [
    { label: "Period", value: `${formatDateKey(from)} - ${formatDateKey(to)}` },
    { label: "Scope", value: scope.label },
  ];

  if (departmentName) {
    filters.push({ label: "Department", value: departmentName });
  }

  if (employeeName) {
    filters.push({ label: "Employee", value: employeeName });
  }

  return filters;
};

const fullName = (user) => `${user.firstName || ""} ${user.lastName || ""}`.trim();

/* =====================================================================
   SECTION 2 - THE DAILY REPORT
   ---------------------------------------------------------------------
   One row per employee per DAY, with the punches on it. The rawest of
   the four, and the one somebody prints when they need to check a
   single afternoon.

   ABSENT DAYS ARE ROWS. That is the difference between this and a dump
   of the collection, and it is the reason the report is worth having:
   the days somebody was not there are the days anybody is looking for,
   and they have no document to export.

   NON-WORKING DAYS WITH NO RECORD ARE LEFT OUT, though. A month of
   "Weekend / Weekend / Weekend" rows is eight pages of a printout
   saying nothing - the summary already reports how many there were,
   and a weekend somebody DID work still appears, because it has a
   record.
   ===================================================================== */
export const buildDailyAttendanceReport = ({ employeeCalendars, scope, filters }) => {
  const rows = [];

  employeeCalendars.forEach(({ user, days }) => {
    days.forEach((day) => {
      if (!day.record && !day.isWorkingDay) {
        return;
      }

      if (day.beforeJoining) {
        return;
      }

      rows.push({
        dateKey: day.dateKey,
        employeeId: user.employeeId || "-",
        name: fullName(user),
        departmentName: user.department?.name || "No department",
        status: ATTENDANCE_STATUS_LABELS[day.status] || day.status,
        clockIn: day.clockInAt ? minutesToClock(day.clockInMinuteOfDay) : "-",
        clockOut: day.clockOutAt ? minutesToClock(day.clockOutMinuteOfDay) : "-",
        workedHours: minutesToHours(day.workedMinutes),
        breakHours: minutesToHours(day.breakMinutes),
        lateMinutes: day.lateMinutes || 0,
        overtimeHours: minutesToHours(day.overtimeMinutes),
      });
    });
  });

  // newest day first, then by name - how somebody reads a daily sheet
  rows.sort((a, b) => {
    if (a.dateKey !== b.dateKey) {
      return a.dateKey < b.dateKey ? 1 : -1;
    }

    return a.name.localeCompare(b.name);
  });

  const totals = rows.reduce(
    (sum, row) => ({
      worked: sum.worked + (row.workedHours || 0),
      breaks: sum.breaks + (row.breakHours || 0),
      absent: sum.absent + (row.status === "Absent" ? 1 : 0),
      late: sum.late + (row.status === "Late" ? 1 : 0),
    }),
    { worked: 0, breaks: 0, absent: 0, late: 0 }
  );

  return buildEnvelope({
    key: "daily",
    scope,
    filters,
    rows,
    summary: [
      { label: "Rows", value: rows.length, type: "number" },
      { label: "Absent days", value: totals.absent, type: "number" },
      { label: "Late arrivals", value: totals.late, type: "number" },
      { label: "Total worked", value: Math.round(totals.worked * 10) / 10, type: "duration" },
      { label: "Total break", value: Math.round(totals.breaks * 10) / 10, type: "duration" },
    ],
  });
};

/* =====================================================================
   SECTION 3 - THE EMPLOYEE REPORT
   ---------------------------------------------------------------------
   One row per person: how the range went for them. This is the report
   a manager actually sends to HR, and the one the performance score
   appears on.

   The score is a plain number in a column here rather than the four
   coloured parts the screen shows, because a spreadsheet is for
   sorting. Anybody who wants to know WHY somebody scored 78 has the
   attendance and punctuality columns on the same row.
   ===================================================================== */
export const buildEmployeeAttendanceReport = ({ employeeRows, scope, filters }) => {
  const rows = employeeRows.map((row) => ({
    employeeId: row.user.employeeId || "-",
    name: fullName(row.user),
    departmentName: row.user.department?.name || "No department",
    designation: row.user.designation || "-",
    workingDays: row.workingDays,
    // the expected one, so "Expected" and "Present" are comparable
    // columns rather than two counts of two different things
    presentDays: row.expectedPresentDays,
    absentDays: row.absentDays,
    lateDays: row.lateDays,
    halfDays: row.halfDays,
    workedHours: minutesToHours(row.workedMinutes),
    overtimeHours: minutesToHours(row.overtimeMinutes),
    attendanceRate: row.attendanceRate,
    punctualityRate: row.punctualityRate,
    score: row.score,
  }));

  // best first: a ranked list is the fastest way to read this report
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const totals = employeeRows.reduce(
    (sum, row) => ({
      working: sum.working + row.workingDays,
      present: sum.present + row.expectedPresentDays,
      absent: sum.absent + row.absentDays,
      late: sum.late + row.lateDays,
      worked: sum.worked + row.workedMinutes,
      overtime: sum.overtime + row.overtimeMinutes,
    }),
    { working: 0, present: 0, absent: 0, late: 0, worked: 0, overtime: 0 }
  );

  return buildEnvelope({
    key: "employee",
    scope,
    filters,
    rows,
    summary: [
      { label: "Employees", value: rows.length, type: "number" },
      {
        label: "Attendance",
        /*
          The rate is computed from the TOTALS, not as the average of
          the per-employee rates. Those two differ the moment people
          have different numbers of expected days, and only the first
          one is the answer to "how did this team attend".
        */
        value:
          totals.working > 0
            ? Math.round((totals.present / totals.working) * 100)
            : null,
        type: "percent",
      },
      { label: "Absent days", value: totals.absent, type: "number" },
      { label: "Late arrivals", value: totals.late, type: "number" },
      { label: "Hours worked", value: minutesToHours(totals.worked), type: "duration" },
      { label: "Overtime", value: minutesToHours(totals.overtime), type: "duration" },
    ],
  });
};

/* =====================================================================
   SECTION 4 - THE DEPARTMENT REPORT
   ---------------------------------------------------------------------
   The director's report: one row per department, so two teams can be
   compared without opening either.
   ===================================================================== */
export const buildDepartmentAttendanceReport = ({ departmentRows, scope, filters }) => {
  const rows = departmentRows.map((row) => ({
    code: row.code,
    name: row.name,
    employees: row.employees,
    workingDays: row.workingDays,
    presentDays: row.expectedPresentDays,
    absentDays: row.absentDays,
    lateDays: row.lateDays,
    workedHours: minutesToHours(row.workedMinutes),
    avgDayHours: minutesToHours(row.avgDayMinutes),
    attendanceRate: row.attendanceRate,
    punctualityRate: row.punctualityRate,
    score: row.score,
  }));

  const totals = departmentRows.reduce(
    (sum, row) => ({
      employees: sum.employees + row.employees,
      working: sum.working + row.workingDays,
      present: sum.present + row.expectedPresentDays,
      absent: sum.absent + row.absentDays,
      worked: sum.worked + row.workedMinutes,
    }),
    { employees: 0, working: 0, present: 0, absent: 0, worked: 0 }
  );

  return buildEnvelope({
    key: "department",
    scope,
    filters,
    rows,
    summary: [
      { label: "Departments", value: rows.length, type: "number" },
      { label: "Employees", value: totals.employees, type: "number" },
      {
        label: "Attendance",
        value:
          totals.working > 0
            ? Math.round((totals.present / totals.working) * 100)
            : null,
        type: "percent",
      },
      { label: "Absent days", value: totals.absent, type: "number" },
      { label: "Hours worked", value: minutesToHours(totals.worked), type: "duration" },
    ],
  });
};

/* =====================================================================
   SECTION 5 - THE BREAK REPORT
   ---------------------------------------------------------------------
   The one report that exists because a manager asked a specific
   question: "how much break time is my department actually taking?"

   THE ALLOWANCE IS A COLUMN ON EVERY ROW, and that is the point of the
   report. A number of minutes means nothing on its own - 75 minutes is
   generous against an hour and frugal against ninety. Printing the
   allowance next to it turns the report from a list of numbers into a
   list of answers.

   It is the row's OWN allowance, taken from the policy that was frozen
   into the records, so a department that changed its allowance in the
   middle of the range is reported against what it actually promised at
   the time.
   ===================================================================== */
export const buildBreakReport = ({ employeeRows, scope, filters }) => {
  const rows = employeeRows.map((row) => ({
    employeeId: row.user.employeeId || "-",
    name: fullName(row.user),
    departmentName: row.user.department?.name || "No department",
    presentDays: row.presentDays,
    breakCount: row.breakCount,
    breakHours: minutesToHours(row.breakMinutes),
    avgBreakMinutes: row.avgBreakMinutes,
    allowanceMinutes: row.allowanceMinutes,
    overBreakDays: row.overBreakDays,
  }));

  // the longest average first - the reason somebody opened this report
  rows.sort((a, b) => (b.avgBreakMinutes ?? -1) - (a.avgBreakMinutes ?? -1));

  const totals = employeeRows.reduce(
    (sum, row) => ({
      breaks: sum.breaks + row.breakMinutes,
      count: sum.count + row.breakCount,
      days: sum.days + row.presentDays,
      over: sum.over + row.overBreakDays,
    }),
    { breaks: 0, count: 0, days: 0, over: 0 }
  );

  return buildEnvelope({
    key: "breaks",
    scope,
    filters,
    rows,
    summary: [
      { label: "Employees", value: rows.length, type: "number" },
      { label: "Breaks taken", value: totals.count, type: "number" },
      { label: "Total break time", value: minutesToHours(totals.breaks), type: "duration" },
      {
        label: "Average per day",
        value: totals.days > 0 ? Math.round(totals.breaks / totals.days) : null,
        type: "number",
      },
      { label: "Days over allowance", value: totals.over, type: "number" },
    ],
  });
};

export { describeAttendanceFilters };
