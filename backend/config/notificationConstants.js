/*
=========================================================================
  NOTIFICATION CONSTANTS   (Module 6 - Notification & Communication)
=========================================================================
  Small fixed lists used by the Notification model, the notification
  service, the reminder engine and (as a matching copy) the React
  frontend.

  Same idea as requestConstants.js and approvalConstants.js: keeping the
  strings in ONE file means the model's `enum` check, the service that
  creates the notifications and the labels in the UI can never drift
  apart.

  WHAT MODULE 6 IS FOR
  --------------------
  Modules 2 to 4 let a request travel from the employee to the last
  approver, but NOBODY WAS EVER TOLD about it. An approver had to open
  the Approvals page and hope something was waiting there, and an
  employee had to keep re-opening their request to see whether anybody
  had answered.

  Module 6 closes that gap in three ways:

    IN-APP   the bell in the navbar, filled by the Notification model
    EMAIL    the same message in the inbox, for the things that matter
    REMINDER a small engine that wakes up on its own and nudges people
             who have been sitting on a request for too long
=========================================================================
*/

/* =====================================================================
   1) THE KINDS OF NOTIFICATION
   ---------------------------------------------------------------------
   The first five are caused by a PERSON doing something. The last three
   are written by the reminder engine, so nobody is their actor.
   ===================================================================== */
export const NOTIFICATION_TYPES = [
  // ---- caused by a person ----
  "NewRequest", // a request arrived at a stage that points at you
  "Approved", // your request was fully approved
  "Rejected", // your request was rejected
  "Returned", // your request came back for a correction
  "NewComment", // somebody wrote on a request you are part of
  /*
    MODULE 12. The one notification in FlowDesk that is not about a
    request at all - which is why the `request` field on the model has
    always been optional, and why deliver() takes it as null.

    It is sent once per employee when payroll PUBLISHES a month, never
    when it is generated: a draft is finance's working copy, and
    telling three hundred people about a number that is still being
    checked is the exact thing the Draft state exists to prevent.
  */
  "SalaryPublished", // your payslip for the month is ready

  // ---- written by the reminder engine ----
  "PendingReminder", // "you have been sitting on this for a while"
  "Escalation", // "your team member has been sitting on this"
  "DailySummary", // "here is what is on your plate today"
];

/*
  The heading shown in the bell dropdown. The MESSAGE underneath is
  written by notificationService.js, because it names the actual request.
*/
export const NOTIFICATION_TITLES = {
  NewRequest: "A request needs your approval",
  Approved: "Your request was approved",
  Rejected: "Your request was rejected",
  Returned: "Your request needs a correction",
  NewComment: "New comment",
  SalaryPublished: "Your payslip is ready",
  PendingReminder: "Reminder: a request is waiting for you",
  Escalation: "A request has been waiting too long",
  DailySummary: "Your daily summary",
};

/*
  WHERE CLICKING THE NOTIFICATION TAKES YOU.

  Anything that asks the user to DECIDE opens the Approvals page;
  anything about their OWN paperwork opens the Requests page.
*/
export const NOTIFICATION_LINKS = {
  NewRequest: "/approvals",
  Approved: "/requests",
  Rejected: "/requests",
  Returned: "/requests",
  NewComment: "/requests",
  // straight to their own Salary page, where the receipt button is
  SalaryPublished: "/salary",
  PendingReminder: "/approvals",
  Escalation: "/approvals",
  DailySummary: "/",
};

/* =====================================================================
   2) WHICH ONES ALSO GO OUT AS AN EMAIL
   ---------------------------------------------------------------------
   Every notification lands in the bell. Only the ones that need the
   person to DO something (or that they would be upset to miss) are also
   emailed, so FlowDesk does not turn into a spam machine.

   "NewComment" is deliberately in-app only: a conversation can be ten
   messages long, and ten emails about it would be unbearable.

   MODULE 12's "SalaryPublished" IS IN-APP ONLY TOO, for a different
   and more careful reason. An email about somebody's pay is a message
   about their money sitting in an inbox, forwarded by a mail server
   FlowDesk does not own, and every step of that is somewhere a payslip
   should not be. The bell tells them it is ready; the document itself
   is only ever downloaded from the application, by them, after logging
   in.
   ===================================================================== */
export const TYPES_THAT_ALSO_EMAIL = [
  "NewRequest",
  "Approved",
  "Rejected",
  "Returned",
  "PendingReminder",
  "Escalation",
  "DailySummary",
];

/* =====================================================================
   3) THE REMINDER ENGINE'S CLOCK
   ---------------------------------------------------------------------
   Every value can be overridden in .env, so a demo can be sped up to
   minutes without touching the code:

       REMINDER_AFTER_HOURS=24
       REMINDER_REPEAT_HOURS=24
       ESCALATION_AFTER_HOURS=72
       DAILY_SUMMARY_HOUR=8
       REMINDER_CHECK_MINUTES=30
       REMINDERS_ENABLED=true

   IT IS A FUNCTION, NOT A LIST OF CONSTANTS, AND THAT MATTERS.
   In an ES module every `import` runs BEFORE the first line of index.js,
   so at the moment this file is loaded dotenv.config() has not run yet
   and process.env is still empty. Reading the values inside a function
   means they are read later, when the engine actually starts - by then
   the .env file is loaded.

   readNumber() also protects us from a typo in the .env file: "abc" or
   an empty value falls back to the default instead of turning the whole
   engine into NaN (which would make it fire on every single tick).
   ===================================================================== */
const readNumber = (value, fallback, lowest = 1) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= lowest ? parsed : fallback;
};

export const getReminderConfig = () => ({
  // how long a request may sit at a stage before we nudge the approver
  remindAfterHours: readNumber(process.env.REMINDER_AFTER_HOURS, 24),

  // how long we wait before nudging the SAME approver again
  repeatEveryHours: readNumber(process.env.REMINDER_REPEAT_HOURS, 24),

  // after this long we stop nudging and tell somebody above them
  escalateAfterHours: readNumber(process.env.ESCALATION_AFTER_HOURS, 72),

  // the hour of the day (0-23, server time) the daily summary goes out.
  // "0" (midnight) is a real answer here, so this one allows zero.
  dailySummaryHour: Math.min(
    Math.floor(readNumber(process.env.DAILY_SUMMARY_HOUR, 8, 0)),
    23
  ),

  // how often the engine wakes up and looks around
  checkEveryMinutes: readNumber(process.env.REMINDER_CHECK_MINUTES, 30),

  /*
    The whole engine can be switched off with REMINDERS_ENABLED=false.
    Useful while developing, so a long debugging session does not fill
    the database with reminders.
  */
  enabled: process.env.REMINDERS_ENABLED !== "false",
});

/* =====================================================================
   4) COMMENTS  (the "Communication" half of the module)
   ===================================================================== */
export const MIN_COMMENT_LENGTH = 1;

export const MAX_COMMENT_LENGTH = 1000;

/*
  How long a person may still delete what they wrote, in minutes.

  A comment is part of the record of an approval - an approver may have
  already read it and decided because of it - so it cannot be removed
  days later. Fifteen minutes is enough to take back a typo or a message
  that landed on the wrong request.
*/
export const COMMENT_DELETE_WINDOW_MINUTES = 15;

/* =====================================================================
   5) SMALL HELPERS SHARED BY THE SERVICE AND THE ENGINE
   ===================================================================== */

// hours -> milliseconds, so the code below reads like a sentence
export const hoursToMs = (hours) => hours * 60 * 60 * 1000;

/*
  "3 days ago", "5 hours ago" ... used in the reminder emails, because
  "waiting since 2026-07-28T09:14:22.031Z" means nothing to a reader.
*/
export const describeWaitingTime = (since) => {
  if (!since) {
    return "a while";
  }

  const minutes = Math.floor((Date.now() - new Date(since).getTime()) / 60000);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
};
