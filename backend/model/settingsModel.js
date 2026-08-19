/*
=========================================================================
  MODEL: Settings                                  ( the "M" of MVC )
=========================================================================
  Application-wide configuration. Unlike User/Role/Department, there is
  only ever ONE document in this collection - we always read/write the
  same row instead of picking one by id.

  Module 1 put a single thing in here: the shape of an auto-generated
  employeeId. Module 9 turned it into the home of every answer the
  application used to hard-code:

    companyName / companyLogo   what this FlowDesk is called and the
                                mark it wears (sidebar, login, emails)
    timezone                    the clock the company runs on
    workingDays                 which days are working days
    holidays                    the days that are not, by name
    smtp                        the mail server outgoing email uses
    employeeIdPrefix/Suffix     Module 1, unchanged

  WHERE THE REQUEST TYPES WENT
  ----------------------------
  They are NOT in here. A request type is a row people create, rename
  and delete, so it earned its own collection (requestTypeModel.js).
  This document is for the handful of values a company has exactly one
  of.

  EVERY FIELD HAS A READER
  ------------------------
  See the note at the top of config/settingsConstants.js: a setting
  nothing reads is a promise the application does not keep. The reader
  is named next to each field below.
=========================================================================
*/

import mongoose from "mongoose";
import {
  DEFAULT_WORKING_DAYS,
  DEFAULT_TIMEZONE,
} from "../config/settingsConstants.js";

/* =====================================================================
   SUB-SCHEMA - one holiday
   ---------------------------------------------------------------------
   THE DATE IS TEXT, NOT A Date. "2026-01-26" is a day on a calendar,
   not a moment in time, and only text survives a trip through a
   timezone unchanged. The full reasoning is in settingsConstants.js -
   it is the single most likely bug in this whole module.
   ===================================================================== */
const holidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
      maxlength: [60, "Holiday name cannot be more than 60 characters"],
    },

    // "YYYY-MM-DD", checked by isValidHolidayDate() in the controller
    date: {
      type: String,
      required: [true, "Holiday date is required"],
      trim: true,
    },
  },
  { _id: false } // tiny rows, they do not need their own id
);

/* =====================================================================
   SUB-SCHEMA - the mail server
   ---------------------------------------------------------------------
   Read by config/nodemailer.js, which prefers these values over the
   USER_EMAIL / USER_PASSWORD pair in .env. That order matters: an admin
   who fills this in should not have to also edit a file on the server.
   ===================================================================== */
const smtpSchema = new mongoose.Schema(
  {
    /*
      Switched off, nodemailer.js ignores everything below and falls
      back to .env. So a half-typed mail server cannot break the
      "reset your password" email that people actually need today.
    */
    enabled: { type: Boolean, default: false },

    host: { type: String, trim: true, default: "" },

    port: {
      type: Number,
      default: 587,
      min: [1, "Port must be between 1 and 65535"],
      max: [65535, "Port must be between 1 and 65535"],
    },

    // true for port 465 (implicit TLS), false for 587 (STARTTLS)
    secure: { type: Boolean, default: false },

    // the login for the mail server, usually the full email address
    user: { type: String, trim: true, default: "" },

    /*
      ENCRYPTED, never hashed, and never sent to the browser.

      It cannot be hashed because we have to hand the real thing to the
      mail server - see the long note in config/secrets.js. The
      controller strips it from every response and puts a
      `smtp.hasPassword` boolean there instead.
    */
    password: { type: String, default: "" },

    // what the recipient sees in their inbox: "FlowDesk <noreply@...>"
    fromName: { type: String, trim: true, default: "" },
    fromEmail: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    /* ================================================================
       COMPANY IDENTITY
       ----------------------------------------------------------------
       Read by GET /api/settings/public, which needs NO LOGIN - the
       login page has to know the company name before anybody has
       logged in, which is exactly the moment no token exists.
       ================================================================ */
    companyName: {
      type: String,
      trim: true,
      default: "FlowDesk",
      maxlength: [80, "Company name cannot be more than 80 characters"],
    },

    // "/uploads/1712345678901-logo.png", or "" for the built-in mark
    companyLogo: {
      type: String,
      trim: true,
      default: "",
    },

    /* ================================================================
       THE COMPANY CLOCK AND CALENDAR
       ----------------------------------------------------------------
       Read by config/workingCalendar.js, which the reminder engine
       asks before it nags anybody. Without these three the engine
       cheerfully emails approvers at 3am on Sunday, because a server
       has no idea where it is or what day off means.
       ================================================================ */
    timezone: {
      type: String,
      trim: true,
      default: DEFAULT_TIMEZONE,
    },

    // JavaScript's own numbering: 0 = Sunday ... 6 = Saturday
    workingDays: {
      type: [Number],
      default: DEFAULT_WORKING_DAYS,
    },

    holidays: {
      type: [holidaySchema],
      default: [],
    },

    /* ================================================================
       OUTGOING EMAIL
       ================================================================ */
    smtp: {
      type: smtpSchema,
      default: () => ({}),
    },

    /* ================================================================
       MODULE 1 - THE SHAPE OF AN EMPLOYEE ID
       ----------------------------------------------------------------
       Read by the pre-save hook in userModel.js.
           employeeIdPrefix = "EMP-"  ->  "EMP-0001"
           employeeIdSuffix = ""      ->  (nothing added at the end)
       ================================================================ */

    // goes BEFORE the number, e.g. "EMP-" -> "EMP-0001"
    employeeIdPrefix: {
      type: String,
      trim: true,
      default: "EMP-",
      maxlength: [20, "Prefix cannot be more than 20 characters"],
    },

    // goes AFTER the number, e.g. "-2026" -> "0001-2026"
    employeeIdSuffix: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Suffix cannot be more than 20 characters"],
    },
  },
  {
    timestamps: true,
  }
);

/*
  ---- get the one settings document, creating it if it does not exist yet ----
  upsert:true + setDefaultsOnInsert:true means:
    "find the (only) row; if there is none, create it with the defaults above"

  A database created before Module 9 already has this row, holding only
  the two employeeId fields. Mongoose fills the new fields in with their
  defaults as it reads the document, so an old row behaves like a new
  one without any migration to run.
*/
settingsSchema.statics.getSettings = async function () {
  return this.findOneAndUpdate(
    {},
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const Settings = mongoose.model("Settings", settingsSchema);

export default Settings;
