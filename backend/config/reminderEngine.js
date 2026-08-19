/*
=========================================================================
  THE REMINDER ENGINE   (Module 6 - Notification & Communication)
=========================================================================
  Everything else in FlowDesk only happens because somebody clicked
  something. This is the one part of the backend that acts ON ITS OWN.

  It wakes up every REMINDER_CHECK_MINUTES and does three jobs:

    1. PENDING APPROVAL REMINDER
       "You have been sitting on REQ-0007 for 2 days."
       -> to the approvers the request is waiting for

    2. ESCALATION REMINDER
       "REQ-0007 has been stuck at Finance for 4 days."
       -> to the approvers' department managers and to the workflow
          admins. NOT to the approver: they have already been reminded
          and did nothing, so telling them a fourth time is not the
          answer.

    3. DAILY SUMMARY
       "5 requests are waiting for your decision, 2 of yours are still
       travelling." -> once a day, to everybody who has something on
       their plate.

  WHY setInterval AND NOT A CRON LIBRARY
  --------------------------------------
  A cron package (node-cron, agenda, bull...) would be the right answer
  the day FlowDesk runs on several servers at once, because then only
  ONE of them may send the reminders. Until that day an interval inside
  the API process does exactly the same job with no extra dependency and
  nothing new to install or explain.

  WHAT KEEPS IT FROM SPAMMING PEOPLE
  ----------------------------------
  The engine has no memory of its own - it restarts empty every time
  nodemon reloads. So "have I already sent this?" is always answered by
  the DATABASE:

    reminders  -> approval.stages[].lastReminderAt
    escalation -> approval.stages[].escalatedAt (set once, ever)
    summary    -> "is there already a DailySummary notification for this
                   person since midnight?"

  That is why restarting the server ten times in a row does not send
  anybody ten emails.

  MODULE 9 - IT NOW KNOWS WHAT DAY IT IS
  --------------------------------------
  The three jobs above were always right about WHAT to send and wrong
  about WHEN, because a server has no idea where the company is. Every
  tick now starts by asking config/workingCalendar.js, which reads the
  timezone, the working days and the holidays from the Settings page:

    - nothing at all is sent on a weekend or a company holiday
    - the daily summary fires at its hour ON THE COMPANY'S CLOCK

  Nothing is cancelled, only delayed - see the note inside
  runReminderTick() for why that distinction matters.
=========================================================================
*/

import Approval from "../model/approvalModel.js";
import Request from "../model/requestModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import Notification from "../model/notificationModel.js";
import { PERMISSIONS } from "./permissions.js";
import {
  getReminderConfig,
  hoursToMs,
  describeWaitingTime,
} from "./notificationConstants.js";
import { getWaitingApprovers } from "./requestAccess.js";
import {
  describeDay,
  getLocalHour,
  getStartOfLocalDay,
} from "./workingCalendar.js";
import { deliver } from "./notificationService.js";
import {
  sendPendingReminderEmail,
  sendEscalationEmail,
  sendDailySummaryEmail,
} from "./nodemailer.js";

/* =====================================================================
   HELPERS
   ===================================================================== */

/*
  The stage a running approval is standing at, or null.

  The Approval model has a getCurrentStage() method that does the same,
  but it only exists on a real mongoose document. Some of the queries
  below use .lean() for speed, so the engine keeps its own copy.
*/
const currentStageOf = (approval) =>
  approval.stages?.find((stage) => stage.order === approval.currentStage) ||
  null;

/*
  WHO IS ABOVE THIS APPROVER?

  Escalation only helps if it reaches somebody who can actually do
  something, so it goes to two groups:

    - the manager of the department each stuck approver works in
    - every admin who may manage workflows (workflow:read), because a
      request stuck for days is often a broken route, not a lazy person

  Both are looked up fresh every time, so a new admin starts receiving
  escalations without anybody configuring anything.
*/
const findEscalationRecipients = async (approverIds) => {
  const recipients = new Set();

  /* ---- the managers of the departments the approvers work in ---- */
  if (approverIds.length > 0) {
    const approvers = await User.find({
      _id: { $in: approverIds },
      isDeleted: false,
    })
      .select("department")
      .lean();

    const departmentIds = approvers
      .map((approver) => approver.department)
      .filter(Boolean);

    if (departmentIds.length > 0) {
      const departments = await Department.find({
        _id: { $in: departmentIds },
        isDeleted: false,
      })
        .select("manager")
        .lean();

      departments.forEach((department) => {
        if (department.manager) {
          recipients.add(String(department.manager));
        }
      });
    }
  }

  /* ---- every workflow admin ---- */
  const admins = await User.find({ isActive: true, isDeleted: false })
    .select("_id role")
    .populate("role", "permissions")
    .lean();

  admins.forEach((admin) => {
    if ((admin.role?.permissions || []).includes(PERMISSIONS.WORKFLOW_READ)) {
      recipients.add(String(admin._id));
    }
  });

  /*
    A stuck approver who is themselves the department manager would end
    up escalating to themselves, which is pointless.
  */
  approverIds.forEach((approverId) => recipients.delete(String(approverId)));

  return [...recipients];
};

/*
  Loads the running approvals the engine has to look at, with just
  enough of the request and the requester to write a sentence about
  them.

  These are NOT lean: the two reminder jobs write lastReminderAt /
  escalatedAt back onto the stage, so they need real documents.
*/
const findRunningApprovals = async () => {
  return await Approval.find({ status: "InProgress" })
    .populate("request", "requestId title type category priority status isDeleted")
    .populate("requester", "firstName lastName employeeId email");
};

/* =====================================================================
   JOB 1 - PENDING APPROVAL REMINDER
   ---------------------------------------------------------------------
   A stage qualifies when ALL of this is true:

     - the request is really standing there (status Pending)
     - it arrived more than `remindAfterHours` ago
     - the last nudge was more than `repeatEveryHours` ago (or there has
       never been one)
     - it has not been escalated yet - once the case is in somebody
       else's hands, nagging the approver adds nothing

   @returns how many stages were reminded, only for the log line
   ===================================================================== */
export const runPendingApprovalReminders = async () => {
  const config = getReminderConfig();
  const now = Date.now();

  const approvals = await findRunningApprovals();

  let reminded = 0;

  for (const approval of approvals) {
    // a request that was deleted underneath us is nobody's problem now
    if (!approval.request || approval.request.isDeleted) {
      continue;
    }

    const stage = currentStageOf(approval);

    if (!stage || stage.status !== "Pending" || !stage.startedAt) {
      continue;
    }

    const waitedMs = now - new Date(stage.startedAt).getTime();

    if (waitedMs < hoursToMs(config.remindAfterHours)) {
      continue; // not old enough yet
    }

    if (stage.escalatedAt) {
      continue; // somebody above them is already dealing with it
    }

    if (
      stage.lastReminderAt &&
      now - new Date(stage.lastReminderAt).getTime() <
        hoursToMs(config.repeatEveryHours)
    ) {
      continue; // we nudged them recently, give them room
    }

    const waiting = getWaitingApprovers(approval);

    if (waiting.length === 0) {
      continue;
    }

    const waitingFor = describeWaitingTime(stage.startedAt);

    const told = await deliver({
      recipients: waiting,
      type: "PendingReminder",
      request: approval.request._id,
      message: `${approval.request.requestId} - ${approval.request.title} has been waiting for your decision for ${waitingFor}.`,
      sendOneEmail: (user) =>
        sendPendingReminderEmail(
          user,
          approval.request,
          approval.requester,
          waitingFor
        ),
    });

    /*
      The clock is reset even when told === 0 (every approver turned out
      to be deactivated). Otherwise the engine would retry that same
      dead stage on every single tick, forever.
    */
    stage.lastReminderAt = new Date();
    stage.reminderCount += 1;

    await approval.save();

    if (told > 0) {
      reminded += 1;
    }
  }

  return reminded;
};

/* =====================================================================
   JOB 2 - ESCALATION REMINDER
   ---------------------------------------------------------------------
   Same idea, one step further up, and it happens ONCE per stage:
   escalatedAt is set the first time and never cleared, so nobody gets
   the same escalation twice. If the request moves on and comes back
   (after a correction) the stages are rebuilt from the workflow, so the
   new visit starts with a clean slate.
   ===================================================================== */
export const runEscalations = async () => {
  const config = getReminderConfig();
  const now = Date.now();

  const approvals = await findRunningApprovals();

  let escalated = 0;

  for (const approval of approvals) {
    if (!approval.request || approval.request.isDeleted) {
      continue;
    }

    const stage = currentStageOf(approval);

    if (!stage || stage.status !== "Pending" || !stage.startedAt) {
      continue;
    }

    if (stage.escalatedAt) {
      continue; // already escalated once, that is enough
    }

    const waitedMs = now - new Date(stage.startedAt).getTime();

    if (waitedMs < hoursToMs(config.escalateAfterHours)) {
      continue;
    }

    const waiting = getWaitingApprovers(approval);

    const recipients = await findEscalationRecipients(waiting);

    /*
      Even when there is nobody to escalate TO, the stage is marked as
      escalated. The alternative is to try again every half hour for a
      company that simply has no managers set up.
    */
    stage.escalatedAt = new Date();
    await approval.save();

    if (recipients.length === 0) {
      continue;
    }

    // the names of the people everybody is waiting for
    const stuckPeople = await User.find({ _id: { $in: waiting } })
      .select("firstName lastName")
      .lean();

    const approverNames =
      stuckPeople
        .map((person) => `${person.firstName} ${person.lastName}`.trim())
        .join(", ") || "nobody (the stage has no active approver)";

    const waitingFor = describeWaitingTime(stage.startedAt);

    await deliver({
      recipients,
      type: "Escalation",
      request: approval.request._id,
      message: `${approval.request.requestId} - ${approval.request.title} has been stuck at "${stage.name}" for ${waitingFor}, waiting for ${approverNames}.`,
      sendOneEmail: (user) =>
        sendEscalationEmail(
          user,
          approval.request,
          approverNames,
          waitingFor,
          stage.name
        ),
    });

    escalated += 1;
  }

  return escalated;
};

/* =====================================================================
   JOB 3 - DAILY SUMMARY
   ---------------------------------------------------------------------
   One email a day, at DAILY_SUMMARY_HOUR, to everybody who has
   something open. Two lists:

     - the requests waiting for THEIR decision
     - their OWN requests that are still travelling or came back for a
       correction

   Somebody with nothing on either list gets nothing at all. A summary
   that says "you have nothing to do" is the fastest way to teach people
   to ignore FlowDesk emails.

   THE "ALREADY SENT TODAY" CHECK
   ------------------------------
   The engine ticks every half hour, so within the summary hour it would
   run two or three times. Instead of remembering anything in memory
   (which a restart would lose) we ask the database whether a
   DailySummary notification already exists for that person since
   midnight.
   ===================================================================== */
export const runDailySummary = async () => {
  /* ---- 1) who has something waiting for their decision? ---- */
  const approvals = await Approval.find({ status: "InProgress" })
    .populate("request", "requestId title priority isDeleted")
    .lean();

  // userId -> [request, request, ...]
  const pendingByUser = new Map();

  approvals.forEach((approval) => {
    if (!approval.request || approval.request.isDeleted) {
      return;
    }

    getWaitingApprovers(approval).forEach((userId) => {
      const list = pendingByUser.get(userId) || [];
      list.push(approval.request);
      pendingByUser.set(userId, list);
    });
  });

  /* ---- 2) whose own requests are still open? ---- */
  const openRequests = await Request.find({
    status: { $in: ["InProgress", "Returned"] },
    isDeleted: false,
  })
    .select("requestId title priority requester")
    .lean();

  const myRequestsByUser = new Map();

  openRequests.forEach((request) => {
    const userId = String(request.requester);
    const list = myRequestsByUser.get(userId) || [];
    list.push(request);
    myRequestsByUser.set(userId, list);
  });

  /* ---- 3) everybody who appears in either list ---- */
  const userIds = [
    ...new Set([...pendingByUser.keys(), ...myRequestsByUser.keys()]),
  ];

  if (userIds.length === 0) {
    return 0;
  }

  /* ---- 4) who already got their summary today? ---- */
  /*
    MODULE 9 - "today" is the COMPANY's today, not the server's.

    This used to be the server's midnight, and the two are different
    moments. When the summary hour happens to fall either side of
    server midnight, that gap is enough for the check to reset
    mid-window and send somebody a second summary an hour after the
    first.
  */
  const startOfToday = await getStartOfLocalDay();

  const alreadySent = await Notification.find({
    recipient: { $in: userIds },
    type: "DailySummary",
    createdAt: { $gte: startOfToday },
  })
    .select("recipient")
    .lean();

  const alreadySentIds = new Set(
    alreadySent.map((notification) => String(notification.recipient))
  );

  /* ---- 5) send them ---- */
  let sent = 0;

  for (const userId of userIds) {
    if (alreadySentIds.has(userId)) {
      continue;
    }

    const summary = {
      pendingApprovals: pendingByUser.get(userId) || [],
      myRequests: myRequestsByUser.get(userId) || [],
    };

    const parts = [];

    if (summary.pendingApprovals.length > 0) {
      parts.push(
        `${summary.pendingApprovals.length} request${
          summary.pendingApprovals.length === 1 ? "" : "s"
        } waiting for your decision`
      );
    }

    if (summary.myRequests.length > 0) {
      parts.push(
        `${summary.myRequests.length} of your own request${
          summary.myRequests.length === 1 ? " is" : "s are"
        } still open`
      );
    }

    const told = await deliver({
      recipients: [userId],
      type: "DailySummary",
      message: `${parts.join(", and ")}.`,
      sendOneEmail: (user) => sendDailySummaryEmail(user, summary),
    });

    if (told > 0) {
      sent += 1;
    }
  }

  return sent;
};

/* =====================================================================
   THE TICK  -  one round of all three jobs
   ---------------------------------------------------------------------
   `isTicking` is a small lock. The jobs read and write the same
   approvals, so if one round were still running when the next timer
   fired they could send the same reminder twice. In that case we simply
   skip the round - the next one is only half an hour away.
   ===================================================================== */
let isTicking = false;

export const runReminderTick = async () => {
  if (isTicking) {
    return;
  }

  isTicking = true;

  try {
    const config = getReminderConfig();

    /* =================================================================
       MODULE 9 - IS ANYBODY ACTUALLY AT WORK TODAY?
       -----------------------------------------------------------------
       Until Module 9 this engine ran on the SERVER's clock, which knows
       neither where the company is nor when it works. Hosted in UTC it
       would email an approver "you have been sitting on this for two
       days" on Sunday morning, and again on Diwali - and it would send
       the "8am daily summary" at half past one in the afternoon to a
       company in Mumbai.

       Now it asks config/workingCalendar.js, which reads the timezone,
       the working days and the holidays an admin set on the Settings
       page.

       NOTHING IS CANCELLED, ONLY DELAYED. A request that went quiet on
       Friday is still waiting on Monday, and the engine reminds then.
       The clock keeps running through the weekend; only the nagging
       pauses. Dropping the reminder instead would turn every weekend
       into a place where requests go to be forgotten.
       ================================================================= */
    const today = await describeDay();

    if (!today.isWorkingDay) {
      console.log(
        `Reminder engine: skipping ${today.dateKey} (${today.reason}) - nothing is sent on a non-working day`
      );
      return;
    }

    const reminded = await runPendingApprovalReminders();
    const escalated = await runEscalations();

    /*
      The summary only runs during its hour - and it is the COMPANY's
      hour, not the server's. Every tick inside that hour calls it, and
      the "already sent today" check makes all but the first one do
      nothing.
    */
    let summaries = 0;

    if ((await getLocalHour()) === config.dailySummaryHour) {
      summaries = await runDailySummary();
    }

    if (reminded || escalated || summaries) {
      console.log(
        `Reminder engine: ${reminded} reminder(s), ${escalated} escalation(s), ${summaries} daily summary/summaries`
      );
    }
  } catch (error) {
    // the engine must survive its own mistakes, or reminders stop forever
    console.error(`Reminder Engine Error ${error}`);
  } finally {
    isTicking = false;
  }
};

/* =====================================================================
   START THE ENGINE  -  called once from index.js
   ---------------------------------------------------------------------
   The first tick waits a minute, so it does not fight with the database
   connection while the server is still starting up.

   unref() tells node "this timer is not a reason to keep the process
   alive" - without it a stopped server would hang until the next tick.
   ===================================================================== */
/*
  MODULE 10 kept the timer here instead of only returning it, so that
  stopReminderEngine() below can find it again. The engine is the one
  thing in FlowDesk that keeps working after the last request has been
  answered, so it is also the one thing a clean shutdown has to be able
  to switch off - see the shutdown handler in index.js.
*/
let engineTimer = null;
let firstTickTimer = null;

export const startReminderEngine = () => {
  const config = getReminderConfig();

  if (!config.enabled) {
    console.log("Reminder engine is switched off (REMINDERS_ENABLED=false)");
    return null;
  }

  firstTickTimer = setTimeout(runReminderTick, 60 * 1000);
  firstTickTimer.unref();

  engineTimer = setInterval(
    runReminderTick,
    config.checkEveryMinutes * 60 * 1000
  );

  engineTimer.unref();

  console.log(
    `Reminder engine started - checking every ${config.checkEveryMinutes} min ` +
      `(remind after ${config.remindAfterHours}h, escalate after ${config.escalateAfterHours}h, ` +
      `daily summary at ${config.dailySummaryHour}:00)`
  );

  return engineTimer;
};

/* =====================================================================
   STOP THE ENGINE  -  called from the shutdown handler in index.js
   ---------------------------------------------------------------------
   Both timers are cleared, including the one-minute first tick, because
   a server that is asked to stop 30 seconds after it started should not
   fire a tick on its way out and write notifications into a database it
   is about to disconnect from.

   Safe to call when the engine was never started (REMINDERS_ENABLED is
   false) - clearInterval(null) does nothing, and a shutdown path is a
   bad place to need an if.
   ===================================================================== */
export const stopReminderEngine = () => {
  clearTimeout(firstTickTimer);
  clearInterval(engineTimer);

  firstTickTimer = null;
  engineTimer = null;
};
