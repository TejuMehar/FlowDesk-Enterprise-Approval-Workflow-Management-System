/*
=========================================================================
  ROUTES: Notification      ->  mounted at  /api/notification
=========================================================================
  Module 6 - Notification & Communication.

  THESE ROUTES ASK FOR A LOGIN AND NOTHING ELSE.

  Every other module checks a permission as well, so the missing
  checkPermission() here is a decision, not an oversight: a notification
  belongs to ONE person, and reading a message that was sent to you is
  like reading your own requests. There is no admin who should have to
  grant that first.

  The controller adds `recipient: req.userId` to every single query, so
  "only my own" is enforced by the data, not by a role.

  NOTE the order of the last two routes. Express matches from the top
  down, so "/read" must be written BEFORE "/:id" - otherwise express
  would read the word "read" as an id and answer "Invalid notification
  id".
=========================================================================
*/

import express from "express";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
} from "../controllers/notificationController.js";
import isAuth from "../middleware/isAuth.js";

const router = express.Router();

/* ---------------- reading ---------------- */

router.get("/my", isAuth, getMyNotifications);

router.get("/unread-count", isAuth, getUnreadCount);

/* ---------------- marking as read ---------------- */

// again: the fixed word first, the :id pattern after it
router.patch("/read-all", isAuth, markAllAsRead);

router.patch("/:id/read", isAuth, markAsRead);

/* ---------------- deleting ---------------- */

router.delete("/read", isAuth, clearReadNotifications);

router.delete("/:id", isAuth, deleteNotification);

export default router;
