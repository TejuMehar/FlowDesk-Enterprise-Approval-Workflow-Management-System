/*
=========================================================================
  SETTINGS CONSTANTS   (Module 9 - System Configuration)
=========================================================================
  A frontend copy of the small fixed lists in
  backend/config/settingsConstants.js, plus the helpers the Settings
  page needs to draw a calendar.

  NOTE WHAT IS *NOT* COPIED HERE: the list of timezones and the SMTP
  presets. Those arrive from the backend with the settings themselves
  (GET /api/settings sends an `options` block), the same way the Roles
  page downloads its permission list instead of holding a copy. A list
  the user picks a value from should only exist once, on the side that
  validates it.

  What IS here are the things the UI reasons about rather than offers:
  the weekday names it draws, and the date helpers it formats with.
=========================================================================
*/

/*
  The days of the week, using JavaScript's own numbering - 0 is Sunday,
  exactly like new Date().getDay() and exactly like the numbers stored
  in settings.workingDays.
*/
export const WEEKDAYS = [
  { day: 0, label: "Sunday", short: "Sun" },
  { day: 1, label: "Monday", short: "Mon" },
  { day: 2, label: "Tuesday", short: "Tue" },
  { day: 3, label: "Wednesday", short: "Wed" },
  { day: 4, label: "Thursday", short: "Thu" },
  { day: 5, label: "Friday", short: "Fri" },
  { day: 6, label: "Saturday", short: "Sat" },
];

/*
  "Mon, Tue, Wed, Thu, Fri" - the working week in one line, for the
  summary shown at the top of the card.
*/
export const describeWorkingDays = (workingDays = []) => {
  if (workingDays.length === 0) {
    return "No working days chosen";
  }

  return WEEKDAYS.filter((weekday) => workingDays.includes(weekday.day))
    .map((weekday) => weekday.short)
    .join(", ");
};

/* =====================================================================
   HOLIDAY DATES ARE TEXT, AND THEY STAY TEXT
   ---------------------------------------------------------------------
   A holiday is stored as "2026-01-26", which is the same format an
   <input type="date"> reads and writes. That is not a coincidence -
   it means the value travels from the date picker to MongoDB and back
   without ever being turned into a Date object.

   The moment it became a Date it would belong to a timezone, and
   "26 January" typed in Mumbai would be stored as the 25th in UTC. The
   backend refuses to store it any other way; this file does the same
   so the two never argue.
   ===================================================================== */

/*
  "26 Jan 2026" - only for DISPLAY. Note the "T00:00:00" bolted onto
  the end: without it, browsers parse a bare "2026-01-26" as UTC
  midnight and then print it in local time, which shows the 25th to
  anybody west of Greenwich. With it, the string is parsed as local
  midnight and the date shown is the date typed.
*/
export const formatHolidayDate = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

// "Monday" - which day of the week a holiday falls on
export const holidayWeekday = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return WEEKDAYS[date.getDay()].label;
};

// is this holiday still ahead of us? used to grey out the old ones
export const isUpcoming = (value) => {
  if (!value) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return new Date(`${value}T00:00:00`) >= today;
};

/*
  Today as "YYYY-MM-DD", for the "add a holiday" date input's minimum.

  Built from the local parts rather than toISOString(), which would
  convert to UTC first and hand back yesterday for anybody in a
  timezone ahead of Greenwich late in the evening.
*/
export const todayAsInputDate = () => {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
};

/*
  The two ports worth knowing about, and the "Use TLS" answer each one
  needs. The Settings page uses this to flip the switch automatically
  when an admin types a port, because getting this pair wrong is the
  most common reason correct credentials still cannot send mail.
*/
export const SMTP_PORT_HINTS = {
  465: { secure: true, hint: "Port 465 uses TLS from the start" },
  587: {
    secure: false,
    hint: "Port 587 upgrades the connection itself (STARTTLS), so TLS stays off here",
  },
};
