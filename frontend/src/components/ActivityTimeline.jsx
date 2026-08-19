/*
=========================================================================
  COMPONENT: ActivityTimeline   (Module 7 - Audit Logs & Activity Tracking)
=========================================================================
  The COMPLETE story of one request, on one screen, in time order.

  HOW IT IS DIFFERENT FROM <ApprovalTimeline />
  ---------------------------------------------
  They look similar and they answer different questions, which is why
  both exist and both are shown on the request pop-up:

    ApprovalTimeline  "where is this request in the workflow?"
                      the route, the stages, who still has to decide.
                      It reads the APPROVAL.

    ActivityTimeline  "everything that has ever happened to this?"
                      created, edited, submitted, decided, commented on,
                      files attached - four collections merged into one
                      list. It reads GET /api/audit/request/:id.

  The merging, the de-duplicating and the sorting are all done by the
  backend (see getRequestActivity in auditController.js). This component
  only DRAWS what it is handed, the same way ApprovalTimeline does.

  WHY IT LOADS ITS OWN DATA
  -------------------------
  Unlike ApprovalTimeline, which is given an `approval` the page had
  already fetched, nothing else on the page needs this list. Fetching it
  here means the request pop-up does not pay for it until the timeline
  is actually opened.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineHistory,
  MdCheck,
  MdClose,
  MdUndo,
  MdOutlineComment,
  MdOutlineAttachFile,
  MdOutlineEdit,
  MdOutlineAddCircleOutline,
  MdOutlineSend,
  MdOutlineDelete,
  MdArrowRightAlt,
  MdRefresh,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { getPhotoUrl } from "../utils/config.js";
import { activityDotStyle, formatMoment } from "../utils/auditConstants.js";

/*
  The icon inside the round dot.

  The ACTION is checked first and the SOURCE second, because the action
  is the more specific of the two: every approval decision arrives as
  source "Approval", but approved / rejected / returned are three very
  different pieces of news and deserve three different icons.
*/
const activityIcon = (entry) => {
  switch (entry.action) {
    case "Approved":
      return <MdCheck size={15} />;
    case "Rejected":
      return <MdClose size={15} />;
    case "Returned":
      return <MdUndo size={15} />;
    case "RequestCreated":
      return <MdOutlineAddCircleOutline size={15} />;
    case "RequestUpdated":
      return <MdOutlineEdit size={14} />;
    case "RequestSubmitted":
      return <MdOutlineSend size={14} />;
    case "RequestDeleted":
      return <MdOutlineDelete size={15} />;
    default:
      break;
  }

  // no special action, so fall back to the kind of thing it is
  if (entry.source === "Comment") return <MdOutlineComment size={14} />;
  if (entry.source === "Attachment") return <MdOutlineAttachFile size={14} />;

  return <MdOutlineHistory size={14} />;
};

function ActivityTimeline({ requestId }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  /*
    The one thing that can go wrong here and MUST be shown rather than
    swallowed: a 403 from canViewRequest(). Silently drawing "nothing
    has happened yet" to somebody who simply is not allowed to look
    would be a lie.
  */
  const [error, setError] = useState("");

  const fetchActivity = useCallback(async () => {
    if (!requestId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await api.get(`/api/audit/request/${requestId}`);
      setActivity(result.data.activity);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return (
    <div>
      {/* ==================== header ==================== */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Activity timeline
        </p>

        {/*
          A manual reload. The pop-up stays open while somebody writes a
          comment underneath it, so the timeline can fall behind what is
          on the same screen.
        */}
        <button
          onClick={fetchActivity}
          disabled={loading}
          title="Reload the timeline"
          className="text-slate-400 hover:text-slate-700 disabled:opacity-40"
        >
          <MdRefresh size={17} />
        </button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center">
          <ClipLoader size={22} color="#4f46e5" />
        </div>
      ) : error ? (
        <p className="text-sm text-slate-400">{error}</p>
      ) : activity.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing has happened yet.</p>
      ) : (
        /*
          Oldest at the top, because a story is read forwards - and
          because ApprovalTimeline directly above it reads in the same
          direction. Two timelines on one screen running opposite ways
          would be genuinely confusing.
        */
        <ol className="flex flex-col">
          {activity.map((entry, index) => {
            const isLast = index === activity.length - 1;

            return (
              <li key={index} className="flex gap-3">
                {/* ---------- the dot and the line under it ---------- */}
                <div className="flex flex-col items-center">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${activityDotStyle(
                      entry
                    )}`}
                  >
                    {activityIcon(entry)}
                  </span>

                  {/* no line after the last entry */}
                  {!isLast && <span className="w-px flex-1 bg-slate-200" />}
                </div>

                {/* ---------- what happened ---------- */}
                <div className={`flex-1 ${isLast ? "pb-0" : "pb-5"}`}>
                  <p className="text-sm text-slate-700">{entry.title}</p>

                  {/*
                    The detail is a different thing per source: the
                    words of a comment, the size of a file, or the
                    reason an approver typed. All three read best as a
                    quiet quoted line under the title.
                  */}
                  {entry.detail && (
                    <p className="text-xs text-slate-600 mt-1 bg-slate-50 rounded-lg px-3 py-2">
                      {entry.detail}
                    </p>
                  )}

                  {/*
                    THE DIFF, for the entries that carry one (an edited
                    request). Not hidden behind a toggle the way the
                    audit table does it: a request rarely has more than
                    a handful, and here they are the interesting part.
                  */}
                  {entry.changes?.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {entry.changes.map((change, changeIndex) => (
                        <li
                          key={changeIndex}
                          className="text-xs text-slate-600 flex flex-wrap items-center gap-1.5"
                        >
                          <span className="font-medium text-slate-700">
                            {change.field}:
                          </span>
                          <span className="line-through text-slate-400">
                            {change.from}
                          </span>
                          <MdArrowRightAlt
                            size={15}
                            className="text-slate-400 shrink-0"
                          />
                          <span className="text-slate-800">{change.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* ---------- who, and when ---------- */}
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                    {entry.actorPhotoUrl && (
                      <img
                        src={getPhotoUrl(entry.actorPhotoUrl)}
                        alt=""
                        className="w-4 h-4 rounded-full object-cover"
                      />
                    )}
                    {entry.actorName || "FlowDesk"}
                    {entry.actorRole ? ` (${entry.actorRole})` : ""} •{" "}
                    {formatMoment(entry.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default ActivityTimeline;
