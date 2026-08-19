/*
=========================================================================
  THE ATTENDANCE SERVICE   (Module 11 - Attendance Management)
=========================================================================
  The same job config/approvalEngine.js does for Module 4 and
  config/dashboardStats.js does for Module 5: the CONTROLLER does the
  HTTP work, this file does the thinking.

  It owns FOUR PUNCHES and nothing else:

      clockIn      start the working day
      startBreak   step away
      endBreak     come back
      clockOut     finish the day

  Everything a screen shows about attendance is derived from those four
  moments. There is no fifth verb, and adding one should feel wrong -
  "pause", "resume" and "half day" are all breaks and totals wearing a
  different hat.

  THE FOUR RULES THIS FILE ENFORCES
  ---------------------------------
    1. EVERY MOMENT IS THE SERVER'S. Not one function takes a time from
       the caller. A punch whose timestamp the punching device can
       choose is not evidence of anything.

    2. A DAY IS OPENED ONCE. The unique index on { user, dateKey } is
       the referee, not an `if` - see the race note in clockIn().

    3. THE PUNCHES ARE THE RECORD, THE TOTALS ARE A CACHE. Every path
       ends in recalculate(), which rebuilds every number from the
       punches rather than adjusting the old one.

    4. A GUESS IS ALWAYS LABELLED. The one moment this module invents -
       the shift-end close of a forgotten clock out - sets
       isAutoClosed, and every screen and export shows it.

  HOW ERRORS LEAVE THIS FILE
  --------------------------
  A punch fails for reasons that are the USER'S business ("you are
  already on a break"), not the server's, and answering all of them with
  500 would be a lie. So the refusals below are thrown with a
  `statusCode` on them and the controller reads it - one line there
  instead of an if-ladder around every call.
=========================================================================
*/

import mongoose from "mongoose";

import Attendance from "../model/attendanceModel.js";
import {
  getCalendar,
  getLocalDateKey,
  getLocalMinutesOfDay,
  buildMinutesOfDay,
} from "./workingCalendar.js";
import { getPolicyForUser } from "./attendancePolicyService.js";
import {
  describeDateKey,
  formatMinutes,
  BREAK_TYPES,
  DEFAULT_BREAK_TYPE,
} from "./attendanceConstants.js";

/* =====================================================================
   SECTION 1 - REFUSALS
   ---------------------------------------------------------------------
   A refusal a person can act on: "you have not started your day yet".
   The controller turns the statusCode into the HTTP answer.

   409 (Conflict) rather than 400 for most of them, and the difference
   is worth keeping: 400 means the request was malformed, 409 means the
   request was perfectly well formed and the world is not in a state
   where it makes sense. Pressing "End break" twice is the second thing.
   ===================================================================== */
const refuse = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isAttendanceRefusal = true;

  return error;
};

/* =====================================================================
   SECTION 2 - THE CONTEXT OF A PUNCH
   ---------------------------------------------------------------------
   Everything the four verbs need, worked out once:

     now          the server's clock, the only one we trust
     dateKey      which day that is AT THE COMPANY
     minutesOfDay a synchronous "how many minutes past local midnight"
     policy       the working pattern for this person's department
     day          is anybody supposed to be at work today?

   Fetching it once per punch and passing it down is what keeps
   recalculate() synchronous and keeps the timezone question in exactly
   one place.
   ===================================================================== */
export const buildPunchContext = async (user, at = new Date()) => {
  const calendar = await getCalendar();
  const policy = await getPolicyForUser(user);

  const dateKey = getLocalDateKey(at, calendar.timezone);

  return {
    now: at,
    calendar,
    dateKey,
    policy,
    minutesOfDay: (date) => getLocalMinutesOfDay(date, calendar.timezone),
    day: describeDateKey(calendar, dateKey),
  };
};

/*
  The seven numbers a record is JUDGED by, copied out of the resolved
  policy at the moment the day is opened.

  See the note on appliedPolicy in model/attendanceModel.js for why a
  record freezes them instead of following the live policy.
*/
const freezePolicy = (policy) => ({
  shiftStartMinutes: policy.shiftStartMinutes,
  shiftEndMinutes: policy.shiftEndMinutes,
  fullDayMinutes: policy.fullDayMinutes,
  halfDayMinutes: policy.halfDayMinutes,
  graceMinutes: policy.graceMinutes,
  breakAllowanceMinutes: policy.breakAllowanceMinutes,
  overtimeAfterMinutes: policy.overtimeAfterMinutes,
});

/* =====================================================================
   SECTION 3 - WHERE IS THIS PERSON RIGHT NOW?
   ---------------------------------------------------------------------
   The live reading of a record: the state, the running clock, and what
   is left of the break allowance.

   NOTHING HERE IS STORED. It is all computed from clockInAt,
   clockOutAt and the breaks array on every read, so it can never
   disagree with them - the reason there is no `isOnBreak` field in the
   model.

   THE RUNNING TOTALS ARE THE INTERESTING PART. A finished day has its
   worked minutes on the document; an OPEN day deliberately stores zero
   (see recalculate) because a stored "so far" is stale the instant it
   is written. The screen still needs a number, so it is worked out
   here, at the moment somebody asks.
   ===================================================================== */
export const describeState = (record, { now = new Date(), minutesOfDay }) => {
  if (!record) {
    return {
      state: "NotStarted",
      openBreak: null,
      liveWorkedMinutes: 0,
      liveBreakMinutes: 0,
      currentBreakMinutes: 0,
    };
  }

  const openBreak = record.breaks.find((entry) => !entry.endedAt) || null;

  const currentBreakMinutes = openBreak
    ? Math.max(0, Math.round((now.getTime() - openBreak.startedAt.getTime()) / 60000))
    : 0;

  /*
    The break time so far INCLUDES the one still running, unlike the
    stored total which deliberately excludes it. The stored number
    feeds reports, where a half-finished break would corrupt a sum; this
    one feeds a screen, where a break timer that does not move is
    simply broken.
  */
  const liveBreakMinutes = record.breakMinutes + currentBreakMinutes;

  if (record.clockOutAt) {
    return {
      state: "Finished",
      openBreak: null,
      liveWorkedMinutes: record.workedMinutes,
      liveBreakMinutes: record.breakMinutes,
      currentBreakMinutes: 0,
    };
  }

  const grossMinutes = Math.max(
    0,
    Math.round((now.getTime() - record.clockInAt.getTime()) / 60000)
  );

  return {
    state: openBreak ? "OnBreak" : "Working",
    openBreak,
    liveWorkedMinutes: Math.max(0, grossMinutes - liveBreakMinutes),
    liveBreakMinutes,
    currentBreakMinutes,
  };
};

// 552 -> "09:12", the company's own wall clock
const formatClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;

/*
  One record, in the shape every screen in this module reads.

  Written once, here, so the punch card, the history table, the team
  board and the correction dialog all describe a day with the same
  words - and so adding a field to a day means touching one function.
*/
export const presentRecord = (record, context) => {
  if (!record) {
    return null;
  }

  const live = describeState(record, context);
  const minutesOfDay = context.minutesOfDay;

  return {
    _id: record._id,
    dateKey: record.dateKey,

    clockInAt: record.clockInAt,
    clockOutAt: record.clockOutAt,

    // "09:12" at the company, so a screen never has to redo the timezone
    clockInClock: minutesOfDay
      ? formatClock(minutesOfDay(record.clockInAt))
      : null,
    clockOutClock:
      record.clockOutAt && minutesOfDay
        ? formatClock(minutesOfDay(record.clockOutAt))
        : null,

    status: record.status,
    state: live.state,

    workedMinutes: record.clockOutAt ? record.workedMinutes : live.liveWorkedMinutes,
    breakMinutes: record.clockOutAt ? record.breakMinutes : live.liveBreakMinutes,
    overtimeMinutes: record.overtimeMinutes,
    lateMinutes: record.lateMinutes,
    earlyLeaveMinutes: record.earlyLeaveMinutes,
    overBreakMinutes: record.overBreakMinutes,

    breaks: record.breaks.map((entry) => ({
      _id: entry._id,
      type: entry.type,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      minutes: entry.endedAt ? entry.minutes : live.currentBreakMinutes,
      isRunning: !entry.endedAt,
      note: entry.note,
    })),

    // the three honesty flags - see model/attendanceModel.js
    isAutoClosed: record.isAutoClosed,
    correctedAt: record.correctedAt,
    correctionReason: record.correctionReason,

    note: record.note,
    appliedPolicy: record.appliedPolicy,
  };
};

/* =====================================================================
   SECTION 4 - THE FORGOTTEN CLOCK OUT
   ---------------------------------------------------------------------
   People close the laptop and go home. That is not a bug to be
   defended against, it is Friday, and an attendance system that has no
   answer for it accumulates open records for ever - and then has to
   decide, at some random later moment, what a day two weeks ago meant.

   So before anything else is done for a user, yesterday's open days are
   closed AT THE SHIFT END OF THEIR OWN POLICY.

   WHY THE SHIFT END, AND NOT MIDNIGHT OR THE LAST BREAK
   -----------------------------------------------------
   Midnight would credit fifteen hours to somebody who went home at
   six. The shift end is the only defensible guess: it is the hours the
   company asked for, so the system neither invents overtime nor
   punishes an employee for a punch they did not make.

   And it is a GUESS, so it is labelled. isAutoClosed rides on the
   record from here to the report, and every screen shows it - a day the
   system closed and a day an employee closed must never look the same.

   THE INSTANT IS BUILT FROM THE PUNCH, NOT FROM A CALENDAR
   -------------------------------------------------------
      close = clockIn + (shiftEnd - the minute of day the punch landed on)

   which lands exactly on the shift end of THAT local day, without
   parsing a date, without knowing the offset, and without caring
   whether the country changed its clocks that night.

   A POLICY MAY SWITCH THIS OFF (autoCloseAtShiftEnd: false). Then the
   day stays open and shows up as "missing clock out" for a manager to
   correct by hand - which is the right answer for a company that would
   rather have a gap than an estimate.
   ===================================================================== */
export const autoCloseStaleDays = async (user, context) => {
  // the company would rather have a gap than an estimate
  if (!context.policy.autoCloseAtShiftEnd) {
    return 0;
  }

  const stale = await Attendance.find({
    user: user._id,
    clockOutAt: null,
    dateKey: { $lt: context.dateKey },
  });

  if (stale.length === 0) {
    return 0;
  }

  let closed = 0;

  for (const record of stale) {
    /*
      The record's OWN frozen policy decides, not today's. The day
      belonged to whatever the shift was back then, which is the whole
      reason appliedPolicy exists.
    */
    const shiftEnd = record.appliedPolicy.shiftEndMinutes;
    const startMinute = context.minutesOfDay(record.clockInAt);

    const extraMinutes = Math.max(0, shiftEnd - startMinute);

    const closeAt = new Date(record.clockInAt.getTime() + extraMinutes * 60000);

    // a break left running is closed at the same moment, never later
    const openBreak = record.breaks.find((entry) => !entry.endedAt);

    if (openBreak) {
      openBreak.endedAt = new Date(
        Math.min(closeAt.getTime(), openBreak.startedAt.getTime() + extraMinutes * 60000)
      );
    }

    record.clockOutAt = closeAt;
    record.isAutoClosed = true;

    record.recalculate(context.minutesOfDay);

    await record.save();

    closed += 1;
  }

  return closed;
};

/* =====================================================================
   SECTION 5 - THE FOUR PUNCHES
   ===================================================================== */

/* ---------------------------------------------------------------------
   5a) START WORK
   ---------------------------------------------------------------------
   WORKING ON A HOLIDAY IS ALLOWED, and that is a decision rather than
   an oversight. Support works Sundays, releases happen on public
   holidays, and a system that refuses the punch simply means that work
   goes unrecorded - the one outcome nobody wants. The day is still
   marked as a non-working day in every summary, so the extra shows up
   as exactly what it is: work on a day off.

   THE RACE, AND WHY THE DATABASE SETTLES IT
   -----------------------------------------
   Two tabs, one Monday morning, both pressing Start work. Both read
   "no record for today", both create one. An `if` cannot prevent that -
   between the read and the write there is a gap, and the gap is where
   the second request lives.

   The unique index on { user, dateKey } closes it: the second insert is
   rejected by MongoDB with code 11000, and we read the winner back and
   answer with it. The employee sees one started day, which is the
   truth, instead of an error about something they did nothing wrong to
   cause.
   --------------------------------------------------------------------- */
export const clockIn = async (user, context) => {
  await autoCloseStaleDays(user, context);

  const existing = await Attendance.findOne({
    user: user._id,
    dateKey: context.dateKey,
  });

  if (existing) {
    if (existing.clockOutAt) {
      throw refuse(
        "You have already finished your day. Ask your manager if today needs correcting."
      );
    }

    throw refuse("You have already started work today");
  }

  try {
    const record = new Attendance({
      user: user._id,
      // frozen, not followed - see model/attendanceModel.js
      department: user.department?._id || user.department || null,
      dateKey: context.dateKey,
      clockInAt: context.now,
      /*
        Frozen alongside the policy, and for the same reason: an admin
        who adds Saturday to the working days in September must not
        turn every Saturday shift already worked into an ordinary day.
        It is also what stops a Sunday being marked Late - see the note
        on isWorkingDay in model/attendanceModel.js.
      */
      isWorkingDay: context.day.isWorkingDay,
      appliedPolicy: freezePolicy(context.policy),
    });

    record.recalculate(context.minutesOfDay);

    return await record.save();
  } catch (error) {
    // 11000 = the unique index refused a second day. The other tab won.
    if (error?.code === 11000) {
      return await Attendance.findOne({
        user: user._id,
        dateKey: context.dateKey,
      });
    }

    throw error;
  }
};

/* ---------------------------------------------------------------------
   5b) START A BREAK
   ---------------------------------------------------------------------
   Three refusals, and each one is a real state somebody reaches:

     not clocked in     pressing Break before Start work
     already on break   a second tab, or a double tap
     too many breaks    the policy's ceiling for one day

   THE ALLOWANCE IS NOT ONE OF THEM. Going over the break allowance is
   RECORDED (overBreakMinutes) and reported, never blocked. A system
   that locks somebody out of the break button when they are genuinely
   away from their desk does not create discipline - it creates
   employees who stop pressing the button, and then the data is worth
   nothing. Measuring is the job here; managing is the manager's.
   --------------------------------------------------------------------- */
export const startBreak = async (user, context, { type, note } = {}) => {
  const record = await getOpenDay(user, context);

  if (record.getOpenBreak()) {
    throw refuse("You are already on a break");
  }

  if (record.breaks.length >= context.policy.maxBreaksPerDay) {
    throw refuse(
      `Your department allows ${context.policy.maxBreaksPerDay} breaks a day, and you have taken them all`
    );
  }

  record.breaks.push({
    type: BREAK_TYPES.includes(type) ? type : DEFAULT_BREAK_TYPE,
    startedAt: context.now,
    note: String(note || "").trim().slice(0, 120),
  });

  record.recalculate(context.minutesOfDay);

  return await record.save();
};

/* ---------------------------------------------------------------------
   5c) END A BREAK
   --------------------------------------------------------------------- */
export const endBreak = async (user, context) => {
  const record = await getOpenDay(user, context);

  const openBreak = record.getOpenBreak();

  if (!openBreak) {
    throw refuse("You are not on a break");
  }

  openBreak.endedAt = context.now;

  record.recalculate(context.minutesOfDay);

  await record.save();

  /*
    The one thing worth SAYING back rather than only storing: a break
    that ran past the policy's single-break limit. It is not blocked
    (see the note above), but somebody who stepped away for two hours
    should be told plainly on the way back, rather than finding out
    from their manager's report at the end of the month.
  */
  const warning =
    openBreak.minutes > context.policy.maxSingleBreakMinutes
      ? `That break was ${formatMinutes(openBreak.minutes)}, longer than the ${formatMinutes(
          context.policy.maxSingleBreakMinutes
        )} your department allows in one go.`
      : "";

  return { record, warning };
};

/* ---------------------------------------------------------------------
   5d) END WORK
   ---------------------------------------------------------------------
   A running break is ENDED, not refused.

   Refusing would be defensible and is the wrong call: somebody
   clocking out while still on a break is somebody who forgot to press
   "Back", and the alternative is an error message between them and
   going home. Closing the break at the same instant costs them nothing
   they actually worked, and the break is visible on the record for
   anybody who cares to look.
   --------------------------------------------------------------------- */
export const clockOut = async (user, context, { note } = {}) => {
  const record = await getOpenDay(user, context);

  const openBreak = record.getOpenBreak();

  if (openBreak) {
    openBreak.endedAt = context.now;
  }

  record.clockOutAt = context.now;

  if (note !== undefined) {
    record.note = String(note || "").trim().slice(0, 300);
  }

  record.recalculate(context.minutesOfDay);

  return await record.save();
};

/*
  Today's record, with the two refusals every break and clock-out
  shares. Written once so the three verbs above cannot answer the same
  situation with three different sentences.
*/
const getOpenDay = async (user, context) => {
  const record = await Attendance.findOne({
    user: user._id,
    dateKey: context.dateKey,
  });

  if (!record) {
    throw refuse("You have not started work today yet");
  }

  if (record.clockOutAt) {
    throw refuse("You have already finished your day");
  }

  return record;
};

/* =====================================================================
   SECTION 6 - A MANAGER CORRECTING A DAY
   ---------------------------------------------------------------------
   The escape hatch every attendance system needs and every attendance
   system is judged by: somebody's laptop died, somebody was in a
   customer's office all morning, somebody's clock out is the shift end
   the system guessed.

   WHAT MAY BE CHANGED, AND WHAT MAY NOT
   -------------------------------------
   The two punch times and the break minutes - the facts a person can
   testify to. NOT the status, NOT the worked minutes, NOT the late
   minutes: those are CONCLUSIONS, and letting somebody set a conclusion
   directly would make the record say "Present" over a day with no hours
   in it. Everything derived is rebuilt by recalculate() from the
   corrected punches, exactly as it is for a punched day.

   THE REASON IS REQUIRED. A correction with no reason is
   indistinguishable from a manager rewriting somebody's hours, and this
   is the one write in the module that is not the employee's own action.
   The controller records it in the audit log as well, with the before
   and after - so the correction is itself evidence.
   ===================================================================== */
export const applyCorrection = async (
  record,
  { clockInAt, clockOutAt, breaks, reason },
  correctedBy
) => {
  const minutesOfDay = await buildMinutesOfDay();

  if (clockInAt) {
    record.clockInAt = clockInAt;
  }

  if (clockOutAt !== undefined) {
    record.clockOutAt = clockOutAt;
  }

  if (Array.isArray(breaks)) {
    /*
      Breaks are REPLACED rather than merged. A correction dialog hands
      back the whole list it was showing, so a merge would have to guess
      which of the missing ones were deleted and which were simply not
      sent - and guessing about deletions is how a break quietly comes
      back to life.
    */
    record.breaks = breaks;
  }

  if (record.clockOutAt && record.clockOutAt <= record.clockInAt) {
    throw refuse("The clock out has to be after the clock in", 400);
  }

  /*
    A break outside the working day would produce negative worked
    minutes, which recalculate() would clamp to zero and nobody would
    ever understand. Refusing is the honest answer.
  */
  const outsideDay = record.breaks.some(
    (entry) =>
      entry.startedAt < record.clockInAt ||
      (entry.endedAt && record.clockOutAt && entry.endedAt > record.clockOutAt)
  );

  if (outsideDay) {
    throw refuse("Every break has to fall between the clock in and the clock out", 400);
  }

  record.correctedBy = correctedBy._id;
  record.correctedAt = new Date();
  record.correctionReason = String(reason || "").trim().slice(0, 300);

  /*
    The auto-close flag is CLEARED by a correction, and that is the
    point of correcting one: the day is no longer the system's guess,
    it is a person's statement. The audit entry keeps the fact that it
    once was a guess.
  */
  record.isAutoClosed = false;

  record.recalculate(minutesOfDay);

  return await record.save();
};

/* =====================================================================
   SECTION 7 - WHO IS AT WORK RIGHT NOW?
   ---------------------------------------------------------------------
   The live board a manager opens in the morning. One query, today only,
   for a list of employees.

   It reads the OPEN records rather than every record of the day,
   because "who is here" is a much smaller question than "what happened
   today" and the answer is drawn on a screen somebody is watching.
   ===================================================================== */
export const getLiveBoard = async (memberIds, context) => {
  if (!memberIds || memberIds.length === 0) {
    return [];
  }

  const records = await Attendance.find({
    user: { $in: memberIds },
    dateKey: context.dateKey,
  })
    .populate("user", "firstName lastName employeeId designation photoUrl department")
    .lean();

  return records.map((record) => {
    /*
      A lean document has no methods, so the state is read straight off
      the fields here rather than through describeState(). It is the
      same three facts - a clock out, an open break, neither - and
      keeping it inline avoids rehydrating a mongoose document for a
      list that is only ever displayed.
    */
    const openBreak = record.breaks.find((entry) => !entry.endedAt) || null;

    const currentBreakMinutes = openBreak
      ? Math.max(
          0,
          Math.round((context.now.getTime() - new Date(openBreak.startedAt).getTime()) / 60000)
        )
      : 0;

    const liveBreakMinutes = record.breakMinutes + currentBreakMinutes;

    const grossMinutes = Math.max(
      0,
      Math.round(
        (context.now.getTime() - new Date(record.clockInAt).getTime()) / 60000
      )
    );

    return {
      recordId: record._id,
      user: record.user,
      state: record.clockOutAt ? "Finished" : openBreak ? "OnBreak" : "Working",
      status: record.status,
      clockInAt: record.clockInAt,
      clockOutAt: record.clockOutAt,
      lateMinutes: record.lateMinutes,
      breakMinutes: record.clockOutAt ? record.breakMinutes : liveBreakMinutes,
      workedMinutes: record.clockOutAt
        ? record.workedMinutes
        : Math.max(0, grossMinutes - liveBreakMinutes),
      currentBreakType: openBreak?.type || "",
      currentBreakMinutes,
      isAutoClosed: record.isAutoClosed,
    };
  });
};

/*
  Today's record for one user, as a mongoose document.
  Used by the "my attendance" screen, which needs the methods.
*/
export const getDayRecord = async (userId, dateKey) => {
  return await Attendance.findOne({
    user: userId,
    dateKey,
  });
};

/*
  A guard the correction route needs before it touches anything.
  Kept here rather than in the controller so "is this a real record id"
  and "does it exist" are one question with one answer.
*/
export const findRecordById = async (recordId) => {
  if (!mongoose.Types.ObjectId.isValid(String(recordId))) {
    return null;
  }

  return await Attendance.findById(recordId).populate(
    "user",
    "firstName lastName employeeId department"
  );
};
