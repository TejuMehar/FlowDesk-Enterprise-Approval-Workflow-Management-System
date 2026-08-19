/*
=========================================================================
  MODEL: Attendance                               ( the "M" of MVC )
=========================================================================
  Module 11 - Attendance Management.

  ONE DOCUMENT = ONE EMPLOYEE, ONE DAY.

  Not one document per punch. That is the first design decision of this
  module and everything else follows from it:

    - "was Ravi at work on Tuesday" is one findOne, not a scan and a
      fold over a stream of events
    - a day can only ever be clocked in once, because the database
      itself refuses a second row (the unique index below)
    - the totals a report needs are already worked out and stored, so
      a month of attendance for a department is a $group over 300 small
      documents rather than a reconstruction of 3000 punches

  THE PRICE, PAID ON PURPOSE
  --------------------------
  Storing totals means they can go stale, so nothing in this module
  ever writes one by hand. Every path goes through recalculate() below,
  which throws the old numbers away and works them out again from the
  punches. A total is a CACHE of the punches, and the punches are the
  record.

  WHAT IS DELIBERATELY NOT HERE
  -----------------------------
  There is no "Absent" document, and there never will be. An absence is
  the absence of a document - see the long note in
  config/attendanceConstants.js. Writing absences would need a nightly
  job, and a nightly job that runs while somebody is on leave, or the
  day after Settings changed which days are worked, leaves rows behind
  that nobody can explain.
=========================================================================
*/

import mongoose from "mongoose";

import {
  STORED_ATTENDANCE_STATUSES,
  BREAK_TYPES,
  DEFAULT_BREAK_TYPE,
} from "../config/attendanceConstants.js";

/* =====================================================================
   SUB-SCHEMA - one break
   ---------------------------------------------------------------------
   A break is OPEN while `endedAt` is null. That is the only way the
   application knows somebody is on a break right now, and it is the
   reason there is no "isOnBreak" flag anywhere in this file: a flag can
   disagree with the data, an absent end time cannot.
   ===================================================================== */
const breakSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: {
        values: BREAK_TYPES,
        message: "{VALUE} is not a valid break type",
      },
      default: DEFAULT_BREAK_TYPE,
    },

    // both stamped by the SERVER - never by the browser
    startedAt: {
      type: Date,
      required: [true, "A break must have a start time"],
    },

    endedAt: {
      type: Date,
      default: null,
    },

    /*
      The length in minutes, stored once the break ends.

      It is derived from the two dates above and could be worked out on
      every read - but a report that sums break time across a whole
      department would then have to do that arithmetic inside an
      aggregation, per break, per day. Storing it turns that into a
      $sum. recalculate() is the only writer.
    */
    minutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: [120, "A break note cannot be more than 120 characters"],
    },
  },
  { _id: true } // the UI needs to point at one break to end or remove it
);

const attendanceSchema = new mongoose.Schema(
  {
    /* ================================================================
       1) WHO, AND WHEN
       ================================================================ */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Attendance must belong to a user"],
    },

    /*
      THE DEPARTMENT IS A SNAPSHOT, NOT A LINK TO FOLLOW.

      It is copied in when the day is first opened, and never updated
      afterwards. That is the opposite of what a join would do, and it
      is the point: when somebody moves from Engineering to Sales in
      June, May's attendance must stay in Engineering's numbers.
      Reading the department off the user document instead would
      silently rewrite last quarter's report the day somebody
      transfers.

      The same reasoning auditModel.js gives for freezing actorName.
    */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    /*
      "2026-08-02" - the day AT THE COMPANY, from
      config/workingCalendar.js.

      Text, not a Date, for the reason spelled out in
      config/attendanceConstants.js: a working day is a day on a
      calendar, and a Date is a moment. It also sorts and groups as
      text exactly as it does as a date, which is what makes the
      weekly and monthly buckets a plain string slice.
    */
    dateKey: {
      type: String,
      required: [true, "Attendance must belong to a calendar day"],
      trim: true,
    },

    /*
      WAS THE COMPANY OPEN ON THIS DAY?

      Frozen at the moment the day is opened, exactly like the
      department and the policy above, and for the third time for the
      same reason: an admin who adds Saturday to the working days in
      September must not turn every Saturday shift somebody has ever
      worked into a normal day retrospectively.

      IT IS ALSO WHAT STOPS A SUNDAY BEING "LATE". A shift start of
      09:00 is a promise about working days; somebody who comes in at
      noon on a Sunday to fix something has not broken it, because
      there was nothing to be late for. Without this field
      recalculate() had no way to know the difference, and the first
      person to work a weekend was marked Late for it - which is close
      to the worst thing an attendance system can say to somebody who
      gave up their Sunday.
    */
    isWorkingDay: {
      type: Boolean,
      /*
        NO DEFAULT, ON PURPOSE, and it is the one field in this schema
        that deliberately has none.

        A default of `true` would be applied by mongoose when it reads a
        document written before this field existed - so every one of
        those rows would come back claiming to be a working day, and a
        Sunday recorded last month would silently become an ordinary
        Monday in every rate built on it.

        Left undefined, an old row admits it does not know, and
        buildEmployeeCalendar() falls back to the working calendar -
        which is what those rows were judged by at the time anyway.
        Every new record sets it explicitly in clockIn().
      */
    },

    /* ================================================================
       2) THE PUNCHES
       ================================================================ */

    clockInAt: {
      type: Date,
      required: [true, "Attendance starts at a clock in"],
    },

    // null while the employee is still at work
    clockOutAt: {
      type: Date,
      default: null,
    },

    breaks: {
      type: [breakSchema],
      default: [],
    },

    /* ================================================================
       3) THE TOTALS  (all written by recalculate(), never by hand)
       ================================================================ */

    // clockOut - clockIn - every finished break
    workedMinutes: { type: Number, default: 0, min: 0 },

    breakMinutes: { type: Number, default: 0, min: 0 },

    // work beyond the policy's overtime threshold
    overtimeMinutes: { type: Number, default: 0, min: 0 },

    /*
      How far SHORT of a full day the day fell. The honest counterpart
      of overtimeMinutes, and the two can never both be positive.

      It exists because the status alone is too blunt to act on: a
      manager looking at a "Half day" wants to know whether it was
      twenty minutes or four hours, and every screen subtracting that
      for itself is four places to get it wrong.
    */
    shortfallMinutes: { type: Number, default: 0, min: 0 },

    /*
      How late the clock in was, past the grace period. 0 means on
      time, and there is no negative version: arriving an hour early is
      not a number anybody manages by, and storing it would invite a
      "most eager employee" chart nobody asked for.
    */
    lateMinutes: { type: Number, default: 0, min: 0 },

    // how long before the shift end the employee clocked out
    earlyLeaveMinutes: { type: Number, default: 0, min: 0 },

    // break time beyond the policy's allowance, for the break report
    overBreakMinutes: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: {
        values: STORED_ATTENDANCE_STATUSES,
        message: "{VALUE} is not a valid attendance status",
      },
      default: "Present",
    },

    /* ================================================================
       4) THE POLICY THIS DAY WAS JUDGED BY
       ----------------------------------------------------------------
       Frozen into the record, for the same reason the department is.

       A manager who lengthens the break allowance in September must
       not turn every day in August from "over the allowance" into
       "fine". Judging an old day by a new rule is how an attendance
       system loses the trust of the people it measures, and it can
       never be argued with afterwards because the old rule is gone.

       Only the four numbers a record is actually JUDGED by are kept.
       The rest of the policy (how many breaks are allowed, whether to
       auto close) shapes what may HAPPEN, not what a finished day
       means, so freezing it would preserve nothing.
       ================================================================ */
    appliedPolicy: {
      shiftStartMinutes: { type: Number, default: 540 },
      shiftEndMinutes: { type: Number, default: 1080 },
      fullDayMinutes: { type: Number, default: 480 },
      halfDayMinutes: { type: Number, default: 240 },
      graceMinutes: { type: Number, default: 15 },
      breakAllowanceMinutes: { type: Number, default: 60 },
      overtimeAfterMinutes: { type: Number, default: 480 },
    },

    /* ================================================================
       5) HOW HONEST IS THIS ROW?
       ----------------------------------------------------------------
       Three fields that all answer the same question: did a person
       punch this, or did somebody (or something) decide it for them?

       An attendance record is evidence. A row that was corrected by a
       manager and a row that an employee clocked themselves must never
       look identical on screen, or the corrections become invisible -
       which is exactly the abuse an attendance system has to be able
       to rule out.
       ================================================================ */

    // true when a forgotten clock out was closed at the shift end
    isAutoClosed: {
      type: Boolean,
      default: false,
    },

    // set when a manager edited the times by hand
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    correctedAt: {
      type: Date,
      default: null,
    },

    /*
      WHY it was corrected. Required by the controller (not by the
      schema, so an old row without one still loads) - a correction
      with no reason is indistinguishable from a manager rewriting
      somebody's hours.
    */
    correctionReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "A correction reason cannot be more than 300 characters"],
    },

    // whatever the employee wanted to say about the day
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "A note cannot be more than 300 characters"],
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   The first one is not an optimisation, it is a RULE: one employee can
   have exactly one record per day. Two browser tabs both pressing
   "Start work" at the same moment is not a rare case - it is Monday
   morning - and only the database can settle that race. The service
   catches the duplicate key error and reads the winner back, so the
   second tab sees the day that was really started.
   ===================================================================== */
attendanceSchema.index({ user: 1, dateKey: 1 }, { unique: true });

// "the whole department, for August" - the query behind every team screen
attendanceSchema.index({ department: 1, dateKey: 1 });

// "one person's month", the employee's own history page
attendanceSchema.index({ user: 1, dateKey: -1 });

/*
  "who is still clocked in?" - the live board, and the query
  autoCloseStaleDays() runs before it. Sparse because a finished day
  has a clockOutAt, so only the handful of open records are indexed.
*/
attendanceSchema.index({ clockOutAt: 1, dateKey: 1 });

/* =====================================================================
   THE ONE FUNCTION THAT WRITES A TOTAL
   ---------------------------------------------------------------------
   Called after every punch, every break and every correction. It never
   trusts a stored number - it throws them all away and rebuilds them
   from clockInAt, clockOutAt and the breaks array.

   That is what keeps the cache honest. A "just add the new break to
   the total" shortcut would be faster and would drift the first time a
   break was edited, a request was retried, or two writes crossed.

   @param minutesOfDay - a function turning a Date into "minutes since
                         local midnight AT THE COMPANY". Passed in
                         rather than imported, because a model must not
                         reach into a service - see the note in
                         config/attendanceService.js.
   ===================================================================== */
attendanceSchema.methods.recalculate = function (minutesOfDay) {
  const policy = this.appliedPolicy;

  /* ---------------- the breaks ---------------- */
  let breakMinutes = 0;

  this.breaks.forEach((entry) => {
    if (!entry.endedAt) {
      /*
        AN OPEN BREAK COUNTS AS ZERO, and that is deliberate.

        Counting the time so far would make the day's worked minutes
        tick DOWNWARDS while somebody is at lunch, and a total that
        goes backwards is a total nobody believes. The screen shows the
        running break separately, and the moment it ends the minutes
        land here properly.
      */
      entry.minutes = 0;
      return;
    }

    entry.minutes = Math.max(
      0,
      Math.round((entry.endedAt.getTime() - entry.startedAt.getTime()) / 60000)
    );

    breakMinutes += entry.minutes;
  });

  this.breakMinutes = breakMinutes;

  this.overBreakMinutes = Math.max(
    0,
    breakMinutes - (policy.breakAllowanceMinutes || 0)
  );

  /* ---------------- how late was the start ----------------
     ONLY ON A DAY THE COMPANY WAS OPEN. See the note on isWorkingDay
     above: a shift start is a promise about working days, and somebody
     who came in at noon on a Sunday has not broken it. */
  const startMinuteOfDay = minutesOfDay(this.clockInAt);

  this.lateMinutes = this.isWorkingDay
    ? Math.max(
        0,
        startMinuteOfDay - (policy.shiftStartMinutes + policy.graceMinutes)
      )
    : 0;

  /* ---------------- the day is still running ---------------- */
  if (!this.clockOutAt) {
    /*
      An open day has NO worked total yet. Not "the minutes so far" -
      that number would be stale the instant it was written, and a
      report run at lunchtime would quietly count half days as whole
      ones. The live figure is computed on read (describeState in
      config/attendanceService.js) and never stored.
    */
    this.workedMinutes = 0;
    this.overtimeMinutes = 0;
    this.earlyLeaveMinutes = 0;
    this.shortfallMinutes = 0;

    // an unfinished day is provisionally whatever the arrival time said
    this.status = this.lateMinutes > 0 ? "Late" : "Present";

    return this;
  }

  /* ---------------- the finished day ---------------- */
  const grossMinutes = Math.max(
    0,
    Math.round((this.clockOutAt.getTime() - this.clockInAt.getTime()) / 60000)
  );

  this.workedMinutes = Math.max(0, grossMinutes - breakMinutes);

  this.overtimeMinutes = Math.max(
    0,
    this.workedMinutes - (policy.overtimeAfterMinutes || policy.fullDayMinutes)
  );

  const endMinuteOfDay = minutesOfDay(this.clockOutAt);

  // and for the same reason, nobody leaves a Sunday early
  this.earlyLeaveMinutes = this.isWorkingDay
    ? Math.max(0, policy.shiftEndMinutes - endMinuteOfDay)
    : 0;

  /*
    HOW SHORT OF A FULL DAY, so the shortfall is a number on the record
    rather than something every screen has to subtract for itself. It
    is the honest counterpart of overtimeMinutes, and the two can never
    both be positive.
  */
  this.shortfallMinutes = Math.max(0, policy.fullDayMinutes - this.workedMinutes);

  /* ---------------- and what the day was worth ----------------
     THE LINE IS halfDayMinutes, NOT fullDayMinutes, and the difference
     matters more than it looks.

     Marking anything short of a full day as "HalfDay" would put
     somebody who worked 7h 25m in the same bucket as somebody who
     worked 90 minutes, and would have most of a normal department
     reading as half days by Friday afternoon. Nobody talks that way,
     and a status nobody would use out loud is a status that gets
     ignored.

     So the half day line is the half day line: below it the day did
     not amount to a working day, above it somebody was here. How much
     they were short by is shortfallMinutes, which is a number a
     manager can act on rather than a label.

     There is no status BELOW HalfDay, however short the day. The
     record itself proves somebody was here, and marking it "Absent"
     would be the system contradicting its own evidence.

     The order matters too: presence is the stronger fact and
     punctuality is the modifier on top of it, so a short day is a half
     day even if it started on time, and being late never turns a full
     eight hours into a half day.
  */
  if (this.workedMinutes < policy.halfDayMinutes) {
    this.status = "HalfDay";
  } else {
    this.status = this.lateMinutes > 0 ? "Late" : "Present";
  }

  return this;
};

/*
  The break that has not ended yet, or undefined.
  There can only ever be one - startBreak() refuses a second.
*/
attendanceSchema.methods.getOpenBreak = function () {
  return this.breaks.find((entry) => !entry.endedAt);
};

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;
