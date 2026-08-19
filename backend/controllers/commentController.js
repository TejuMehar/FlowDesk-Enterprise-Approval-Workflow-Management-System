/*
=========================================================================
  CONTROLLER: Comment                             ( the "C" of MVC )
=========================================================================
  Module 6 - the COMMUNICATION half.

  FUNCTIONS IN THIS FILE
    getComments     GET     /api/comment/request/:requestId
    addComment      POST    /api/comment/request/:requestId
    deleteComment   DELETE  /api/comment/:id

  WHAT THIS IS FOR
  ----------------
  Module 4 gave every DECISION a comment ("rejected, the budget is
  used up"). That is a formal, final thing: it is written at the moment
  of deciding and it can never be changed.

  This is the other half people always end up needing:

      Meera (Finance) : "Can you attach the quotation please?"
      Ravi (employee) : "Added it, thanks!"

  A plain conversation, at any time, without pretending to be a
  decision - which is why it lives in its own collection and shows up
  under the timeline instead of inside it.

  WHO MAY TALK
  ------------
  The permission (comment:read / comment:create) only says "you may use
  the comments feature at all". WHICH conversations you can reach is a
  completely different question, and it is answered in ONE place -
  config/requestAccess.js - so that the people who may READ a
  conversation and the people who are NOTIFIED about it can never drift
  apart.
=========================================================================
*/

import Comment from "../model/commentModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  MAX_COMMENT_LENGTH,
  COMMENT_DELETE_WINDOW_MINUTES,
} from "../config/notificationConstants.js";
import {
  loadRequestWithApproval,
  canViewRequest,
} from "../config/requestAccess.js";
import { notifyNewComment } from "../config/notificationService.js";
import {
  recordAudit,
  describePerson,
  describeRequest,
} from "../config/auditService.js";

// the conversation shows a face and a name next to every message
const AUTHOR_POPULATE = {
  path: "author",
  select: "firstName lastName employeeId designation photoUrl",
};

/*
  A deleted comment keeps its place in the conversation but loses its
  words - see the note in model/commentModel.js for why it is not simply
  removed. This is the only place that decides what a reader sees.
*/
const hideDeletedText = (comment) => {
  if (!comment.isDeleted) {
    return comment;
  }

  return { ...comment, message: "This comment was deleted" };
};

/* =====================================================================
   1) THE CONVERSATION OF ONE REQUEST
   ---------------------------------------------------------------------
   GET /api/comment/request/:requestId

   Oldest first, because that is how a conversation is read. There is no
   pagination: a comment thread on one approval request is a handful of
   messages, not a chat room, and the frontend shows them all under the
   timeline.
   ===================================================================== */
export const getComments = async (req, res) => {
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

    const comments = await Comment.find({ request: requestId })
      .populate(AUTHOR_POPULATE)
      .sort({ createdAt: 1 })
      .lean();

    return res.status(200).json({
      message: "Comments fetched successfully",
      comments: comments.map(hideDeletedText),
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Comments Error ${error}` });
  }
};

/* =====================================================================
   2) WRITE A COMMENT
   ---------------------------------------------------------------------
   POST /api/comment/request/:requestId
   body: { message }

   The notification to everybody else on the request is sent AFTER the
   comment is saved, and its failure can never break this route -
   notificationService.js swallows its own errors. A comment that was
   written must stay written even if the notification collection is
   having a bad day.
   ===================================================================== */
export const addComment = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { message } = req.body;

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const cleanMessage = String(message || "").trim();

    if (!cleanMessage) {
      return res.status(400).json({ message: "Please write something first" });
    }

    if (cleanMessage.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({
        message: `A comment cannot be more than ${MAX_COMMENT_LENGTH} characters`,
      });
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

    /*
      A draft has never left the employee's hands, so there is nobody to
      talk to yet. Blocking it here keeps the conversation meaningful:
      every comment in FlowDesk has at least two possible readers.
    */
    if (request.status === "Draft") {
      return res.status(400).json({
        message:
          "This request is still a draft, so there is nobody to talk to yet. Submit it first.",
      });
    }

    const comment = await Comment.create({
      request: request._id,
      author: req.userId,
      message: cleanMessage,
    });

    // tell everybody else who is part of this request (in-app only)
    await notifyNewComment(request, approval, req.user, cleanMessage);

    const savedComment = await Comment.findById(comment._id)
      .populate(AUTHOR_POPULATE)
      .lean();

    /*
      MODULE 7. The entry records THAT somebody wrote, not WHAT they
      wrote - the words stay in the Comment collection, which is the
      only place that can hide them again if the author deletes the
      message within their fifteen minutes.

      Copying the text in here as well would quietly defeat that: a
      deleted comment would still be readable in full by anybody with
      audit:read, and the audit log has no delete route.
    */
    await recordAudit(req, {
      action: "CommentAdded",
      targetType: "Comment",
      targetId: comment._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: `${describePerson(req.user)} wrote a comment on ${describeRequest(
        request
      )}`,
    });

    return res.status(201).json({
      message: "Comment added successfully",
      comment: savedComment,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Add Comment Error ${error}` });
  }
};

/* =====================================================================
   3) DELETE YOUR OWN COMMENT
   ---------------------------------------------------------------------
   DELETE /api/comment/:id

   Two limits, both on purpose:

     WHO   only the author. Not an admin, not the requester - a comment
           is somebody's words, and the record of an approval should not
           be editable by whoever happens to have the most permissions.

     WHEN  only for COMMENT_DELETE_WINDOW_MINUTES. Long enough to take
           back a typo or a message meant for another request, short
           enough that nobody can quietly remove what an approver read
           before deciding.
   ===================================================================== */
export const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid comment id" });
    }

    const comment = await Comment.findById(id);

    if (!comment || comment.isDeleted) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (String(comment.author) !== String(req.userId)) {
      return res
        .status(403)
        .json({ message: "You can only delete your own comments" });
    }

    const ageInMinutes = (Date.now() - comment.createdAt.getTime()) / 60000;

    if (ageInMinutes > COMMENT_DELETE_WINDOW_MINUTES) {
      return res.status(400).json({
        message: `A comment can only be deleted within ${COMMENT_DELETE_WINDOW_MINUTES} minutes of writing it`,
      });
    }

    comment.isDeleted = true;
    comment.deletedAt = new Date();

    await comment.save();

    /*
      MODULE 7. The conversation shows "This comment was deleted" and
      says no more; this entry says who did it and when. Between them
      an approver who remembers reading something can find out that it
      was taken back, without the words themselves being recoverable
      from a log nobody can edit.
    */
    await recordAudit(req, {
      action: "CommentDeleted",
      targetType: "Comment",
      targetId: comment._id,
      request: comment.request,
      description: `${describePerson(req.user)} deleted their own comment`,
    });

    return res.status(200).json({ message: "Comment deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Delete Comment Error ${error}` });
  }
};
