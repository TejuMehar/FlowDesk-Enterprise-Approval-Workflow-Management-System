/*
=========================================================================
  PAGE: Requests (Module 2 - Request Management)
=========================================================================
  This is where an employee manages their OWN approval requests:

    - see them in a table with search, filters and pagination
    - create a new request (it starts as a "Draft")
    - edit a draft, or a request an approver returned for correction
    - submit it, which starts the approval workflow (Module 4)
    - delete a draft
    - open "View" to see the full details, upload attachments and follow
      the approval timeline - where the request is standing and what
      every approver said about it

  The backend (controllers/requestController.js) always double-checks
  that a request belongs to the logged in user, so this page never has
  to worry about seeing someone else's data.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdAdd,
  MdSearch,
  MdEdit,
  MdDelete,
  MdSend,
  MdVisibility,
  MdChevronLeft,
  MdChevronRight,
  MdAttachFile,
  MdUploadFile,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
/*
  getPhotoUrl is gone from this page (Module 10). It turned a stored
  path into a public /uploads address, which is exactly what an
  attachment no longer has - the files are fetched through the API now,
  by AttachmentList. It is still the right helper for a profile photo.
*/
import { formatDate, toInputDate } from "../utils/config.js";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  EDITABLE_REQUEST_STATUSES,
  STATUS_BADGE_STYLES,
  PRIORITY_BADGE_STYLES,
} from "../utils/requestConstants.js";
/*
  MODULE 9 - four things this page used to import as constants now come
  from the database, because an administrator configures them:

    the list of types            -> useRequestTypes()
    the category suggestions     -> categoriesOf()
    "does it need an amount?"    -> typeNeedsAmount()
    "does it need dates?"        -> typeNeedsDates()

  All four used to be separate arrays that had to be kept in step by
  hand. They are four columns of one row now, so a type describes
  itself and a new one can behave differently from the eight the
  project shipped with.
*/
import useRequestTypes, {
  categoriesOf,
  typeNeedsAmount,
  typeNeedsDates,
} from "../CustomHooks/useRequestTypes.js";

/*
  MODULE 10 - the attachments block of this pop-up is a component now,
  shared with the approver's copy in Approvals.jsx. The two used to be
  the same JSX written twice, and only one of them was ever updated.
*/
import AttachmentList from "../components/AttachmentList.jsx";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  MAX_ATTACHMENTS_PER_REQUEST,
  ATTACHMENT_HINT,
  formatFileSize,
} from "../utils/fileConstants.js";

import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import RequestComments from "../components/RequestComments.jsx";
import ActivityTimeline from "../components/ActivityTimeline.jsx";

/*
  What an empty "Add Request" form looks like.

  MODULE 9 - the type starts EMPTY rather than "Leave". A company that
  renamed or retired that type would otherwise open the form pre-filled
  with a value the backend is about to reject. openAddForm() picks the
  first type that really exists instead.
*/
const emptyForm = {
  type: "",
  category: "",
  title: "",
  description: "",
  priority: "Medium",
  amount: "",
  startDate: "",
  endDate: "",
  /*
    WHO TO SEND IT TO. "" means "use my department manager", which is
    what the backend does with a null - so an employee who ignores the
    field gets exactly the behaviour every request had before it
    existed.
  */
  chosenApprover: "",
};

function Requests() {
  const { userData } = useSelector((state) => state.user);

  /*
    MODULE 9 - the request types, from the database.
      typeNames    every type there has ever been, for the FILTER
      activeTypes  the ones an employee may still choose, for the FORM
     is the full list, used by the three helpers further
    down that work out what the form should show.
  */
  const { types: requestTypes, typeNames, activeTypes } = useRequestTypes();

  /* ---------------- the data ---------------- */
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ---------------- search + filters + pages ---------------- */
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);

  /* ---------------- add / edit pop-up ---------------- */
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  /*
    THE "SEND TO" LIST - everybody who manages a department, and which
    of them is this employee's own manager.

    Fetched ONCE when the page mounts rather than every time the form
    opens: it is the same handful of people all day, and an employee
    who raises three requests should not wait for three identical
    round trips.
  */
  const [approverOptions, setApproverOptions] = useState([]);
  const [defaultApprover, setDefaultApprover] = useState("");

  /* ---------------- view details pop-up ---------------- */
  const [viewTarget, setViewTarget] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState(null);
  const [uploading, setUploading] = useState(false);

  /*
    The approval of the request in the pop-up (Module 4).
    Stays null while the request is still a draft - a draft has never
    been sent anywhere, so there is no approval to show yet.
  */
  const [approval, setApproval] = useState(null);

  /* ---------------- submit pop-up ---------------- */
  const [submitTarget, setSubmitTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /* ---------------- delete pop-up ---------------- */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* ---------------- what may this user do? ---------------- */
  const canCreate = hasPermission(userData, PERMISSIONS.REQUEST_CREATE);
  const canUpdate = hasPermission(userData, PERMISSIONS.REQUEST_UPDATE);
  const canDelete = hasPermission(userData, PERMISSIONS.REQUEST_DELETE);
  const canSubmit = hasPermission(userData, PERMISSIONS.REQUEST_SUBMIT);

  /* =================================================================
     LOAD MY REQUESTS
     ================================================================= */
  const fetchRequests = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        const query = new URLSearchParams({ page: String(page), limit: "10" });

        if (search.trim()) query.append("search", search.trim());
        if (typeFilter) query.append("type", typeFilter);
        if (statusFilter) query.append("status", statusFilter);
        if (priorityFilter) query.append("priority", priorityFilter);

        const result = await api.get(`/api/request/all?${query.toString()}`, {
          signal,
        });

        setRequests(result.data.requests);
        setTotalPages(result.data.pagination.totalPages);
        setTotalRequests(result.data.pagination.totalRequests);
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
    [page, search, typeFilter, statusFilter, priorityFilter]
  );

  /*
    The 400 ms timer stops us from calling the backend on every letter,
    and the AbortController stops a slow answer to an older search from
    landing last and repainting the table with the wrong rows - see the
    note on isCancelledError in utils/api.js.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchRequests(controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchRequests]);

  /*
    Deleting the last draft on the last page would otherwise leave the
    footer saying "Page 3 of 2" over an empty table.
  */
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  /* =================================================================
     LOAD THE PEOPLE I CAN SEND A REQUEST TO
     ---------------------------------------------------------------
     A failure here is deliberately SILENT. The dropdown is optional -
     leaving it on "my department manager" is a complete request - so a
     toast about a list the employee never intended to open would be
     noise, and the form still works entirely without it.
     ================================================================= */
  useEffect(() => {
    const fetchApprovers = async () => {
      try {
        const result = await api.get("/api/request/approvers");

        setApproverOptions(result.data.approvers || []);
        setDefaultApprover(result.data.defaultApprover || "");
      } catch (error) {
        setApproverOptions([]);
      }
    };

    if (canCreate) {
      fetchApprovers();
    }
  }, [canCreate]);

  /* =================================================================
     OPEN THE ADD / EDIT FORM
     ================================================================= */
  const openAddForm = () => {
    setEditingRequest(null);
    setForm({
      ...emptyForm,
      // whatever the admin put first in Settings, not a hard-coded guess
      type: activeTypes[0]?.name || "",
      /*
        Pre-selected with the employee's own department manager - the
        person the request would have gone to anyway. The dropdown is
        therefore a REDIRECT rather than a question: somebody who does
        not care can ignore it and get the org chart, which is what the
        overwhelming majority of requests want.
      */
      chosenApprover: defaultApprover || "",
    });
    setShowForm(true);
  };

  const openEditForm = (request) => {
    setEditingRequest(request);
    setForm({
      type: request.type,
      category: request.category || "",
      title: request.title,
      description: request.description,
      priority: request.priority,
      amount: request.amount ?? "",
      startDate: toInputDate(request.startDate),
      endDate: toInputDate(request.endDate),
      /*
        The field holds an id, but getRequestById populates it into a
        whole user object - so accept either shape rather than showing
        an empty dropdown depending on which call filled the row.
      */
      chosenApprover:
        request.chosenApprover?._id || request.chosenApprover || "",
    });
    setShowForm(true);
  };

  /* =================================================================
     SAVE (create or update a draft)
     ================================================================= */
  const handleSubmitForm = async (event) => {
    event.preventDefault();

    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required");
      return;
    }

    setSaving(true);

    try {
      if (editingRequest) {
        const result = await api.put(
          `/api/request/${editingRequest._id}`,
          form
        );
        toast.success(result.data.message);
      } else {
        const result = await api.post("/api/request/create", form);
        toast.success(result.data.message);
      }

      setShowForm(false);
      fetchRequests();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     SUBMIT A DRAFT
     ================================================================= */
  const handleSubmitRequest = async () => {
    setSubmitting(true);

    try {
      const result = await api.patch(`/api/request/${submitTarget._id}/submit`);

      toast.success(result.data.message);
      setSubmitTarget(null);
      fetchRequests();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  /* =================================================================
     DELETE A DRAFT
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/request/${deleteTarget._id}`);

      toast.success(result.data.message);
      setDeleteTarget(null);
      fetchRequests();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  /* =================================================================
     VIEW DETAILS
     ================================================================= */
  const openViewModal = async (request) => {
    setViewTarget(request); // show something immediately
    setFilesToUpload(null);
    setApproval(null);
    setViewLoading(true);

    try {
      const result = await api.get(`/api/request/${request._id}`);
      setViewTarget(result.data.request);

      /*
        A draft was never submitted, so asking for its approval would
        only answer 404. For everything else we fetch the timeline.

        It sits in its own try/catch on purpose: a request created before
        Module 4 existed has no approval either, and that must not stop
        the rest of the pop-up from showing.
      */
      if (result.data.request.status !== "Draft") {
        try {
          const approvalResult = await api.get(
            `/api/approval/request/${request._id}`
          );
          setApproval(approvalResult.data.approval);
        } catch {
          setApproval(null);
        }
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setViewLoading(false);
    }
  };

  /* =================================================================
     UPLOAD ATTACHMENTS
     ================================================================= */
  const handleUploadAttachments = async () => {
    if (!filesToUpload || filesToUpload.length === 0) {
      toast.error("Please choose at least one file");
      return;
    }

    /*
      MODULE 10 - THREE CHECKS BEFORE THE UPLOAD STARTS, AND NONE OF
      THEM IS SECURITY.

      The backend refuses all three cases anyway (multer's limits and
      the ceiling in uploadAttachments), and it is the only refusal
      that counts - anything in this file can be edited by whoever
      opens the browser's console.

      They are here because of what the REFUSAL COSTS. Without them a
      40 MB holiday video is uploaded over somebody's phone connection,
      for thirty seconds, before being told no. Catching it here costs
      nothing and answers instantly.
    */
    const chosenFiles = Array.from(filesToUpload);

    if (chosenFiles.length > MAX_FILES_PER_UPLOAD) {
      toast.error(`You can upload at most ${MAX_FILES_PER_UPLOAD} files at a time`);
      return;
    }

    const tooLarge = chosenFiles.find((file) => file.size > MAX_FILE_BYTES);

    if (tooLarge) {
      toast.error(
        `"${tooLarge.fileName || tooLarge.name}" is ${formatFileSize(
          tooLarge.size
        )}. The limit is ${formatFileSize(MAX_FILE_BYTES)} per file.`
      );
      return;
    }

    const alreadyAttached = viewTarget.attachments?.length || 0;

    if (alreadyAttached + chosenFiles.length > MAX_ATTACHMENTS_PER_REQUEST) {
      toast.error(
        `A request can hold at most ${MAX_ATTACHMENTS_PER_REQUEST} files. This one already has ${alreadyAttached}.`
      );
      return;
    }

    /*
      A file upload must be sent as "multipart/form-data" instead of
      plain JSON, so we build a FormData object and append every chosen
      file under the SAME field name "attachments" - that is what
      upload.array("attachments", 5) on the backend expects.
    */
    const formData = new FormData();
    chosenFiles.forEach((file) => {
      formData.append("attachments", file);
    });

    setUploading(true);

    try {
      const result = await api.post(
        `/api/request/${viewTarget._id}/attachments`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      toast.success(result.data.message);
      setViewTarget(result.data.request);
      setFilesToUpload(null);
      fetchRequests();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const selectClass =
    "h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white";
  const inputClass =
    "h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500";

  /*
    Does the CURRENT form need the amount / date fields, and what
    categories should it suggest? All three are answered by the type
    itself now (Module 9), so they are looked up rather than listed.
  */
  const formNeedsAmount = typeNeedsAmount(requestTypes, form.type);
  const formNeedsDates = typeNeedsDates(requestTypes, form.type);
  const categorySuggestions = categoriesOf(requestTypes, form.type);

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            My Requests
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalRequests} request{totalRequests === 1 ? "" : "s"} found
          </p>
        </div>

        {canCreate && (
          <button
            onClick={openAddForm}
            className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <MdAdd size={19} /> New Request
          </button>
        )}
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
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All status</option>
          {REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {REQUEST_STATUS_LABELS[status] || status}
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
        ) : requests.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            No requests found. Click "New Request" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Request</th>
                  <th className="text-left font-medium px-5 py-3">Type</th>
                  <th className="text-left font-medium px-5 py-3">Priority</th>
                  <th className="text-left font-medium px-5 py-3">Status</th>
                  <th className="text-left font-medium px-5 py-3">Created</th>
                  <th className="text-right font-medium px-5 py-3">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {requests.map((request) => {
                  /*
                    A draft and a returned request can both still be
                    edited and submitted. Only a draft can be DELETED
                    though - once a request has been through a workflow
                    its history has to stay.
                  */
                  const isEditable = EDITABLE_REQUEST_STATUSES.includes(
                    request.status
                  );
                  const isDraft = request.status === "Draft";

                  return (
                    <tr key={request._id} className="hover:bg-slate-50">
                      {/* ---------- title ---------- */}
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">
                          {request.title}
                        </p>
                        <p className="text-xs text-slate-400">
                          {request.requestId}
                          {request.category ? ` • ${request.category}` : ""}
                        </p>
                      </td>

                      {/* ---------- type ---------- */}
                      <td className="px-5 py-3 text-slate-600">
                        {request.type}
                      </td>

                      {/* ---------- priority ---------- */}
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full ${
                            PRIORITY_BADGE_STYLES[request.priority]
                          }`}
                        >
                          {request.priority}
                        </span>
                      </td>

                      {/* ---------- status ---------- */}
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full ${
                            STATUS_BADGE_STYLES[request.status]
                          }`}
                        >
                          {REQUEST_STATUS_LABELS[request.status] ||
                            request.status}
                        </span>
                      </td>

                      {/* ---------- created date ---------- */}
                      <td className="px-5 py-3 text-slate-600">
                        {formatDate(request.createdAt)}
                      </td>

                      {/* ---------- action buttons ---------- */}
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="View details"
                            onClick={() => openViewModal(request)}
                            className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                          >
                            <MdVisibility size={18} />
                          </button>

                          {isEditable && canUpdate && (
                            <button
                              title={isDraft ? "Edit draft" : "Correct request"}
                              onClick={() => openEditForm(request)}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                            >
                              <MdEdit size={18} />
                            </button>
                          )}

                          {isEditable && canSubmit && (
                            <button
                              title={isDraft ? "Submit" : "Submit again"}
                              onClick={() => setSubmitTarget(request)}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center"
                            >
                              <MdSend size={17} />
                            </button>
                          )}

                          {isDraft && canDelete && (
                            <button
                              title="Delete draft"
                              onClick={() => setDeleteTarget(request)}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                            >
                              <MdDelete size={18} />
                            </button>
                          )}
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

      {/* ==================== add / edit pop-up ==================== */}
      <Modal
        isOpen={showForm}
        title={
          !editingRequest
            ? "New Request"
            : editingRequest.status === "Returned"
            ? "Correct Request"
            : "Edit Draft Request"
        }
        onClose={() => setShowForm(false)}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSubmitForm} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* ---------- type ---------- */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Request Type <span className="text-red-500">*</span>
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  // changing the type also resets the category, since the
                  // suggestions for the new type are different
                  setForm({ ...form, type: e.target.value, category: "" })
                }
                className={`${selectClass} h-11`}
              >
                {/*
                  Only ACTIVE types, unlike the filter above: a type an
                  admin has retired must not be offered on a new
                  request, even though old requests still carry it.
                */}
                {activeTypes.map((type) => (
                  <option key={type._id} value={type.name}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>

            {/* ---------- priority ---------- */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Priority
              </label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className={`${selectClass} h-11`}
              >
                {REQUEST_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ---------- who to send it to ----------
              Only drawn when there is somebody to choose. A company that
              has not set a manager on any department yet would otherwise
              get an empty dropdown promising a choice it cannot offer. */}
          {approverOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Send to
                <span className="font-normal text-slate-400">
                  {" "}
                  - the manager who should approve this
                </span>
              </label>

              <select
                value={form.chosenApprover}
                onChange={(e) =>
                  setForm({ ...form, chosenApprover: e.target.value })
                }
                className={`${selectClass} h-11`}
              >
                {/*
                  The empty option is not a "nothing" - it is the org
                  chart, which is a real and usually correct answer. It
                  also keeps the field genuinely optional, so a request
                  can always be raised by somebody who does not know who
                  their approver should be.
                */}
                <option value="">My department manager (default)</option>

                {approverOptions.map((approver) => (
                  <option key={approver._id} value={approver._id}>
                    {approver.firstName} {approver.lastName}
                    {approver.departments.length > 0
                      ? ` - ${approver.departments
                          .map((department) => department.name)
                          .join(", ")}`
                      : ""}
                  </option>
                ))}
              </select>

              {/*
                Says out loud what the dropdown can and cannot do. An
                employee choosing a name here could otherwise reasonably
                think they had chosen the ONLY approver, and be surprised
                when Finance and a Director still had to sign a large
                purchase afterwards.
              */}
              <p className="text-xs text-slate-400">
                Only the first approval step changes. Any Finance, IT or
                Director steps in the workflow still apply.
              </p>
            </div>
          )}

          {/* ---------- category ----------
              "list" links this input to the <datalist> below, which shows
              suggestions while typing but still allows any free text.   */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Category
            </label>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              list="category-suggestions"
              placeholder="e.g. Sick Leave"
              className={inputClass}
            />
            <datalist id="category-suggestions">
              {categorySuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>

          {/* ---------- title ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="A short summary, e.g. 3 days sick leave"
              maxLength={120}
              className={inputClass}
            />
          </div>

          {/* ---------- description ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={4}
              placeholder="Explain what you need and why"
              maxLength={2000}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* ---------- amount (only for money-related types) ---------- */}
          {formNeedsAmount && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Amount
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
          )}

          {/* ---------- dates (only for Leave / Travel) ---------- */}
          {formNeedsDates && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Start Date
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">
                  End Date
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={saving}
              className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[140px]"
            >
              {saving ? (
                <ClipLoader size={20} color="white" />
              ) : editingRequest ? (
                "Save changes"
              ) : (
                "Save as draft"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== view details pop-up ==================== */}
      <Modal
        isOpen={Boolean(viewTarget)}
        title={viewTarget ? `${viewTarget.requestId} - ${viewTarget.title}` : ""}
        onClose={() => setViewTarget(null)}
        maxWidth="max-w-xl"
      >
        {viewTarget && (
          <div className="flex flex-col gap-5">
            {/* ---------- badges ---------- */}
            <div className="flex flex-wrap gap-2">
              <span
                className={`text-xs px-2.5 py-1 rounded-full ${
                  STATUS_BADGE_STYLES[viewTarget.status]
                }`}
              >
                {REQUEST_STATUS_LABELS[viewTarget.status] || viewTarget.status}
              </span>
              <span
                className={`text-xs px-2.5 py-1 rounded-full ${
                  PRIORITY_BADGE_STYLES[viewTarget.priority]
                }`}
              >
                {viewTarget.priority} priority
              </span>
              <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                {viewTarget.type}
              </span>
              {viewTarget.category && (
                <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                  {viewTarget.category}
                </span>
              )}
            </div>

            {/* ---------- description ---------- */}
            <div>
              <p className="text-xs text-slate-500 mb-1">Description</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {viewTarget.description}
              </p>
            </div>

            {/* ---------- amount / dates, only when they are set ---------- */}
            {(viewTarget.amount !== null ||
              viewTarget.startDate ||
              viewTarget.endDate) && (
              <div className="grid grid-cols-2 gap-4">
                {viewTarget.amount !== null && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Amount</p>
                    <p className="text-sm text-slate-700">
                      {viewTarget.amount}
                    </p>
                  </div>
                )}
                {viewTarget.startDate && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Start Date</p>
                    <p className="text-sm text-slate-700">
                      {formatDate(viewTarget.startDate)}
                    </p>
                  </div>
                )}
                {viewTarget.endDate && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">End Date</p>
                    <p className="text-sm text-slate-700">
                      {formatDate(viewTarget.endDate)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---------- dates: created / submitted ---------- */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Created</p>
                <p className="text-sm text-slate-700">
                  {formatDate(viewTarget.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Submitted</p>
                <p className="text-sm text-slate-700">
                  {viewTarget.submittedAt
                    ? formatDate(viewTarget.submittedAt)
                    : "Not submitted yet"}
                </p>
              </div>
            </div>

            {/* ---------- attachments ---------- */}
            <div className="pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                <MdAttachFile size={15} /> Attachments (
                {viewTarget.attachments?.length || 0})
              </p>

              {/*
                MODULE 10 replaced the plain list of links that used to
                be here. Two things changed and only one of them is
                visible:

                  on screen  each file now has Preview, Download and
                             (for the owner, while it is still a draft)
                             Remove

                  underneath the links no longer point at /uploads at
                             all. They call a route that checks who is
                             asking, because the old ones handed a
                             medical certificate to anybody who knew
                             the address.
              */}
              <div className="mb-4">
                <AttachmentList
                  requestId={viewTarget._id}
                  attachments={viewTarget.attachments || []}
                  canDelete={
                    canUpdate &&
                    EDITABLE_REQUEST_STATUSES.includes(viewTarget.status)
                  }
                  onChanged={(updatedRequest) => {
                    setViewTarget(updatedRequest);
                    fetchRequests();
                  }}
                />
              </div>

              {/*
                Files may only be added while the request still belongs
                to the employee - a draft, or one that came back for
                correction. Once it is travelling down the workflow the
                paperwork is frozen, so every approver sees exactly the
                same documents.
              */}
              {canUpdate &&
                EDITABLE_REQUEST_STATUSES.includes(viewTarget.status) && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        multiple
                        onChange={(e) => setFilesToUpload(e.target.files)}
                        className="text-sm flex-1"
                      />
                      <button
                        type="button"
                        onClick={handleUploadAttachments}
                        disabled={uploading}
                        className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5 shrink-0"
                      >
                        {uploading ? (
                          <ClipLoader size={16} color="white" />
                        ) : (
                          <>
                            <MdUploadFile size={17} /> Upload
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-slate-400 mt-1.5">
                      {ATTACHMENT_HINT}
                    </p>
                  </>
                )}
            </div>

            {/* ---------- the approval timeline (Module 4) ----------
                A draft has never been sent anywhere, so there is nothing
                to show for it yet.                                     */}
            {viewTarget.status !== "Draft" && (
              <div className="pt-4 border-t border-slate-100">
                {approval ? (
                  <ApprovalTimeline approval={approval} />
                ) : (
                  !viewLoading && (
                    <p className="text-sm text-slate-400">
                      This request did not go through an approval workflow.
                    </p>
                  )
                )}
              </div>
            )}

            {/* ---------- the conversation (Module 6) ----------
                Under the timeline, and for the same reason it is not
                shown on a draft: nobody else has seen the request yet,
                so there is nobody to talk to.                          */}
            {viewTarget.status !== "Draft" && (
              <div className="pt-4 border-t border-slate-100">
                <RequestComments requestId={viewTarget._id} />
              </div>
            )}

            {/* ---------- the complete history (Module 7) ----------
                Unlike the two blocks above, this one IS shown on a
                draft. A draft has already been created, edited and had
                files attached to it, and those are exactly the moments
                this timeline is made of - it is the approvals and the
                conversation that do not exist yet, not the history. */}
            <div className="pt-4 border-t border-slate-100">
              <ActivityTimeline requestId={viewTarget._id} />
            </div>

            {viewLoading && (
              <div className="flex justify-center">
                <ClipLoader size={22} color="#4f46e5" />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ==================== submit confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(submitTarget)}
        title={
          submitTarget?.status === "Returned"
            ? "Send this request back for approval?"
            : "Submit this request?"
        }
        message={
          submitTarget?.status === "Returned"
            ? `"${submitTarget?.title}" will start the approval workflow again from the first stage, and will be locked for editing.`
            : `"${submitTarget?.title}" will start its approval workflow and will be locked for editing.`
        }
        confirmText="Yes, submit"
        loading={submitting}
        onConfirm={handleSubmitRequest}
        onCancel={() => setSubmitTarget(null)}
      />

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this draft?"
        message={`"${deleteTarget?.title}" and any attached files will be permanently removed.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Requests;
