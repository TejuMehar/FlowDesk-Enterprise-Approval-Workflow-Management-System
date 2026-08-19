/*
=========================================================================
  CONTROLLER: Settings                            ( the "C" of MVC )
=========================================================================
  Module 9 - System Configuration.

  FUNCTIONS IN THIS FILE
    getPublicSettings  GET     /api/settings/public   (NO LOGIN)
    getSettings        GET     /api/settings
    updateSettings     PUT     /api/settings
    uploadLogo         POST    /api/settings/logo
    removeLogo         DELETE  /api/settings/logo
    updateSmtp         PUT     /api/settings/smtp
    testSmtp           POST    /api/settings/smtp/test

  TWO THINGS IN THIS FILE ARE WORTH READING TWICE
  -----------------------------------------------

  1. THE PUBLIC ROUTE. Everything else in FlowDesk is behind isAuth, and
     getPublicSettings deliberately is not. The login page has to show
     the company name and logo, and that is the exact moment nobody is
     logged in - a branding endpoint behind a login could never brand
     the login. It answers with FOUR harmless fields and nothing else;
     the whole reason it is a separate function rather than a flag on
     getSettings is that the shape of what leaves the building is
     decided in one visible place.

  2. THE SMTP PASSWORD NEVER LEAVES THE SERVER. sanitizeSettings()
     below replaces it with a boolean. Sending it to the browser "so
     the form can show it" would put a live mailbox credential into
     every browser cache, every proxy log and every screenshot of the
     Settings page. The form shows an empty box marked "leave blank to
     keep the current password" instead, which is how every mail
     client has done it for thirty years.
=========================================================================
*/

import Settings from "../model/settingsModel.js";
// MODULE 10 - one shared, path-checked, never-throwing file delete
import { deleteStoredFile } from "../config/fileService.js";
import { PERMISSIONS } from "../config/permissions.js";
import {
  isValidEmployeeIdPart,
  isValidEmail,
} from "../config/validation.js";
import {
  WEEKDAYS,
  COMMON_TIMEZONES,
  COMMON_SMTP_PRESETS,
  MIN_WORKING_DAYS,
  MAX_HOLIDAYS,
  SMTP_SECURE_PORT,
  SMTP_STARTTLS_PORT,
  isValidTimezone,
  isValidHolidayDate,
} from "../config/settingsConstants.js";
import { encryptSecret, decryptSecret, hasSecret } from "../config/secrets.js";
import { clearCalendarCache } from "../config/workingCalendar.js";
import { clearMailCache, sendTestEmail } from "../config/nodemailer.js";
import {
  recordAudit,
  describePerson,
  buildChanges,
} from "../config/auditService.js";

/*
  The settings fields worth a line in the audit log, and how they are
  written in English. Same shape as DEPARTMENT_AUDIT_FIELDS and the
  others - buildChanges() only looks at the fields named here, so a
  save that touched nothing a person would call a change writes no
  entry at all.
*/
const SETTINGS_AUDIT_FIELDS = {
  companyName: "Company name",
  timezone: "Timezone",
  employeeIdPrefix: "Employee ID prefix",
  employeeIdSuffix: "Employee ID suffix",
};

/*
  The SMTP fields, kept apart because they have their own action, their
  own permission and their own route.

  `password` is NOT in this list, and that is not an oversight: an
  audit entry saying 'Password: "hunter2" -> "swordfish"' would take a
  credential that is encrypted in one collection and write it in plain
  text into another - the one collection that is deliberately never
  deleted. The change is recorded as a yes/no further down instead.
*/
const SMTP_AUDIT_FIELDS = {
  enabled: "SMTP enabled",
  host: "SMTP host",
  port: "SMTP port",
  secure: "SMTP secure (TLS)",
  user: "SMTP username",
  fromName: "From name",
  fromEmail: "From address",
};

/* =====================================================================
   WHAT LEAVES THE SERVER
   ---------------------------------------------------------------------
   One function, used by every response in this file, so a new field
   can never accidentally arrive in the browser by being added to the
   model.
   ===================================================================== */
const sanitizeSettings = (settings, canSeeSmtp = true) => {
  const plain = settings.toObject ? settings.toObject() : { ...settings };

  const smtp = plain.smtp || {};

  /*
    An admin WITHOUT settings:smtp does not get the block at all - not
    even the host and the username.

    Hiding only the password would be theatre: "mail.acme.com" plus
    "billing@acme.com" is most of a credential, and it is exactly what
    somebody would need to start guessing the rest. The frontend reads
    this flag to draw a short "you do not have access to this" card
    instead of an empty form.
  */
  if (!canSeeSmtp) {
    return { ...plain, smtp: { visible: false } };
  }

  return {
    ...plain,
    smtp: {
      visible: true,
      enabled: Boolean(smtp.enabled),
      host: smtp.host || "",
      port: smtp.port || SMTP_STARTTLS_PORT,
      secure: Boolean(smtp.secure),
      user: smtp.user || "",
      fromName: smtp.fromName || "",
      fromEmail: smtp.fromEmail || "",

      // the ONLY thing the browser is ever told about the password
      hasPassword: hasSecret(smtp.password),
    },
  };
};

/*
  Every cached copy of the settings, dropped at once.

  Three files keep their own 60 second cache of this document
  (workingCalendar, nodemailer and - indirectly - the request types),
  and an admin who presses Save expects the effect NOW, not within the
  minute. Called from every write below.
*/
const clearSettingsCaches = () => {
  clearCalendarCache();
  clearMailCache();
};

// does the caller hold settings:smtp? decides what sanitizeSettings shows
const canSeeSmtp = (req) =>
  (req.user?.role?.permissions || []).includes(PERMISSIONS.SETTINGS_SMTP);

/* =====================================================================
   1) PUBLIC SETTINGS   (no login)
   ---------------------------------------------------------------------
   GET /api/settings/public

   Four fields, chosen because they are all things a visitor can see on
   the login page anyway - the company's own name and logo. The
   timezone and working days come with them because the React app
   formats dates with them from the first screen.

   Nothing here reveals anything about the company's staff, its data or
   its configuration.
   ===================================================================== */
export const getPublicSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    return res.status(200).json({
      message: "Public settings fetched successfully",
      settings: {
        companyName: settings.companyName || "FlowDesk",
        companyLogo: settings.companyLogo || "",
        timezone: settings.timezone,
        workingDays: settings.workingDays,
      },
    });
  } catch (error) {
    /*
      Even a failure here answers with the defaults rather than an
      error. This is the very first call the React app makes, and a
      login page that will not draw because the branding could not be
      loaded is a worse outcome than a login page that says
      "FlowDesk".
    */
    return res.status(200).json({
      message: "Public settings unavailable, using defaults",
      settings: {
        companyName: "FlowDesk",
        companyLogo: "",
        timezone: "UTC",
        workingDays: [1, 2, 3, 4, 5],
      },
    });
  }
};

/* =====================================================================
   2) GET SETTINGS
   ---------------------------------------------------------------------
   GET /api/settings

   The lists the React page needs to draw its dropdowns travel with the
   settings themselves, so the page is ONE request instead of four -
   the same thing GET /api/role/permissions does for the Roles page.
   ===================================================================== */
export const getSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    return res.status(200).json({
      message: "Settings fetched successfully",
      settings: sanitizeSettings(settings, canSeeSmtp(req)),
      options: {
        weekdays: WEEKDAYS,
        timezones: COMMON_TIMEZONES,
        smtpPresets: COMMON_SMTP_PRESETS,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Settings Error ${error}` });
  }
};

/* =====================================================================
   3) UPDATE SETTINGS
   ---------------------------------------------------------------------
   PUT /api/settings
   body: { companyName, timezone, workingDays, holidays,
           employeeIdPrefix, employeeIdSuffix }

   NOT the SMTP block and NOT the logo - those have their own routes,
   because they have their own permission and their own file handling.

   Every field is optional. The page saves one card at a time, so a
   body carrying only { workingDays } has to leave everything else
   exactly as it was.
   ===================================================================== */
export const updateSettings = async (req, res) => {
  try {
    const {
      companyName,
      timezone,
      workingDays,
      holidays,
      employeeIdPrefix,
      employeeIdSuffix,
    } = req.body;

    const settings = await Settings.getSettings();

    /*
      A COPY OF THE OLD VALUES, TAKEN BEFORE ANYTHING BELOW OVERWRITES
      THEM. toObject() is what makes it a real copy - keeping a
      reference to the document itself would give us the NEW values by
      the time we compared, and every diff would come out empty.
    */
    const before = settings.toObject();

    /* ---------------- company name ---------------- */
    if (companyName !== undefined) {
      if (!companyName || !companyName.trim()) {
        return res.status(400).json({ message: "Company name is required" });
      }

      settings.companyName = companyName.trim();
    }

    /* ---------------- timezone ---------------- */
    if (timezone !== undefined) {
      if (!isValidTimezone(timezone)) {
        return res.status(400).json({
          message: `"${timezone}" is not a timezone this server knows. Use a name like "Asia/Kolkata".`,
        });
      }

      settings.timezone = timezone;
    }

    /* ---------------- working days ---------------- */
    if (workingDays !== undefined) {
      if (!Array.isArray(workingDays)) {
        return res
          .status(400)
          .json({ message: "Working days must be a list of day numbers" });
      }

      /*
        Numbers only, 0 to 6, no duplicates, and sorted so Sunday is
        always first however the checkboxes were clicked.
      */
      const cleaned = [
        ...new Set(
          workingDays
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        ),
      ].sort((a, b) => a - b);

      if (cleaned.length < MIN_WORKING_DAYS) {
        return res.status(400).json({
          message:
            "Choose at least one working day. With none, the reminder engine would never send anything again.",
        });
      }

      settings.workingDays = cleaned;
    }

    /* ---------------- holidays ---------------- */
    if (holidays !== undefined) {
      if (!Array.isArray(holidays)) {
        return res
          .status(400)
          .json({ message: "Holidays must be a list" });
      }

      if (holidays.length > MAX_HOLIDAYS) {
        return res.status(400).json({
          message: `A maximum of ${MAX_HOLIDAYS} holidays can be stored`,
        });
      }

      const cleaned = [];
      const seenDates = new Set();

      for (const holiday of holidays) {
        const name = String(holiday?.name || "").trim();
        const date = String(holiday?.date || "").trim();

        if (!name) {
          return res
            .status(400)
            .json({ message: "Every holiday needs a name" });
        }

        if (!isValidHolidayDate(date)) {
          return res.status(400).json({
            message: `"${date}" is not a valid date for "${name}". Use the format YYYY-MM-DD.`,
          });
        }

        /*
          Two holidays on the same day would be counted once by the
          calendar and listed twice on screen, which reads like a bug
          in the page rather than a mistake in the data.
        */
        if (seenDates.has(date)) {
          return res.status(400).json({
            message: `There are two holidays on ${date}. Keep one of them.`,
          });
        }

        seenDates.add(date);
        cleaned.push({ name, date });
      }

      // sorted by date, because that is the only order a calendar reads in
      cleaned.sort((a, b) => a.date.localeCompare(b.date));

      settings.holidays = cleaned;
    }

    /* ---------------- employee id format (Module 1) ---------------- */
    if (employeeIdPrefix !== undefined) {
      if (!isValidEmployeeIdPart(employeeIdPrefix)) {
        return res.status(400).json({
          message:
            "Employee ID prefix can only contain letters, numbers, '-' and '_'",
        });
      }
      settings.employeeIdPrefix = employeeIdPrefix;
    }

    if (employeeIdSuffix !== undefined) {
      if (!isValidEmployeeIdPart(employeeIdSuffix)) {
        return res.status(400).json({
          message:
            "Employee ID suffix can only contain letters, numbers, '-' and '_'",
        });
      }
      settings.employeeIdSuffix = employeeIdSuffix;
    }

    await settings.save();

    clearSettingsCaches();

    const changes = buildChanges(
      before,
      settings.toObject(),
      SETTINGS_AUDIT_FIELDS
    );

    /*
      MODULE 7 - the audit entry.

      Changing the employee ID prefix silently changes what every
      employee hired from now on is called; changing the working days
      silently changes when the reminder engine speaks. Both are
      exactly the kind of quiet administrative change an audit log
      exists for.

      The two LIST fields get their own lines, because buildChanges()
      can only say "5 item(s) -> 6 item(s)" about an array, and the
      question about a holiday list is always which day moved.
    */
    if (workingDays !== undefined) {
      changes.push({
        field: "Working days",
        from: "",
        to: settings.workingDays
          .map((day) => WEEKDAYS.find((entry) => entry.day === day)?.short || day)
          .join(", "),
      });
    }

    if (holidays !== undefined) {
      changes.push({
        field: "Holidays",
        from: "",
        to: `${settings.holidays.length} day(s) in the calendar`,
      });
    }

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "SettingsUpdated",
        targetType: "Settings",
        targetId: settings._id,
        targetLabel: "System settings",
        changes,
        description: `${describePerson(req.user)} updated the system settings`,
      });
    }

    return res.status(200).json({
      message: "Settings updated successfully",
      settings: sanitizeSettings(settings, canSeeSmtp(req)),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update Settings Error ${error}` });
  }
};

/* =====================================================================
   4) UPLOAD THE COMPANY LOGO
   ---------------------------------------------------------------------
   POST /api/settings/logo   (multipart/form-data, field name "logo")

   It reuses middleware/multer.js - the same 2 MB, images-only upload
   that has handled profile photos since Module 1. A logo is a photo as
   far as a disk is concerned, and a second uploader would be a second
   place to get the file filter wrong.

   THE OLD FILE IS DELETED. Profile photos in Module 1 are kept, and
   the difference is deliberate: a user's old photo may still be
   referenced by something, while there is only ever ONE company logo
   and nothing else points at the file it replaced. Without the delete,
   the uploads folder would collect a dead image every time an admin
   tried a new one.
   ===================================================================== */
export const uploadLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please choose an image file" });
    }

    const settings = await Settings.getSettings();

    const previousLogo = settings.companyLogo;

    settings.companyLogo = `/uploads/${req.file.filename}`;
    await settings.save();

    clearSettingsCaches();

    /*
      Deleting the old file must never break the upload that succeeded,
      so it is wrapped on its own. A leftover file is untidy; a 500
      after the logo was already changed is confusing.
    */
    // MODULE 10 - one shared, path-checked, never-throwing delete
    deleteStoredFile(previousLogo);

    await recordAudit(req, {
      action: "CompanyLogoUpdated",
      targetType: "Settings",
      targetId: settings._id,
      targetLabel: "Company logo",
      changes: [
        { field: "Logo", from: previousLogo || "", to: settings.companyLogo },
      ],
      description: `${describePerson(req.user)} changed the company logo`,
    });

    return res.status(200).json({
      message: "Company logo updated successfully",
      settings: sanitizeSettings(settings, canSeeSmtp(req)),
    });
  } catch (error) {
    return res.status(500).json({ message: `Upload Logo Error ${error}` });
  }
};

/* =====================================================================
   5) REMOVE THE COMPANY LOGO
   ---------------------------------------------------------------------
   DELETE /api/settings/logo

   Back to the built-in FlowDesk mark. There is no "no logo at all"
   state - the sidebar always draws something.
   ===================================================================== */
export const removeLogo = async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    if (!settings.companyLogo) {
      return res.status(400).json({ message: "There is no logo to remove" });
    }

    const previousLogo = settings.companyLogo;

    settings.companyLogo = "";
    await settings.save();

    clearSettingsCaches();

    deleteStoredFile(previousLogo);

    await recordAudit(req, {
      action: "CompanyLogoUpdated",
      targetType: "Settings",
      targetId: settings._id,
      targetLabel: "Company logo",
      changes: [{ field: "Logo", from: previousLogo, to: "" }],
      description: `${describePerson(req.user)} removed the company logo`,
    });

    return res.status(200).json({
      message: "Company logo removed",
      settings: sanitizeSettings(settings, canSeeSmtp(req)),
    });
  } catch (error) {
    return res.status(500).json({ message: `Remove Logo Error ${error}` });
  }
};

/* =====================================================================
   6) UPDATE THE MAIL SERVER
   ---------------------------------------------------------------------
   PUT /api/settings/smtp
   body: { enabled, host, port, secure, user, password, fromName, fromEmail }

   Behind its own permission (settings:smtp) - see config/permissions.js
   for why holding a mailbox credential is not the same level of trust
   as changing the company name.

   AN EMPTY PASSWORD MEANS "KEEP THE ONE YOU HAVE". The form cannot
   show the saved password (it never leaves the server), so an admin
   editing the port would otherwise wipe the password every time they
   pressed Save.
   ===================================================================== */
export const updateSmtp = async (req, res) => {
  try {
    const { enabled, host, port, secure, user, password, fromName, fromEmail } =
      req.body;

    const settings = await Settings.getSettings();

    /*
      The saved block as a PLAIN OBJECT, both for the diff and to edit.
      Working on a copy and assigning it back at the end is what keeps
      an early "return res.status(400)" below from leaving the document
      half-changed in memory.
    */
    const before = settings.smtp?.toObject
      ? settings.smtp.toObject()
      : { ...(settings.smtp || {}) };

    const smtp = { ...before };

    if (host !== undefined) {
      smtp.host = String(host || "").trim();
    }

    if (port !== undefined) {
      const portNumber = Number(port);

      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        return res
          .status(400)
          .json({ message: "Port must be a number between 1 and 65535" });
      }

      smtp.port = portNumber;
    }

    if (secure !== undefined) {
      smtp.secure = Boolean(secure);
    }

    if (user !== undefined) {
      smtp.user = String(user || "").trim();
    }

    if (fromName !== undefined) {
      smtp.fromName = String(fromName || "").trim();
    }

    if (fromEmail !== undefined) {
      const trimmed = String(fromEmail || "").trim();

      if (trimmed && !isValidEmail(trimmed)) {
        return res
          .status(400)
          .json({ message: "The 'from' address is not a valid email address" });
      }

      smtp.fromEmail = trimmed;
    }

    /* ---- the password: only replaced when a new one was typed ---- */
    let passwordChanged = false;

    if (password) {
      smtp.password = encryptSecret(password);
      passwordChanged = true;
    }

    if (enabled !== undefined) {
      smtp.enabled = Boolean(enabled);
    }

    /*
      Switching it ON is the moment to be strict. Half-filled settings
      that sit there disabled harm nobody; half-filled settings that
      are live silently stop every password reset in the company.
    */
    if (smtp.enabled) {
      if (!smtp.host || !smtp.user || !smtp.password) {
        return res.status(400).json({
          message:
            "A host, a username and a password are all needed before the mail server can be switched on",
        });
      }

      /*
        The port/secure pair is the single most common reason correct
        credentials still cannot send mail, so it is checked here
        rather than left to a timeout the admin has to interpret.
      */
      if (smtp.port === SMTP_SECURE_PORT && !smtp.secure) {
        return res.status(400).json({
          message: `Port ${SMTP_SECURE_PORT} needs "Use TLS" switched on`,
        });
      }

      if (smtp.port === SMTP_STARTTLS_PORT && smtp.secure) {
        return res.status(400).json({
          message: `Port ${SMTP_STARTTLS_PORT} needs "Use TLS" switched off - the server upgrades the connection itself (STARTTLS)`,
        });
      }
    }

    settings.smtp = smtp;
    settings.markModified("smtp");

    await settings.save();

    clearSettingsCaches();

    const changes = buildChanges(before, smtp, SMTP_AUDIT_FIELDS);

    /*
      The password change is recorded as a fact, never as a value -
      see the note above SMTP_AUDIT_FIELDS.
    */
    if (passwordChanged) {
      changes.push({
        field: "SMTP password",
        from: "",
        to: "Changed",
      });
    }

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "SmtpUpdated",
        targetType: "Settings",
        targetId: settings._id,
        targetLabel: "Mail server",
        changes,
        description: `${describePerson(req.user)} changed the mail server settings`,
      });
    }

    return res.status(200).json({
      message: "Mail server settings saved",
      settings: sanitizeSettings(settings, canSeeSmtp(req)),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update SMTP Error ${error}` });
  }
};

/* =====================================================================
   7) SEND A TEST EMAIL
   ---------------------------------------------------------------------
   POST /api/settings/smtp/test
   body: { to?, host?, port?, secure?, user?, password? }

   The one place in FlowDesk where a failing mail server is allowed to
   produce an error on screen. Everywhere else a broken mailbox must
   not break the action that caused the email (see sendEmail() in
   config/nodemailer.js) - here the error IS the answer.

   Any field left out falls back to what is saved, so an admin can
   test the settings as they stand, or test a new password before
   committing to it. The address defaults to the admin's own, because
   the question is "does this work?" and the fastest proof is an email
   in your own inbox.
   ===================================================================== */
export const testSmtp = async (req, res) => {
  try {
    const { to, host, port, secure, user, password } = req.body;

    const settings = await Settings.getSettings();

    const saved = settings.smtp || {};

    const recipient = (to || req.user?.email || "").trim();

    if (!isValidEmail(recipient)) {
      return res
        .status(400)
        .json({ message: "Enter a valid address to send the test to" });
    }

    /*
      The typed values win, the saved ones fill the gaps. decryptSecret
      is what turns the stored password back into something a mail
      server will accept - see config/secrets.js.
    */
    const smtp = {
      host: host !== undefined ? String(host).trim() : saved.host,
      port: port !== undefined ? Number(port) : saved.port,
      secure: secure !== undefined ? Boolean(secure) : Boolean(saved.secure),
      user: user !== undefined ? String(user).trim() : saved.user,
      password: password || decryptSecret(saved.password),
      fromName: saved.fromName,
      fromEmail: saved.fromEmail,
    };

    await sendTestEmail({
      smtp,
      to: recipient,
      companyName: settings.companyName,
    });

    /*
      Recorded because it PROVES SOMETHING LATER: a test that
      succeeded at 14:02 and emails that stopped arriving at 14:30
      tell a very different story from a mail server nobody ever
      tested.
    */
    await recordAudit(req, {
      action: "SmtpTested",
      targetType: "Settings",
      targetId: settings._id,
      targetLabel: "Mail server",
      description: `${describePerson(req.user)} sent a test email to ${recipient}`,
    });

    return res.status(200).json({
      message: `Test email sent to ${recipient}. If it does not arrive, check the spam folder.`,
    });
  } catch (error) {
    /*
      nodemailer's own message is far more useful than anything we
      could write ("Invalid login: 535-5.7.8 Username and Password not
      accepted"), so it is passed straight through. 400 and not 500:
      the settings are wrong, the server is fine.
    */
    return res.status(400).json({
      message: `The test email could not be sent: ${error.message}`,
    });
  }
};
