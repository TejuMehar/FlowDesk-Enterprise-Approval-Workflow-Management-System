/*
=========================================================================
  COMPONENT: ApproverDashboard      ("My Approvals")
=========================================================================
  The section for people whose job is to DECIDE things.

  WHY THIS IS NOT PART OF THE TEAM DASHBOARD
  ------------------------------------------
  ManagerDashboard answers "how is my team doing?" and counts the
  requests RAISED BY the departments you manage. That is the right
  question for an Engineering Manager, because the people they manage
  and the requests they approve are the same set.

  It is the wrong question for everybody else who approves. A Finance
  Manager reviews purchases from Engineering, Sales and R&D; a Director
  signs off budgets from the whole company. None of that is raised by
  their own department, so before this section existed they could
  approve twenty requests in a morning and see nothing on their
  dashboard.

  So the two sections deliberately count DIFFERENT things, and somebody
  who is both a department manager and a busy approver sees both.
=========================================================================
*/

import { Link } from "react-router-dom";
import {
  MdOutlineFactCheck,
  MdOutlineCheckCircle,
  MdOutlineCancel,
  MdOutlineUndo,
  MdArrowForward,
  MdOutlineHowToReg,
} from "react-icons/md";

import { getPhotoUrl, formatDate } from "../../utils/config.js";
import { describePerson } from "../../utils/approvalConstants.js";
import {
  REQUEST_STATUS_LABELS,
  STATUS_BADGE_STYLES,
} from "../../utils/requestConstants.js";

import StatCard from "./StatCard.jsx";

/*
  How each of the three decisions is drawn in the list.

  The colours are the ones the rest of FlowDesk already uses for these
  words - green for approved, red for rejected, orange for returned - so
  the row reads the same way a status badge does.
*/
const DECISION_STYLES = {
  Approved: {
    label: "Approved",
    icon: <MdOutlineCheckCircle size={16} />,
    chip: "bg-green-50 text-green-700 border-green-200",
  },
  Rejected: {
    label: "Rejected",
    icon: <MdOutlineCancel size={16} />,
    chip: "bg-red-50 text-red-700 border-red-200",
  },
  Returned: {
    label: "Returned",
    icon: <MdOutlineUndo size={16} />,
    chip: "bg-orange-50 text-orange-700 border-orange-200",
  },
};

function ApproverDashboard({ data }) {
  // nothing waiting and nothing ever decided -> this section does not exist
  if (!data || !data.isApprover) {
    return null;
  }

  const { pendingApprovals, decisionCounts, recentDecisions, windowDays } =
    data;

  const decidedTotal =
    decisionCounts.approved + decisionCounts.rejected + decisionCounts.returned;

  const cards = [
    {
      label: "Waiting for me",
      value: pendingApprovals,
      icon: <MdOutlineFactCheck size={20} />,
      tone: "amber",
      note: pendingApprovals > 0 ? "needs your decision" : "all caught up",
      to: "/approvals",
    },
    {
      label: "Approved by me",
      value: decisionCounts.approved,
      icon: <MdOutlineCheckCircle size={20} />,
      tone: "green",
      note: `in the last ${windowDays} days`,
    },
    {
      label: "Rejected by me",
      value: decisionCounts.rejected,
      icon: <MdOutlineCancel size={20} />,
      tone: "red",
      note: `in the last ${windowDays} days`,
    },
    {
      label: "Returned by me",
      value: decisionCounts.returned,
      icon: <MdOutlineUndo size={20} />,
      tone: "orange",
      note: "sent back for correction",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== the four numbers ==================== */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-600">My Approvals</h2>

          <span className="text-xs text-slate-400">
            {decidedTotal} decision{decidedTotal === 1 ? "" : "s"} in the last{" "}
            {windowDays} days
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      </div>

      {/* ==================== what I recently decided ==================== */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-slate-600">
            Recently Decided by Me
          </h2>

          {recentDecisions.length > 0 && (
            <Link
              to="/approvals"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              View all <MdArrowForward size={13} />
            </Link>
          )}
        </div>

        {recentDecisions.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
            <span className="w-11 h-11 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3">
              <MdOutlineHowToReg size={22} />
            </span>
            <p className="text-sm text-slate-500">
              You have not decided on any request yet. Anything waiting for you
              is on the Approvals page.
            </p>

            <Link
              to="/approvals"
              className="inline-block mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Open Approvals
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-300 divide-y divide-slate-100">
            {recentDecisions.map((decision) => {
              const style =
                DECISION_STYLES[decision.action] || DECISION_STYLES.Approved;

              const photo = getPhotoUrl(decision.requester?.photoUrl);

              return (
                <div
                  key={`${decision.request?._id}-${decision.decidedAt}`}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  {/* ---------- who asked ---------- */}
                  {photo ? (
                    <img
                      src={photo}
                      alt=""
                      className="w-9 h-9 shrink-0 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <span className="w-9 h-9 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                      {decision.requester?.firstName?.charAt(0).toUpperCase() ||
                        "?"}
                    </span>
                  )}

                  {/* ---------- what it was ---------- */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {decision.request?.title || "Request"}
                    </p>

                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      <span className="font-medium text-slate-600">
                        {decision.request?.requestId}
                      </span>
                      {" · "}
                      {decision.request?.type}
                      {" · "}
                      {describePerson(decision.requester, "Unknown")}
                      {decision.stageName ? ` · ${decision.stageName}` : ""}
                    </p>
                  </div>

                  {/* ---------- what I said, and where it is now ----------
                      BOTH are shown on purpose. "I approved this" and
                      "it is still in progress" are different facts: my
                      yes only moved it to the next stage, and an
                      approver who sees only their own decision would
                      think it was finished.                            */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${style.chip}`}
                    >
                      {style.icon}
                      {style.label}
                    </span>

                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                      {formatDate(decision.decidedAt)}

                      {decision.request?.status && (
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            STATUS_BADGE_STYLES[decision.request.status] ||
                            "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {REQUEST_STATUS_LABELS[decision.request.status] ||
                            decision.request.status}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApproverDashboard;
