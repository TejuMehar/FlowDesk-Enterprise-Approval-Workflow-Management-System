/*
=========================================================================
  MODEL: AttendancePolicy                         ( the "M" of MVC )
=========================================================================
  Module 11 - Attendance Management.

  ONE DOCUMENT = THE WORKING PATTERN OF ONE DEPARTMENT.

  Plus exactly one more, with `department: null`, which is the COMPANY
  DEFAULT every department falls back to.

  WHY THIS IS NOT IN settingsModel.js
  -----------------------------------
  Module 9's Settings document is for the values a company has exactly
  ONE of: its name, its timezone, its mail server. A shift is not one of
  those. Support answers the phone from 06:00, the warehouse starts at
  07:00 and the office at 09:30, and a single company-wide shift would
  mark two of those three departments late every morning for ever.

  WHY THE DEPARTMENT MANAGER OWNS IT
  ----------------------------------
  The same argument config/dashboardStats.js makes about "my team":
  being a manager here is a FACT ABOUT THE DATA - a department points at
  you - not a role somebody was granted. So the person who may change
  Engineering's break allowance is whoever Engineering currently calls
  its manager, and the moment they are replaced that ability moves with
  the job, without an admin having to remember to take anything away.

  The COMPANY DEFAULT is the exception, and it needs a real permission
  (attendance:policy) because it reaches every department at once,
  including the ones with no policy of their own.

  A POLICY IS NEVER READ FROM THIS FILE DIRECTLY
  ----------------------------------------------
  Everything goes through config/attendancePolicyService.js, which
  layers department over company over the built-in defaults and caches
  the answer. A controller that read a document from here would get
  `null` for most departments and have to know what to do about it -
  which is exactly the knowledge that belongs in one place.
=========================================================================
*/

import mongoose from "mongoose";

import { DEFAULT_ATTENDANCE_POLICY } from "../config/attendanceConstants.js";

const attendancePolicySchema = new mongoose.Schema(
  {
    /*
      WHICH DEPARTMENT THIS IS FOR.

      null is not "missing", it is a VALUE: the company-wide default.
      The unique index below therefore has to allow exactly one null,
      which is what a plain unique index on a nullable field does in
      MongoDB - two documents with no department would collide, and
      that is the behaviour we want.
    */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      unique: true,
    },

    /* ================================================================
       THE SHIFT
       ----------------------------------------------------------------
       Minutes from local midnight - 540 is 09:00. The reasoning is in
       config/attendanceConstants.js, and the two helpers that turn
       these into "09:00" for a screen live there too.
       ================================================================ */
    shiftStartMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.shiftStartMinutes,
      min: 0,
      max: 24 * 60,
    },

    shiftEndMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.shiftEndMinutes,
      min: 0,
      max: 24 * 60,
    },

    /* ================================================================
       WHAT A DAY OF WORK IS WORTH
       ================================================================ */

    // real work, breaks already removed
    fullDayMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.fullDayMinutes,
      min: 0,
    },

    halfDayMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.halfDayMinutes,
      min: 0,
    },

    // arriving inside this many minutes of the shift start is not late
    graceMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.graceMinutes,
      min: 0,
    },

    /* ================================================================
       THE BREAKS - the reason a manager opens this screen
       ================================================================ */

    // total paid break in one day, across every break taken
    breakAllowanceMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.breakAllowanceMinutes,
      min: 0,
    },

    maxSingleBreakMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.maxSingleBreakMinutes,
      min: 0,
    },

    maxBreaksPerDay: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.maxBreaksPerDay,
      min: 1,
    },

    /* ================================================================
       OVERTIME AND THE FORGOTTEN CLOCK OUT
       ================================================================ */
    overtimeAfterMinutes: {
      type: Number,
      default: DEFAULT_ATTENDANCE_POLICY.overtimeAfterMinutes,
      min: 0,
    },

    autoCloseAtShiftEnd: {
      type: Boolean,
      default: DEFAULT_ATTENDANCE_POLICY.autoCloseAtShiftEnd,
    },

    /* ================================================================
       WHO LAST CHANGED IT
       ----------------------------------------------------------------
       The audit log has the full history (AttendancePolicyUpdated), so
       this is not the record - it is the line the policy screen shows
       above the form, so a manager can see at a glance whether the
       numbers in front of them are theirs or somebody else's.
       ================================================================ */
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const AttendancePolicy = mongoose.model(
  "AttendancePolicy",
  attendancePolicySchema
);

export default AttendancePolicy;
