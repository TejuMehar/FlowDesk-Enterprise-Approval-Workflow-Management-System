/*
=========================================================================
  PAGE: Approvals   (Module 4 - Approval Engine)
=========================================================================
  The other side of the Requests page.

  Requests.jsx is "the things I ASKED for".
  This page is "the things somebody is ASKING ME to decide".

  It has two tabs:

    PENDING  - requests standing at a stage that points at me. These are
               the ones with the three buttons.
    HISTORY  - requests I have already decided on. Read only, so I can
               look up what I said and why.

  Opening a row shows the full request PLUS the whole approval timeline
  (<ApprovalTimeline />), because nobody should approve something without
  seeing what the people before them already said.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdSearch,
  MdVisibility,
  MdChevronLeft,
  MdChevronRight,
  MdCheckCircle,
  MdCancel,
  MdUndo,
  MdAttachFile,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import { getPhotoUrl, formatDate } from "../utils/config.js";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUS_LABELS,
  STATUS_BADGE_STYLES,
  PRIORITY_BADGE_STYLES,
} from "../utils/requestConstants.js";
/*
  MODULE 9 - the request types are configured by an administrator now,
  so the dropdown is filled from the server instead of from a constant.
  This is a FILTER, so it lists every type including the ones that have
  been switched off: an approval raised under a retired type still has
  to be findable by the person who has to decide it.
*/
import useRequestTypes from "../CustomHooks/useRequestTypes.js";
import {
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
  describePerson,
} from "../utils/approvalConstants.js";

import Modal from "../components/Modal.jsx";
// MODULE 10 - shared with the employee's copy in Requests.jsx
import AttachmentList from "../components/AttachmentList.jsx";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import RequestComments from "../components/RequestComments.jsx";
import ActivityTimeline from "../components/ActivityTimeline.jsx";

function Approvals() {
  const { userData } = useSelector((state) => state.user);

  // MODULE 9 - the type filter is filled from the database
  const { typeNames } = useRequestTypes();

  /* ---------------- which tab are we on ---------------- */
  const [tab, setTab] = useState("pending"); // "pending" | "history"

  /* ---------------- the data ---------------- */
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ---------------- search + filters + pages ---------------- */
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalApprovals, setTotalApprovals] = useState(0);

  /* ---------------- the details pop-up ---------------- */
  const [viewTarget, setViewTarget] = useState(null); // the row we clicked
  const [detail, setDetail] = useState(null); // the full approval
  const [detailLoading, setDetailLoading] = useState(false);
  const [comment, setComment] = useState("");

  // which of the three buttons is busy right now ("" = none)
  const [actionRunning, setActionRunning] = useState("");

  const canApprove = hasPermission(userData, PERMISSIONS.APPROVAL_APPROVE);
  const canReject = hasPermission(userData, PERMISSIONS.APPROVAL_REJECT);
  const canReturn = hasPermission(userData, PERMISSIONS.APPROVAL_RETURN);

  /* =================================================================
     LOAD THE LIST
     ---------------------------------------------------------------
     Both tabs answer in exactly the same shape, so one function with a
     different address covers them both.
     ================================================================= */
  const fetchApprovals = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        const query = new URLSearchParams({ page: String(page), limit: "10" });

        if (search.trim()) query.append("search", search.trim());
        if (typeFilter) query.append("type", typeFilter);
        if (priorityFilter) query.append("priority", priorityFilter);

        const endpoint = tab === "pending" ? "pending" : "history";
        const result = await api.get(
          `/api/approval/${endpoint}?${query.toString()}`,
          { signal }
        );

        setApprovals(result.data.approvals);
        setTotalPages(result.data.pagination.totalPages);
        setTotalApprovals(result.data.pagination.totalApprovals);
      } catch (error) {
        if (isCancelledError(error)) {
          return;
        }

        toast.error(getErrorMessage(error));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [tab, page, search, typeFilter, priorityFilter]
  );

  /*
    The 400 ms timer stops us calling the backend on every letter, and
    the AbortController stops an old answer landing after a newer one.

    It matters more here than on most pages: the two tabs share this
    function, so switching from Pending to History while the Pending
    request was still in flight could otherwise paint pending rows into
    the History table.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchApprovals(controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchApprovals]);

  /*
    Approving the last request on the last page empties it - step back
    rather than showing "Page 3 of 2" over nothing.
  */
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  /* =================================================================
     OPEN ONE APPROVAL
     ---------------------------------------------------------------
     The list only carries enough for a table row, so we fetch the full
     approval (with every name filled in) when the pop-up opens.
     ================================================================= */
  const openDetail = async (approval) => {
    setViewTarget(approval);
    setDetail(null);
    setComment("");
    setDetailLoading(true);

    try {
      const result = await api.get(
        `/api/approval/request/${approval.request?._id}`
      );
      setDetail(result.data.approval);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setViewTarget(null);
    setDetail(null);
    setComment("");
  };

  /* =================================================================
     THE THREE BUTTONS
     ---------------------------------------------------------------
     @param action - "approve" | "reject" | "return"
     ================================================================= */
  const handleDecision = async (action) => {
    /*
      Saying no must always say why. The backend refuses a short comment
      too - this check only saves the user a pointless round trip.
    */
    if (action !== "approve" && comment.trim().length < MIN_COMMENT_LENGTH) {
      toast.error(
        `Please write at least ${MIN_COMMENT_LENGTH} characters explaining your decision`
      );
      return;
    }

    setActionRunning(action);

    try {
      const result = await api.post(
        `/api/approval/${viewTarget.request._id}/${action}`,
        { comment: comment.trim() }
      );

      toast.success(result.data.message);

      /*
        CLOSE THE POP-UP. It used to stay open showing the updated
        timeline, which read as "nothing happened" - the three buttons
        vanished and the same window sat there, so an approver could not
        tell whether their click had registered and often clicked again.

        The decision is made and the answer is the toast; the timeline it
        was holding open for is still one click away in the History tab.
      */
      closeDetail();
      fetchApprovals();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setActionRunning("");
    }
  };

  const selectClass =
    "h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white";

  /*
    The buttons only make sense while the request really is standing at a
    stage. After a decision the same pop-up shows the finished timeline
    instead, so `detail` (not the row we clicked) decides.
  */
  const isStillPending = detail?.status === "InProgress";
  const showActions = tab === "pending" && isStillPending;

  // the stage the request is standing at, used in the table and the header
  const currentStageOf = (approval) =>
    approval.stages?.find((stage) => stage.order === approval.currentStage);

  const request = detail?.request || viewTarget?.request;

  const tabs = [
    { key: "pending", label: "Pending" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Approvals</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {tab === "pending"
            ? `${totalApprovals} request${
                totalApprovals === 1 ? "" : "s"
              } waiting for your decision`
            : `${totalApprovals} request${
                totalApprovals === 1 ? "" : "s"
              } you have decided on`}
        </p>
      </div>

      {/* ==================== the two tabs ==================== */}
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

      {/* ==================== search + filters ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <MdSearch
            size={19}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by title, request ID or category"
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All types</option>
          {typeNames.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All priorities</option>
          {REQUEST_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </div>

      {/* ==================== the table ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-16 flex justify-center">
            <ClipLoader size={35} color="#4f46e5" />
          </div>
        ) : approvals.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            {tab === "pending"
              ? "Nothing is waiting for your decision right now."
              : "You have not decided on any request yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Request</th>
                  <th className="text-left font-medium px-5 py-3">Raised by</th>
                  <th className="text-left font-medium px-5 py-3">Priority</th>
                  <th className="text-left font-medium px-5 py-3">
                    {tab === "pending" ? "Waiting at" : "Result"}
                  </th>
                  <th className="text-left font-medium px-5 py-3">Submitted</th>
                  <th className="text-right font-medium px-5 py-3">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {approvals.map((approval) => {
                  const stage = currentStageOf(approval);
                  const row = approval.request;

                  return (
                    <tr key={approval._id} className="hover:bg-slate-50">
                      {/* ---------- the request ---------- */}
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">
                          {row?.title || "-"}
                        </p>
                        <p className="text-xs text-slate-400">
                          {row?.requestId}
                          {row?.type ? ` • ${row.type}` : ""}
                          {row?.category ? ` • ${row.category}` : ""}
                        </p>
                      </td>

                      {/* ---------- who raised it ---------- */}
                      <td className="px-5 py-3 text-slate-600">
                        <p>{describePerson(approval.requester, "-")}</p>
                        <p className="text-xs text-slate-400">
                          {approval.requester?.employeeId}
                        </p>
                      </td>

                      {/* ---------- priority ---------- */}
                      <td className="px-5 py-3">
                        {row?.priority && (
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full ${
                              PRIORITY_BADGE_STYLES[row.priority]
                            }`}
                          >
                            {row.priority}
                          </span>
                        )}
                      </td>

                      {/* ---------- stage (pending) or status (history) ---------- */}
                      <td className="px-5 py-3">
                        {tab === "pending" ? (
                          <span className="text-slate-600">
                            {stage ? `${stage.order}. ${stage.name}` : "-"}
                          </span>
                        ) : (
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full ${
                              STATUS_BADGE_STYLES[row?.status] ||
                              "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {REQUEST_STATUS_LABELS[row?.status] || row?.status}
                          </span>
                        )}
                      </td>

                      {/* ---------- when it was submitted ---------- */}
                      <td className="px-5 py-3 text-slate-600">
                        {formatDate(row?.submittedAt || row?.createdAt)}
                      </td>

                      {/* ---------- open ---------- */}
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end">
                          <button
                            title="Open"
                            onClick={() => openDetail(approval)}
                            className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                          >
                            <MdVisibility size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      {/* ==================== the details pop-up ==================== */}
      <Modal
        isOpen={Boolean(viewTarget)}
        title={request ? `${request.requestId} - ${request.title}` : "Approval"}
        onClose={closeDetail}
        maxWidth="max-w-2xl"
      >
        {detailLoading && !detail ? (
          <div className="py-16 flex justify-center">
            <ClipLoader size={30} color="#4f46e5" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* ---------- badges ---------- */}
            <div className="flex flex-wrap gap-2">
              <span
                className={`text-xs px-2.5 py-1 rounded-full ${
                  STATUS_BADGE_STYLES[request?.status] ||
                  "bg-slate-100 text-slate-600"
                }`}
              >
                {REQUEST_STATUS_LABELS[request?.status] || request?.status}
              </span>

              {request?.priority && (
                <span
                  className={`text-xs px-2.5 py-1 rounded-full ${
                    PRIORITY_BADGE_STYLES[request.priority]
                  }`}
                >
                  {request.priority} priority
                </span>
              )}

              <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                {request?.type}
              </span>

              {request?.category && (
                <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                  {request.category}
                </span>
              )}
            </div>

            {/* ---------- who is asking ---------- */}
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              {detail?.requester?.photoUrl ? (
                <img
                  src={getPhotoUrl(detail.requester.photoUrl)}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-medium">
                  {describePerson(detail?.requester, "?").charAt(0)}
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-slate-800">
                  {describePerson(detail?.requester, "-")}
                </p>
                <p className="text-xs text-slate-500">
                  {detail?.requester?.designation || "Employee"}
                  {detail?.requester?.employeeId
                    ? ` • ${detail.requester.employeeId}`
                    : ""}
                </p>
              </div>
            </div>

            {/* ---------- what they are asking for ---------- */}
            <div>
              <p className="text-xs text-slate-500 mb-1">Description</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {request?.description}
              </p>
            </div>

            {/* ---------- amount / dates, only when they are set ---------- */}
            {(request?.amount !== null ||
              request?.startDate ||
              request?.endDate) && (
              <div className="grid grid-cols-2 gap-4">
                {request?.amount !== null && request?.amount !== undefined && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Amount</p>
                    <p className="text-sm text-slate-700">{request.amount}</p>
                  </div>
                )}
                {request?.startDate && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Start Date</p>
                    <p className="text-sm text-slate-700">
                      {formatDate(request.startDate)}
                    </p>
                  </div>
                )}
                {request?.endDate && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">End Date</p>
                    <p className="text-sm text-slate-700">
                      {formatDate(request.endDate)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---------- the files they attached ---------- */}
            {request?.attachments?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                  <MdAttachFile size={15} /> Attachments (
                  {request.attachments.length})
                </p>

                {/*
                  MODULE 10 - the same component the employee sees in
                  Requests.jsx, with ONE difference: canDelete is not
                  passed.

                  That is not about trusting approvers less. A document
                  an approver could quietly remove is a document the
                  NEXT approver would decide without ever knowing had
                  existed - which is the same reason Module 2 freezes
                  the whole request once it starts moving. The backend
                  refuses it too (fileController.js); this only keeps
                  the button from being drawn.
                */}
                <AttachmentList
                  requestId={request._id}
                  attachments={request.attachments}
                />
              </div>
            )}

            {/* ---------- the route and the history ---------- */}
            <div className="pt-5 border-t border-slate-100">
              <ApprovalTimeline approval={detail} />
            </div>

            {/* ---------- the conversation (Module 6) ----------
                This is the reason an approver no longer has to RETURN a
                request just to ask one small question - which used to
                throw away every approval it had already collected.    */}
            {request?._id && (
              <div className="pt-5 border-t border-slate-100">
                <RequestComments requestId={request._id} />
              </div>
            )}

            {/* ---------- the complete history (Module 7) ----------
                Above the decision buttons on purpose. An approver about
                to reject something should be able to see that it has
                already been edited twice and returned once, without
                leaving the pop-up to go and find out.                  */}
            {request?._id && (
              <div className="pt-5 border-t border-slate-100">
                <ActivityTimeline requestId={request._id} />
              </div>
            )}

            {/* ---------- the decision ---------- */}
            {showActions && (
              <div className="pt-5 border-t border-slate-100 flex flex-col gap-3">
                <label className="text-sm font-medium text-slate-700">
                  Your comment
                  <span className="font-normal text-slate-400">
                    {" "}
                    - required when you reject or return
                  </span>
                </label>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={MAX_COMMENT_LENGTH}
                  placeholder="Explain your decision, so the employee knows what to do next"
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 resize-none"
                />

                <div className="flex flex-wrap justify-end gap-3">
                  {canReturn && (
                    <button
                      type="button"
                      onClick={() => handleDecision("return")}
                      disabled={Boolean(actionRunning)}
                      className="h-11 px-5 rounded-lg border border-orange-300 text-orange-700 text-sm font-medium hover:bg-orange-50 disabled:opacity-60 flex items-center justify-center gap-1.5 min-w-[150px]"
                    >
                      {actionRunning === "return" ? (
                        <ClipLoader size={18} color="#c2410c" />
                      ) : (
                        <>
                          <MdUndo size={18} /> Return
                        </>
                      )}
                    </button>
                  )}

                  {canReject && (
                    <button
                      type="button"
                      onClick={() => handleDecision("reject")}
                      disabled={Boolean(actionRunning)}
                      className="h-11 px-5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5 min-w-[130px]"
                    >
                      {actionRunning === "reject" ? (
                        <ClipLoader size={18} color="white" />
                      ) : (
                        <>
                          <MdCancel size={18} /> Reject
                        </>
                      )}
                    </button>
                  )}

                  {canApprove && (
                    <button
                      type="button"
                      onClick={() => handleDecision("approve")}
                      disabled={Boolean(actionRunning)}
                      className="h-11 px-6 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-1.5 min-w-[140px]"
                    >
                      {actionRunning === "approve" ? (
                        <ClipLoader size={18} color="white" />
                      ) : (
                        <>
                          <MdCheckCircle size={18} /> Approve
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Approvals;
