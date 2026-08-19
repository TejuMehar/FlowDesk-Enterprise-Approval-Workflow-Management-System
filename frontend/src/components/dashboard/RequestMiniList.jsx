/*
=========================================================================
  COMPONENT: RequestMiniList
=========================================================================
  The short "latest requests" list that all three dashboards use.

  It is deliberately NOT a table. A dashboard list is read at a glance
  and on a phone; a table with six columns would either scroll sideways
  or squeeze every column to nothing. The full table lives on the
  Requests page, and the "View all" link goes there.
=========================================================================
*/

import { Link } from "react-router-dom";
import { MdOutlineAssignment, MdArrowForward } from "react-icons/md";

import { formatDate } from "../../utils/config.js";
import {
  REQUEST_STATUS_LABELS,
  STATUS_BADGE_STYLES,
} from "../../utils/requestConstants.js";
import { describePerson } from "../../utils/approvalConstants.js";

/*
  @param title         the heading above the card
  @param requests      the rows
  @param to            where "View all" goes
  @param showRequester true on the manager / admin dashboards, where the
                       rows belong to other people
  @param emptyText     what to say when there is nothing yet
*/
function RequestMiniList({
  title,
  requests = [],
  to = "/requests",
  showRequester = false,
  emptyText = "No requests yet.",
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-600">{title}</h2>

        {requests.length > 0 && (
          <Link
            to={to}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            View all <MdArrowForward size={13} />
          </Link>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
          <span className="w-11 h-11 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3">
            <MdOutlineAssignment size={22} />
          </span>
          <p className="text-sm text-slate-500">{emptyText}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-300 divide-y divide-slate-100">
          {requests.map((request) => (
            <div
              key={request._id}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {request.title}
                </p>

                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  <span className="font-medium text-slate-600">
                    {request.requestId}
                  </span>
                  {" · "}
                  {request.type}
                  {showRequester && request.requester && (
                    <> · {describePerson(request.requester, "Unknown")}</>
                  )}
                  {" · "}
                  {formatDate(request.submittedAt || request.createdAt)}
                </p>
              </div>

              <span
                className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                  STATUS_BADGE_STYLES[request.status] ||
                  "bg-slate-100 text-slate-600"
                }`}
              >
                {REQUEST_STATUS_LABELS[request.status] || request.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RequestMiniList;
