/*
=========================================================================
  CONTROLLER: Audit                               ( the "C" of MVC )
=========================================================================
  Module 7 - Audit Logs & Activity Tracking.

  FUNCTIONS IN THIS FILE
    getAuditLogs        GET  /api/audit/all
    getAuditActors      GET  /api/audit/actors
    getRequestActivity  GET  /api/audit/request/:requestId
    exportAuditLogs     GET  /api/audit/export

  THERE IS NO POST, NO PUT AND NO DELETE IN THIS FILE.

  That is the whole design of the module, not an oversight. Entries are
  written by config/auditService.js when something really happened, and
  nothing in FlowDesk can change one afterwards - not an admin, not a
  Super Admin, not the person the entry is about. A log that its
  subject can edit proves nothing.

  THE TWO HALVES OF THE MODULE
  ----------------------------
  AUDIT LOG        getAuditLogs + exportAuditLogs. Company wide, behind
                   audit:read, and the answer to "who did that?".

  ACTIVITY TIMELINE getRequestActivity. One request, open to everybody
                   who is part of it, and the answer to "what happened
                   to my request?". It needs no audit permission for
                   the same reason reading your own notifications needs
                   none - see the note above it.
=========================================================================
*/

import AuditLog from "../model/auditModel.js";
import Comment from "../model/commentModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  AUDIT_STATUSES,
  REQUEST_TIMELINE_ACTIONS,
  TIMELINE_SKIPPED_APPROVAL_ACTIONS,
  MAX_EXPORT_ROWS,
} from "../config/auditConstants.js";
import {
  loadRequestWithApproval,
  canViewRequest,
} from "../config/requestAccess.js";
import { describePerson } from "../config/auditService.js";

/*
  The table shows a face next to every entry, so the actor is
  populated - but ONLY for the photo. Every word on screen comes from
  the frozen actorName / actorRole on the entry itself, so a renamed
  or deleted user cannot rewrite what the log says (see the note at
  the top of model/auditModel.js).
*/
const ACTOR_POPULATE = {
  path: "actor",
  select: "firstName lastName employeeId photoUrl",
};

/* =====================================================================
   HELPER 1 - make a search box safe to put inside a regular expression
   ---------------------------------------------------------------------
   Everything the user types goes into a $regex, and characters like
   ( [ * + ? mean something in a regular expression. Without escaping
   them, a search for "REQ-0007 (old)" is not just wrong - it is an
   invalid expression, and MongoDB answers with an error instead of a
   result.
   ===================================================================== */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* =====================================================================
   HELPER 2 - turn the query string into a MongoDB filter
   ---------------------------------------------------------------------
   The list and the CSV export must ALWAYS agree: an admin who filters
   the table and then presses Export has every right to expect the file
   to hold what they were looking at. Building the filter once, here,
   is what guarantees that.

   Every value is checked against the fixed lists before it is used, so
   an unknown module or a made up action is quietly ignored instead of
   becoming part of the query.
   ===================================================================== */
const buildAuditFilter = (query) => {
  const { search, module, action, actor, status, from, to } = query;

  const filter = {};

  if (module && AUDIT_MODULES.includes(module)) {
    filter.module = module;
  }

  if (action && AUDIT_ACTIONS.includes(action)) {
    filter.action = action;
  }

  if (status && AUDIT_STATUSES.includes(status)) {
    filter.status = status;
  }

  if (actor && isValidObjectId(actor)) {
    filter.actor = actor;
  }

  if (search && search.trim()) {
    const searchText = escapeRegex(search.trim());

    /*
      The three fields worth searching are the three the table shows.
      They are all frozen text on the entry, so the search reads
      exactly what the admin can see - no populate, no join.
    */
    filter.$or = [
      { description: { $regex: searchText, $options: "i" } },
      { actorName: { $regex: searchText, $options: "i" } },
      { targetLabel: { $regex: searchText, $options: "i" } },
    ];
  }

  /*
    THE DATE RANGE.

    "to" is pushed to the END of the day it names. An admin who asks
    for 14 Aug to 14 Aug means that whole day, not the single instant
    of midnight - which is what a plain $lte would have meant, and it
    would have returned nothing at all.
  */
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate && !isNaN(fromDate.getTime())) {
    filter.createdAt = { ...filter.createdAt, $gte: fromDate };
  }

  if (toDate && !isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
    filter.createdAt = { ...filter.createdAt, $lte: toDate };
  }

  return filter;
};

/* =====================================================================
   1) THE AUDIT LOG
   ---------------------------------------------------------------------
   GET /api/audit/all?page=1&limit=20&search=&module=User&action=&actor=&status=&from=&to=

   Newest first, because the question an audit log is opened with is
   almost always "what just happened?".
   ===================================================================== */
export const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const filter = buildAuditFilter(req.query);
    const skip = (page - 1) * limit;

    const [logs, totalLogs] = await Promise.all([
      AuditLog.find(filter)
        .populate(ACTOR_POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Audit logs fetched successfully",
      logs,
      pagination: {
        page,
        limit,
        totalLogs,
        totalPages: Math.ceil(totalLogs / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Audit Logs Error ${error}` });
  }
};

/* =====================================================================
   2) EVERYBODY WHO HAS EVER DONE ANYTHING
   ---------------------------------------------------------------------
   GET /api/audit/actors

   Fills the "Performed by" dropdown on the audit page.

   WHY IT IS NOT SIMPLY /api/user/all
   ----------------------------------
   Because the two lists answer different questions. The user list is
   "who works here today"; this is "who appears in the log", and those
   drift apart in both directions:

     - an employee who left is gone from the user list (soft deleted)
       but their 400 entries are still in the log, and they are often
       exactly who an investigation is about
     - a new hire who has not done anything yet would sit in the
       dropdown filtering to zero rows

   So the list is built from the log itself. $group gives one row per
   actor, and $last takes the most recent name that person was
   recorded under.
   ===================================================================== */
export const getAuditActors = async (req, res) => {
  try {
    const actors = await AuditLog.aggregate([
      // the entries with nobody behind them (failed logins) have no actor
      { $match: { actor: { $ne: null } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$actor",
          name: { $last: "$actorName" },
          role: { $last: "$actorRole" },
          entries: { $sum: 1 },
        },
      },
      { $sort: { name: 1 } },
    ]);

    return res.status(200).json({
      message: "Audit actors fetched successfully",
      actors,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Audit Actors Error ${error}` });
  }
};

/* =====================================================================
   3) THE ACTIVITY TIMELINE OF ONE REQUEST
   ---------------------------------------------------------------------
   GET /api/audit/request/:requestId

   The complete history of a single request, built from four places and
   handed back as ONE list, oldest first - because a story is read
   forwards.

   WHY THIS ROUTE ASKS FOR NO AUDIT PERMISSION
   -------------------------------------------
   audit:read unlocks the company. This is one request, and it is
   guarded the way every other per-request feature in FlowDesk is
   guarded: canViewRequest() in config/requestAccess.js, the same
   function the comments and the approval timeline already use.

   That is deliberate. An employee should be able to see what happened
   to their own paperwork without an admin granting them the right to
   read everybody else's, and the three features can never disagree
   about who is allowed in, because they all ask the same question in
   the same place.
   ===================================================================== */
export const getRequestActivity = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const { request, approval } = await loadRequestWithApproval(requestId);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!canViewRequest(request, approval, req.user)) {
      return res
        .status(403)
        .json({ message: "You are not part of this request" });
    }

    /* -----------------------------------------------------------------
       SOURCE 1 - the audit log: the request's own life.

       Only the four actions no other collection records. See
       REQUEST_TIMELINE_ACTIONS in config/auditConstants.js for why the
       approvals, the comments and the attachments are left out here.
       ----------------------------------------------------------------- */
    const auditEntries = await AuditLog.find({
      request: request._id,
      action: { $in: REQUEST_TIMELINE_ACTIONS },
    })
      .populate(ACTOR_POPULATE)
      .sort({ createdAt: 1 })
      .lean();

    const auditActivity = auditEntries.map((entry) => ({
      source: "Audit",
      action: entry.action,
      title: entry.description,
      detail: "",
      changes: entry.changes || [],
      actorName: entry.actorName,
      actorRole: entry.actorRole,
      actorPhotoUrl: entry.actor?.photoUrl || "",
      at: entry.createdAt,
    }));

    /* -----------------------------------------------------------------
       SOURCE 2 - the approval history: every decision, with its stage.

       The actor is populated here rather than frozen, because unlike
       the audit log the approval was never designed to keep a copy of
       the name. describePerson() falls back to "FlowDesk" for the
       lines the engine wrote by itself (an auto approved stage).
       ----------------------------------------------------------------- */
    const approvalActivity = (approval?.history || [])
      .filter(
        (entry) => !TIMELINE_SKIPPED_APPROVAL_ACTIONS.includes(entry.action)
      )
      .map((entry) => ({
        source: "Approval",
        action: entry.action,
        title: entry.stageName ? `${entry.action} - ${entry.stageName}` : entry.action,
        detail: entry.comment || "",
        changes: [],
        actorName: "",
        actorRole: "",
        actorPhotoUrl: "",
        // filled in below, once every actor has been looked up in one go
        actorId: entry.actor || null,
        at: entry.createdAt,
      }));

    /* -----------------------------------------------------------------
       SOURCE 3 - the conversation.

       A deleted comment keeps its place and loses its words, exactly
       the way commentController.js shows it. The timeline would tell a
       lie if a message an approver had already read simply vanished
       from it.
       ----------------------------------------------------------------- */
    const comments = await Comment.find({ request: request._id })
      .populate({ path: "author", select: "firstName lastName photoUrl" })
      .sort({ createdAt: 1 })
      .lean();

    const commentActivity = comments.map((comment) => ({
      source: "Comment",
      action: comment.isDeleted ? "CommentDeleted" : "CommentAdded",
      title: `${describePerson(comment.author)} wrote a comment`,
      detail: comment.isDeleted ? "This comment was deleted" : comment.message,
      changes: [],
      actorName: describePerson(comment.author),
      actorRole: "",
      actorPhotoUrl: comment.author?.photoUrl || "",
      at: comment.createdAt,
    }));

    /* -----------------------------------------------------------------
       SOURCE 4 - the files.

       They live inside the request document, so there is nothing to
       query. Every attachment is a line of its own: uploading three
       files at once is three moments in the story, not one.

       They have no actor - only the person who owns a request can
       attach anything to it, so the requester IS the actor.
       ----------------------------------------------------------------- */
    const requesterName = describePerson(request.requester);

    const attachmentActivity = (request.attachments || []).map(
      (attachment) => ({
        source: "Attachment",
        action: "AttachmentUploaded",
        title: `${requesterName} attached ${attachment.fileName}`,
        detail: `${Math.round((attachment.fileSize || 0) / 1024)} KB`,
        changes: [],
        actorName: requesterName,
        actorRole: "",
        actorPhotoUrl: request.requester?.photoUrl || "",
        at: attachment.uploadedAt,
      })
    );

    /* -----------------------------------------------------------------
       FILL IN THE APPROVAL ACTORS

       The approval history holds bare ids, and .lean() means mongoose
       did not populate them. Loading them in ONE query keeps a
       timeline with twenty decisions at two database trips instead of
       twenty-one.
       ----------------------------------------------------------------- */
    const actorIds = [
      ...new Set(
        approvalActivity
          .map((entry) => entry.actorId)
          .filter(Boolean)
          .map(String)
      ),
    ];

    if (actorIds.length > 0) {
      const actors = await User.find({ _id: { $in: actorIds } })
        .select("firstName lastName photoUrl")
        .lean();

      const actorById = new Map(actors.map((user) => [String(user._id), user]));

      approvalActivity.forEach((entry) => {
        const actor = actorById.get(String(entry.actorId));

        entry.actorName = describePerson(actor, "FlowDesk");
        entry.actorPhotoUrl = actor?.photoUrl || "";
      });
    }

    // the id was only needed for the lookup above
    approvalActivity.forEach((entry) => delete entry.actorId);

    /* -----------------------------------------------------------------
       MERGE AND SORT

       Four lists, each already sorted, become one story in time order.
       Oldest first: the same direction ApprovalTimeline.jsx already
       reads in, so the two components on the same screen agree.
       ----------------------------------------------------------------- */
    const activity = [
      ...auditActivity,
      ...approvalActivity,
      ...commentActivity,
      ...attachmentActivity,
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    return res.status(200).json({
      message: "Request activity fetched successfully",
      activity,
      request: {
        _id: request._id,
        requestId: request.requestId,
        title: request.title,
        status: request.status,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Request Activity Error ${error}` });
  }
};

/* =====================================================================
   4) EXPORT THE AUDIT LOG AS CSV
   ---------------------------------------------------------------------
   GET /api/audit/export?search=&module=&action=&actor=&status=&from=&to=

   The same filter as the table, without the pagination - what you see
   is what you download.

   IT IS ITS OWN PERMISSION (audit:export), NOT audit:read.
   Reading the log on screen and walking out of the building with a
   spreadsheet of every action in the company are different levels of
   trust, and an admin should be able to grant the first without the
   second.
   ===================================================================== */
export const exportAuditLogs = async (req, res) => {
  try {
    const filter = buildAuditFilter(req.query);

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();

    /*
      ESCAPING A CSV CELL.

      A description like 'Rejected: "budget is used up"' would tear a
      spreadsheet apart: the comma starts a new column and the quotes
      end the text early. The CSV rule is to wrap the cell in quotes
      and double every quote inside it.
    */
    const csvCell = (value) => {
      const text = String(value === null || value === undefined ? "" : value);

      return `"${text.replace(/"/g, '""')}"`;
    };

    const header = [
      "When",
      "Action",
      "Module",
      "Performed by",
      "Role",
      "Description",
      "Target",
      "Changes",
      "Status",
      "IP address",
    ];

    const rows = logs.map((log) =>
      [
        new Date(log.createdAt).toISOString(),
        log.action,
        log.module,
        log.actorName,
        log.actorRole,
        log.description,
        log.targetLabel,
        // the diff has to survive as ONE cell, so it becomes one line
        (log.changes || [])
          .map((change) => `${change.field}: ${change.from} -> ${change.to}`)
          .join(" | "),
        log.status,
        log.ipAddress,
      ].map(csvCell).join(",")
    );

    const csv = [header.map(csvCell).join(","), ...rows].join("\r\n");

    const fileName = `flowdesk-audit-${new Date().toISOString().split("T")[0]}.csv`;

    /*
      These two headers are what turns a response into a download.
      Without Content-Disposition the browser would simply show the
      text; "attachment" tells it to save a file instead.
    */
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    /*
      THE THREE ODD BYTES IN FRONT.

      "﻿" is a byte order mark. Excel opens a plain UTF-8 CSV as
      if it were the local Windows encoding, which turns every accented
      name into mojibake. The BOM is the one hint it does listen to.
    */
    return res.status(200).send(`﻿${csv}`);
  } catch (error) {
    return res.status(500).json({ message: `Export Audit Logs Error ${error}` });
  }
};
