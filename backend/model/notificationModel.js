/*
=========================================================================
  MODEL: Notification                             ( the "M" of MVC )
=========================================================================
  Module 6 - Notification & Communication.

  ONE DOCUMENT = ONE MESSAGE FOR ONE PERSON.

  That last part is the important design decision. When a request lands
  on a stage with three approvers we do NOT store one notification with
  three recipients - we store THREE documents. It costs a little more
  space, but it buys us the two things the bell needs most:

    - "read" belongs to a person. If Ravi opens his bell, Meera's copy
      must still be unread.
    - "how many unread do I have?" becomes one simple countDocuments()
      instead of digging through an array on every document.

  WHAT A NOTIFICATION IS NOT
  --------------------------
  It is not the truth about anything. The truth about a request lives on
  the Request and the Approval; this is only a MESSAGE ABOUT something
  that happened, frozen in the words the user was told at the time. That
  is why the title and message are stored as plain text instead of being
  rebuilt every time the bell opens.
=========================================================================
*/

import mongoose from "mongoose";
import { NOTIFICATION_TYPES } from "../config/notificationConstants.js";

const notificationSchema = new mongoose.Schema(
  {
    // WHO is being told. Every notification belongs to exactly one person
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Recipient is required"],
    },

    type: {
      type: String,
      required: [true, "Notification type is required"],
      enum: {
        values: NOTIFICATION_TYPES,
        message: "{VALUE} is not a valid notification type",
      },
    },

    // the bold line in the bell, e.g. "A request needs your approval"
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [150, "Title cannot be more than 150 characters"],
    },

    // the sentence underneath, e.g. "REQ-0007 - New laptop, from Ravi"
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: [600, "Message cannot be more than 600 characters"],
    },

    /*
      The request this is about. Kept so the UI can show its id and open
      the right row. A DailySummary is about nothing in particular, so it
      leaves this empty.
    */
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Request",
      default: null,
    },

    /*
      WHO caused it. Empty when FlowDesk itself did (every reminder), and
      the UI then shows "FlowDesk" as the sender.
    */
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // where clicking it takes the user, e.g. "/approvals"
    link: {
      type: String,
      default: "/",
      trim: true,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    readAt: {
      type: Date,
      default: null,
    },

    /*
      Did the same message also go out by email? Only used to show a tiny
      "emailed" hint in the UI and to help when a user says "I never got
      an email" - it is never used to decide anything.
    */
    emailSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   The bell asks two questions, over and over:

     "my newest notifications"      -> recipient + createdAt
     "how many are still unread?"   -> recipient + isRead

   One compound index answers both, because MongoDB can use the front of
   an index on its own.

   THE LAST INDEX IS DIFFERENT: expireAfterSeconds is a TTL index, which
   makes MongoDB delete the document by itself once it is 90 days old.
   Without it this collection would grow forever - it is the one
   collection in FlowDesk where nobody ever presses delete.
   ===================================================================== */
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
