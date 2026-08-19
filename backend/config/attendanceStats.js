/*
=========================================================================
  ATTENDANCE STATISTICS   (Module 11 - Attendance Management)
=========================================================================
  The same job config/dashboardStats.js does for Module 5: the
  CONTROLLER does the HTTP work, this file does the counting.

  Everything here is a READ. Not one function writes to the database, so
  looking at an attendance summary can never change a record.

  WHY THIS ONE IS NOT AN AGGREGATION PIPELINE
  -------------------------------------------
  dashboardStats.js pushes almost everything into MongoDB, and the
  reasoning there is right: counting 50,000 requests in node would be
  hopeless. Attendance counts differently, and the difference is the
  whole design of this file.

  THE MOST IMPORTANT NUMBER IN ATTENDANCE IS THE ABSENCE, AND AN
  ABSENCE HAS NO DOCUMENT. "Ravi was absent on the 14th" is a statement
  about a day that has NO row in the collection - so no $group over the
  collection can ever produce it. The count has to start from the
  CALENDAR and look the records up, which is the opposite direction to
  an aggregation.

  So the shape is:

      1. build every day in the range          (the calendar)
      2. ask Settings which of them are worked (Module 9)
      3. drop the records that exist onto them (one indexed query)
      4. count

  and step 4 is arithmetic over a few hundred small objects, which node
  does instantly. A department of 50 people over a month is 1500 days -
  smaller than a single page of the audit log.

  THE OTHER REASON: EVERY EMPLOYEE IS JUDGED BY THEIR OWN POLICY. The
  warehouse starts at 07:00 and the office at 09:30, so "late" is a
  different number per row. A pipeline would need the policy joined in
  and the comparison expressed in $expr; here it is a lookup in a Map.
=========================================================================
*/

import Attendance from "../model/attendanceModel.js";
import { getCalendar, getLocalDateKey } from "./workingCalendar.js";
import { pickPolicy } from "./attendancePolicyService.js";
import {
  listDateKeys,
  describeDateKey,
  addDaysToDateKey,
  startOfWeekKey,
  monthKeyOfDateKey,
  formatDateKey,
  formatMonthKey,
  isValidDateKey,
  computePerformanceScore,
  DEFAULT_PERIOD_DAYS,
  MAX_RANGE_DAYS,
  SUMMARY_PERIODS,
  PRESENT_STATUSES,
} from "./attendanceConstants.js";

/* =====================================================================
   SECTION 1 - THE RANGE
   ---------------------------------------------------------------------
   Every screen in this module is "these people, between these two
   days", so the range is worked out once and in one shape.

   THE END IS CLAMPED TO TODAY, and that is not tidiness. Without it,
   a range ending next month would count thirty days somebody has not
   had the chance to work yet as thirty absences, and every attendance
   rate on the page would be wrong in a way that looks like a scandal.
   ===================================================================== */
export const buildAttendanceRange = async (query = {}, period = "daily") => {
  const calendar = await getCalendar();

  // "today" means today AT THE COMPANY, not on the server
  const todayKey = getLocalDateKey(new Date(), calendar.timezone);

  const requestedTo = isValidDateKey(query.to) ? query.to : todayKey;

  // never past today - see the note above
  const to = requestedTo > todayKey ? todayKey : requestedTo;

  const defaultDays = DEFAULT_PERIOD_DAYS[period] || DEFAULT_PERIOD_DAYS.daily;

  const from = isValidDateKey(query.from)
    ? query.from
    : addDaysToDateKey(to, -(defaultDays - 1));

  /*
    A backwards range is a typo, not an attack, so it is corrected
    rather than refused - a user who swapped the two dates gets the
    period they obviously meant instead of an error page.
  */
  if (from > to) {
    return { from: to, to: from, todayKey, calendar };
  }

  /*
    THE CEILING. The range is expanded into one object per day per
    employee, so an unbounded range is unbounded memory. Clamping the
    START (rather than refusing) means a hand-edited URL gets the most
    recent MAX_RANGE_DAYS, which is the part anybody actually wanted.
  */
  const capped = addDaysToDateKey(to, -(MAX_RANGE_DAYS - 1));

  return {
    from: from < capped ? capped : from,
    to,
    todayKey,
    calendar,
  };
};

export const normalisePeriod = (value) =>
  SUMMARY_PERIODS.includes(value) ? value : "daily";

/* =====================================================================
   SECTION 2 - THE RECORDS
   ---------------------------------------------------------------------
   ONE query for the whole board: every record, for every employee in
   scope, in the range. It hits the { user, dateKey } index, and the
   result is grouped in node afterwards.

   Doing it per employee would be the obvious way and would fire fifty
   queries to draw one table.
   ===================================================================== */
export const fetchRecords = async (memberIds, from, to) => {
  if (!memberIds || memberIds.length === 0) {
    return new Map();
  }

  const records = await Attendance.find({
    user: { $in: memberIds },
    dateKey: { $gte: from, $lte: to },
  })
    .sort({ dateKey: 1 })
    .lean();

  /*
    Keyed by "userId|dateKey" rather than nested maps: the only lookup
    anybody ever does is "this person, that day", and one flat key
    answers it without walking two levels.
  */
  const byUserAndDay = new Map();

  records.forEach((record) => {
    byUserAndDay.set(`${record.user}|${record.dateKey}`, record);
  });

  return byUserAndDay;
};

/* =====================================================================
   SECTION 3 - THE CALENDAR OF ONE EMPLOYEE
   ---------------------------------------------------------------------
   The function this whole file is built around: every day in the
   range, with what happened on it - INCLUDING the days nothing
   happened on, which is where absences come from.

   A DAY BEFORE SOMEBODY JOINED IS NOT AN ABSENCE.
   -----------------------------------------------
   It is not a day at all. Without this check a joiner who started
   yesterday would show a month of absences and an attendance rate of
   5%, which is not a small cosmetic problem - it is the number their
   manager sees first.

   The same reasoning applies to a day AFTER somebody's account was
   deactivated, and that is deliberately NOT handled here: a
   deactivated account keeps its dateOfJoining but has no leaving date
   in FlowDesk to read. Adding one is a User-model change and belongs
   with whoever owns Module 1, so for now a leaver simply stops
   appearing in the employee list the scope builds.

   @param dateKeys     every day in the range, from listDateKeys()
   @param calendar     from Module 9, for weekends and holidays
   @param recordFor    (dateKey) => the stored record, or undefined
   @param policy       the resolved policy for this employee
   @param joinedKey    the employee's joining day, as a dateKey
   @param minutesOfDay turns a punch into minutes past local midnight,
                       so the row can carry "09:12" as well as the raw
                       instant. Every screen and every export needs the
                       company's wall clock reading and none of them
                       should redo the timezone themselves.
   ===================================================================== */
export const buildEmployeeCalendar = ({
  dateKeys,
  calendar,
  recordFor,
  policy,
  joinedKey = null,
  minutesOfDay = null,
}) => {
  const minuteOf = (date) => (date && minutesOfDay ? minutesOfDay(date) : null);

  return dateKeys.map((dateKey) => {
    const record = recordFor(dateKey);
    const day = describeDateKey(calendar, dateKey);

    // before this person existed here - not a working day, not an absence
    const beforeJoining = Boolean(joinedKey) && dateKey < joinedKey;

    /* ---------------- nothing was punched ---------------- */
    if (!record) {
      return {
        dateKey,
        status: beforeJoining
          ? "Weekend" // "not expected", and the UI prints it as a blank day
          : day.isWorkingDay
          ? "Absent"
          : day.status,
        reason: beforeJoining ? "Before joining" : day.reason,
        isWorkingDay: day.isWorkingDay && !beforeJoining,
        isExpected: day.isWorkingDay && !beforeJoining,
        beforeJoining,
        record: null,
        workedMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        lateMinutes: 0,
        clockInAt: null,
        clockOutAt: null,
        clockInMinuteOfDay: null,
        clockOutMinuteOfDay: null,
      };
    }

    /* ---------------- somebody was here ---------------- */

    /*
      THE RECORD'S OWN ANSWER WINS OVER TODAY'S CALENDAR.

      A record froze `isWorkingDay` when it was opened, so a company
      that starts working Saturdays in September does not retroactively
      turn last April's Saturday shifts into ordinary days - the same
      argument appliedPolicy makes.

      The `??` is for records written before that field existed: they
      fall back to the calendar, which is what they were judged by at
      the time anyway.
    */
    const wasWorkingDay = (record.isWorkingDay ?? day.isWorkingDay) && !beforeJoining;

    return {
      dateKey,
      status: record.status,
      /*
        WORK ON A DAY OFF KEEPS BOTH FACTS. The status says what the
        day was worth ("Present"), and isWorkingDay still says the
        company was closed - so a Sunday shift shows up as extra
        rather than silently becoming a normal Sunday.
      */
      reason: wasWorkingDay ? "" : day.reason,
      isWorkingDay: wasWorkingDay,
      isExpected: wasWorkingDay,
      beforeJoining,
      record,
      workedMinutes: record.workedMinutes,
      breakMinutes: record.breakMinutes,
      overtimeMinutes: record.overtimeMinutes,
      lateMinutes: record.lateMinutes,
      overBreakMinutes: record.overBreakMinutes,
      isAutoClosed: record.isAutoClosed,
      correctedAt: record.correctedAt,
      isOpen: !record.clockOutAt,
      clockInAt: record.clockInAt,
      clockOutAt: record.clockOutAt,
      clockInMinuteOfDay: minuteOf(record.clockInAt),
      clockOutMinuteOfDay: minuteOf(record.clockOutAt),
      breakCount: record.breaks?.length || 0,
      allowanceMinutes:
        record.appliedPolicy?.breakAllowanceMinutes ?? policy.breakAllowanceMinutes,
    };
  });
};

/* =====================================================================
   SECTION 4 - COUNTING A LIST OF DAYS
   ---------------------------------------------------------------------
   Turns the calendar above into the numbers every screen shows. It is
   used for ONE employee over a month, for one employee over a week, and
   for a whole department - because "a department's attendance" is just
   the same counting over everybody's days at once.

   Writing it once is what makes the department total the exact sum of
   the employee rows. Two counting functions is how a report ends up
   with a total that does not match its own rows.
   ===================================================================== */
export const summariseDays = (days, policy) => {
  const summary = {
    // the calendar
    totalDays: days.length,
    workingDays: 0,
    holidayDays: 0,
    weekendDays: 0,

    /*
       WHAT HAPPENED ON THEM

       presentDays counts EVERY day with a record, including the
       Saturday somebody came in to fix something. expectedPresentDays
       counts only the ones the company was open for.

       THE TWO ARE NOT THE SAME NUMBER AND THE DIFFERENCE IS A REAL
       BUG IF IT IS IGNORED. An attendance rate of presentDays over
       workingDays reads 105% for somebody who worked every weekday
       and one Sunday - a number that is not wrong so much as
       meaningless, and the first thing anybody would screenshot.

       So every RATE below is built on expectedPresentDays, and
       presentDays is what the headline "days worked" cards show.
       offDayWorkedDays is the gap between them, reported on its own
       because a manager should see who is giving up their weekends.
    */
    presentDays: 0,
    expectedPresentDays: 0,
    absentDays: 0,
    lateDays: 0,
    halfDays: 0,
    onTimeDays: 0,

    // work on a day the company was closed
    offDayWorkedDays: 0,

    // the clock
    workedMinutes: 0,
    breakMinutes: 0,
    overtimeMinutes: 0,
    lateMinutes: 0,
    expectedMinutes: 0,

    // the break allowance
    breakCompliantDays: 0,
    overBreakDays: 0,
    breakCount: 0,

    // the honesty flags, so a manager can see how much of this is real
    autoClosedDays: 0,
    correctedDays: 0,
    openDays: 0,
  };

  days.forEach((day) => {
    if (day.beforeJoining) {
      // not counted anywhere - this person did not work here yet
      return;
    }

    if (day.isWorkingDay) {
      summary.workingDays += 1;
      summary.expectedMinutes += policy.fullDayMinutes;
    } else if (day.status === "Holiday") {
      summary.holidayDays += 1;
    } else if (day.status === "Weekend") {
      summary.weekendDays += 1;
    }

    if (!day.record) {
      if (day.isWorkingDay) {
        summary.absentDays += 1;
      }
      return;
    }

    /* ---------------- there is a record ---------------- */
    summary.presentDays += 1;

    if (day.isWorkingDay) {
      summary.expectedPresentDays += 1;

      if (day.status === "Late") {
        summary.lateDays += 1;
      } else {
        /*
          On time means "not Late", which includes a half day that
          started punctually. Punctuality is about the ARRIVAL; how
          long somebody then stayed is what presence and hours
          already measure.
        */
        summary.onTimeDays += 1;
      }

      if (day.status === "HalfDay") {
        summary.halfDays += 1;
      }
    } else {
      /*
        A DAY THE COMPANY WAS CLOSED IS COUNTED, NEVER JUDGED.

        Its hours are added to the totals below - the work was real -
        but it takes no part in lateness, punctuality or the half day
        count. There was no shift to be late for and no full day to
        fall short of, and scoring somebody against a promise nobody
        made is how an attendance system loses the room.
      */
      summary.offDayWorkedDays += 1;
    }

    summary.workedMinutes += day.workedMinutes || 0;
    summary.breakMinutes += day.breakMinutes || 0;
    summary.overtimeMinutes += day.overtimeMinutes || 0;
    summary.lateMinutes += day.lateMinutes || 0;
    summary.breakCount += day.breakCount || 0;

    if ((day.overBreakMinutes || 0) > 0) {
      summary.overBreakDays += 1;
    } else {
      summary.breakCompliantDays += 1;
    }

    if (day.isAutoClosed) {
      summary.autoClosedDays += 1;
    }

    if (day.correctedAt) {
      summary.correctedDays += 1;
    }

    if (day.isOpen) {
      summary.openDays += 1;
    }
  });

  /* ---------------- the rates ----------------
     null, never zero, when there is nothing to divide by. A joiner with
     no expected days yet has NO attendance rate; printing 0% would say
     they never turn up. The same rule getDepartmentPerformance() keeps
     for approvalRate in Module 5. */
  summary.attendanceRate =
    summary.workingDays > 0
      ? Math.round((summary.expectedPresentDays / summary.workingDays) * 100)
      : null;

  summary.punctualityRate =
    summary.expectedPresentDays > 0
      ? Math.round((summary.onTimeDays / summary.expectedPresentDays) * 100)
      : null;

  summary.avgDayMinutes =
    summary.presentDays > 0
      ? Math.round(summary.workedMinutes / summary.presentDays)
      : null;

  summary.avgBreakMinutes =
    summary.presentDays > 0
      ? Math.round(summary.breakMinutes / summary.presentDays)
      : null;

  summary.allowanceMinutes = policy.breakAllowanceMinutes;

  /*
    The four-part score, from config/attendanceConstants.js.

    `presentDays` is overridden with the EXPECTED one on the way in, so
    presence and punctuality are both measured against the days the
    company was actually open - the same correction the two rates above
    make. A weekend shift raises the hours part and nothing else, which
    is the honest way for extra work to show up.
  */
  Object.assign(
    summary,
    computePerformanceScore({
      ...summary,
      presentDays: summary.expectedPresentDays,
    })
  );

  return summary;
};

/* =====================================================================
   SECTION 5 - DAILY, WEEKLY, MONTHLY
   ---------------------------------------------------------------------
   The employee's own history page, in the three shapes they ask for.

   All three are the SAME days grouped differently, which is why there
   is one function and a key-builder rather than three queries. A weekly
   row is the sum of its days by construction, so the three views can
   never disagree with each other.

   A WEEK OR MONTH WITH NOTHING IN IT STILL APPEARS, for the reason
   fillMonthBuckets() gives in dashboardStats.js: a chart that skips the
   quiet periods draws a straight line from May to July and tells the
   reader a lie about June.
   ===================================================================== */
export const bucketDays = (days, period, policy) => {
  if (period === "daily") {
    /*
      A daily view is not a bucket - it IS the days. Summarising each
      one would produce a row per day whose "workingDays" is 1, which
      is noise; the day objects already carry everything the table
      draws.
    */
    return days.map((day) => ({
      key: day.dateKey,
      label: formatDateKey(day.dateKey),
      ...day,
    }));
  }

  const keyOf = (dateKey) =>
    period === "weekly" ? startOfWeekKey(dateKey) : monthKeyOfDateKey(dateKey);

  const labelOf = (key) =>
    period === "weekly"
      ? `${formatDateKey(key)} - ${formatDateKey(addDaysToDateKey(key, 6))}`
      : formatMonthKey(key);

  const buckets = new Map();

  days.forEach((day) => {
    const key = keyOf(day.dateKey);

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    buckets.get(key).push(day);
  });

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, bucketDaysList]) => ({
      key,
      label: labelOf(key),
      ...summariseDays(bucketDaysList, policy),
    }));
};

/* =====================================================================
   SECTION 6 - A WHOLE TEAM
   ---------------------------------------------------------------------
   One row per employee, each judged by their own department's policy.

   This is what the team board draws, what the top-performer list is
   sorted from, and what the employee export writes - one function, so
   the number on the board and the number in the spreadsheet are the
   same number.
   ===================================================================== */
export const summariseEmployees = ({
  employees,
  records,
  dateKeys,
  calendar,
  policyMap,
  minutesOfDay = null,
  /*
    The per-day calendar is NOT sent to the browser by default. A team
    board of 50 people over 60 days would carry 3000 day objects the
    page never draws - the rows it shows are the summaries.

    The daily EXPORT needs exactly those objects (it is one row per
    employee per day), so it asks for them. One flag rather than a
    second function, because the days have to be built either way to
    produce the summary at all.
  */
  includeDays = false,
}) => {
  return employees.map((employee) => {
    const policy = pickPolicy(policyMap, employee.department?._id || employee.department);

    const joinedKey = employee.dateOfJoining
      ? new Date(employee.dateOfJoining).toISOString().split("T")[0]
      : null;

    const days = buildEmployeeCalendar({
      dateKeys,
      calendar,
      recordFor: (dateKey) => records.get(`${employee._id}|${dateKey}`),
      policy,
      joinedKey,
      minutesOfDay,
    });

    const summary = summariseDays(days, policy);

    return {
      ...(includeDays ? { days } : {}),
      user: {
        _id: employee._id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeId: employee.employeeId,
        designation: employee.designation,
        photoUrl: employee.photoUrl,
        isActive: employee.isActive,
        department: employee.department || null,
      },
      policy: {
        shiftStartMinutes: policy.shiftStartMinutes,
        shiftEndMinutes: policy.shiftEndMinutes,
        breakAllowanceMinutes: policy.breakAllowanceMinutes,
        fullDayMinutes: policy.fullDayMinutes,
      },
      ...summary,
    };
  });
};

/* =====================================================================
   SECTION 7 - A WHOLE DEPARTMENT, AND THE WHOLE COMPANY
   ---------------------------------------------------------------------
   Built by ADDING UP THE EMPLOYEE ROWS rather than by counting the days
   again. That is the point: a department total that is not the sum of
   its own rows is a total somebody will one day have to explain.

   Employees with no department land under one "No department" row
   instead of being thrown away, exactly as getDepartmentPerformance()
   does in Module 5 - a number that quietly ignores some of the data is
   worse than an untidy row.
   ===================================================================== */
export const summariseDepartments = (employeeRows) => {
  const groups = new Map();

  employeeRows.forEach((row) => {
    const department = row.user.department;
    const key = department?._id ? String(department._id) : "none";

    if (!groups.has(key)) {
      groups.set(key, {
        departmentId: department?._id || null,
        name: department?.name || "No department",
        code: department?.code || "-",
        employees: 0,

        workingDays: 0,
        presentDays: 0,
        expectedPresentDays: 0,
        absentDays: 0,
        lateDays: 0,
        halfDays: 0,
        onTimeDays: 0,
        offDayWorkedDays: 0,

        workedMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        expectedMinutes: 0,

        breakCompliantDays: 0,
        overBreakDays: 0,
        autoClosedDays: 0,
        openDays: 0,
      });
    }

    const group = groups.get(key);

    group.employees += 1;

    [
      "workingDays",
      "presentDays",
      "expectedPresentDays",
      "absentDays",
      "lateDays",
      "halfDays",
      "onTimeDays",
      "offDayWorkedDays",
      "workedMinutes",
      "breakMinutes",
      "overtimeMinutes",
      "expectedMinutes",
      "breakCompliantDays",
      "overBreakDays",
      "autoClosedDays",
      "openDays",
    ].forEach((field) => {
      group[field] += row[field] || 0;
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,

      // the same expected-days denominators summariseDays() uses, so a
      // department's rate means what an employee's rate means
      attendanceRate:
        group.workingDays > 0
          ? Math.round((group.expectedPresentDays / group.workingDays) * 100)
          : null,

      punctualityRate:
        group.expectedPresentDays > 0
          ? Math.round((group.onTimeDays / group.expectedPresentDays) * 100)
          : null,

      // the average length of a day somebody actually worked, weekend
      // shifts included - this one really is about every present day
      avgDayMinutes:
        group.presentDays > 0
          ? Math.round(group.workedMinutes / group.presentDays)
          : null,

      /*
        The department's score is worked out from the department's
        TOTALS, not as the average of its employees' scores. Those two
        differ whenever people have different numbers of expected days
        - a joiner with three perfect days would otherwise pull a whole
        department's score up as hard as somebody with a full month.
      */
      ...computePerformanceScore({
        ...group,
        presentDays: group.expectedPresentDays,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/* =====================================================================
   SECTION 8 - THE TOP PERFORMERS
   ---------------------------------------------------------------------
   "Who is the top performing employee in my department?"

   THE FLOOR IS THE IMPORTANT PART. Somebody with two expected days in
   the range can score 100 without having done anything a manager would
   recognise as a good month, and a leaderboard topped by whoever joined
   most recently is a leaderboard nobody looks at twice.

   So a row needs a minimum number of expected days before it can be
   ranked. Everyone else is still on the board and still has a score -
   they simply do not compete for the top of it.

   TIES ARE BROKEN BY PRESENCE, then by hours. Two people on 96 should
   not be ordered by whose name the database happened to return first,
   because the order is the whole message of a ranked list.
   ===================================================================== */
export const MIN_DAYS_TO_RANK = 5;

export const rankPerformers = (employeeRows, limit = 5) => {
  return employeeRows
    .filter(
      (row) => row.score !== null && row.workingDays >= MIN_DAYS_TO_RANK
    )
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.presentDays !== a.presentDays) {
        return b.presentDays - a.presentDays;
      }

      return b.workedMinutes - a.workedMinutes;
    })
    .slice(0, limit);
};

/*
  How many names an admin sees per department. Three, not five: this is
  a page-wide grid of every department at once, and a list long enough
  to need scrolling in each card stops being the glance it exists to be.
*/
export const DEPARTMENT_LEADER_LIMIT = 3;

/*
  THE SAME QUESTION, ASKED ONE DEPARTMENT AT A TIME.

  rankPerformers() above answers "who is top of the people I can see",
  which is the right answer for a MANAGER - the people they can see are
  one department. It is the wrong answer for an ADMIN, whose scope is
  the whole company: a single top-ten across three hundred people is a
  list of whichever department happens to run the tightest shift, and
  the other departments never appear on it at all.

  So the ranking is done INSIDE each department instead. Every
  department gets its own leaders, which is the only version of this
  list that is comparable between teams - a 91 in the warehouse and a 91
  in the office were scored against two different working patterns, and
  putting them in one column implies a comparison neither number
  supports.

  A DEPARTMENT WITH NOBODY RANKABLE STILL GETS A ROW, carrying its
  headcount and an empty `leaders`. Dropping it would make a small
  department silently disappear from the admin's page, which reads as
  "no such department" rather than "nobody here has enough days yet" -
  the same reason summariseDepartments() keeps its "No department" row.

  @param employeeRows from summariseEmployees()
  @param limit        how many names per department
  @returns [{ departmentId, name, code, employees, rankable, leaders }]
           best department first, by its own top score
*/
export const rankPerformersByDepartment = (
  employeeRows,
  limit = DEPARTMENT_LEADER_LIMIT
) => {
  const groups = new Map();

  // grouped exactly as summariseDepartments() groups, so the leaders
  // card and the department table always agree on who is where
  employeeRows.forEach((row) => {
    const department = row.user.department;
    const key = department?._id ? String(department._id) : "none";

    if (!groups.has(key)) {
      groups.set(key, {
        departmentId: department?._id || null,
        name: department?.name || "No department",
        code: department?.code || "-",
        rows: [],
      });
    }

    groups.get(key).rows.push(row);
  });

  return [...groups.values()]
    .map(({ rows, ...department }) => {
      const leaders = rankPerformers(rows, limit);

      return {
        ...department,
        employees: rows.length,
        /*
          How many cleared the floor. The card needs it to tell the two
          empty states apart: "this department has nobody in it" and
          "everybody here joined last week" look identical without it,
          and only one of them is worth doing something about.
        */
        rankable: rows.filter(
          (row) => row.score !== null && row.workingDays >= MIN_DAYS_TO_RANK
        ).length,
        leaders,
      };
    })
    .sort((a, b) => {
      /*
        Departments are ordered by their OWN best score, so the page
        reads as a leaderboard of leaders. A department with nobody
        rankable sorts to the bottom rather than to the top, which a
        plain `?? 0` would have done for anybody scoring zero too.
      */
      const bestOf = (group) =>
        group.leaders.length > 0 ? group.leaders[0].score : -1;

      if (bestOf(b) !== bestOf(a)) {
        return bestOf(b) - bestOf(a);
      }

      return a.name.localeCompare(b.name);
    });
};

/*
  The other end of the same list, and it is deliberately NOT called
  "worst performers".

  A manager needs to know who is drifting, and the honest framing is
  "needs attention" - these are rows to ASK ABOUT, not rows to punish.
  Somebody at 40% attendance is far more likely to be quietly ill, or
  to have a rota nobody updated, than to be a problem employee, and a
  screen that says so keeps a manager pointed at the question instead
  of at a conclusion.
*/
export const rankNeedsAttention = (employeeRows, limit = 5) => {
  return employeeRows
    .filter(
      (row) => row.score !== null && row.workingDays >= MIN_DAYS_TO_RANK
    )
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .filter((row) => row.score < 85);
};

/* =====================================================================
   SECTION 9 - THE TREND
   ---------------------------------------------------------------------
   One point per day for the whole team: how many were present, late or
   absent. It is what the chart on the team board draws.

   Built from the same day objects as everything else, so the chart and
   the table can never tell two different stories.
   ===================================================================== */
export const buildAttendanceTrend = ({
  employees,
  records,
  dateKeys,
  calendar,
  policyMap,
}) => {
  return dateKeys.map((dateKey) => {
    const day = describeDateKey(calendar, dateKey);

    let present = 0;
    let late = 0;
    let absent = 0;

    employees.forEach((employee) => {
      const record = records.get(`${employee._id}|${dateKey}`);

      const joinedKey = employee.dateOfJoining
        ? new Date(employee.dateOfJoining).toISOString().split("T")[0]
        : null;

      if (joinedKey && dateKey < joinedKey) {
        return;
      }

      if (!record) {
        if (day.isWorkingDay) {
          absent += 1;
        }
        return;
      }

      if (record.status === "Late") {
        late += 1;
      } else {
        present += 1;
      }
    });

    return {
      dateKey,
      label: formatDateKey(dateKey).slice(0, 6), // "02 Aug"
      isWorkingDay: day.isWorkingDay,
      reason: day.reason,
      present,
      late,
      absent,
    };
  });
};

/*
  Was this person at work on this day? The one place PRESENT_STATUSES
  is read, so "present" means the same thing in a chart, a rate and an
  export.
*/
export const isPresentStatus = (status) => PRESENT_STATUSES.includes(status);

/*
  Every day in a range, as dateKeys. A thin wrapper so a controller
  never has to import both listDateKeys and the range builder to ask
  one question.
*/
export const expandRange = (from, to) => listDateKeys(from, to);

/*
  The policy resolution a caller needs before summarising: the distinct
  departments of a list of employees.
*/
export const collectDepartmentIds = (employees) => {
  const ids = new Set();

  employees.forEach((employee) => {
    const id = employee.department?._id || employee.department;

    if (id) {
      ids.add(String(id));
    }
  });

  return [...ids];
};
