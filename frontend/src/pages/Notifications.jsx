/*
=========================================================================
  PAGE: Notifications   (Module 6 - Notification & Communication)
=========================================================================
  The full version of the bell in the navbar.

  The dropdown shows the newest 8 and is meant to be glanced at. This
  page is for going back through everything:

    - two tabs: All / Unread
    - a filter by kind ("only the reminders", "only the comments")
    - pagination, like every other list in FlowDesk
    - mark one as read, mark everything as read, delete one, or clear
      out everything that has already been read

  Every route it calls is scoped to the logged in user by the backend
  (recipient: req.userId), so this page never has to think about whose
  notifications it is showing.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdDoneAll,
  MdDelete,
  MdChevronLeft,
  MdChevronRight,
  MdOutlineCleaningServices,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_DOT_STYLES,
  describeSender,
  timeAgo,
} from "../utils/notificationConstants.js";
import { notificationIcon } from "../components/NotificationBell.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

function Notifications() {
  const navigate = useNavigate();

  /* ---------------- the data ---------------- */
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  /* ---------------- tab + filter + pages ---------------- */
  const [tab, setTab] = useState("all"); // "all" | "unread"
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalNotifications, setTotalNotifications] = useState(0);

  /* ---------------- the "clear read ones" pop-up ---------------- */
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearing, setClearing] = useState(false);

  /* =================================================================
     LOAD THE LIST
     ================================================================= */
  const fetchNotifications = useCallback(async () => {
    setLoading(true);

    try {
      const query = new URLSearchParams({ page: String(page), limit: "15" });

      if (tab === "unread") query.append("unread", "true");
      if (typeFilter) query.append("type", typeFilter);

      const result = await api.get(`/api/notification/my?${query.toString()}`);

      setNotifications(result.data.notifications);
      setUnreadCount(result.data.unreadCount);
      setTotalPages(result.data.pagination.totalPages);
      setTotalNotifications(result.data.pagination.totalNotifications);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [tab, typeFilter, page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  /* =================================================================
     OPEN ONE
     ---------------------------------------------------------------
     Same behaviour as the bell: mark it read, then go to the page it
     is about.
     ================================================================= */
  const openNotification = async (notification) => {
    if (!notification.isRead) {
      try {
        await api.patch(`/api/notification/${notification._id}/read`);
      } catch {
        // the list is reloaded on the next visit anyway
      }
    }

    navigate(notification.link || "/");
  };

  /* =================================================================
     MARK EVERYTHING AS READ
     ================================================================= */
  const handleMarkAllRead = async () => {
    try {
      const result = await api.patch("/api/notification/read-all");

      toast.success(result.data.message);
      fetchNotifications();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  /* =================================================================
     DELETE ONE
     ---------------------------------------------------------------
     No confirmation pop-up here on purpose: deleting one notification
     destroys nothing - the request, the approval and the timeline it
     talks about are all still there.
     ================================================================= */
  const handleDelete = async (notification) => {
    try {
      await api.delete(`/api/notification/${notification._id}`);

      /*
        Taking the row out of the list straight away feels instant. We
        still reload afterwards, because deleting the last row of a page
        can change how many pages there are.
      */
      setNotifications((list) =>
        list.filter((item) => item._id !== notification._id)
      );

      fetchNotifications();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  /* =================================================================
     CLEAR EVERYTHING ALREADY READ
     ---------------------------------------------------------------
     This one DOES ask first - it can remove a hundred rows at once.
     ================================================================= */
  const handleClearRead = async () => {
    setClearing(true);

    try {
      const result = await api.delete("/api/notification/read");

      toast.success(result.data.message);
      setPage(1);
      fetchNotifications();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setClearing(false);
      setShowClearDialog(false);
    }
  };

  const tabs = [
    { key: "all", label: "All" },
    { key: "unread", label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalNotifications} notification
            {totalNotifications === 1 ? "" : "s"}
            {unreadCount > 0 ? `, ${unreadCount} unread` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <MdDoneAll size={17} /> Mark all read
          </button>

          <button
            onClick={() => setShowClearDialog(true)}
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 flex items-center gap-1.5"
          >
            <MdOutlineCleaningServices size={17} /> Clear read
          </button>
        </div>
      </div>

      {/* ==================== tabs ==================== */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setTab(item.key);
              setPage(1);
            }}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              tab === item.key
                ? "border-indigo-600 text-indigo-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ==================== filter ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white w-full sm:w-64"
        >
          <option value="">All kinds</option>
          {NOTIFICATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {NOTIFICATION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {/* ==================== the list ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-16 flex justify-center">
            <ClipLoader size={35} color="#4f46e5" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            {tab === "unread"
              ? "You have read everything. Nice."
              : "You have no notifications yet."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((notification) => (
              <div
                key={notification._id}
                className={`flex gap-3 px-5 py-4 hover:bg-slate-50 transition-colors ${
                  notification.isRead ? "" : "bg-indigo-50/40"
                }`}
              >
                {/* ---------- the kind of notification ---------- */}
                <span
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    NOTIFICATION_DOT_STYLES[notification.type] ||
                    "bg-slate-100 text-slate-600"
                  }`}
                >
                  {notificationIcon(notification.type)}
                </span>

                {/* ---------- the message, clickable ---------- */}
                <button
                  onClick={() => openNotification(notification)}
                  className="flex-1 text-left min-w-0"
                >
                  <p
                    className={`text-sm ${
                      notification.isRead
                        ? "text-slate-700"
                        : "text-slate-900 font-medium"
                    }`}
                  >
                    {notification.title}
                  </p>

                  <p className="text-sm text-slate-600 mt-0.5">
                    {notification.message}
                  </p>

                  <p className="text-xs text-slate-400 mt-1">
                    {describeSender(notification.actor)} •{" "}
                    {timeAgo(notification.createdAt)}
                    {notification.request?.requestId
                      ? ` • ${notification.request.requestId}`
                      : ""}
                  </p>
                </button>

                {/* ---------- delete ---------- */}
                <button
                  title="Delete"
                  onClick={() => handleDelete(notification)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center shrink-0"
                >
                  <MdDelete size={17} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ==================== pagination ==================== */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <p className="text-sm text-slate-500">
              Page {page} of {totalPages}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page === 1}
                className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
              >
                <MdChevronLeft size={20} />
              </button>

              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page === totalPages}
                className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
              >
                <MdChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ==================== clear confirmation ==================== */}
      <ConfirmDialog
        isOpen={showClearDialog}
        title="Clear read notifications?"
        message="Every notification you have already read will be removed. The unread ones stay where they are."
        confirmText="Clear"
        loading={clearing}
        onConfirm={handleClearRead}
        onCancel={() => setShowClearDialog(false)}
      />
    </div>
  );
}

export default Notifications;
