/*
=========================================================================
  SETTINGS CONSTANTS   (Module 9 - System Configuration)
=========================================================================
  The fixed lists behind the Settings page: the days of the week, the
  timezones we suggest, and the request types a brand new database is
  seeded with.

  Same idea as requestConstants.js and auditConstants.js - the model's
  validators, the controller's checks and the dropdowns in React all
  read from THIS file, so they can never drift apart.

  WHAT MODULE 9 IS FOR
  --------------------
  Modules 1 to 8 all asked the same silent question and answered it in
  code: what is this company called, when does it work, which kinds of
  request exist, who may do what. Every one of those answers was a
  constant somebody had to edit and redeploy.

  Module 9 moves them into the DATABASE, where an administrator can
  change them, and the audit log records who did.

  THE ONE RULE OF THIS MODULE
  ---------------------------
  A setting must DO something. A form that saves a value nothing ever
  reads is worse than no form at all, because it promises a behaviour
  that does not exist. So every setting here has a reader named next to
  it:

    companyName / companyLogo  ->  the sidebar, the login page, emails
    timezone / workingDays     ->  config/workingCalendar.js, which the
    holidays                       reminder engine asks before nagging
                                   anybody
    smtp                       ->  config/nodemailer.js
    requestTypes               ->  config/requestTypeService.js
    employeeIdPrefix/Suffix    ->  userModel.js (Module 1)
=========================================================================
*/

/* =====================================================================
   1) THE DAYS OF THE WEEK
   ---------------------------------------------------------------------
   The numbers are JavaScript's own: new Date().getDay() returns 0 for
   Sunday and 6 for Saturday. We store the SAME numbers so nothing has
   to be translated between the database and the code.
   ===================================================================== */
export const WEEKDAYS = [
  { day: 0, label: "Sunday", short: "Sun" },
  { day: 1, label: "Monday", short: "Mon" },
  { day: 2, label: "Tuesday", short: "Tue" },
  { day: 3, label: "Wednesday", short: "Wed" },
  { day: 4, label: "Thursday", short: "Thu" },
  { day: 5, label: "Friday", short: "Fri" },
  { day: 6, label: "Saturday", short: "Sat" },
];

// Monday to Friday, the working week of most of the world
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

/*
  A company with NO working days would switch the reminder engine off
  for ever, which is never what somebody meant to do. The controller
  refuses to save an empty list.
*/
export const MIN_WORKING_DAYS = 1;

/* =====================================================================
   2) TIMEZONES
   ---------------------------------------------------------------------
   These are only SUGGESTIONS for the dropdown. The real check is
   isValidTimezone() below, which asks the JavaScript engine itself
   whether it knows the zone - that way an admin in a city we forgot to
   list is not locked out of their own settings.
   ===================================================================== */
export const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Jakarta",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Toronto",
  "Pacific/Auckland",
];

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/*
  Is this a timezone node actually knows?

  Intl.DateTimeFormat throws a RangeError for a name it does not
  recognise, so the try/catch IS the check. Writing our own list of
  every IANA zone would be out of date the next time a country changes
  its mind about daylight saving.
*/
export const isValidTimezone = (timezone) => {
  if (!timezone || typeof timezone !== "string") {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
};

/* =====================================================================
   3) HOLIDAYS
   ---------------------------------------------------------------------
   A HOLIDAY IS A CALENDAR DAY, NOT A MOMENT IN TIME, so it is stored as
   the plain text "2026-01-26" and never as a Date.

   This is worth being stubborn about. A Date is an instant, and an
   instant belongs to a timezone: saving "26 January" from a browser in
   Mumbai stores 2026-01-25T18:30:00Z, and a server reading it back in
   UTC would say the holiday is the 25th. Republic Day does not move
   because the server did.

   Text has no timezone, so it cannot drift.
   ===================================================================== */
export const HOLIDAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/*
  Is this a real "YYYY-MM-DD" day?

  The pattern alone would accept "2026-02-31", so we also build the date
  and check it did not roll over into March.
*/
export const isValidHolidayDate = (value) => {
  if (!HOLIDAY_DATE_PATTERN.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = String(value).split("-").map(Number);

  // Date.UTC keeps this away from the server's own timezone
  const built = new Date(Date.UTC(year, month - 1, day));

  return (
    built.getUTCFullYear() === year &&
    built.getUTCMonth() === month - 1 &&
    built.getUTCDate() === day
  );
};

/*
  A ceiling, for the same reason MAX_EXPORT_ROWS exists in the audit
  module: the holidays live INSIDE the single settings document, and a
  document that grows without limit eventually stops loading.
  Ten years of public holidays is about 150 entries.
*/
export const MAX_HOLIDAYS = 400;

/* =====================================================================
   4) SMTP
   ---------------------------------------------------------------------
   port 465 -> implicit TLS  ("secure" must be true)
   port 587 -> STARTTLS      ("secure" must be false, the server
                              upgrades the connection afterwards)

   Getting this pair wrong is the single most common reason a correct
   username and password still cannot send mail, so the controller
   checks it instead of letting the admin find out from a timeout.
   ===================================================================== */
export const SMTP_SECURE_PORT = 465;
export const SMTP_STARTTLS_PORT = 587;

export const COMMON_SMTP_PRESETS = [
  { name: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  { name: "Outlook / Office 365", host: "smtp.office365.com", port: 587, secure: false },
  { name: "Zoho", host: "smtp.zoho.com", port: 465, secure: true },
  { name: "Brevo (Sendinblue)", host: "smtp-relay.brevo.com", port: 587, secure: false },
  { name: "Mailgun", host: "smtp.mailgun.org", port: 587, secure: false },
  { name: "SendGrid", host: "smtp.sendgrid.net", port: 587, secure: false },
];

/* =====================================================================
   5) THE REQUEST TYPES A NEW DATABASE STARTS WITH
   ---------------------------------------------------------------------
   Until Module 9 this was a frozen array in config/requestConstants.js.
   It is now only a STARTING POINT: "npm run seed" creates these eight
   rows in the requesttypes collection, and from then on the database is
   the truth. An admin can add "Overtime", rename nothing, and delete
   the ones their company never uses.

   needsAmount / needsDates decide which extra fields the React form
   shows - they used to be REQUEST_TYPES_WITH_AMOUNT and
   REQUEST_TYPES_WITH_DATES, two more lists that had to be kept in step
   by hand.
   ===================================================================== */
export const DEFAULT_REQUEST_TYPES = [
  {
    name: "Leave",
    description: "Time off work - sick, casual, earned or unpaid.",
    needsAmount: false,
    needsDates: true,
    categories: [
      "Sick Leave",
      "Casual Leave",
      "Earned Leave",
      "Maternity / Paternity Leave",
      "Unpaid Leave",
    ],
  },
  {
    name: "Purchase",
    description: "Buying something the company does not have yet.",
    needsAmount: true,
    needsDates: false,
    categories: ["Office Supplies", "Equipment", "Furniture", "Other"],
  },
  {
    name: "Expense",
    description: "Money already spent, waiting to be reimbursed.",
    needsAmount: true,
    needsDates: false,
    categories: ["Travel Expense", "Client Entertainment", "Miscellaneous"],
  },
  {
    name: "Travel",
    description: "A trip that has to be approved before it is booked.",
    needsAmount: false,
    needsDates: true,
    categories: ["Domestic Travel", "International Travel"],
  },
  {
    name: "Laptop",
    description: "A new machine, a repair or an upgrade.",
    needsAmount: false,
    needsDates: false,
    categories: ["New Laptop", "Laptop Repair", "Laptop Upgrade"],
  },
  {
    name: "Software",
    description: "Licences and subscriptions.",
    needsAmount: false,
    needsDates: false,
    categories: ["New License", "License Renewal", "Subscription"],
  },
  {
    name: "Budget",
    description: "Money set aside for a project, a team or a campaign.",
    needsAmount: true,
    needsDates: false,
    categories: ["Project Budget", "Department Budget", "Marketing Budget"],
  },
  {
    name: "Custom",
    description: "Anything that does not fit the types above.",
    needsAmount: false,
    needsDates: false,
    categories: ["Other"],
  },
];
