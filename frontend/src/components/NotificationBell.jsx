/*
=========================================================================
  COMPONENT: NotificationBell   (Module 6)
=========================================================================
  The bell in the navbar, with the little red number on it.

  It does three things:

    1. asks the backend every 60 seconds how many unread notifications
       there are, and paints that number on the bell
    2. loads the newest 8 when the user opens the dropdown - not before,
       because most of the time nobody opens it
    3. clicking one marks it as read and jumps to the page it is about
       (/approvals for something to decide, /requests for your own)

  WHY POLLING AND NOT WEBSOCKETS
  ------------------------------
  A websocket would be instant, but it would also mean a second server
  process, a second connection to keep alive and a reconnect story for
  every dropped wifi. An approval workflow is not a chat app: learning
  about a new request within a minute is perfectly good, and a plain
  setInterval + one very cheap endpoint (/unread-count is a single
  countDocuments) costs nothing.
=========================================================================
*/

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ClipLoader } from "react-spinners";
import {
  MdNotificationsNone,
  MdDoneAll,
  MdOutlineAssignment,
  MdCheckCircle,
  MdCancel,
  MdUndo,
  MdOutlineComment,
  MdAccessTime,
  MdPriorityHigh,
  MdOutlineSummarize,
} from "react-icons/md";

import { api } from "../utils/api.js";
import {
  NOTIFICATION_DOT_STYLES,
  describeSender,
  timeAgo,
} from "../utils/notificationConstants.js";

// how often we ask "anything new?" - see the note at the top of the file
const POLL_MILLISECONDS = 60 * 1000;

/*
  The icon inside the round badge. Exported because the Notifications
  page draws exactly the same list and must not invent its own icons.
*/
export const notificationIcon = (type) => {
  if (type === "NewRequest") return <MdOutlineAssignment size={16} />;
  if (type === "Approved") return <MdCheckCircle size={16} />;
  if (type === "Rejected") return <MdCancel size={16} />;
  if (type === "Returned") return <MdUndo size={16} />;
  if (type === "NewComment") return <MdOutlineComment size={16} />;
  if (type === "PendingReminder") return <MdAccessTime size={16} />;
  if (type === "Escalation") return <MdPriorityHigh size={16} />;
  return <MdOutlineSummarize size={16} />;
};

function NotificationBell() {
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const panelRef = useRef(null);

  /* =================================================================
     THE BADGE
     ---------------------------------------------------------------
     This runs whether the dropdown is open or not, so the number is
     already right the first time the user looks at it.

     The errors are swallowed on purpose: a failed background poll must
     not throw a red toast across a page the user is working on. The
     worst case is a number that is one minute old.
     ================================================================= */
  const fetchUnreadCount = useCallback(async () => {
    try {
      const result = await api.get("/api/notification/unread-count");
      setUnreadCount(result.data.unreadCount);
    } catch {
      // stay quiet - see the comment above
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();

    const timer = setInterval(fetchUnreadCount, POLL_MILLISECONDS);

    // React runs this when the component disappears (logout, page change)
    return () => clearInterval(timer);
  }, [fetchUnreadCount]);

  /* =================================================================
     THE LIST  -  only loaded when the dropdown is opened
     ================================================================= */
  const fetchNotifications = async () => {
    setLoading(true);

    try {
      const result = await api.get("/api/notification/my?page=1&limit=8");
      setNotifications(result.data.notifications);
      setUnreadCount(result.data.unreadCount);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDropdown = () => {
    const willOpen = !isOpen;

    setIsOpen(willOpen);

    if (willOpen) {
      fetchNotifications();
    }
  };

  // close when the user clicks anywhere else, like the profile menu does
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* =================================================================
     CLICKING ONE NOTIFICATION
     ---------------------------------------------------------------
     Mark it read, then go where it points. The "mark read" is not
     awaited before navigating - the user should not wait for a
     bookkeeping call to see the page they asked for.
     ================================================================= */
  const openNotification = (notification) => {
    setIsOpen(false);

    if (!notification.isRead) {
      setUnreadCount((count) => Math.max(count - 1, 0));

      /*
        NOT awaited, which is what the comment above has always said and
        what the code did not do. `await` here put a round trip between
        the click and the page: on a slow connection the dropdown shut,
        nothing else happened for a second, and then the page changed -
        long enough for people to click a second notification in the
        gap. Marking something as read is bookkeeping; nobody should
        wait for it.

        .catch() is required rather than optional now: an un-awaited
        promise that rejects with nobody listening is an unhandled
        rejection in the console.
      */
      api
        .patch(`/api/notification/${notification._id}/read`)
        .catch(() => {
          // if it fails the next poll simply shows it as unread again
        });
    }

    navigate(notification.link || "/");
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch("/api/notification/read-all");

      setNotifications((list) =>
        list.map((item) => ({ ...item, isRead: true }))
      );
      setUnreadCount(0);
    } catch {
      // same reasoning as above: never shout at the user from the navbar
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* ==================== the bell ==================== */}
      <button
        onClick={toggleDropdown}
        title="Notifications"
        className="relative w-10 h-10 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 flex items-center justify-center transition-colors"
      >
        <MdNotificationsNone size={22} />

        {/* the red number, only when there is something unread */}
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ==================== the dropdown ==================== */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-[330px] sm:w-[380px] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          {/* ---------- header ---------- */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  ({unreadCount} new)
                </span>
              )}
            </p>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <MdDoneAll size={15} /> Mark all read
              </button>
            )}
          </div>

          {/* ---------- the list ---------- */}
          <div className="max-h-[380px] overflow-y-auto">
            {loading ? (
              <div className="py-10 flex justify-center">
                <ClipLoader size={24} color="#4f46e5" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                You have no notifications yet.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification._id}
                  onClick={() => openNotification(notification)}
                  className={`w-full text-left px-4 py-3 flex gap-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${
                    notification.isRead ? "" : "bg-indigo-50/40"
                  }`}
                >
                  {/* the coloured icon that says what kind it is */}
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      NOTIFICATION_DOT_STYLES[notification.type] ||
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {notificationIcon(notification.type)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm truncate ${
                        notification.isRead
                          ? "text-slate-700"
                          : "text-slate-900 font-medium"
                      }`}
                    >
                      {notification.title}
                    </p>

                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {notification.message}
                    </p>

                    <p className="text-[11px] text-slate-400 mt-1">
                      {describeSender(notification.actor)} •{" "}
                      {timeAgo(notification.createdAt)}
                    </p>
                  </div>

                  {/* the small blue dot on the ones not read yet */}
                  {!notification.isRead && (
                    <span className="w-2 h-2 rounded-full bg-indigo-500 mt-2 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* ---------- footer ---------- */}
          <button
            onClick={() => {
              setIsOpen(false);
              navigate("/notifications");
            }}
            className="w-full px-4 py-2.5 text-sm text-indigo-600 hover:bg-slate-50 border-t border-slate-100"
          >
            See all notifications
          </button>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
