/*
=========================================================================
  PAGE: Audit Logs   (Module 7 - Audit Logs & Activity Tracking)
=========================================================================
  The company wide record of who did what.

  Every other page in FlowDesk shows the RESULT of people's work - the
  requests that exist, the users that exist. This one shows the ACTIONS
  themselves, newest first, and it is the only place that can answer
  "why is Ravi's role suddenly Employee?".

  WHAT IS ON THE PAGE
    - a search box over the description, the person and the target
    - filters: module, action, who did it, worked/failed, a date range
    - the table, paginated
    - a row can be opened to show the field-by-field diff
    - Export CSV, behind its own permission

  THERE IS NOTHING TO EDIT AND NOTHING TO DELETE HERE, and there is no
  backend route for either. That is the whole point of an audit log: a
  record the person being investigated could change would prove nothing.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdSearch,
  MdChevronLeft,
  MdChevronRight,
  MdOutlineFileDownload,
  MdOutlineFilterAltOff,
  MdExpandMore,
  MdArrowRightAlt,
} from "react-icons/md";
import { useSelector } from "react-redux";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { downloadFile, stampedFileName } from "../utils/download.js";
import { getPhotoUrl } from "../utils/config.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import {
  AUDIT_MODULES,
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_STYLES,
  AUDIT_MODULE_STYLES,
  describeAction,
  formatMoment,
} from "../utils/auditConstants.js";

function AuditLogs() {
  const { userData } = useSelector((state) => state.user);

  const canExport = hasPermission(userData, PERMISSIONS.AUDIT_EXPORT);

  /* ---------------- the data ---------------- */
  const [logs, setLogs] = useState([]);
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  /* ---------------- the filters ---------------- */
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  /* ---------------- pages ---------------- */
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  /*
    Which row is opened to show its diff.

    Only ONE at a time (an id, not a list). The diff is the small print
    of an entry, and a table with six rows expanded is no longer a
    table you can scan.
  */
  const [openRow, setOpenRow] = useState(null);

  /* =================================================================
     BUILD THE QUERY STRING
     ---------------------------------------------------------------
     Shared by the table and the CSV export, so the file can never
     hold something different from what is on screen. Empty filters
     are left out entirely rather than sent as "", which keeps the URL
     readable in the network tab.
     ================================================================= */
  const buildQuery = useCallback(
    (extra = {}) => {
      const query = new URLSearchParams();

      if (search.trim()) query.append("search", search.trim());
      if (moduleFilter) query.append("module", moduleFilter);
      if (actionFilter) query.append("action", actionFilter);
      if (actorFilter) query.append("actor", actorFilter);
      if (statusFilter) query.append("status", statusFilter);
      if (fromDate) query.append("from", fromDate);
      if (toDate) query.append("to", toDate);

      Object.entries(extra).forEach(([key, value]) =>
        query.append(key, String(value))
      );

      return query.toString();
    },
    [search, moduleFilter, actionFilter, actorFilter, statusFilter, fromDate, toDate]
  );

  /* =================================================================
     LOAD THE TABLE
     ================================================================= */
  const fetchLogs = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        const result = await api.get(
          `/api/audit/all?${buildQuery({ page, limit: 20 })}`,
          { signal }
        );

        setLogs(result.data.logs);
        setTotalPages(result.data.pagination.totalPages);
        setTotalLogs(result.data.pagination.totalLogs);
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
    [buildQuery, page]
  );

  /*
    The 400 ms timer is the same "debounce" the Users page uses: without
    it, typing "Ravi" would send four requests. The AbortController next
    to it cancels the previous one, so a slow answer to an older filter
    can never land last and repaint the table - see isCancelledError in
    utils/api.js.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchLogs(controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchLogs]);

  /*
    Changing a filter must go back to page 1. Staying on page 4 while
    the new filter only has two pages would show an empty table and
    look like a bug.
  */
  useEffect(() => {
    setPage(1);
  }, [search, moduleFilter, actionFilter, actorFilter, statusFilter, fromDate, toDate]);

  /* =================================================================
     LOAD THE "PERFORMED BY" DROPDOWN
     ---------------------------------------------------------------
     Once, when the page opens. It comes from the LOG, not from the
     user list, so somebody who has left the company is still in it -
     see the note on getAuditActors in the backend controller.
     ================================================================= */
  useEffect(() => {
    const fetchActors = async () => {
      try {
        const result = await api.get("/api/audit/actors");
        setActors(result.data.actors);
      } catch {
        // the dropdown simply stays empty; the table still works
      }
    };

    fetchActors();
  }, []);

  /* =================================================================
     EXPORT AS CSV
     ---------------------------------------------------------------
     The export route answers with a FILE, not with JSON, which needs a
     little dance: ask axios for a `blob`, wrap it in a temporary link,
     click it in code and hand the memory back afterwards.

     All of that lives in utils/download.js now, because the reports
     page and the attendance page were each writing their own copy of
     it - and one of those copies had drifted into a window.open that
     stopped working whenever the access token expired.
     ================================================================= */
  const handleExport = async () => {
    setExporting(true);

    try {
      await downloadFile(
        `/api/audit/export?${buildQuery()}`,
        stampedFileName(["audit"], "csv")
      );

      toast.success("Audit log exported");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExporting(false);
    }
  };

  /* =================================================================
     CLEAR EVERY FILTER
     ================================================================= */
  const handleClearFilters = () => {
    setSearch("");
    setModuleFilter("");
    setActionFilter("");
    setActorFilter("");
    setStatusFilter("");
    setFromDate("");
    setToDate("");
  };

  // is anything filtered at all? decides whether to draw the Clear button
  const hasFilters =
    search ||
    moduleFilter ||
    actionFilter ||
    actorFilter ||
    statusFilter ||
    fromDate ||
    toDate;

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Audit Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalLogs} recorded action{totalLogs === 1 ? "" : "s"}
          </p>
        </div>

        {/*
          The export button only exists for somebody with audit:export.
          Hiding it is a courtesy, not security - the backend refuses
          the route either way.
        */}
        {canExport && (
          <button
            onClick={handleExport}
            disabled={exporting || totalLogs === 0}
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            {exporting ? (
              <ClipLoader size={16} color="#4f46e5" />
            ) : (
              <MdOutlineFileDownload size={17} />
            )}
            Export CSV
          </button>
        )}
      </div>

      {/* ==================== the filters ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
        {/* ---------- search ---------- */}
        <div className="relative">
          <MdSearch
            size={19}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the description, the person or what was touched..."
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        {/* ---------- the dropdowns ---------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
          >
            <option value="">All modules</option>
            {AUDIT_MODULES.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>

          {/*
            <optgroup> is what turns 35 actions into nine readable
            groups. The browser draws the headings and refuses to let
            them be selected, so no extra code is needed.
          */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
          >
            <option value="">All actions</option>
            {AUDIT_ACTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((action) => (
                  <option key={action} value={action}>
                    {AUDIT_ACTION_LABELS[action] || action}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
          >
            <option value="">Anybody</option>
            {actors.map((actor) => (
              <option key={actor._id} value={actor._id}>
                {actor.name} ({actor.entries})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
          >
            <option value="">Worked and failed</option>
            <option value="Success">Worked</option>
            <option value="Failure">Failed</option>
          </select>
        </div>

        {/* ---------- the date range ---------- */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          {hasFilters && (
            <button
              onClick={handleClearFilters}
              className="h-10 px-4 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50 flex items-center gap-1.5"
            >
              <MdOutlineFilterAltOff size={17} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ==================== the table ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-16 flex justify-center">
            <ClipLoader size={35} color="#4f46e5" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            {hasFilters
              ? "Nothing matches these filters."
              : "Nothing has been recorded yet."}
          </div>
        ) : (
          /*
            overflow-x-auto keeps the table on one screen on a phone:
            it scrolls sideways inside its own box instead of pushing
            the whole page wide.
          */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-slate-500">
                  <th className="px-5 py-3 font-medium whitespace-nowrap">When</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">What happened</th>
                  <th className="px-5 py-3 font-medium">Performed by</th>
                  <th className="px-5 py-3 font-medium">Module</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => {
                  const hasChanges = (log.changes || []).length > 0;
                  const isOpen = openRow === log._id;

                  return (
                    /*
                      align-top keeps the date and the person lined up
                      with the FIRST line of the description, which
                      matters once a row is opened and its diff makes
                      the cell tall.
                    */
                    <tr
                      key={log._id}
                      className={`align-top ${
                        log.status === "Failure" ? "bg-red-50/40" : ""
                      }`}
                    >
                      {/* ---------- when ---------- */}
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                        {formatMoment(log.createdAt)}
                      </td>

                      {/* ---------- the action ---------- */}
                      <td className="px-5 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                            AUDIT_ACTION_STYLES[log.action] ||
                            "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {describeAction(log.action)}
                        </span>

                        {log.status === "Failure" && (
                          <span className="block mt-1 text-[11px] text-red-600">
                            Failed
                          </span>
                        )}
                      </td>

                      {/* ---------- the sentence, and the diff ---------- */}
                      <td className="px-5 py-3 text-slate-700 min-w-[280px]">
                        {log.description}

                        {log.targetLabel && (
                          <span className="block text-xs text-slate-400 mt-0.5">
                            {log.targetLabel}
                          </span>
                        )}

                        {/*
                          THE FIELD BY FIELD DIFF.

                          Hidden behind a toggle because most rows have
                          one or two changes and a few have ten. Showing
                          them all at once would bury the descriptions.
                        */}
                        {hasChanges && (
                          <>
                            <button
                              onClick={() => setOpenRow(isOpen ? null : log._id)}
                              className="mt-1.5 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
                            >
                              <MdExpandMore
                                size={16}
                                className={`transition-transform ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                              {log.changes.length} change
                              {log.changes.length === 1 ? "" : "s"}
                            </button>

                            {isOpen && (
                              <ul className="mt-2 flex flex-col gap-1.5">
                                {log.changes.map((change, index) => (
                                  <li
                                    key={index}
                                    className="text-xs bg-slate-50 rounded-lg px-3 py-2"
                                  >
                                    <span className="font-medium text-slate-700">
                                      {change.field}
                                    </span>

                                    <span className="flex flex-wrap items-center gap-1.5 mt-1 text-slate-600">
                                      <span className="line-through text-slate-400">
                                        {change.from}
                                      </span>
                                      <MdArrowRightAlt
                                        size={15}
                                        className="text-slate-400 shrink-0"
                                      />
                                      <span className="text-slate-800">
                                        {change.to}
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </td>

                      {/* ---------- who did it ---------- */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {/*
                            The photo is the ONLY thing taken from the
                            populated user. Every word comes from the
                            frozen actorName / actorRole on the entry,
                            so renaming somebody cannot rewrite history.
                          */}
                          {log.actor?.photoUrl ? (
                            <img
                              src={getPhotoUrl(log.actor.photoUrl)}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 text-xs flex items-center justify-center shrink-0">
                              {(log.actorName || "?").charAt(0).toUpperCase()}
                            </span>
                          )}

                          <div className="min-w-0">
                            <p className="text-slate-700 whitespace-nowrap">
                              {log.actorName}
                            </p>
                            {log.actorRole && (
                              <p className="text-xs text-slate-400 whitespace-nowrap">
                                {log.actorRole}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* ---------- the module ---------- */}
                      <td className="px-5 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                            AUDIT_MODULE_STYLES[log.module] ||
                            "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {log.module}
                        </span>
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
    </div>
  );
}

export default AuditLogs;
