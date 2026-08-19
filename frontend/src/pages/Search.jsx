/*
=========================================================================
  PAGE: Search   (Module 8 - Reports & Search)
=========================================================================
  "Find that request."

  WHAT CAN BE SEARCHED
    the text box   the request id, the title, the category, the
                   description, and the name of the person who raised it
    Employee       who raised it
    Department     which department they belong to
    Request type   Leave, Purchase, Laptop ...
    Approver       who it is waiting on, or who already answered it

  AND FILTERED BY
    status (Pending / Approved / Rejected / Returned / Draft / Cancelled),
    priority, and a date range.

  WHY THIS IS NOT THE REQUESTS PAGE WITH MORE BOXES
  -------------------------------------------------
  /requests answers "MY requests" and is filtered by requester on
  purpose. This answers "find it, wherever it is" - it reaches as far
  across the company as the person looking is allowed to see, and it is
  the only place in FlowDesk where an approver can find a request that
  was never theirs. Two different security rules do not belong in one
  page.

  HOW FAR EACH PERSON CAN SEE is decided by the backend, in exactly the
  same file the six reports use (config/reportScope.js), so the two
  halves of Module 8 can never disagree. The badge in the header always
  says which of the three it turned out to be - and the results list
  says so again when it is empty, because "no results" and "no results
  that you are allowed to see" are very different answers.

  DRAFTS STAY PRIVATE. Even at organisation scope this page never shows
  somebody else's unsent draft - see the note in the backend controller.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdSearch,
  MdChevronLeft,
  MdChevronRight,
  MdOutlineFilterAltOff,
  MdOutlineAttachFile,
  MdOutlineSchedule,
  MdOutlineHourglassEmpty,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { getPhotoUrl } from "../utils/config.js";
import {
  STATUS_BADGE_STYLES,
  PRIORITY_BADGE_STYLES,
  REQUEST_STATUS_LABELS,
} from "../utils/requestConstants.js";
import {
  SEARCH_STATUS_FILTERS,
  SEARCH_SORTS,
  SCOPE_STYLES,
  formatValue,
  formatMoney,
} from "../utils/reportConstants.js";

const EMPTY_FILTERS = {
  employee: "",
  approver: "",
  department: "",
  type: "",
  status: "",
  priority: "",
  from: "",
  to: "",
};

const PAGE_SIZE = 20;

function Search() {
  /* ---------------- the data ---------------- */
  const [results, setResults] = useState([]);
  const [options, setOptions] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ---------------- what was asked ---------------- */
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("newest");

  /* ---------------- pages ---------------- */
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);

  /* =================================================================
     LOAD THE DROPDOWNS
     ---------------------------------------------------------------
     Once, when the page opens. The employee list and the approver
     list are NOT the same list - see the note on getSearchFilters in
     the backend controller.
     ================================================================= */
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const result = await api.get("/api/search/filters");

        setOptions(result.data);
        setScope(result.data.scope);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    };

    fetchOptions();
  }, []);

  /* =================================================================
     SEARCH
     ================================================================= */
  const fetchResults = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        const query = new URLSearchParams();

        if (q.trim()) {
          query.append("q", q.trim());
        }

        Object.entries(filters).forEach(([key, value]) => {
          if (value) {
            query.append(key, value);
          }
        });

        query.append("sort", sort);
        query.append("page", String(page));
        query.append("limit", String(PAGE_SIZE));

        const result = await api.get(
          `/api/search/requests?${query.toString()}`,
          { signal }
        );

        setResults(result.data.results);
        setScope(result.data.scope);
        setTotalPages(result.data.pagination.totalPages);
        setTotalRequests(result.data.pagination.totalRequests);
      } catch (error) {
        if (isCancelledError(error)) {
          return;
        }

        toast.error(getErrorMessage(error));
        setResults([]);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [q, filters, sort, page]
  );

  /*
    THE DEBOUNCE AND THE ABORT DO TWO DIFFERENT JOBS, and the comment
    that used to sit here credited the first one with both.

    The 400 ms timer cuts "Ravi" down from four requests to one. It does
    NOT put answers in order: pausing mid-word sends a real request for
    "Rav", and if the database is slow that answer can land after the
    one for "Ravi" and repaint the results under a search box that says
    something else. Cancelling the previous request is what actually
    prevents it, and this page is the one where it shows most - the
    searches are the heaviest queries in FlowDesk.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchResults(controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchResults]);

  // any change to the question goes back to page 1
  useEffect(() => {
    setPage(1);
  }, [q, filters, sort]);

  const handleFilterChange = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const handleClear = () => {
    setQ("");
    setFilters(EMPTY_FILTERS);
    setSort("newest");
  };

  const hasQuestion = q.trim() || Object.values(filters).some((value) => value);

  const scopeStyle = SCOPE_STYLES[scope?.level] || SCOPE_STYLES.own;

  const selectClass =
    "h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white text-slate-700";

  // "Ravi Sharma (EMP-0007)" for the two people dropdowns
  const personLabel = (person) =>
    `${person.firstName} ${person.lastName}`.trim() +
    (person.employeeId ? ` (${person.employeeId})` : "");

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-slate-800">Search</h1>

            {scope && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full ${scopeStyle.className}`}
                title={scope.label}
              >
                {scopeStyle.label}
              </span>
            )}
          </div>

          <p className="text-sm text-slate-500 mt-0.5">
            {loading
              ? "Searching..."
              : `${totalRequests} request${totalRequests === 1 ? "" : "s"} found`}
          </p>
        </div>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          className={selectClass}
        >
          {SEARCH_SORTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* ==================== the question ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
        {/* ---------- the text box ---------- */}
        <div className="relative">
          <MdSearch
            size={19}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Request ID, title, description, or the name of the person who raised it..."
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        {/* ---------- the status buttons ----------
            Buttons rather than a dropdown because these five words are
            the filter people reach for first, and clicking one should
            not cost opening a menu. Clicking the active one again
            clears it, which is what a toggle is for. */}
        <div className="flex flex-wrap items-center gap-2">
          {SEARCH_STATUS_FILTERS.map((status) => (
            <button
              key={status}
              onClick={() =>
                handleFilterChange(
                  "status",
                  filters.status === status ? "" : status
                )
              }
              className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                filters.status === status
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {status}
            </button>
          ))}

          {hasQuestion && (
            <button
              onClick={handleClear}
              className="h-8 px-3 rounded-full text-xs border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center gap-1"
            >
              <MdOutlineFilterAltOff size={15} /> Clear
            </button>
          )}
        </div>

        {/* ---------- the dropdowns ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/*
            Both people dropdowns disappear when the backend sent an
            empty list - which is what happens at "own" scope, where
            filtering your own requests by who raised them would be a
            menu with one entry in it.
          */}
          {options?.employees?.length > 1 && (
            <select
              value={filters.employee}
              onChange={(event) =>
                handleFilterChange("employee", event.target.value)
              }
              className={selectClass}
            >
              <option value="">Anybody raised it</option>
              {options.employees.map((person) => (
                <option key={person._id} value={person._id}>
                  {personLabel(person)}
                </option>
              ))}
            </select>
          )}

          {options?.approvers?.length > 0 && (
            <select
              value={filters.approver}
              onChange={(event) =>
                handleFilterChange("approver", event.target.value)
              }
              className={selectClass}
            >
              <option value="">Any approver</option>
              {options.approvers.map((person) => (
                <option key={person._id} value={person._id}>
                  {personLabel(person)}
                </option>
              ))}
            </select>
          )}

          {options?.departments?.length > 0 && (
            <select
              value={filters.department}
              onChange={(event) =>
                handleFilterChange("department", event.target.value)
              }
              className={selectClass}
            >
              <option value="">All departments</option>
              {options.departments.map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={filters.type}
            onChange={(event) => handleFilterChange("type", event.target.value)}
            className={selectClass}
          >
            <option value="">All request types</option>
            {(options?.requestTypes || []).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <select
            value={filters.priority}
            onChange={(event) =>
              handleFilterChange("priority", event.target.value)
            }
            className={selectClass}
          >
            <option value="">Any priority</option>
            {(options?.priorities || []).map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        {/* ---------- the date range ---------- */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">Raised from</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => handleFilterChange("from", event.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => handleFilterChange("to", event.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* ==================== the results ==================== */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 flex justify-center">
          <ClipLoader size={35} color="#4f46e5" />
        </div>
      ) : results.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <p className="text-slate-500 text-sm">
            {hasQuestion
              ? "Nothing matches this search."
              : "Nothing to show yet."}
          </p>

          {/*
            "No results" and "no results YOU can see" are different
            answers, and somebody hunting for a colleague's request
            deserves to be told which one they got rather than being
            left to conclude the request does not exist.
          */}
          {scope && scope.level !== "org" && (
            <p className="text-xs text-slate-400 mt-2">
              This search covers {scope.label.toLowerCase()} only.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {results.map((request) => (
            /*
              A CARD PER RESULT, NOT A TABLE ROW.

              A search result has to carry things of very different
              shapes - a title, a status, an amount, a face, and a list
              of the people it is waiting on. Forcing those into
              columns would mean a "waiting on" column that is empty in
              most rows and three names deep in the rest.
            */
            <div
              key={request._id}
              className="bg-white rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* ---------- what it is ---------- */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">
                      {request.requestId}
                    </span>

                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${
                        STATUS_BADGE_STYLES[request.status] ||
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {REQUEST_STATUS_LABELS[request.status] || request.status}
                    </span>

                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${
                        PRIORITY_BADGE_STYLES[request.priority] ||
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {request.priority}
                    </span>

                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {request.type}
                      {request.category ? ` / ${request.category}` : ""}
                    </span>
                  </div>

                  <p className="text-slate-800 font-medium mt-1.5">
                    {request.title}
                  </p>

                  {/* ---------- who raised it ---------- */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      {request.requester?.photoUrl ? (
                        <img
                          src={getPhotoUrl(request.requester.photoUrl)}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] flex items-center justify-center">
                          {(request.requester?.firstName || "?")
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                      {request.requester
                        ? `${request.requester.firstName} ${request.requester.lastName}`
                        : "Removed employee"}
                    </span>

                    {request.requester?.department && (
                      <span>{request.requester.department.name}</span>
                    )}

                    <span className="flex items-center gap-1">
                      <MdOutlineSchedule size={13} />
                      {formatValue(request.createdAt, "date")}
                    </span>

                    {request.attachmentCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MdOutlineAttachFile size={13} />
                        {request.attachmentCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* ---------- the amount ---------- */}
                {request.amount > 0 && (
                  <p className="text-lg font-semibold text-slate-900 tabular-nums shrink-0">
                    {formatMoney(request.amount)}
                  </p>
                )}
              </div>

              {/* ==================== where it is standing ====================
                  The single most useful line next to a search result:
                  a request that is stuck says WHO it is stuck on. */}
              {request.approval?.stageName && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span className="flex items-center gap-1.5 text-amber-700">
                    <MdOutlineHourglassEmpty size={14} />
                    Stage {request.approval.stageOrder} of{" "}
                    {request.approval.totalStages}: {request.approval.stageName}
                  </span>

                  {request.approval.waitingOn?.length > 0 && (
                    <span className="flex items-center gap-1.5 text-slate-500">
                      waiting on
                      {request.approval.waitingOn.map((person) => (
                        <span
                          key={person._id}
                          className="flex items-center gap-1 text-slate-700"
                        >
                          {person.photoUrl ? (
                            <img
                              src={getPhotoUrl(person.photoUrl)}
                              alt=""
                              className="w-5 h-5 rounded-full object-cover"
                            />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] flex items-center justify-center">
                              {person.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          {person.name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* ==================== pagination ==================== */}
          {totalPages > 1 && (
            <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-between px-5 py-3">
              <p className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  disabled={page === 1}
                  className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
                >
                  <MdChevronLeft size={20} />
                </button>

                <button
                  onClick={() =>
                    setPage((current) => Math.min(current + 1, totalPages))
                  }
                  disabled={page === totalPages}
                  className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
                >
                  <MdChevronRight size={20} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Search;
