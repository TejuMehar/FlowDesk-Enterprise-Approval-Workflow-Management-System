/*
=========================================================================
  THE WORKING CALENDAR   (Module 9 - System Configuration)
=========================================================================
  Timezone, working days and holidays are three settings on one screen,
  and on their own they are three dead values in a database. THIS file
  is what makes them mean something.

  It answers two questions, and config/reminderEngine.js is the caller
  that cares:

      isWorkingDay(date)     is anybody at work on this day?
      getLocalHour(date)     what time is it AT THE COMPANY right now?

  WHY THE REMINDER ENGINE NEEDED THIS
  -----------------------------------
  The engine is the one part of FlowDesk that acts on its own, and until
  Module 9 it acted on the SERVER's clock. An Atlas-hosted API running
  in UTC would:

    - send the "daily summary at 8am" at half past one in the afternoon
      to a company in Mumbai, because 8am UTC is 13:30 IST
    - email an approver "you have been sitting on this for two days"
      on Sunday morning, and again on Diwali

  Neither is a bug in the engine. The engine simply had no way to know
  what time it was where the people are. Now it can ask.

  WHAT IS DELIBERATELY NOT DONE HERE
  ----------------------------------
  Reminders are DELAYED by a non-working day, never CANCELLED. A
  request that went quiet on Friday is still waiting on Monday, and the
  engine reminds then - the clock keeps running, only the nagging
  pauses. Silently dropping the reminder would make a weekend a place
  where requests go to be forgotten.

  The waiting-time NUMBERS in the Module 8 reports are also left alone:
  "this took 3 days" there still means three real days. Turning them
  into working days is a genuine feature, but it is a change to what
  every historical report says, and that is a decision to make on
  purpose rather than as a side effect of adding a settings page.
=========================================================================
*/

import Settings from "../model/settingsModel.js";
import {
  DEFAULT_WORKING_DAYS,
  DEFAULT_TIMEZONE,
  isValidTimezone,
} from "./settingsConstants.js";

/*
  The same small cache as requestTypeService.js, and for the same
  reason: the reminder engine asks these questions in a loop over every
  running approval, and the answers change about twice a year.
*/
const CACHE_TTL_MS = 60 * 1000;

let cachedCalendar = null;
let cachedAt = 0;

/*
  What the calendar falls back to when the database cannot be reached.

  This matters more than it looks: getCalendar() is called from inside
  the reminder engine's loop, and an engine that throws stops sending
  reminders for ever. A Monday-to-Friday week in the default timezone
  is a far better answer than an exception.
*/
const FALLBACK_CALENDAR = {
  timezone: DEFAULT_TIMEZONE,
  workingDays: DEFAULT_WORKING_DAYS,
  holidayDates: new Set(),
  holidays: [],
};

export const clearCalendarCache = () => {
  cachedCalendar = null;
  cachedAt = 0;
};

/* =====================================================================
   THE CALENDAR ITSELF
   ---------------------------------------------------------------------
   Holidays become a Set of "YYYY-MM-DD" strings, because the only
   question ever asked of them is "is this day in the list?" - which a
   Set answers instantly however many holidays there are.
   ===================================================================== */
export const getCalendar = async () => {
  const now = Date.now();

  if (cachedCalendar && now - cachedAt < CACHE_TTL_MS) {
    return cachedCalendar;
  }

  try {
    const settings = await Settings.getSettings();

    const timezone = isValidTimezone(settings.timezone)
      ? settings.timezone
      : DEFAULT_TIMEZONE;

    const workingDays =
      Array.isArray(settings.workingDays) && settings.workingDays.length > 0
        ? settings.workingDays
        : DEFAULT_WORKING_DAYS;

    const holidays = settings.holidays || [];

    cachedCalendar = {
      timezone,
      workingDays,
      holidayDates: new Set(holidays.map((holiday) => holiday.date)),
      holidays,
    };

    cachedAt = now;

    return cachedCalendar;
  } catch (error) {
    console.error(`Working Calendar Error ${error}`);
    return FALLBACK_CALENDAR;
  }
};

/* =====================================================================
   WHAT DAY IS IT, AT THE COMPANY?
   ---------------------------------------------------------------------
   date.getDay() and date.getHours() answer for the SERVER, which is the
   whole problem. Intl.DateTimeFormat is the only thing in plain node
   that can re-read the same instant in another timezone, so both
   helpers below go through it.

   "en-CA" is not a decoration: that locale formats a date as
   "2026-01-26", which is already the exact "YYYY-MM-DD" shape the
   holidays are stored in. Any other locale would need reassembling by
   hand.
   ===================================================================== */

// "2026-01-26" - the calendar day this instant falls on, at the company
export const getLocalDateKey = (date, timezone) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

// 0 = Sunday ... 6 = Saturday, at the company
export const getLocalWeekday = (date, timezone) => {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);

  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return order.indexOf(short);
};

/* ---------------------------------------------------------------------
   MODULE 11 NEEDED A FINER READING OF THE SAME CLOCK.

   getLocalHour() below answers "is it 8am yet?", which is all the
   reminder engine ever wanted. Attendance has to answer "how many
   minutes past the start of the shift was this punch?", and an hour is
   far too coarse for that - arriving at 09:59 and at 09:01 would be the
   same fact.

   So this returns MINUTES SINCE LOCAL MIDNIGHT: 09:30 is 570. It is the
   unit every time in an attendance policy is written in (see
   config/attendanceConstants.js), which means a punch and a shift start
   can be compared by subtracting two integers, with no parsing and no
   Date arithmetic in between.

   It takes the timezone as an argument instead of loading the calendar
   itself, because attendance calls it in a loop - once per punch, per
   day, per employee - and awaiting a cache lookup thousands of times to
   be told the same string is work for nothing. buildMinutesOfDay()
   below is the wrapper that looks the timezone up once and hands back a
   plain synchronous function.
   --------------------------------------------------------------------- */
export const getLocalMinutesOfDay = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type) => Number(parts.find((part) => part.type === type).value);

  return read("hour") * 60 + read("minute");
};

/*
  The timezone looked up once, wrapped in a function that needs no await.

  This is what lets attendanceModel.recalculate() stay synchronous. A
  mongoose document method that had to await a settings lookup would
  drag the whole call chain into async for a value that is the same on
  every one of its iterations.
*/
export const buildMinutesOfDay = async () => {
  const calendar = await getCalendar();

  return (date) => getLocalMinutesOfDay(date, calendar.timezone);
};

// the hour, 0 to 23, at the company
export const getLocalHour = async (date = new Date()) => {
  const calendar = await getCalendar();

  /*
    hourCycle "h23" is what stops midnight coming back as "24". Without
    it the daily summary configured for hour 0 would never fire, which
    is the kind of bug that takes a week to notice.
  */
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: calendar.timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(date);

  return Number(hour);
};

/* =====================================================================
   HOW FAR AHEAD OF UTC IS THE COMPANY, AT THIS INSTANT?
   ---------------------------------------------------------------------
   +5.5 hours for Asia/Kolkata, -4 or -5 for America/New_York depending
   on the month.

   It is MEASURED and not looked up, which is the only way to be right
   about daylight saving without shipping a timezone database: we ask
   Intl what the company's wall clock reads at `date`, then rebuild
   that reading as if it were UTC. The gap between the two IS the
   offset.

   Note that it deliberately does not go anywhere near new Date(string)
   or getHours(). Both of those are interpreted in the SERVER's
   timezone, and a helper whose answer depends on where the server
   happens to be hosted is the exact bug this whole file exists to
   remove.
   ===================================================================== */
const getOffsetMs = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type) => Number(parts.find((part) => part.type === type).value);

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );

  return asIfUtc - date.getTime();
};

/* =====================================================================
   WHEN DID TODAY START, AT THE COMPANY?
   ---------------------------------------------------------------------
   Returns the real instant of local midnight, so a query can ask
   "since the start of today" and mean the company's today.

   The reminder engine's daily summary needs exactly this. Its "have I
   already sent one today?" check used to compare against the SERVER's
   midnight, which is a different moment - and when the summary hour
   happens to straddle server midnight, that gap is enough to send the
   same person two summaries in one working day.

   THE SECOND PASS AT THE BOTTOM
   -----------------------------
   The offset is first measured at UTC midnight, which is not the
   instant we are actually after. On the two days a year a country
   changes its clocks, the offset an hour either side of local midnight
   can differ, so the answer is measured again AT THE CANDIDATE and
   corrected. Everywhere else the second pass changes nothing.
   ===================================================================== */
export const getStartOfLocalDay = async (date = new Date()) => {
  const calendar = await getCalendar();

  // "2026-08-02" -> the numbers of the day the company is having
  const [year, month, day] = getLocalDateKey(date, calendar.timezone)
    .split("-")
    .map(Number);

  const midnightAsIfUtc = Date.UTC(year, month - 1, day);

  const firstGuess = new Date(
    midnightAsIfUtc - getOffsetMs(new Date(midnightAsIfUtc), calendar.timezone)
  );

  return new Date(
    midnightAsIfUtc - getOffsetMs(firstGuess, calendar.timezone)
  );
};

/* =====================================================================
   IS ANYBODY AT WORK?
   ---------------------------------------------------------------------
   Two ways to be "no", and the caller sometimes wants to know which -
   an escalation log line reading "skipped, Republic Day" is far more
   use than "skipped".
   ===================================================================== */
export const describeDay = async (date = new Date()) => {
  const calendar = await getCalendar();

  const dateKey = getLocalDateKey(date, calendar.timezone);
  const weekday = getLocalWeekday(date, calendar.timezone);

  // a holiday beats everything - a company holiday on a Tuesday is a day off
  if (calendar.holidayDates.has(dateKey)) {
    const holiday = calendar.holidays.find((entry) => entry.date === dateKey);

    return {
      isWorkingDay: false,
      reason: holiday?.name || "Holiday",
      dateKey,
    };
  }

  if (!calendar.workingDays.includes(weekday)) {
    return { isWorkingDay: false, reason: "Weekend", dateKey };
  }

  return { isWorkingDay: true, reason: "", dateKey };
};

// the short version, for the callers that only need yes or no
export const isWorkingDay = async (date = new Date()) => {
  const { isWorkingDay: working } = await describeDay(date);
  return working;
};
