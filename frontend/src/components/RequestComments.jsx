/*
=========================================================================
  COMPONENT: RequestComments   (Module 6 - the communication half)
=========================================================================
  The conversation that sits under the approval timeline of one request:

      Meera (Finance) : "Can you attach the quotation please?"
      Ravi (employee) : "Added it, thanks!"

  Like <ApprovalTimeline />, it is a component and not a page because it
  is used from BOTH sides of the same request:

    Requests.jsx  -> the employee talks to whoever is holding it up
    Approvals.jsx -> the approver asks for what is missing, instead of
                     having to return the whole request for a typo

  That last sentence is the point of the whole feature: before this, an
  approver who only needed one small clarification had to REJECT or
  RETURN the request, which threw away every approval it had already
  collected. Now they can simply ask.

  WHO CAN SEE IT
  --------------
  The backend decides (config/requestAccess.js): the employee, everybody
  the workflow points at, and anybody who already acted on it. This
  component just shows what it is given, and hides itself when the
  answer is 403.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdSend, MdDelete, MdOutlineForum } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import { getPhotoUrl } from "../utils/config.js";
import {
  MAX_COMMENT_LENGTH,
  COMMENT_DELETE_WINDOW_MINUTES,
  timeAgo,
} from "../utils/notificationConstants.js";

function RequestComments({ requestId, canWrite = true }) {
  const { userData } = useSelector((state) => state.user);

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // 403 = "you are not part of this request" -> draw nothing at all
  const [blocked, setBlocked] = useState(false);

  const canRead = hasPermission(userData, PERMISSIONS.COMMENT_READ);
  const canCreate = hasPermission(userData, PERMISSIONS.COMMENT_CREATE);
  const canDelete = hasPermission(userData, PERMISSIONS.COMMENT_DELETE);

  /* =================================================================
     LOAD THE CONVERSATION
     ================================================================= */
  const fetchComments = useCallback(async () => {
    if (!requestId || !canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const result = await api.get(`/api/comment/request/${requestId}`);
      setComments(result.data.comments);
      setBlocked(false);
    } catch (error) {
      /*
        A 403 here is not a bug and not worth a toast: it simply means
        this user is not part of this request, which happens when an
        admin opens somebody else's request from the workflow screens.
      */
      if (error?.response?.status === 403) {
        setBlocked(true);
      } else {
        toast.error(getErrorMessage(error));
      }

      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [requestId, canRead]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  /* =================================================================
     WRITE ONE
     ================================================================= */
  const handleSend = async () => {
    const text = message.trim();

    if (!text) {
      toast.error("Please write something first");
      return;
    }

    setSending(true);

    try {
      const result = await api.post(`/api/comment/request/${requestId}`, {
        message: text,
      });

      // add it to the bottom straight away, so the reply feels instant
      setComments((list) => [...list, result.data.comment]);
      setMessage("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  /* =================================================================
     DELETE YOUR OWN
     ---------------------------------------------------------------
     The backend refuses anything older than the window, so this is
     only about not DRAWING a button that would fail.
     ================================================================= */
  const isMine = (comment) =>
    String(comment.author?._id) === String(userData?._id);

  const isStillDeletable = (comment) => {
    const ageInMinutes = (Date.now() - new Date(comment.createdAt)) / 60000;

    return ageInMinutes <= COMMENT_DELETE_WINDOW_MINUTES;
  };

  const handleDelete = async (comment) => {
    try {
      await api.delete(`/api/comment/${comment._id}`);

      /*
        A deleted comment keeps its place in the conversation and loses
        its words - the same thing the backend does - because an
        approver may already have read it and decided because of it.
      */
      setComments((list) =>
        list.map((item) =>
          item._id === comment._id
            ? { ...item, isDeleted: true, message: "This comment was deleted" }
            : item
        )
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  /* =================================================================
     NOTHING TO SHOW
     ================================================================= */
  if (!canRead || blocked) {
    return null;
  }

  const showBox = canWrite && canCreate;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
        <MdOutlineForum size={15} />
        Comments
        {comments.length > 0 && (
          <span className="font-normal normal-case tracking-normal text-slate-400">
            ({comments.length})
          </span>
        )}
      </p>

      {/* ==================== the conversation ==================== */}
      {loading ? (
        <div className="py-6 flex justify-center">
          <ClipLoader size={22} color="#4f46e5" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400">
          No comments yet. Ask a question here instead of returning the whole
          request for something small.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment._id} className="flex gap-3">
              {/* ---------- who wrote it ---------- */}
              {comment.author?.photoUrl ? (
                <img
                  src={getPhotoUrl(comment.author.photoUrl)}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-medium shrink-0">
                  {comment.author?.firstName?.charAt(0).toUpperCase() || "?"}
                </div>
              )}

              {/* ---------- what they said ---------- */}
              <div className="flex-1 min-w-0">
                <div className="bg-slate-50 rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {comment.author?.firstName} {comment.author?.lastName}
                      {comment.author?.designation && (
                        <span className="font-normal text-slate-400">
                          {" "}
                          • {comment.author.designation}
                        </span>
                      )}
                    </p>

                    {/* the bin, only on your own and only for a few minutes */}
                    {!comment.isDeleted &&
                      isMine(comment) &&
                      canDelete &&
                      isStillDeletable(comment) && (
                        <button
                          title={`You can delete this for ${COMMENT_DELETE_WINDOW_MINUTES} minutes`}
                          onClick={() => handleDelete(comment)}
                          className="text-slate-400 hover:text-red-600 shrink-0"
                        >
                          <MdDelete size={16} />
                        </button>
                      )}
                  </div>

                  <p
                    className={`text-sm mt-1 whitespace-pre-wrap break-words ${
                      comment.isDeleted
                        ? "text-slate-400 italic"
                        : "text-slate-700"
                    }`}
                  >
                    {comment.message}
                  </p>
                </div>

                <p className="text-[11px] text-slate-400 mt-1 ml-1">
                  {timeAgo(comment.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ==================== write a new one ==================== */}
      {showBox && (
        <div className="mt-4 flex gap-2 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder="Write a comment..."
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 resize-none"
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
          >
            {sending ? (
              <ClipLoader size={16} color="white" />
            ) : (
              <>
                <MdSend size={16} /> Send
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default RequestComments;
