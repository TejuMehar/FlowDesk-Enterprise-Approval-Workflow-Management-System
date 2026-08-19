/*
=========================================================================
  THE AUDIT SERVICE   (Module 7 - Audit Logs & Activity Tracking)
=========================================================================
  This file is to Module 7 what notificationService.js is to Module 6:
  the one place that WRITES the module's collection. It knows nothing
  about express beyond reading three fields off `req`, and no controller
  ever touches AuditLog directly.

  Nine controllers call it. That is a lot of call sites, which is
  exactly why the awkward parts live here instead of in each of them:

    - working out the module from the action
    - freezing the actor's name and role as they are right now
    - pulling the IP address and the browser off the request
    - turning "before" and "after" into a readable list of changes

  THE ONE RULE OF THIS FILE
  -------------------------
  NOTHING IN HERE MAY EVER THROW.

  An audit entry is a side effect, and it is written AFTER the real
  work has already been saved. If this collection is unhappy, the user
  who just approved a request must still get their 200 - losing the
  log entry is bad, losing the approval is much worse.

  So recordAudit() swallows everything and logs to the console, exactly
  the way deliver() in notificationService.js and sendEmail() in
  nodemailer.js already do. Every caller can safely `await` it without
  a try/catch of their own.

  WHY IT IS AWAITED AT ALL, THEN
  ------------------------------
  Because "fire and forget" inside express means the entry may still be
  in flight when the response is sent, and an error thrown after that
  becomes an unhandled rejection with no request to attach it to.
  Awaiting a function that cannot reject costs one quick insert and
  keeps the failure inside the try/catch that owns it.
=========================================================================
*/

import AuditLog from "../model/auditModel.js";
import { ACTION_MODULE, describeValue } from "./auditConstants.js";

/* =====================================================================
   1) SMALL HELPERS FOR THE WORDING
   ---------------------------------------------------------------------
   Every description in FlowDesk names people and requests the same
   way, so the audit table reads consistently no matter which
   controller wrote the row.
   ===================================================================== */

/*
  "Ravi Sharma", or the fallback when the user is missing.

  The fallback matters for the entries with no actor: a failed login
  has nobody behind it yet, and the reminder engine is not a person.
*/
export const describePerson = (person, fallback = "Somebody") => {
  if (!person) {
    return fallback;
  }

  const name = `${person.firstName || ""} ${person.lastName || ""}`.trim();

  return name || person.email || fallback;
};

// "REQ-0007 - New laptop", the same shape notificationService.js uses
export const describeRequest = (request) =>
  `${request?.requestId || "Request"} - ${request?.title || ""}`.trim();

/* =====================================================================
   2) WHAT CHANGED?
   ---------------------------------------------------------------------
   Compares the document BEFORE an edit with the document AFTER it, and
   returns one entry per field that is really different.

   @param before - a plain object of the old values
   @param after  - a plain object of the new values
   @param labels - { fieldName: "Label shown to a human" }

   Only the fields named in `labels` are looked at. That is the point:
   an update route touches `updatedAt` and a dozen internals on every
   save, and none of them are worth a line in an audit log. Naming the
   fields explicitly keeps the diff to what a person would call a
   change.

   WHY BOTH SIDES GO THROUGH describeValue() BEFORE BEING COMPARED
   --------------------------------------------------------------
   Because that is the only way the comparison matches what the reader
   will see. A Date and its ISO string are different values but the
   same day; null and "" are different values but both empty. Comparing
   the DESCRIPTIONS means the log never shows a "change" from
   "(empty)" to "(empty)".
   ===================================================================== */
export const buildChanges = (before = {}, after = {}, labels = {}) => {
  const changes = [];

  Object.entries(labels).forEach(([field, label]) => {
    const from = describeValue(before[field]);
    const to = describeValue(after[field]);

    if (from !== to) {
      changes.push({ field: label, from, to });
    }
  });

  return changes;
};

/* =====================================================================
   3) THE ONE FUNCTION THAT WRITES AN AUDIT ENTRY
   ---------------------------------------------------------------------
   @param req     - the express request, for the actor, the IP and the
                    browser. Pass null for anything that happens
                    without one.
   @param options - everything about the event itself:

       action      required, one of AUDIT_ACTIONS
       description required, the frozen sentence the table shows
       targetType  required, what kind of thing was touched
       targetId    the id of that thing, when there is one
       targetLabel how it was called at the time
       request     the request this belongs to, for the timeline
       changes     the field-by-field diff from buildChanges()
       status      "Success" (default) or "Failure"
       actor       ONLY for the rare case where the person is not
                   req.user - a failed login knows the email that was
                   tried, but nobody is logged in

   @returns the saved entry, or null when something went wrong. Nobody
            checks the return value today; it is there so a future
            caller can, without having to change this function.
   ===================================================================== */
export const recordAudit = async (
  req,
  {
    action,
    description,
    targetType,
    targetId = null,
    targetLabel = "",
    request = null,
    changes = [],
    status = "Success",
    actor,
    actorName,
    actorRole,
  }
) => {
  try {
    /*
      An action we do not know is a typo in a controller. Refusing it
      here (instead of letting the model's enum throw) means the
      mistake is one clear line in the terminal rather than a stack
      trace inside a route that otherwise worked.
    */
    const auditModule = ACTION_MODULE[action];

    if (!auditModule) {
      console.error(`Audit Error unknown action "${action}"`);
      return null;
    }

    /*
      THE ACTOR.

      Normally it is whoever is logged in. `actor` is only passed by
      hand for the events that happen before there is a session - and
      those pass null on purpose, so `actor === undefined` (not given)
      and `actor === null` (given, and there is nobody) mean two
      different things.
    */
    const user = actor === undefined ? req?.user : actor;

    return await AuditLog.create({
      action,
      module: auditModule,
      description,

      actor: user?._id || null,
      // the name and role AS THEY ARE NOW - see model/auditModel.js
      actorName: actorName || describePerson(user, "FlowDesk"),
      actorRole: actorRole || user?.role?.name || "",

      targetType,
      targetId,
      targetLabel,
      request,

      changes,
      status,

      /*
        req.ip is what express worked out from the connection. Behind a
        proxy it is the proxy unless `trust proxy` is switched on, so
        this is a hint about where a request came from, never a
        security decision.
      */
      ipAddress: req?.ip || "",
      userAgent: req?.headers?.["user-agent"] || "",
    });
  } catch (error) {
    console.error(`Audit Record Error ${error}`);
    return null;
  }
};
