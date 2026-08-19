/*
=========================================================================
  THE NOTIFICATION SERVICE   (Module 6 - Notification & Communication)
=========================================================================
  This file is to Module 6 what approvalEngine.js is to Module 4: it
  knows WHO has to be told WHAT, and it knows nothing about express -
  no req, no res, no routes.

  Three files call it:

    requestController.js  -> the employee pressed Submit
    approvalController.js -> somebody approved / rejected / returned
    commentController.js  -> somebody wrote on a request

  ...and reminderEngine.js uses the same deliver() helper for its
  reminders, so a reminder ends up in the bell exactly like everything
  else.

  THE ONE RULE OF THIS FILE
  -------------------------
  NOTHING IN HERE MAY EVER THROW.

  A notification is a side effect. If the mail server is down, or the
  notification collection is unhappy, the approval that just happened
  must still be saved and the API must still answer 200. A failure is
  logged and swallowed - exactly the way sendEmail() in nodemailer.js
  already behaves.

  That is why every public function below is wrapped in its own
  try/catch, and why the controllers call them WITHOUT await-ing a
  result they would act on.
=========================================================================
*/

import Notification from "../model/notificationModel.js";
import User from "../model/userModel.js";
import {
  NOTIFICATION_TITLES,
  NOTIFICATION_LINKS,
  TYPES_THAT_ALSO_EMAIL,
} from "./notificationConstants.js";
import {
  sendRequestCreatedEmail,
  sendRequestApprovedEmail,
  sendRequestRejectedEmail,
  sendRequestReturnedEmail,
} from "./nodemailer.js";
import { getParticipants, getWaitingApprovers } from "./requestAccess.js";

/* =====================================================================
   1) THE ONE FUNCTION THAT ACTUALLY CREATES NOTIFICATIONS
   ---------------------------------------------------------------------
   Everything else in this file (and in the reminder engine) ends up
   here. It does three things:

     - throws away recipients that make no sense (nobody, or the person
       who caused the event - you are never told about your own click)
     - writes one Notification document per recipient
     - hands each recipient to sendOneEmail(), when this type is emailed

   @param recipients - user ids (ObjectId or text), duplicates are fine
   @param sendOneEmail - optional async (user) => ... , called per person

   @returns the number of people who were told
   ===================================================================== */
export const deliver = async ({
  recipients,
  type,
  message,
  request = null,
  actor = null,
  title = null,
  sendOneEmail = null,
}) => {
  try {
    /* ---- clean the guest list ---- */
    const actorId = actor ? String(actor) : "";

    const uniqueIds = [
      ...new Set((recipients || []).filter(Boolean).map(String)),
    ].filter((id) => id !== actorId);

    if (uniqueIds.length === 0) {
      return 0;
    }

    /*
      Deactivated and deleted employees are dropped here rather than at
      every call site. We need the user documents anyway for the emails,
      so this costs us nothing extra.
    */
    const users = await User.find({
      _id: { $in: uniqueIds },
      isActive: true,
      isDeleted: false,
    })
      .select("firstName lastName email")
      .lean();

    if (users.length === 0) {
      return 0;
    }

    const shouldEmail =
      TYPES_THAT_ALSO_EMAIL.includes(type) && typeof sendOneEmail === "function";

    /*
      insertMany writes all of them in ONE trip to the database. A stage
      with eight approvers is one insert, not eight.
    */
    await Notification.insertMany(
      users.map((user) => ({
        recipient: user._id,
        type,
        title: title || NOTIFICATION_TITLES[type] || "FlowDesk",
        message,
        request,
        actor,
        link: NOTIFICATION_LINKS[type] || "/",
        emailSent: shouldEmail,
      }))
    );

    /*
      The emails go out in parallel and we do not wait for the result of
      any single one: sendEmail() already swallows its own errors, and a
      slow mail server must not hold up the API response.
    */
    if (shouldEmail) {
      await Promise.all(users.map((user) => sendOneEmail(user)));
    }

    return users.length;
  } catch (error) {
    console.error(`Notification Deliver Error ${error}`);
    return 0;
  }
};

/* =====================================================================
   2) A SMALL HELPER FOR THE MESSAGES
   ---------------------------------------------------------------------
   Every message names the request the same way, so the bell reads
   consistently: "REQ-0007 - New laptop".
   ===================================================================== */
const describeRequest = (request) =>
  `${request?.requestId || "Request"} - ${request?.title || ""}`;

const describePerson = (person, fallback = "Somebody") =>
  person ? `${person.firstName} ${person.lastName}`.trim() : fallback;

/* =====================================================================
   3) "A REQUEST NEEDS YOUR APPROVAL"
   ---------------------------------------------------------------------
   Sent to the approvers of the stage the request is standing at RIGHT
   NOW - which is why it is called both when the employee submits and
   again every time the request moves one stage forward.

   Nobody at the stages further down the route is told anything yet: as
   far as they are concerned nothing has happened, and the request may
   never even reach them.

   @param requester - the employee, populated, only for the wording
   ===================================================================== */
export const notifyApproversOfPendingRequest = async (
  request,
  approval,
  requester
) => {
  try {
    const waiting = getWaitingApprovers(approval);

    if (waiting.length === 0) {
      return 0;
    }

    const stage = approval.stages.find(
      (item) => item.order === approval.currentStage
    );

    return await deliver({
      recipients: waiting,
      type: "NewRequest",
      request: request._id,
      actor: request.requester?._id || request.requester,
      message: `${describePerson(requester)} needs your approval for ${describeRequest(
        request
      )} (stage: ${stage?.name || "-"}).`,
      sendOneEmail: (user) =>
        sendRequestCreatedEmail(user, request, requester, stage?.name),
    });
  } catch (error) {
    console.error(`Notify New Request Error ${error}`);
    return 0;
  }
};

/* =====================================================================
   4) THE THREE ANSWERS AN EMPLOYEE CAN GET
   ---------------------------------------------------------------------
   All three go to ONE person - the employee who raised the request -
   so they share a shape, but they are separate functions because the
   words and the email template differ.

   @param actor - the approver who pressed the button. "Approved" has no
                  actor: by then several people have said yes, and the
                  last one is not more responsible than the others.
   ===================================================================== */

export const notifyRequesterApproved = async (request) => {
  try {
    return await deliver({
      recipients: [request.requester?._id || request.requester],
      type: "Approved",
      request: request._id,
      message: `${describeRequest(
        request
      )} passed every stage and is now fully approved.`,
      sendOneEmail: (user) => sendRequestApprovedEmail(user, request),
    });
  } catch (error) {
    console.error(`Notify Approved Error ${error}`);
    return 0;
  }
};

export const notifyRequesterRejected = async (request, actor, comment) => {
  try {
    return await deliver({
      recipients: [request.requester?._id || request.requester],
      type: "Rejected",
      request: request._id,
      /*
        The approver is stored as the actor AND named in the message,
        because the employee's first question is always "who said no?".
        It is safe to do here: deliver() only ever removes the actor from
        the RECIPIENTS, and an approver can never be the requester.
      */
      actor: actor?._id || null,
      message: `${describePerson(actor, "An approver")} rejected ${describeRequest(
        request
      )}: "${comment}"`,
      sendOneEmail: (user) =>
        sendRequestRejectedEmail(user, request, actor, comment),
    });
  } catch (error) {
    console.error(`Notify Rejected Error ${error}`);
    return 0;
  }
};

export const notifyRequesterReturned = async (request, actor, comment) => {
  try {
    return await deliver({
      recipients: [request.requester?._id || request.requester],
      type: "Returned",
      request: request._id,
      actor: actor?._id || null,
      message: `${describePerson(
        actor,
        "An approver"
      )} returned ${describeRequest(request)} for correction: "${comment}"`,
      sendOneEmail: (user) =>
        sendRequestReturnedEmail(user, request, actor, comment),
    });
  } catch (error) {
    console.error(`Notify Returned Error ${error}`);
    return 0;
  }
};

/* =====================================================================
   5) "NEW COMMENT"
   ---------------------------------------------------------------------
   Goes to EVERYBODY who is part of the request (the employee and every
   approver, past and present) except the person who wrote it - see
   config/requestAccess.js for why that list is worked out over there.

   In-app only, on purpose: a conversation can be twenty messages long,
   and twenty emails about it would make people switch FlowDesk off.
   ===================================================================== */
export const notifyNewComment = async (request, approval, author, message) => {
  try {
    /*
      A long message is cut down for the bell. The full text is one click
      away in the request itself, and a notification is a nudge, not a
      copy of the conversation.
    */
    const preview =
      message.length > 120 ? `${message.slice(0, 117)}...` : message;

    return await deliver({
      recipients: getParticipants(request, approval),
      type: "NewComment",
      request: request._id,
      actor: author._id,
      message: `${describePerson(author)} wrote on ${describeRequest(
        request
      )}: "${preview}"`,
    });
  } catch (error) {
    console.error(`Notify New Comment Error ${error}`);
    return 0;
  }
};

/* =====================================================================
   6) "YOUR PAYSLIP IS READY"      (Module 12 - Payroll & Salary)
   ---------------------------------------------------------------------
   The only notification in FlowDesk that is not about a request, which
   is why `request` is left null here - deliver() has always allowed it,
   and the Notification model has never required one.

   IT IS SENT ONCE, ON PUBLISH, AND NEVER ON A RUN. A generated payroll
   is finance's working copy: telling three hundred people about a
   number that is still being checked is precisely what the Draft state
   exists to prevent (config/salaryConstants.js).

   IN-APP ONLY. An email about somebody's pay is a message about their
   money sitting in an inbox, forwarded by a mail server FlowDesk does
   not own. The bell says it is ready; the document is downloaded from
   the application, by them, after logging in.

   THE MESSAGE DELIBERATELY CONTAINS NO AMOUNT. A notification is read
   over somebody's shoulder on a phone on a train, and "your payslip for
   July 2026 is ready" is all it has to say to do its job.

   @param recipients - the employees whose payslips were published
   @param monthLabel - "July 2026", already formatted by the caller
   @returns how many people were told
   ===================================================================== */
export const notifySalaryPublished = async (recipients, monthLabel, actorId = null) => {
  try {
    return await deliver({
      recipients,
      type: "SalaryPublished",
      actor: actorId,
      message: `Your payslip for ${monthLabel} is ready. Open My Salary to see the breakdown and download the receipt.`,
    });
  } catch (error) {
    console.error(`Notify Salary Published Error ${error}`);
    return 0;
  }
};
