/*
=========================================================================
  CONTROLLER: Attendance                          ( the "C" of MVC )
=========================================================================
  Module 11 - Attendance Management.

  FUNCTIONS IN THIS FILE

    -- the employee's own day --
    getMyAttendance     GET   /api/attendance/me
    clockIn             POST  /api/attendance/clock-in
    startBreak          POST  /api/attendance/break/start
    endBreak            POST  /api/attendance/break/end
    clockOut            POST  /api/attendance/clock-out
    getMyHistory        GET   /api/attendance/me/history

    -- other people's days --
    getOptions          GET   /api/attendance/options
    getTeamAttendance   GET   /api/attendance/team
    getEmployeeAttendance GET /api/attendance/employee/:userId
    getOrganisation     GET   /api/attendance/organisation

    -- changing things --
    getPolicy           GET   /api/attendance/policy
    updatePolicy        PUT   /api/attendance/policy
    correctRecord       PATCH /api/attendance/record/:recordId

    -- the files --
    exportAttendance    GET   /api/attendance/export/:reportType

  THIS FILE IS DELIBERATELY THIN, the same way reportController.js is:

    what a punch does            -> config/attendanceService.js
    whose attendance may I see   -> config/attendanceScope.js
    how it is counted            -> config/attendanceStats.js
    what the policy is           -> config/attendancePolicyService.js
    how it becomes a file        -> config/attendanceReports.js
                                    + config/reportExport.js (Module 8)

  All that is left here is HTTP work: read the query string, throw away
  anything not in a fixed list, hand over, answer.

  THE TWO THINGS EVERY READ ROUTE DOES FIRST
  ------------------------------------------
      1. resolve the scope   (who may this person see?)
      2. build the range     (which days?)

  Both are shared, so the team board, the drill-down, the organisation
  view and the four exports can never disagree about either.
=========================================================================
*/

import Department from "../model/departmentModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
import { recordAudit, buildChanges, describePerson } from "../config/auditService.js";
import { PERMISSIONS } from "../config/permissions.js";
import { getManagedDepartments } from "../config/dashboardStats.js";
import { buildMinutesOfDay } from "../config/workingCalendar.js";

import {
  buildPunchContext,
  clockIn as punchIn,
  clockOut as punchOut,
  startBreak as punchBreakStart,
  endBreak as punchBreakEnd,
  autoCloseStaleDays,
  describeState,
  presentRecord,
  getDayRecord,
  getLiveBoard,
  findRecordById,
  applyCorrection,
} from "../config/attendanceService.js";

import {
  resolveAttendanceScope,
  canViewAttendanceOf,
  resolveScopedEmployees,
  getSelectableDepartments,
} from "../config/attendanceScope.js";

import {
  buildAttendanceRange,
  normalisePeriod,
  fetchRecords,
  expandRange,
  collectDepartmentIds,
  buildEmployeeCalendar,
  summariseDays,
  bucketDays,
  summariseEmployees,
  summariseDepartments,
  buildAttendanceTrend,
  rankPerformers,
  rankNeedsAttention,
  rankPerformersByDepartment,
  MIN_DAYS_TO_RANK,
} from "../config/attendanceStats.js";

import {
  getPolicyForUser,
  getPolicyForDepartment,
  getPolicyMap,
  savePolicy,
} from "../config/attendancePolicyService.js";

import {
  ATTENDANCE_REPORT_TYPES,
  SUMMARY_PERIODS,
  SUMMARY_PERIOD_LABELS,
  BREAK_TYPES,
  POLICY_LIMITS,
  POLICY_FIELD_LABELS,
  DEFAULT_ATTENDANCE_POLICY,
  describePolicyConflict,
  ATTENDANCE_STATUS_LABELS,
  formatDateKey,
  formatMinutes,
} from "../config/attendanceConstants.js";

import {
  buildDailyAttendanceReport,
  buildEmployeeAttendanceReport,
  buildDepartmentAttendanceReport,
  buildBreakReport,
  describeAttendanceFilters,
} from "../config/attendanceReports.js";

import {
  EXPORT_FORMATS,
  EXPORT_FILE_META,
} from "../config/reportConstants.js";
import {
  toCsv,
  toExcelBuffer,
  streamPdf,
  buildFileName,
} from "../config/reportExport.js";

/* =====================================================================
   HELPER 1 - answering a refused punch
   ---------------------------------------------------------------------
   The service throws refusals with a `statusCode` on them (see the note
   at the top of config/attendanceService.js). "You are already on a
   break" is the user's business, not a server fault, and answering it
   with 500 would be a lie the UI has no way to tell from a real crash.

   Anything WITHOUT a statusCode is a genuine bug and keeps the 500 and
   the console line, exactly like every other controller in FlowDesk.
   ===================================================================== */
const answerError = (res, error, label) => {
  if (error?.isAttendanceRefusal) {
    return res.status(error.statusCode || 409).json({ message: error.message });
  }

  return res.status(500).json({ message: `${label} Error ${error}` });
};

/* =====================================================================
   HELPER 2 - the whole picture for a set of employees
   ---------------------------------------------------------------------
   Called by the team board, the organisation view, the drill-down and
   all four exports. It is the single place a range, a scope and a
   policy map turn into rows.

   ONE FUNCTION IS THE POINT. The promise Module 8 makes ("the file
   holds what the screen held") only holds if the screen and the file
   are built by the same call with the same arguments - so they are.
   ===================================================================== */
const buildAttendancePicture = async ({
  scope,
  departmentId,
  userId,
  from,
  to,
  calendar,
  includeDays = false,
}) => {
  const employees = await resolveScopedEmployees(scope, { departmentId, userId });

  const dateKeys = expandRange(from, to);

  const records = await fetchRecords(
    employees.map((employee) => employee._id),
    from,
    to
  );

  const policyMap = await getPolicyMap(collectDepartmentIds(employees));

  const minutesOfDay = await buildMinutesOfDay();

  const employeeRows = summariseEmployees({
    employees,
    records,
    dateKeys,
    calendar,
    policyMap,
    minutesOfDay,
    includeDays,
  });

  return { employees, dateKeys, records, policyMap, employeeRows, minutesOfDay };
};

/* =====================================================================
   HELPER 3 - may this person set THIS department's working pattern?
   ---------------------------------------------------------------------
   Two ways to be allowed, and they are deliberately different in kind:

     the DATA   a department points at you as its manager -> you set
                that department's shift and break allowance
     a PERMISSION  attendance:policy -> you set anybody's, including
                the company-wide default

   The company default has no department, so only the permission can
   ever unlock it - see the long note in config/permissions.js.
   ===================================================================== */
const canSetPolicyFor = async (req, departmentId) => {
  const permissions = req.user.role?.permissions || [];

  if (permissions.includes(PERMISSIONS.ATTENDANCE_POLICY)) {
    return true;
  }

  // nobody without the permission may touch the company-wide default
  if (!departmentId) {
    return false;
  }

  const managed = await getManagedDepartments(req.userId);

  return managed.some(
    (department) => String(department._id) === String(departmentId)
  );
};

/* =====================================================================
   1) MY DAY
   ---------------------------------------------------------------------
   GET /api/attendance/me

   Everything the punch card on the dashboard and the top of the
   Attendance page need, in one call: today's record, where the employee
   is right now, the policy they are judged by, and how the month is
   going so far.

   NO PERMISSION IS CHECKED, and there is nothing here for an admin to
   grant. It reads req.userId and nothing else, so the only attendance
   it can ever return is the caller's own - the same reasoning the
   notification routes use.

   THE STALE-DAY SWEEP HAPPENS HERE TOO, not only on a punch. Somebody
   who forgot to clock out on Friday and opens the app on Monday
   morning should see Friday already closed and labelled, rather than
   see it snap shut the moment they press Start work.
   ===================================================================== */
export const getMyAttendance = async (req, res) => {
  try {
    const context = await buildPunchContext(req.user);

    await autoCloseStaleDays(req.user, context);

    const record = await getDayRecord(req.userId, context.dateKey);

    /* ---------------- how is the month going? ----------------
       The card under the clock. It is this calendar month rather than
       "the last 30 days" because that is the period a person actually
       thinks in - and the one their payslip is cut on. */
    const monthStart = `${context.dateKey.slice(0, 7)}-01`;

    const dateKeys = expandRange(monthStart, context.dateKey);
    const records = await fetchRecords([req.userId], monthStart, context.dateKey);

    const days = buildEmployeeCalendar({
      dateKeys,
      calendar: context.calendar,
      recordFor: (dateKey) => records.get(`${req.userId}|${dateKey}`),
      policy: context.policy,
      joinedKey: req.user.dateOfJoining
        ? new Date(req.user.dateOfJoining).toISOString().split("T")[0]
        : null,
      minutesOfDay: context.minutesOfDay,
    });

    return res.status(200).json({
      message: "Attendance fetched successfully",
      today: {
        dateKey: context.dateKey,
        label: formatDateKey(context.dateKey),
        isWorkingDay: context.day.isWorkingDay,
        reason: context.day.reason,
        // the server's clock, so the browser can correct its own drift
        serverTime: context.now,
      },
      record: presentRecord(record, context),
      state: describeState(record, context).state,
      policy: context.policy,
      monthSummary: summariseDays(days, context.policy),
      breakTypes: BREAK_TYPES,
    });
  } catch (error) {
    return answerError(res, error, "Get My Attendance");
  }
};

/* =====================================================================
   2) THE FOUR PUNCHES
   ---------------------------------------------------------------------
   POST /api/attendance/clock-in
   POST /api/attendance/break/start
   POST /api/attendance/break/end
   POST /api/attendance/clock-out

   Four routes that all look the same on purpose: build the context,
   call the one verb in the service, answer with the record in the shape
   every screen reads. Nothing is decided here.

   NOT ONE OF THEM TAKES A TIME FROM THE CALLER. A punch whose timestamp
   the punching device chooses is not evidence of anything - see the
   rule at the top of config/attendanceService.js.
   ===================================================================== */

export const clockIn = async (req, res) => {
  try {
    const context = await buildPunchContext(req.user);

    const record = await punchIn(req.user, context);

    return res.status(201).json({
      message: context.day.isWorkingDay
        ? "Your working day has started"
        : /*
            Working on a day off is allowed and is SAID OUT LOUD. The
            day still counts, and the employee should know from the
            first second that the system has noticed it is a Sunday -
            rather than find out from a summary at the end of the
            month.
          */
          `Your working day has started on a non-working day (${context.day.reason})`,
      record: presentRecord(record, context),
      state: describeState(record, context).state,
    });
  } catch (error) {
    return answerError(res, error, "Clock In");
  }
};

export const startBreak = async (req, res) => {
  try {
    const context = await buildPunchContext(req.user);

    const record = await punchBreakStart(req.user, context, {
      type: req.body?.type,
      note: req.body?.note,
    });

    return res.status(200).json({
      message: "Break started",
      record: presentRecord(record, context),
      state: describeState(record, context).state,
    });
  } catch (error) {
    return answerError(res, error, "Start Break");
  }
};

export const endBreak = async (req, res) => {
  try {
    const context = await buildPunchContext(req.user);

    const { record, warning } = await punchBreakEnd(req.user, context);

    return res.status(200).json({
      message: "Welcome back",
      /*
        The over-long break is REPORTED, never refused (see the note in
        the service). It travels as its own field rather than as the
        message, so the UI can draw it as a warning while the action
        itself still reads as the success it was.
      */
      warning,
      record: presentRecord(record, context),
      state: describeState(record, context).state,
    });
  } catch (error) {
    return answerError(res, error, "End Break");
  }
};

export const clockOut = async (req, res) => {
  try {
    const context = await buildPunchContext(req.user);

    const record = await punchOut(req.user, context, { note: req.body?.note });

    return res.status(200).json({
      message: `Day finished - ${formatMinutes(record.workedMinutes)} worked`,
      record: presentRecord(record, context),
      state: "Finished",
    });
  } catch (error) {
    return answerError(res, error, "Clock Out");
  }
};

/* =====================================================================
   3) MY OWN HISTORY
   ---------------------------------------------------------------------
   GET /api/attendance/me/history?period=daily|weekly|monthly&from=&to=

   The three views an employee asks for, and they are the SAME days
   bucketed three ways rather than three queries - so the daily rows
   always add up to the weekly ones, which always add up to the monthly
   ones.

   Again no permission: it reads req.userId.
   ===================================================================== */
export const getMyHistory = async (req, res) => {
  try {
    const period = normalisePeriod(req.query.period);

    const { from, to, calendar } = await buildAttendanceRange(req.query, period);

    const policy = await getPolicyForUser(req.user);
    const minutesOfDay = await buildMinutesOfDay();

    const dateKeys = expandRange(from, to);
    const records = await fetchRecords([req.userId], from, to);

    const days = buildEmployeeCalendar({
      dateKeys,
      calendar,
      recordFor: (dateKey) => records.get(`${req.userId}|${dateKey}`),
      policy,
      joinedKey: req.user.dateOfJoining
        ? new Date(req.user.dateOfJoining).toISOString().split("T")[0]
        : null,
      minutesOfDay,
    });

    return res.status(200).json({
      message: "Attendance history fetched successfully",
      period,
      periods: SUMMARY_PERIODS.map((key) => ({
        key,
        label: SUMMARY_PERIOD_LABELS[key],
      })),
      range: { from, to, label: `${formatDateKey(from)} - ${formatDateKey(to)}` },
      summary: summariseDays(days, policy),
      /*
        The buckets the table draws, and the raw days underneath them.

        Both are sent because the page shows both: a monthly view still
        wants the calendar strip of individual days beneath it, and
        fetching that separately would be a second call for data this
        one already had in its hands.
      */
      rows: bucketDays(days, period, policy),
      days,
      policy,
    });
  } catch (error) {
    return answerError(res, error, "Get My History");
  }
};

/* =====================================================================
   4) WHAT CAN I ASK FOR?
   ---------------------------------------------------------------------
   GET /api/attendance/options

   Fills every dropdown on the attendance pages in ONE call, and tells
   the page which slice of the company this user is looking at so the
   header can say "Whole organisation" or "Engineering" honestly.

   The department list is narrowed to what the caller may actually pick
   (getSelectableDepartments) - a dropdown that offers a filter which
   can only ever come back empty is a dropdown that makes the app look
   broken. The same decision getReportOptions() made in Module 8.
   ===================================================================== */
export const getOptions = async (req, res) => {
  try {
    const scope = await resolveAttendanceScope(req);
    const departments = await getSelectableDepartments(scope);

    const permissions = req.user.role?.permissions || [];

    return res.status(200).json({
      message: "Attendance options fetched successfully",
      scope: { level: scope.level, label: scope.label },
      departments,
      periods: SUMMARY_PERIODS.map((key) => ({
        key,
        label: SUMMARY_PERIOD_LABELS[key],
      })),
      reports: ATTENDANCE_REPORT_TYPES,
      exportFormats: EXPORT_FORMATS,
      statusLabels: ATTENDANCE_STATUS_LABELS,
      breakTypes: BREAK_TYPES,
      /*
        WHAT THE PAGE MAY DRAW, answered by the backend rather than
        worked out again in React from the permission list.

        The frontend has its own copy of the permission names and could
        do this itself - but "can I edit THIS department's policy?" is
        not a permission question at all, it is the manager-of-a-
        department question, and the browser does not know which
        departments point at the user. Answering it here keeps one
        source of truth for a rule that is half permission and half
        data.
      */
      can: {
        correct: permissions.includes(PERMISSIONS.ATTENDANCE_CORRECT),
        export: permissions.includes(PERMISSIONS.ATTENDANCE_EXPORT),
        setCompanyPolicy: permissions.includes(PERMISSIONS.ATTENDANCE_POLICY),
        setDepartmentPolicy: scope.departments.length > 0 ||
          permissions.includes(PERMISSIONS.ATTENDANCE_POLICY),
      },
      minDaysToRank: MIN_DAYS_TO_RANK,
    });
  } catch (error) {
    return answerError(res, error, "Get Attendance Options");
  }
};

/* =====================================================================
   5) MY TEAM
   ---------------------------------------------------------------------
   GET /api/attendance/team?from=&to=&department=

   The department manager's page: who was here, who was late, who is on
   a break right now, who is at the top of the department and who needs
   asking about.

   NO PERMISSION IS CHECKED HERE EITHER, and that is the interesting
   part. The route is open to every logged-in user, and
   resolveAttendanceScope() decides what that means for them:

     manages a department -> their department
     attendance:read-all  -> everybody
     neither              -> themselves, and only themselves

   An ordinary employee who opens this URL gets a board with one row on
   it: their own. That is not a leak, it is the same page answering the
   same question honestly for a smaller scope - the design
   config/reportScope.js established for search and reports.

   THE LIVE BOARD IS TODAY ONLY, whatever the range. "Who is on a break"
   is a question about right now, and answering it over a date range in
   the past would be nonsense.
   ===================================================================== */
export const getTeamAttendance = async (req, res) => {
  try {
    const scope = await resolveAttendanceScope(req);

    const { from, to, calendar, todayKey } = await buildAttendanceRange(req.query);

    const departmentId =
      req.query.department && isValidObjectId(req.query.department)
        ? req.query.department
        : "";

    const { employees, employeeRows, records, dateKeys, policyMap } =
      await buildAttendancePicture({
        scope,
        departmentId,
        from,
        to,
        calendar,
      });

    const context = await buildPunchContext(req.user);

    const live = await getLiveBoard(
      employees.map((employee) => employee._id),
      context
    );

    const department = departmentId
      ? await Department.findById(departmentId).select("name code").lean()
      : null;

    /*
      Rolled up ONCE and used twice - as the department rows and as the
      board's own totals. Calling summariseDepartments() a second time
      for the totals would be a second pass over every employee to get
      an answer we are already holding, and would leave two places for
      the two numbers to drift apart.
    */
    const departmentRows = summariseDepartments(employeeRows);

    return res.status(200).json({
      message: "Team attendance fetched successfully",
      scope: { level: scope.level, label: scope.label },
      range: { from, to, todayKey, label: `${formatDateKey(from)} - ${formatDateKey(to)}` },
      department,

      // the totals across everybody on the board
      summary: departmentRows.reduce(
        (all, group) => ({
          employees: all.employees + group.employees,
          workingDays: all.workingDays + group.workingDays,
          presentDays: all.presentDays + group.expectedPresentDays,
          absentDays: all.absentDays + group.absentDays,
          lateDays: all.lateDays + group.lateDays,
          workedMinutes: all.workedMinutes + group.workedMinutes,
          overtimeMinutes: all.overtimeMinutes + group.overtimeMinutes,
          breakMinutes: all.breakMinutes + group.breakMinutes,
          openDays: all.openDays + group.openDays,
          autoClosedDays: all.autoClosedDays + group.autoClosedDays,
        }),
        {
          employees: 0,
          workingDays: 0,
          presentDays: 0,
          absentDays: 0,
          lateDays: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
          breakMinutes: 0,
          openDays: 0,
          autoClosedDays: 0,
        }
      ),

      employees: employeeRows,
      departments: departmentRows,
      topPerformers: rankPerformers(employeeRows),
      needsAttention: rankNeedsAttention(employeeRows),
      /*
        The same names split by department. A manager of ONE department
        gets a single group here that repeats topPerformers above, and
        the page simply does not draw it - the whole board is already
        that department. It earns its place for the manager of two or
        three: mixing their teams into one ranking would answer a
        question nobody asked, since the two teams may not even share a
        working pattern.
      */
      departmentLeaders: rankPerformersByDepartment(employeeRows),
      trend: buildAttendanceTrend({
        employees,
        records,
        dateKeys,
        calendar,
        policyMap,
      }),
      live,
    });
  } catch (error) {
    return answerError(res, error, "Get Team Attendance");
  }
};

/* =====================================================================
   6) ONE EMPLOYEE, IN FULL
   ---------------------------------------------------------------------
   GET /api/attendance/employee/:userId?from=&to=&period=

   The drill-down from the team board, and the route a Director opens to
   check a single person - "director can also check each employee's
   attendance", which is exactly what the org scope unlocks.

   THE PERMISSION CHECK IS HERE AND NOT IN THE ROUTE FILE, because it is
   not a permission check. It is "is this person inside the slice of the
   company you may see", which needs the scope, the target and the
   database - see canViewAttendanceOf() in config/attendanceScope.js.

   404, NOT 403, FOR SOMEBODY OUTSIDE THE SCOPE. A manager who guesses
   an id should not be told "that person exists but is not yours" - that
   is an employee directory, one request at a time.
   ===================================================================== */
export const getEmployeeAttendance = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "That is not a valid employee id" });
    }

    const scope = await resolveAttendanceScope(req);

    if (!canViewAttendanceOf(scope, userId, req.userId)) {
      return res.status(404).json({ message: "That employee was not found" });
    }

    const period = normalisePeriod(req.query.period);

    const { from, to, calendar } = await buildAttendanceRange(req.query, period);

    const employee = await User.findOne({ _id: userId, isDeleted: false })
      .select(
        "firstName lastName employeeId designation photoUrl department dateOfJoining email"
      )
      .populate("department", "name code")
      .lean();

    if (!employee) {
      return res.status(404).json({ message: "That employee was not found" });
    }

    const policy = await getPolicyForDepartment(
      employee.department?._id || employee.department
    );

    const minutesOfDay = await buildMinutesOfDay();

    const dateKeys = expandRange(from, to);
    const records = await fetchRecords([employee._id], from, to);

    const days = buildEmployeeCalendar({
      dateKeys,
      calendar,
      recordFor: (dateKey) => records.get(`${employee._id}|${dateKey}`),
      policy,
      joinedKey: employee.dateOfJoining
        ? new Date(employee.dateOfJoining).toISOString().split("T")[0]
        : null,
      minutesOfDay,
    });

    return res.status(200).json({
      message: "Employee attendance fetched successfully",
      employee,
      policy,
      period,
      range: { from, to, label: `${formatDateKey(from)} - ${formatDateKey(to)}` },
      summary: summariseDays(days, policy),
      rows: bucketDays(days, period, policy),
      days,
      // the manager reading this page may or may not be allowed to fix it
      canCorrect:
        (req.user.role?.permissions || []).includes(PERMISSIONS.ATTENDANCE_CORRECT) &&
        scope.level !== "own",
    });
  } catch (error) {
    return answerError(res, error, "Get Employee Attendance");
  }
};

/* =====================================================================
   7) THE WHOLE COMPANY, BY DEPARTMENT
   ---------------------------------------------------------------------
   GET /api/attendance/organisation?from=&to=

   The director's and the admin's view: one row per department, so two
   teams can be compared without opening either.

   THIS ONE DOES CHECK A PERMISSION, unlike /team above, and the
   difference is the point. /team answers "my people" for whoever asks,
   and shrinks to one row for an ordinary employee. This one is only
   ever about OTHER departments - there is no honest smaller version of
   it - so attendance:read-all is required in the route file.
   ===================================================================== */
export const getOrganisation = async (req, res) => {
  try {
    const scope = await resolveAttendanceScope(req);

    const { from, to, calendar, todayKey } = await buildAttendanceRange(req.query);

    const { employees, employeeRows, records, dateKeys, policyMap } =
      await buildAttendancePicture({ scope, from, to, calendar });

    const departments = summariseDepartments(employeeRows);

    const context = await buildPunchContext(req.user);

    const live = await getLiveBoard(
      employees.map((employee) => employee._id),
      context
    );

    return res.status(200).json({
      message: "Organisation attendance fetched successfully",
      scope: { level: scope.level, label: scope.label },
      range: { from, to, todayKey, label: `${formatDateKey(from)} - ${formatDateKey(to)}` },
      departments,
      /*
        The company's own totals, worked out from the department rows
        for the same reason the department rows are worked out from the
        employee rows: a total that is not the sum of what is on screen
        is a total somebody will one day have to explain.
      */
      summary: departments.reduce(
        (all, group) => ({
          departments: all.departments + 1,
          employees: all.employees + group.employees,
          workingDays: all.workingDays + group.workingDays,
          presentDays: all.presentDays + group.expectedPresentDays,
          absentDays: all.absentDays + group.absentDays,
          lateDays: all.lateDays + group.lateDays,
          workedMinutes: all.workedMinutes + group.workedMinutes,
          overtimeMinutes: all.overtimeMinutes + group.overtimeMinutes,
        }),
        {
          departments: 0,
          employees: 0,
          workingDays: 0,
          presentDays: 0,
          absentDays: 0,
          lateDays: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
        }
      ),
      topPerformers: rankPerformers(employeeRows, 10),
      needsAttention: rankNeedsAttention(employeeRows, 10),
      /*
        THE ADMIN'S ANSWER TO "top performers in each department".

        topPerformers just above is one list across the whole company,
        and on its own it is misleading at this scope: ten names from
        whichever department keeps the tightest shift, with every other
        team missing. This one gives each department its own podium, so
        a department is never invisible for being small or for being
        judged against a harder pattern.
      */
      departmentLeaders: rankPerformersByDepartment(employeeRows),
      trend: buildAttendanceTrend({
        employees,
        records,
        dateKeys,
        calendar,
        policyMap,
      }),
      liveWorking: live.filter((entry) => entry.state === "Working").length,
      liveOnBreak: live.filter((entry) => entry.state === "OnBreak").length,
    });
  } catch (error) {
    return answerError(res, error, "Get Organisation Attendance");
  }
};

/* =====================================================================
   8) THE WORKING PATTERN
   ---------------------------------------------------------------------
   GET /api/attendance/policy?department=<id>

   Reading a policy needs nothing at all: an employee has an absolute
   right to know what shift they are being judged against and how much
   break time they are allowed. A system that measures somebody by a
   rule it will not show them is not a system anybody should trust.

   `canEdit` is what the screen actually needs on top of it, and it is
   half permission, half data - see canSetPolicyFor() above.
   ===================================================================== */
export const getPolicy = async (req, res) => {
  try {
    /*
      NO ?department= MEANS "MINE", NOT "THE COMPANY'S".

      This distinction was a bug the first time round, and the shape of
      it is worth keeping written down: the endpoint answered with the
      caller's own DEPARTMENT policy while working `canEdit` out against
      the COMPANY default. A manager opening their own screen was shown
      their department's numbers and told they could not change them -
      which was true of the company default and false of the thing in
      front of them.

      Resolving the department first means the policy and the answer
      about it are always about the same object.
    */
    const departmentId =
      req.query.department && isValidObjectId(req.query.department)
        ? req.query.department
        : req.user.department?._id || req.user.department || null;

    const policy = await getPolicyForDepartment(departmentId);

    const department = departmentId
      ? await Department.findById(departmentId).select("name code").lean()
      : null;

    return res.status(200).json({
      message: "Working pattern fetched successfully",
      policy,
      department,
      /*
        The company-wide default, sent alongside, so the screen can
        show a manager what they would fall back to - and so "reset to
        the company pattern" is a button rather than a support ticket.
      */
      companyPolicy: await getPolicyForDepartment(null),
      defaults: DEFAULT_ATTENDANCE_POLICY,
      limits: POLICY_LIMITS,
      // about the policy actually returned above, never about a
      // different one - see the note at the top of this function
      canEdit: await canSetPolicyFor(req, departmentId),
      canEditCompany: (req.user.role?.permissions || []).includes(
        PERMISSIONS.ATTENDANCE_POLICY
      ),
    });
  } catch (error) {
    return answerError(res, error, "Get Attendance Policy");
  }
};

/* =====================================================================
   9) CHANGING IT
   ---------------------------------------------------------------------
   PUT /api/attendance/policy
   body: { department, shiftStartMinutes, breakAllowanceMinutes, ... }

   THE VALIDATION IS THE WHOLE FUNCTION, and it is worth being blunt
   about why. A shift that ends before it starts, or a break allowance
   of 9999 minutes, would not throw anywhere. It would quietly poison
   every rate, every score and every report built on it afterwards -
   and the numbers would look plausible enough that nobody would go
   looking for the cause for a month.

   So: an explicit field list, a range per field, then the cross-field
   checks that only make sense as a whole (describePolicyConflict).
   ===================================================================== */
export const updatePolicy = async (req, res) => {
  try {
    const departmentId =
      req.body?.department && isValidObjectId(req.body.department)
        ? req.body.department
        : null;

    if (!(await canSetPolicyFor(req, departmentId))) {
      return res.status(403).json({
        message: departmentId
          ? "You can only change the working pattern of a department you manage"
          : "You do not have permission to change the company working pattern",
      });
    }

    if (departmentId) {
      const department = await Department.findOne({
        _id: departmentId,
        isDeleted: false,
      })
        .select("name")
        .lean();

      if (!department) {
        return res.status(404).json({ message: "That department was not found" });
      }
    }

    /* ---------------- what may be sent ---------------- */
    const before = await getPolicyForDepartment(departmentId);

    const values = {};

    for (const field of Object.keys(POLICY_FIELD_LABELS)) {
      if (req.body[field] === undefined) {
        continue;
      }

      if (field === "autoCloseAtShiftEnd") {
        values[field] = Boolean(req.body[field]);
        continue;
      }

      const number = Number(req.body[field]);

      if (!Number.isFinite(number)) {
        return res.status(400).json({
          message: `${POLICY_FIELD_LABELS[field]} has to be a number`,
        });
      }

      const limit = POLICY_LIMITS[field];

      if (limit && (number < limit.min || number > limit.max)) {
        return res.status(400).json({
          message: `${POLICY_FIELD_LABELS[field]} has to be between ${limit.min} and ${limit.max}`,
        });
      }

      values[field] = Math.round(number);
    }

    if (Object.keys(values).length === 0) {
      return res.status(400).json({ message: "There is nothing to change" });
    }

    /*
      The conflict check runs against the MERGED policy, not against
      what was sent. Somebody moving only the shift end has to be
      checked against the shift start they are keeping, and a check
      that only looked at the changed fields would let exactly that
      through.
    */
    const merged = { ...before, ...values };

    const conflict = describePolicyConflict(merged);

    if (conflict) {
      return res.status(400).json({ message: conflict });
    }

    await savePolicy(departmentId, values, req.userId);

    const after = await getPolicyForDepartment(departmentId);

    const departmentName = departmentId
      ? (await Department.findById(departmentId).select("name").lean())?.name
      : "";

    await recordAudit(req, {
      action: "AttendancePolicyUpdated",
      description: `${describePerson(req.user)} changed the working pattern for ${
        departmentName || "the whole company"
      }`,
      targetType: "AttendancePolicy",
      targetId: departmentId,
      targetLabel: departmentName || "Company default",
      changes: buildChanges(before, after, POLICY_FIELD_LABELS),
    });

    return res.status(200).json({
      message: "Working pattern saved",
      policy: after,
    });
  } catch (error) {
    return answerError(res, error, "Update Attendance Policy");
  }
};

/* =====================================================================
   10) CORRECTING A DAY
   ---------------------------------------------------------------------
   PATCH /api/attendance/record/:recordId
   body: { clockInAt, clockOutAt, breaks, reason }

   The escape hatch every attendance system needs: somebody's laptop
   died, somebody was at a customer's office all morning, somebody's
   clock out is the shift end the system guessed.

   THREE GUARDS, AND THEY ARE THREE DIFFERENT QUESTIONS
   ----------------------------------------------------
     the ROUTE asks   may you correct records at all?
                      (attendance:correct)
     this function    is this record inside your slice of the company?
                      (the scope - a manager may not fix another
                      department's day however much permission they
                      hold)
     the SERVICE      do the corrected times make sense?

   NOBODY MAY CORRECT THEIR OWN RECORD, and that is the fourth guard.
   It is the one rule that makes the whole feature safe to have: an
   employee who could edit their own punches has an attendance system
   that records whatever they type. A manager fixes their own day by
   asking somebody else, exactly as they would with an expense claim.

   THE REASON IS REQUIRED. A correction with no reason is
   indistinguishable from a manager rewriting somebody's hours - and
   both the record and the audit log keep it.
   ===================================================================== */
export const correctRecord = async (req, res) => {
  try {
    const record = await findRecordById(req.params.recordId);

    if (!record) {
      return res.status(404).json({ message: "That attendance record was not found" });
    }

    const scope = await resolveAttendanceScope(req);

    const targetId = record.user?._id || record.user;

    if (String(targetId) === String(req.userId)) {
      return res.status(403).json({
        message:
          "You cannot correct your own attendance. Ask your manager or an administrator.",
      });
    }

    if (!canViewAttendanceOf(scope, targetId, req.userId)) {
      return res.status(404).json({ message: "That attendance record was not found" });
    }

    const reason = String(req.body?.reason || "").trim();

    if (reason.length < 5) {
      return res.status(400).json({
        message: "Please say why this record is being corrected (at least 5 characters)",
      });
    }

    /* ---------------- read the new times ----------------
       Dates arrive as ISO strings. An unparseable one is refused rather
       than quietly becoming "Invalid Date", which mongoose would store
       and every later subtraction would turn into NaN. */
    const readDate = (value, label) => {
      if (value === undefined) {
        return undefined;
      }

      if (value === null) {
        return null;
      }

      const date = new Date(value);

      if (isNaN(date.getTime())) {
        throw Object.assign(new Error(`${label} is not a valid time`), {
          statusCode: 400,
          isAttendanceRefusal: true,
        });
      }

      return date;
    };

    const before = {
      clockInAt: record.clockInAt,
      clockOutAt: record.clockOutAt,
      breakMinutes: record.breakMinutes,
      workedMinutes: record.workedMinutes,
      status: record.status,
    };

    const breaks = Array.isArray(req.body?.breaks)
      ? req.body.breaks.map((entry) => ({
          type: BREAK_TYPES.includes(entry.type) ? entry.type : "Other",
          startedAt: readDate(entry.startedAt, "A break start"),
          endedAt: readDate(entry.endedAt, "A break end") || null,
          note: String(entry.note || "").trim().slice(0, 120),
        }))
      : undefined;

    const saved = await applyCorrection(
      record,
      {
        clockInAt: readDate(req.body?.clockInAt, "The clock in"),
        clockOutAt: readDate(req.body?.clockOutAt, "The clock out"),
        breaks,
        reason,
      },
      req.user
    );

    const after = {
      clockInAt: saved.clockInAt,
      clockOutAt: saved.clockOutAt,
      breakMinutes: saved.breakMinutes,
      workedMinutes: saved.workedMinutes,
      status: saved.status,
    };

    await recordAudit(req, {
      action: "AttendanceCorrected",
      description: `${describePerson(req.user)} corrected ${describePerson(
        record.user
      )}'s attendance for ${formatDateKey(saved.dateKey)} - ${reason}`,
      targetType: "Attendance",
      targetId: saved._id,
      targetLabel: `${record.user?.employeeId || ""} ${saved.dateKey}`.trim(),
      changes: buildChanges(before, after, {
        clockInAt: "Clock in",
        clockOutAt: "Clock out",
        breakMinutes: "Break minutes",
        workedMinutes: "Worked minutes",
        status: "Status",
      }),
    });

    const minutesOfDay = await buildMinutesOfDay();

    return res.status(200).json({
      message: "Attendance corrected",
      record: presentRecord(saved, { now: new Date(), minutesOfDay }),
    });
  } catch (error) {
    return answerError(res, error, "Correct Attendance");
  }
};

/* =====================================================================
   11) THE FILES
   ---------------------------------------------------------------------
   GET /api/attendance/export/:reportType?format=pdf|excel|csv&from=&to=
       &department=&user=

   Four reports times three formats, and not one line of export code -
   config/attendanceReports.js builds a Module 8 REPORT ENVELOPE and
   config/reportExport.js turns it into a file, exactly as it does for
   the six approval reports.

   THE SCOPE STILL APPLIES. An export is not a way around the boundary:
   the rows come from the same buildAttendancePicture() the screen used,
   so a manager's spreadsheet contains their department and nothing else
   - and a manager who edits ?department= into somebody else's gets an
   empty file rather than somebody else's data.

   THE DOWNLOAD IS AUDITED (AttendanceExported) and the punches are not,
   which is the right way round: a file of when every employee arrived
   and how long they were away from their desk has left the building,
   and that is exactly the kind of event Module 7 exists to remember.

   THE THREE FORMATS ARE SENT TWO DIFFERENT WAYS - see the note above
   exportReport() in controllers/reportController.js. Everything that
   can fail happens BEFORE the PDF pipe is opened, because once the
   first byte is out we can no longer change our mind and send a 500.
   ===================================================================== */
export const exportAttendance = async (req, res) => {
  try {
    const { reportType } = req.params;

    if (!ATTENDANCE_REPORT_TYPES.includes(reportType)) {
      return res.status(404).json({ message: `Unknown report: ${reportType}` });
    }

    const format = EXPORT_FORMATS.includes(req.query.format)
      ? req.query.format
      : "csv";

    const scope = await resolveAttendanceScope(req);

    const { from, to, calendar } = await buildAttendanceRange(req.query);

    const departmentId =
      req.query.department && isValidObjectId(req.query.department)
        ? req.query.department
        : "";

    const userId =
      req.query.user && isValidObjectId(req.query.user) ? req.query.user : "";

    const { employeeRows } = await buildAttendancePicture({
      scope,
      departmentId,
      userId,
      from,
      to,
      calendar,
      // only the daily report needs one row per employee per day
      includeDays: reportType === "daily",
    });

    const department = departmentId
      ? await Department.findById(departmentId).select("name").lean()
      : null;

    const employeeName =
      userId && employeeRows.length === 1
        ? `${employeeRows[0].user.firstName} ${employeeRows[0].user.lastName}`
        : "";

    const filters = describeAttendanceFilters({
      scope,
      from,
      to,
      departmentName: department?.name,
      employeeName,
    });

    let report;

    if (reportType === "daily") {
      report = buildDailyAttendanceReport({
        employeeCalendars: employeeRows,
        scope,
        filters,
      });
    } else if (reportType === "employee") {
      report = buildEmployeeAttendanceReport({ employeeRows, scope, filters });
    } else if (reportType === "department") {
      report = buildDepartmentAttendanceReport({
        departmentRows: summariseDepartments(employeeRows),
        scope,
        filters,
      });
    } else {
      report = buildBreakReport({ employeeRows, scope, filters });
    }

    /*
      Audited BEFORE the file is sent, on purpose. A PDF is streamed,
      and once it is streaming there is no later moment at which the
      log entry could still be written and the failure still be
      handled. recordAudit() cannot throw (see the rule at the top of
      config/auditService.js), so this costs one insert and never the
      download.
    */
    await recordAudit(req, {
      action: "AttendanceExported",
      description: `${describePerson(req.user)} exported the ${
        report.title
      } (${format.toUpperCase()}) for ${formatDateKey(from)} - ${formatDateKey(to)}`,
      targetType: "Attendance",
      targetLabel: report.title,
    });

    const { extension, contentType } = EXPORT_FILE_META[format];
    const fileName = buildFileName(report, extension);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    if (format === "pdf") {
      // from here on the response belongs to PDFKit
      return streamPdf(report, res);
    }

    if (format === "excel") {
      const buffer = await toExcelBuffer(report);

      return res.status(200).end(Buffer.from(buffer));
    }

    return res.status(200).send(toCsv(report));
  } catch (error) {
    /*
      If the stream had already started there is nothing left to say -
      the headers are gone and half a PDF is on its way.
    */
    if (res.headersSent) {
      return res.end();
    }

    return answerError(res, error, "Export Attendance");
  }
};
