/*
=========================================================================
  MODEL: Comment                                  ( the "M" of MVC )
=========================================================================
  Module 6 - Notification & Communication.

  A Comment is one message written on ONE REQUEST, by the employee who
  raised it or by anybody who has to approve it:

      Meera (Finance) : "Can you attach the quotation please?"
      Ravi (employee) : "Added it, thanks!"

  WHY THIS IS NOT THE SAME AS AN APPROVAL COMMENT
  -----------------------------------------------
  Module 4 already stores a comment WITH EVERY DECISION ("rejected
  because the budget is used up"). That one is part of the decision - it
  is written once, at the moment of saying yes or no, and it can never
  change afterwards.

  This is the other thing people need: a plain conversation that can
  happen at any time, including while the request is standing still,
  without pretending to be a decision. Keeping the two apart means the
  approval timeline stays a clean legal record, and the chatting happens
  next to it.

  WHY ITS OWN COLLECTION AND NOT AN ARRAY ON THE REQUEST
  -----------------------------------------------------
  Attachments live inside the request because there are always a few of
  them. A conversation has no ceiling, and MongoDB documents do (16 MB),
  so comments get their own collection and are paged like everything
  else.
=========================================================================
*/

import mongoose from "mongoose";
import { MAX_COMMENT_LENGTH } from "../config/notificationConstants.js";

const commentSchema = new mongoose.Schema(
  {
    // WHICH request this was written on
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      required: [true, "Request is required"],
    },

    // WHO wrote it
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Author is required"],
    },

    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [
        MAX_COMMENT_LENGTH,
        `Comment cannot be more than ${MAX_COMMENT_LENGTH} characters`,
      ],
    },

    /*
      Soft delete, the same pattern the rest of FlowDesk uses.

      A deleted comment keeps its row on purpose: an approver may have
      already read it and decided because of it, so the conversation
      would tell a lie if the message simply vanished. The controller
      hides the text and shows "This comment was deleted" instead.
    */
    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEX
   ---------------------------------------------------------------------
   There is only one question ever asked here - "the conversation of
   THIS request, oldest first" - so one compound index covers the whole
   collection.
   ===================================================================== */
commentSchema.index({ request: 1, createdAt: 1 });

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
