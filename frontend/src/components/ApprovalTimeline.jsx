/*
=========================================================================
  COMPONENT: ApprovalTimeline   (Module 4 - Approval Engine)
=========================================================================
  Shows everything that has happened, and still has to happen, to one
  request. It is used in TWO places, which is exactly why it is its own
  component:

    - Requests.jsx  -> the employee watches their own request travel
    - Approvals.jsx -> the approver sees the whole story before deciding

  It draws two lists under each other:

    1. THE ROUTE      - every stage, with the one the request is standing
                        at highlighted
    2. WHAT HAPPENED  - the timeline, newest at the bottom, including the
                        comment every approver wrote

  It only DRAWS. Loading the approval and pressing the buttons is the
  job of the page that uses it.
=========================================================================
*/

import {
  MdCheck,
  MdClose,
  MdHourglassEmpty,
  MdRemove,
  MdUndo,
  MdOutlineComment,
} from "react-icons/md";

import { formatDate } from "../utils/config.js";
import {
  STAGE_STATUS_LABELS,
  STAGE_DOT_STYLES,
  STAGE_BADGE_STYLES,
  HISTORY_ACTION_LABELS,
  HISTORY_DOT_STYLES,
  describePerson,
  describeStageApprover,
  describeApprovalRule,
} from "../utils/approvalConstants.js";

/*
  The little icon inside the round dot. It says at a glance what
  happened, without having to read the label next to it.
*/
const stageIcon = (status) => {
  if (status === "Approved") return <MdCheck size={15} />;
  if (status === "Rejected") return <MdClose size={15} />;
  if (status === "Returned") return <MdUndo size={15} />;
  if (status === "Pending") return <MdHourglassEmpty size={14} />;
  return <MdRemove size={15} />;
};

/*
  Dates in the timeline need the TIME as well ("14 Aug 2026, 10:42"),
  because two decisions can easily happen on the same day.
  formatDate() in utils/config.js only gives the day, so we add to it.
*/
const formatMoment = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return "";
  }

  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${formatDate(value)}, ${time}`;
};

function ApprovalTimeline({ approval }) {
  if (!approval) {
    return (
      <p className="text-sm text-slate-400">
        This request has not been sent through a workflow yet.
      </p>
    );
  }

  const stages = approval.stages || [];
  const history = approval.history || [];

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== 1) THE ROUTE ==================== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Approval route
          </p>
          {approval.workflowName && (
            <p className="text-xs text-slate-400">{approval.workflowName}</p>
          )}
        </div>

        <ol className="flex flex-col">
          {stages.map((stage, index) => {
            const isCurrent = stage.order === approval.currentStage;
            const isLast = index === stages.length - 1;
            const rule = describeApprovalRule(stage);

            return (
              <li key={stage.order} className="flex gap-3">
                {/* ---------- the dot and the line under it ---------- */}
                <div className="flex flex-col items-center">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      STAGE_DOT_STYLES[stage.status] || STAGE_DOT_STYLES.Waiting
                    }`}
                  >
                    {stageIcon(stage.status)}
                  </span>

                  {/* no line after the last stage */}
                  {!isLast && <span className="w-px flex-1 bg-slate-200" />}
                </div>

                {/* ---------- the text of the stage ---------- */}
                <div className={`pb-5 flex-1 ${isLast ? "pb-0" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`text-sm ${
                        isCurrent
                          ? "font-semibold text-slate-800"
                          : "font-medium text-slate-700"
                      }`}
                    >
                      {stage.order}. {stage.name}
                    </p>

                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${
                        STAGE_BADGE_STYLES[stage.status] ||
                        STAGE_BADGE_STYLES.Waiting
                      }`}
                    >
                      {STAGE_STATUS_LABELS[stage.status] || stage.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mt-0.5">
                    {describeStageApprover(stage)}
                    {rule ? ` - ${rule}` : ""}
                  </p>

                  {/* the real people this stage worked out to */}
                  {stage.approvers?.length > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {stage.approvers
                        .map((approver) => describePerson(approver, ""))
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}

                  {/* what the people at THIS stage answered */}
                  {stage.decisions?.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {stage.decisions.map((decision, decisionIndex) => (
                        <li
                          key={decisionIndex}
                          className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2"
                        >
                          <span className="font-medium">
                            {describePerson(decision.approver)}
                          </span>{" "}
                          {decision.action === "Approve"
                            ? "approved"
                            : decision.action === "Reject"
                            ? "rejected"
                            : "returned"}{" "}
                          this
                          <span className="text-slate-400">
                            {" "}
                            - {formatMoment(decision.decidedAt)}
                          </span>
                          {decision.comment && (
                            <span className="block mt-1 text-slate-600 italic">
                              "{decision.comment}"
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ==================== 2) WHAT HAPPENED ==================== */}
      <div className="pt-5 border-t border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          History
        </p>

        {history.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing has happened yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {history.map((entry, index) => (
              <li key={index} className="flex gap-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                    HISTORY_DOT_STYLES[entry.action] || "bg-slate-200"
                  }`}
                />

                <div className="flex-1">
                  <p className="text-sm text-slate-700">
                    {HISTORY_ACTION_LABELS[entry.action] || entry.action}
                    {entry.stageName && (
                      <span className="text-slate-400">
                        {" "}
                        - {entry.stageName}
                      </span>
                    )}
                  </p>

                  <p className="text-xs text-slate-400 mt-0.5">
                    {describePerson(entry.actor, "FlowDesk")} •{" "}
                    {formatMoment(entry.createdAt)}
                  </p>

                  {entry.comment && (
                    <p className="text-xs text-slate-600 mt-1 flex items-start gap-1.5">
                      <MdOutlineComment
                        size={14}
                        className="mt-0.5 shrink-0 text-slate-400"
                      />
                      {entry.comment}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default ApprovalTimeline;
