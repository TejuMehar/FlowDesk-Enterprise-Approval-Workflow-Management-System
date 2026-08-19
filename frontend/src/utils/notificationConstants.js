/*
=========================================================================
  NOTIFICATION CONSTANTS   (Module 6 - Notification & Communication)
=========================================================================
  A frontend copy of backend/config/notificationConstants.js.

  It is used to fill the filter dropdown on the Notifications page, and
  to give every kind of notification its own colour and icon so the bell
  can be understood at a glance, without reading a single word.
=========================================================================
*/

export const NOTIFICATION_TYPES = [
  "NewRequest",
  "Approved",
  "Rejected",
  "Returned",
  "NewComment",
  "PendingReminder",
  "Escalation",
  "DailySummary",
  // Module 12 - the only notification that is not about a request
  "SalaryPublished",
];

// what the filter dropdown calls each one
export const NOTIFICATION_TYPE_LABELS = {
  NewRequest: "Needs my approval",
  Approved: "Approved",
  Rejected: "Rejected",
  Returned: "Returned",
  NewComment: "Comments",
  PendingReminder: "Reminders",
  Escalation: "Escalations",
  DailySummary: "Daily summary",
  SalaryPublished: "Payslips",
};

/*
  The colour of the little round icon in front of each notification.

  They follow the same colour language the rest of FlowDesk already
  uses for approvals: green = yes, red = no, orange = come back to me,
  amber = something is waiting, indigo = information.
*/
export const NOTIFICATION_DOT_STYLES = {
  NewRequest: "bg-indigo-50 text-indigo-600",
  Approved: "bg-green-50 text-green-600",
  Rejected: "bg-red-50 text-red-600",
  Returned: "bg-orange-50 text-orange-600",
  NewComment: "bg-slate-100 text-slate-600",
  PendingReminder: "bg-amber-50 text-amber-600",
  Escalation: "bg-red-50 text-red-600",
  DailySummary: "bg-blue-50 text-blue-600",
  // green, like an approval: a payslip arriving is good news
  SalaryPublished: "bg-emerald-50 text-emerald-600",
};

/*
  How long a comment may still be deleted by the person who wrote it.
  Must match COMMENT_DELETE_WINDOW_MINUTES in the backend - the frontend
  only uses it to decide whether to DRAW the little bin icon; the
  backend is what actually refuses a late delete.
*/
export const COMMENT_DELETE_WINDOW_MINUTES = 15;

export const MAX_COMMENT_LENGTH = 1000;

/*
  "just now", "5 min ago", "3 h ago", "2 d ago", then the plain date.

  A bell is read in a hurry, so a relative time is much easier to take
  in than "31 Jul 2026, 14:05". Anything older than a week goes back to
  a normal date, because "23 d ago" tells nobody anything.
*/
export const timeAgo = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days} d ago`;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/*
  "Ravi Sharma" out of a populated user, or "FlowDesk" when there is no
  actor at all - which is exactly what a reminder looks like, because
  the system itself wrote it.
*/
export const describeSender = (actor) => {
  if (!actor) {
    return "FlowDesk";
  }

  return `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || "FlowDesk";
};
