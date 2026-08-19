/*
=========================================================================
  COMPONENT: ActivityFeed          ("Recent Activity")
=========================================================================
  The newest lines of the approval timelines, whoever wrote them.

  Module 4 already writes an honest, never-edited record of everything
  that happens to a request (see approvalModel.js). This component does
  not invent an "activity log" on the side - it simply reads the newest
  lines of that record, which means the feed can never drift away from
  what really happened.

  The colours and the wording of each line come from
  utils/approvalConstants.js, the same file the timeline pop-up uses, so
  "Returned for correction" looks identical in both places.
=========================================================================
*/

import { Link } from "react-router-dom";
import { MdHistory } from "react-icons/md";

import {
  HISTORY_ACTION_LABELS,
  HISTORY_DOT_STYLES,
  describePerson,
} from "../../utils/approvalConstants.js";
import { timeAgo } from "../../utils/dashboardConstants.js";

/*
  @param items      the recentActivity array from a dashboard endpoint
  @param emptyText  what to say when nothing has happened yet
*/
function ActivityFeed({
  items = [],
  emptyText = "Nothing has happened yet. Activity shows up here as soon as a request is submitted.",
}) {
  if (!items.length) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
        <span className="w-11 h-11 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
          <MdHistory size={22} />
        </span>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-300 divide-y divide-slate-100">
      {items.map((item, index) => (
        <div
          // the same request can appear twice, so the date is part of the key
          key={`${item.request?._id || index}-${item.createdAt}`}
          className="flex items-start gap-3 px-5 py-3.5"
        >
          {/* the coloured dot says WHAT happened before a word is read */}
          <span
            className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${
              HISTORY_DOT_STYLES[item.action] || "bg-slate-100 text-slate-500"
            }`}
          >
            {/* the first letter of the action: A, R, S ... */}
            {item.action?.charAt(0)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-800">
              <span className="font-medium">
                {HISTORY_ACTION_LABELS[item.action] || item.action}
              </span>

              {item.stageName && (
                <span className="text-slate-500"> at {item.stageName}</span>
              )}
            </p>

            {/* which request this was about */}
            {item.request?._id && (
              <Link
                to="/requests"
                className="text-xs text-slate-500 hover:text-indigo-600 transition-colors block truncate mt-0.5"
              >
                <span className="font-medium text-slate-600">
                  {item.request.requestId}
                </span>{" "}
                {item.request.title}
              </Link>
            )}

            {/* the comment an approver left, if there was one */}
            {item.comment && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 italic">
                “{item.comment}”
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <p className="text-xs text-slate-400">{timeAgo(item.createdAt)}</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[120px]">
              {/* an empty actor means the SYSTEM did it (an auto approval rule) */}
              {describePerson(item.actor, "System")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ActivityFeed;
