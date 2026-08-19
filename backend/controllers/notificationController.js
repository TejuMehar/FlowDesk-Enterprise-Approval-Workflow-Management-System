/*
=========================================================================
  CONTROLLER: Notification                        ( the "C" of MVC )
=========================================================================
  Module 6 - Notification & Communication.

  FUNCTIONS IN THIS FILE
    getMyNotifications    GET     /api/notification/my
    getUnreadCount        GET     /api/notification/unread-count
    markAsRead            PATCH   /api/notification/:id/read
    markAllAsRead         PATCH   /api/notification/read-all
    deleteNotification    DELETE  /api/notification/:id
    clearReadNotifications DELETE /api/notification/read

  THE RULE OF THIS WHOLE FILE
  ---------------------------
  Every single query below carries `recipient: req.userId`.

  That one condition is the entire security model of the module: a
  notification belongs to exactly one person, so a user who guesses
  somebody else's notification id gets a 404, not their message. It is
  the same trick requestController.js uses with `requester: req.userId`.

  WHY THERE IS NO PERMISSION ON THESE ROUTES
  ------------------------------------------
  Reading your own bell is like reading your own requests - it is your
  own paperwork. Asking an admin to grant "notification:read" before an
  employee may see a message that was sent TO them would be strange, so
  routes/notificationRoute.js only asks for a login.

  NOBODY CAN CREATE A NOTIFICATION FROM THE OUTSIDE.
  There is no POST route here on purpose. Notifications are written by
  config/notificationService.js when something really happened, so an
  employee cannot send themselves "your request was approved".
=========================================================================
*/

import Notification from "../model/notificationModel.js";
import { isValidObjectId } from "../config/validation.js";
import { NOTIFICATION_TYPES } from "../config/notificationConstants.js";

/*
  The bell shows who caused the notification and which request it is
  about, so both are populated - but only with the few fields the UI
  really draws.
*/
const LIST_POPULATE = [
  { path: "actor", select: "firstName lastName employeeId photoUrl" },
  { path: "request", select: "requestId title type status" },
];

/* =====================================================================
   1) MY NOTIFICATIONS
   ---------------------------------------------------------------------
   GET /api/notification/my?page=1&limit=10&unread=true&type=NewComment

   Used twice by the frontend, with different limits:
     - the bell dropdown asks for the newest 8
     - the Notifications page asks for a full page of 15, with filters
   ===================================================================== */
export const getMyNotifications = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const { unread, type } = req.query;

    const filter = { recipient: req.userId };

    // "unread=true" is the "Unread" tab; anything else means "all"
    if (unread === "true") {
      filter.isRead = false;
    }

    if (type && NOTIFICATION_TYPES.includes(type)) {
      filter.type = type;
    }

    const skip = (page - 1) * limit;

    /*
      Three questions in one trip: the page itself, how many match the
      filter, and how many are unread overall. The last one is what the
      little red badge shows, and it must NOT follow the filter - the
      badge counts everything unread, not everything unread on this page.
    */
    const [notifications, totalNotifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .populate(LIST_POPULATE)
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit)
        // MODULE 10 - read-only list, see the note in requestController.js
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.userId, isRead: false }),
    ]);

    return res.status(200).json({
      message: "Notifications fetched successfully",
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        totalNotifications,
        totalPages: Math.ceil(totalNotifications / limit),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Notifications Error ${error}` });
  }
};

/* =====================================================================
   2) HOW MANY UNREAD?
   ---------------------------------------------------------------------
   GET /api/notification/unread-count

   The frontend calls this every minute to keep the red badge fresh, so
   it is deliberately the cheapest route in FlowDesk: one countDocuments
   answered straight from the { recipient, isRead } index, no documents
   loaded at all.
   ===================================================================== */
export const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.userId,
      isRead: false,
    });

    return res.status(200).json({
      message: "Unread count fetched successfully",
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({ message: `Unread Count Error ${error}` });
  }
};

/* =====================================================================
   3) MARK ONE AS READ
   ---------------------------------------------------------------------
   PATCH /api/notification/:id/read
   ===================================================================== */
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    /*
      findOneAndUpdate with BOTH the id and the recipient does the
      security check and the update in one go: a notification belonging
      to somebody else simply does not match, so it comes back null.
    */
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    ).populate(LIST_POPULATE);

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.userId,
      isRead: false,
    });

    return res.status(200).json({
      message: "Notification marked as read",
      notification,
      unreadCount,
    });
  } catch (error) {
    return res.status(500).json({ message: `Mark As Read Error ${error}` });
  }
};

/* =====================================================================
   4) MARK EVERYTHING AS READ
   ---------------------------------------------------------------------
   PATCH /api/notification/read-all

   updateMany only touches the ones that are still unread, so the
   readAt time of something read last week is not rewritten to today.
   ===================================================================== */
export const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.status(200).json({
      message:
        result.modifiedCount > 0
          ? `${result.modifiedCount} notification${
              result.modifiedCount === 1 ? "" : "s"
            } marked as read`
          : "You had nothing unread",
      unreadCount: 0,
    });
  } catch (error) {
    return res.status(500).json({ message: `Mark All As Read Error ${error}` });
  }
};

/* =====================================================================
   5) DELETE ONE
   ---------------------------------------------------------------------
   DELETE /api/notification/:id

   A real delete, not a soft one. A notification is only a message about
   something that happened - the event itself is safe on the Request and
   the Approval - so there is nothing to keep here.
   ===================================================================== */
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: req.userId,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.userId,
      isRead: false,
    });

    return res.status(200).json({
      message: "Notification deleted successfully",
      unreadCount,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete Notification Error ${error}` });
  }
};

/* =====================================================================
   6) CLEAR EVERYTHING I HAVE ALREADY READ
   ---------------------------------------------------------------------
   DELETE /api/notification/read

   The "clean up my bell" button. Unread ones are deliberately left
   alone: they are the whole point of the bell, and losing one to a
   mis-click would mean never learning about it.
   ===================================================================== */
export const clearReadNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      recipient: req.userId,
      isRead: true,
    });

    return res.status(200).json({
      message:
        result.deletedCount > 0
          ? `${result.deletedCount} notification${
              result.deletedCount === 1 ? "" : "s"
            } cleared`
          : "There was nothing to clear",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Clear Notifications Error ${error}` });
  }
};
