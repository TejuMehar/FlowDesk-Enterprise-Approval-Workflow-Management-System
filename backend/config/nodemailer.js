/*
=========================================================================
  EMAIL SENDER  (nodemailer)
=========================================================================
  FlowDesk sends these emails in Module 1:
    1. "Verify your email"
    2. "Reset your password"
    3. "Welcome - here is your temporary password" (when an admin
        creates an account for an employee)
    4. "New employee added" (to the employee's manager + every Admin)
    5. "Employee role changed" (to the employee's manager + every Admin)

  ...and these in Module 6 (Notification & Communication):
    6. "A request needs your approval"      -> to the approvers
    7. "Your request was approved"          -> to the employee
    8. "Your request was rejected"          -> to the employee
    9. "Your request needs a correction"    -> to the employee
   10. "Reminder: a request is waiting"     -> to the approver, by the
                                               reminder engine
   11. "A request has been waiting too long"-> escalation, to the
                                               approver's manager/admins
   12. "Your daily summary"                 -> to everybody with
                                               something on their plate

  The Module 6 mails are all sent through notificationService.js, never
  directly from a controller, so an email and the matching bell entry can
  never disagree with each other.

  ...and one in Module 9 (System Configuration):
   13. "Test email"                          -> to the admin who pressed
                                               the button on the
                                               Settings page

  MODULE 9 CHANGED WHERE THE MAIL SERVER COMES FROM. It used to be
  Gmail, hard-coded. It is now whatever an administrator saved on the
  Settings page, falling back to the .env pair - see the long note
  above getMailConfig() below.

  BEGINNER NOTE:
  If no SMTP server is configured on the Settings page AND
  USER_EMAIL / USER_PASSWORD are empty in your .env file, the app does
  NOT crash. It simply prints the link in the backend terminal so you can
  copy-paste it into the browser and keep testing.
=========================================================================
*/

import nodemailer from "nodemailer";

import Settings from "../model/settingsModel.js";
import { decryptSecret } from "./secrets.js";

/* =====================================================================
   MODULE 9 - WHERE THE MAIL SERVER COMES FROM
   ---------------------------------------------------------------------
   Until Module 9 this file was wired to Gmail: one hard-coded host, one
   hard-coded port, and two variables in .env. A company on Office 365
   could not use FlowDesk without a developer editing this file.

   Now there are TWO sources, and they are tried in this order:

     1. THE DATABASE  - Settings -> SMTP, filled in on the Settings page
     2. .env          - USER_EMAIL / USER_PASSWORD, the Module 1 pair

   The database wins because an administrator can reach it. .env stays
   as the fallback so an existing installation keeps sending email the
   moment it is upgraded, without anybody having to configure anything.

   Below both of them sits the third case that has been here since
   Module 1: NO configuration at all prints the link in the terminal
   instead of crashing, so the project can be run and tested by someone
   who has not set up a mailbox.

   THE CACHE
   ---------
   The settings document would otherwise be read once per email, and
   the daily summary sends one email per employee. 60 seconds, cleared
   by settingsController the moment an admin saves - the same pattern
   as requestTypeService.js and workingCalendar.js.
   ===================================================================== */

const MAIL_CACHE_TTL_MS = 60 * 1000;

let cachedMail = null;
let cachedAt = 0;

export const clearMailCache = () => {
  cachedMail = null;
  cachedAt = 0;
};

/*
  Turns the saved SMTP block into the object nodemailer wants.

  Exported because the "Send test email" button needs to build a
  transporter from settings that have NOT been saved yet - the whole
  point of a test is to try the values before trusting them.
*/
export const buildTransporter = (smtp) => {
  if (!smtp?.host || !smtp?.user || !smtp?.password) {
    return null;
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    /*
      secure:true means the connection is encrypted from the first byte
      (port 465). secure:false does NOT mean plain text - it means
      STARTTLS, where the connection is upgraded a moment later (port
      587). Almost every mail server wants the second one.
    */
    secure: Boolean(smtp.secure),
    auth: {
      user: smtp.user,
      pass: smtp.password,
    },
  });
};

/*
  The mail configuration in force right now: who is sending, from which
  address, and what the company is called.

  Never throws. A database that cannot be reached must not stop a
  password reset - it falls back to .env, exactly as if the admin had
  never configured anything.
*/
const getMailConfig = async () => {
  const now = Date.now();

  if (cachedMail && now - cachedAt < MAIL_CACHE_TTL_MS) {
    return cachedMail;
  }

  let config = {
    transporter: null,
    fromName: "FlowDesk",
    fromEmail: process.env.USER_EMAIL || "",
    companyName: "FlowDesk",
  };

  try {
    const settings = await Settings.getSettings();

    config.companyName = settings.companyName || "FlowDesk";

    const smtp = settings.smtp || {};

    if (smtp.enabled) {
      const transporter = buildTransporter({
        ...smtp.toObject?.() ?? smtp,
        // the stored password is encrypted - see config/secrets.js
        password: decryptSecret(smtp.password),
      });

      if (transporter) {
        config.transporter = transporter;
        config.fromName = smtp.fromName || config.companyName;
        config.fromEmail = smtp.fromEmail || smtp.user;
      }
    }
  } catch (error) {
    console.error(`Mail Config Error ${error}`);
  }

  /* ---- nothing configured on screen -> the Module 1 .env pair ---- */
  if (!config.transporter && process.env.USER_EMAIL && process.env.USER_PASSWORD) {
    config.transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.USER_EMAIL,
        pass: process.env.USER_PASSWORD, // must be a Gmail "App Password"
      },
    });

    config.fromEmail = process.env.USER_EMAIL;
  }

  cachedMail = config;
  cachedAt = now;

  return config;
};

/*
  One HTML template used by every email, so they all look the same.

  MODULE 9: the heading is the COMPANY NAME from the settings, not the
  word "FlowDesk". An employee should get email from the company they
  work for, not from the software the company bought.
*/
const emailTemplate = ({
  title,
  name,
  message,
  buttonText,
  link,
  note,
  brand = "FlowDesk",
}) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0;font-size:22px;color:#0f172a;">${brand}</h1>
      <p style="margin:4px 0 24px;font-size:13px;color:#64748b;">${title}</p>

      <p style="font-size:15px;color:#334155;">Hi ${name},</p>
      <p style="font-size:15px;color:#334155;line-height:1.6;">${message}</p>

      <a href="${link}"
         style="display:inline-block;margin:24px 0;padding:12px 26px;background:#2563eb;
                color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;">
        ${buttonText}
      </a>

      <p style="font-size:13px;color:#64748b;">
        If the button does not work, copy this link into your browser:
      </p>
      <p style="font-size:12px;color:#2563eb;word-break:break-all;">${link}</p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="font-size:12px;color:#94a3b8;">${note}</p>
    </div>
  </div>
`;

/*
  MODULE 9 - every sender below now DESCRIBES its email instead of
  rendering it.

  The reason is one line: the company name is not known until the
  database has been read, and reading the database is asynchronous.
  Building the HTML inside sendEmail() - the only function here that
  already awaits anything - is what lets all twelve emails carry the
  right brand without twelve of them becoming async.

  So this function just hands its argument back, and sendEmail() passes
  it through emailTemplate() a moment later with the brand filled in.
*/
const describeEmail = (parts) => parts;

/*
  The base function every other function below uses.

  IMPORTANT: it never throws. If the mail server is down we only log the
  problem. Otherwise a failing mail server would break "create user",
  even though the user was created correctly.
*/
const sendEmail = async ({ to, subject, template, link }) => {
  try {
    const { transporter, fromName, fromEmail, companyName } =
      await getMailConfig();

    // the company's own name in the heading and in the subject line
    const html = emailTemplate({ ...template, brand: companyName });
    const fullSubject = `${companyName} - ${subject}`;

    // ----- No mail server anywhere -> print the link in the terminal -----
    if (!transporter) {
      console.log("\n---------------- EMAIL (console mode) ----------------");
      console.log("To      :", to);
      console.log("Subject :", fullSubject);
      console.log("Link    :", link);
      console.log("No SMTP server is configured in Settings, and");
      console.log("USER_EMAIL / USER_PASSWORD are empty in .env,");
      console.log("so no real email was sent. Copy the link above.");
      console.log("------------------------------------------------------\n");
      return false;
    }

    // ----- Real email -----
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: fullSubject,
      html,
    });

    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`Send Email Error ${error}`);
    console.error("Link was:", link);
    return false;
  }
};

/* =====================================================================
   MODULE 9 - THE TEST EMAIL
   ---------------------------------------------------------------------
   The Settings page has a "Send test email" button, and it is the only
   sender in this file that is allowed to FAIL LOUDLY.

   Everywhere else a broken mail server must not break the action that
   caused the email, so sendEmail() swallows the error and returns
   false. Here the error IS the answer: an admin who just typed a
   host, a port and a password needs to be told "authentication
   failed", not "something went wrong".

   It also takes the SMTP block as an argument rather than reading the
   saved one, so an admin can test values before committing them.
   ===================================================================== */
export const sendTestEmail = async ({ smtp, to, companyName }) => {
  const transporter = buildTransporter(smtp);

  if (!transporter) {
    throw new Error(
      "The mail server needs a host, a username and a password before it can be tested"
    );
  }

  const brand = companyName || "FlowDesk";

  const html = emailTemplate({
    brand,
    title: "Test email",
    name: "there",
    message: `This is a test message from ${brand}.<br/><br/>
      If you are reading it, the mail server settings are correct and
      FlowDesk can send approval emails, reminders and password resets.`,
    buttonText: "Open FlowDesk",
    link: process.env.CLIENT_URL || "http://localhost:5173",
    note: "You are receiving this because an administrator pressed 'Send test email' on the Settings page.",
  });

  /*
    verify() opens the connection and logs in WITHOUT sending anything.
    Doing it first means a wrong password comes back as a clear
    authentication error instead of a vague send failure.
  */
  await transporter.verify();

  await transporter.sendMail({
    from: `"${smtp.fromName || brand}" <${smtp.fromEmail || smtp.user}>`,
    to,
    subject: `${brand} - Test email`,
    html,
  });

  return true;
};

/*
  1) "Please verify your email address"
  The link opens a PAGE IN THE REACT APP, not the backend.
*/
export const sendVerificationEmail = async (user, rawToken) => {
  const link = `${process.env.CLIENT_URL}/verify-email/${rawToken}`;

  const template = describeEmail({
    title: "Verify your email address",
    name: user.firstName,
    message:
      "Welcome to FlowDesk! Please confirm your email address so you can start using your account.",
    buttonText: "Verify Email",
    link,
    note: "This link expires in 24 hours. If you were not expecting this email you can ignore it.",
  });

  return await sendEmail({
    to: user.email,
    subject: "Verify your email address",
    template,
    link,
  });
};

/*
  2) "Reset your password"
*/
export const sendResetPasswordEmail = async (user, rawToken) => {
  const link = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;

  const template = describeEmail({
    title: "Reset your password",
    name: user.firstName,
    message:
      "We received a request to reset your FlowDesk password. Click the button below to choose a new one.",
    buttonText: "Reset Password",
    link,
    note: "This link expires in 15 minutes. If you did not ask for this, ignore the email - your password stays the same.",
  });

  return await sendEmail({
    to: user.email,
    subject: "Reset your password",
    template,
    link,
  });
};

/*
  3) "Your account is ready" - sent when an ADMIN creates an employee.
  It contains the temporary password so the employee can log in.
*/
export const sendWelcomeEmail = async (user, tempPassword, rawToken) => {
  const link = `${process.env.CLIENT_URL}/verify-email/${rawToken}`;

  const template = describeEmail({
    title: "Your FlowDesk account is ready",
    name: user.firstName,
    message: `An account has been created for you.<br/><br/>
      <b>Email:</b> ${user.email}<br/>
      <b>Temporary password:</b> ${tempPassword}<br/><br/>
      Verify your email with the button below, then log in and change this password.`,
    buttonText: "Verify Email",
    link,
    note: "For your security, please change the temporary password right after your first login.",
  });

  return await sendEmail({
    to: user.email,
    subject: "Welcome",
    template,
    link,
  });
};

/*
  4) "A new employee has been added" - sent to the employee's department
  manager and to every Admin / Super Admin, right after an admin creates
  the account. "recipient" is the manager/admin being emailed, "newUser"
  is the employee who was just created.
*/
export const sendNewEmployeeNotificationEmail = async (recipient, newUser) => {
  const link = `${process.env.CLIENT_URL}/users`;

  const template = describeEmail({
    title: "New employee added",
    name: recipient.firstName,
    message: `A new employee has been added to FlowDesk.<br/><br/>
      <b>Name:</b> ${newUser.firstName} ${newUser.lastName}<br/>
      <b>Email:</b> ${newUser.email}<br/>
      <b>Designation:</b> ${newUser.designation || "-"}<br/>
      <b>Department:</b> ${newUser.department?.name || "-"}`,
    buttonText: "View Employees",
    link,
    note: "You are receiving this email because you manage this employee's department, or are an administrator.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: "New employee added",
    template,
    link,
  });
};

/*
  5) "An employee's role has changed" - sent to the employee's department
  manager and to every Admin / Super Admin, right after an admin assigns
  a new role to the employee.
*/
export const sendRoleChangeNotificationEmail = async (
  recipient,
  targetUser,
  oldRoleName,
  newRoleName
) => {
  const link = `${process.env.CLIENT_URL}/users`;

  const template = describeEmail({
    title: "Employee role changed",
    name: recipient.firstName,
    message: `An employee's role has been changed in FlowDesk.<br/><br/>
      <b>Employee:</b> ${targetUser.firstName} ${targetUser.lastName} (${targetUser.email})<br/>
      <b>Previous role:</b> ${oldRoleName}<br/>
      <b>New role:</b> ${newRoleName}`,
    buttonText: "View Employees",
    link,
    note: "You are receiving this email because you manage this employee's department, or are an administrator.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: "Employee role changed",
    template,
    link,
  });
};

/* =====================================================================
   MODULE 6 - THE APPROVAL EMAILS
   ---------------------------------------------------------------------
   Everything below is sent by config/notificationService.js and
   config/reminderEngine.js. They all reuse the same emailTemplate above,
   so a FlowDesk email always looks like a FlowDesk email.

   Two tiny helpers first, because every one of them needs them.
   ===================================================================== */

// "REQ-0007 - New laptop for the design team"
const requestLine = (request) =>
  `${request?.requestId || "Request"} - ${request?.title || ""}`;

// "Ravi Sharma", or a fallback when the name could not be loaded
const personName = (person, fallback = "somebody") =>
  person ? `${person.firstName} ${person.lastName}`.trim() : fallback;

// where the two Module 6 buttons point
const approvalsLink = () => `${process.env.CLIENT_URL}/approvals`;
const requestsLink = () => `${process.env.CLIENT_URL}/requests`;

/*
  6) "A request needs your approval" - to every approver the request has
  just landed on, the moment the employee presses Submit (or the moment
  the stage before them said yes).
*/
export const sendRequestCreatedEmail = async (
  recipient,
  request,
  requester,
  stageName
) => {
  const link = approvalsLink();

  const template = describeEmail({
    title: "A request needs your approval",
    name: recipient.firstName,
    message: `${personName(requester)} raised a request that is now waiting for you.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>Type:</b> ${request.type}${request.category ? ` (${request.category})` : ""}<br/>
      <b>Priority:</b> ${request.priority}<br/>
      <b>Stage:</b> ${stageName || "-"}`,
    buttonText: "Open Approvals",
    link,
    note: "You are receiving this email because the approval workflow points at you for this stage.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Approval needed: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  7) "Your request was approved" - to the employee, once the LAST stage
  has said yes. The stages in between are not emailed: an employee does
  not need four emails to learn that their laptop was ordered.
*/
export const sendRequestApprovedEmail = async (recipient, request) => {
  const link = requestsLink();

  const template = describeEmail({
    title: "Your request was approved",
    name: recipient.firstName,
    message: `Good news - your request has passed every stage of its approval workflow.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>Type:</b> ${request.type}`,
    buttonText: "View My Requests",
    link,
    note: "You can see who approved it, and when, in the timeline of the request.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Approved: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  8) "Your request was rejected" - to the employee. A rejection is final,
  so the REASON is the most important part of this email.
*/
export const sendRequestRejectedEmail = async (
  recipient,
  request,
  actor,
  comment
) => {
  const link = requestsLink();

  const template = describeEmail({
    title: "Your request was rejected",
    name: recipient.firstName,
    message: `${personName(actor, "An approver")} rejected your request.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>Reason:</b> ${comment || "-"}`,
    buttonText: "View My Requests",
    link,
    note: "A rejected request cannot be submitted again. If the situation has changed, please raise a new one.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Rejected: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  9) "Your request needs a correction" - to the employee. This one is the
  opposite of a rejection: the request is NOT dead, it is sitting back
  with them waiting to be fixed, so the email has to say what to do next.
*/
export const sendRequestReturnedEmail = async (
  recipient,
  request,
  actor,
  comment
) => {
  const link = requestsLink();

  const template = describeEmail({
    title: "Your request needs a correction",
    name: recipient.firstName,
    message: `${personName(actor, "An approver")} sent your request back so you can correct it.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>What to change:</b> ${comment || "-"}`,
    buttonText: "Correct My Request",
    link,
    note: "Edit the request and submit it again - it will then travel through the workflow from the first stage.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Correction needed: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  10) "Reminder: a request is waiting for you" - written by the reminder
  engine when an approver has been sitting on a request for longer than
  REMINDER_AFTER_HOURS.
*/
export const sendPendingReminderEmail = async (
  recipient,
  request,
  requester,
  waitingFor
) => {
  const link = approvalsLink();

  const template = describeEmail({
    title: "A request is still waiting for you",
    name: recipient.firstName,
    message: `This request has been waiting for your decision for <b>${waitingFor}</b>.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>Raised by:</b> ${personName(requester)}<br/>
      <b>Priority:</b> ${request.priority}`,
    buttonText: "Decide Now",
    link,
    note: "This is an automatic reminder. It stops as soon as you approve, reject or return the request.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Reminder: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  11) "A request has been waiting too long" - the ESCALATION. It does not
  go to the approver (they have already been reminded and did nothing);
  it goes to the people above them, so somebody can unblock it.
*/
export const sendEscalationEmail = async (
  recipient,
  request,
  approverNames,
  waitingFor,
  stageName
) => {
  const link = approvalsLink();

  const template = describeEmail({
    title: "A request has been waiting too long",
    name: recipient.firstName,
    message: `A request has been stuck at the same stage for <b>${waitingFor}</b> and needs attention.<br/><br/>
      <b>Request:</b> ${requestLine(request)}<br/>
      <b>Stage:</b> ${stageName || "-"}<br/>
      <b>Waiting for:</b> ${approverNames || "-"}`,
    buttonText: "Open FlowDesk",
    link,
    note: "You are receiving this because you manage this approver's department, or you administer the approval workflows.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: `Escalation: ${requestLine(request)}`,
    template,
    link,
  });
};

/*
  12) "Your daily summary" - one email a day, to everybody who has
  something on their plate. Two short lists instead of one email per
  request, which is the whole point of a summary.

  @param summary - { pendingApprovals: [request...], myRequests: [request...] }
*/
export const sendDailySummaryEmail = async (recipient, summary) => {
  const link = `${process.env.CLIENT_URL}/`;

  // turns a list of requests into "<li>REQ-0007 - New laptop</li>..."
  const listOf = (requests) =>
    requests
      .map(
        (request) =>
          `<li style="margin-bottom:4px;">${requestLine(request)} <span style="color:#94a3b8;">(${request.priority})</span></li>`
      )
      .join("");

  const parts = [];

  if (summary.pendingApprovals.length > 0) {
    parts.push(`<b>Waiting for your decision (${summary.pendingApprovals.length}):</b>
      <ul style="padding-left:18px;margin:8px 0 16px;">${listOf(summary.pendingApprovals)}</ul>`);
  }

  if (summary.myRequests.length > 0) {
    parts.push(`<b>Your requests still travelling (${summary.myRequests.length}):</b>
      <ul style="padding-left:18px;margin:8px 0 16px;">${listOf(summary.myRequests)}</ul>`);
  }

  const template = describeEmail({
    title: "Your daily summary",
    name: recipient.firstName,
    message: `Here is where things stand this morning.<br/><br/>${parts.join("")}`,
    buttonText: "Open FlowDesk",
    link,
    note: "You only receive this email on days when there is actually something on your plate.",
  });

  return await sendEmail({
    to: recipient.email,
    subject: "Your daily summary",
    template,
    link,
  });
};

export default sendEmail;
