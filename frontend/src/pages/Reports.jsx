/*
=========================================================================
  PAGE: Reports   (Module 8 - Reports & Search)
=========================================================================
  Six reports, one page.

    Monthly         how much came in each month, and how it turned out
    Employee        who raises what, and how it goes for them
    Department      volume and approval performance per department
    Approval Time   how long approvals take, and where they wait
    Rejection       what was turned down, by whom, and why
    Expense         every request that carries an amount

  WHY THEY ARE SIX TABS AND NOT SIX PAGES
  ---------------------------------------
  Because the FILTERS are the same for all six, and they are what
  somebody actually sets. Running the rejection report for last quarter
  and then wanting the expense report for the same quarter is the normal
  way this page is used - as six pages that would mean setting the date
  range six times, and one of those times it would be set slightly
  differently and two reports would be quietly incomparable.

  So the tab changes the QUESTION and everything else stays where it
  was put.

  THIS FILE DOES NOT KNOW WHAT ANY OF THE SIX REPORTS CONTAIN.
  It asks for one by name, and draws whatever columns, rows and summary
  come back - see ReportTable.jsx. A seventh report added to the backend
  would appear here with one entry in REPORT_TABS and nothing else.

  Dashboard vs Reports: Module 5 answers "how are things going right
  now" in four charts; this answers "what happened between these two
  dates" in a table with a file at the end of it.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdChevronLeft,
  MdChevronRight,
  MdOutlineWarningAmber,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { downloadFile, stampedFileName } from "../utils/download.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import {
  REPORT_TABS,
  APPROVAL_TIME_DIMENSIONS,
  EXPORT_FORMATS,
  SCOPE_STYLES,
} from "../utils/reportConstants.js";

import ReportFilters from "../components/reports/ReportFilters.jsx";
import ReportSummary from "../components/reports/ReportSummary.jsx";
import ReportTable from "../components/reports/ReportTable.jsx";
import ExportButtons from "../components/reports/ExportButtons.jsx";

// what "no filters at all" looks like, used on load and by Clear
const EMPTY_FILTERS = {
  from: "",
  to: "",
  department: "",
  type: "",
  status: "",
  priority: "",
};

const PAGE_SIZE = 25;

function Reports() {
  const { userData } = useSelector((state) => state.user);

  const canExport = hasPermission(userData, PERMISSIONS.REPORT_EXPORT);

  /* ---------------- which report ---------------- */
  const [reportKey, setReportKey] = useState("monthly");

  // only the Approval Time report uses this
  const [dimension, setDimension] = useState("type");

  /* ---------------- the data ---------------- */
  const [report, setReport] = useState(null);
  const [options, setOptions] = useState({});
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");

  /* ---------------- the filters ---------------- */
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  /* ---------------- pages ---------------- */
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);

  /* =================================================================
     BUILD THE QUERY STRING
     ---------------------------------------------------------------
     Shared by the table and by all three exports, so a downloaded
     file can never hold something different from what is on screen.
     Empty filters are left out entirely rather than sent as "",
     which keeps the URL readable in the network tab.
     ================================================================= */
  const buildQuery = useCallback(
    (extra = {}) => {
      const query = new URLSearchParams();

      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          query.append(key, value);
        }
      });

      // meaningless on the other five, and the backend ignores it there
      if (reportKey === "approval-time") {
        query.append("by", dimension);
      }

      Object.entries(extra).forEach(([key, value]) =>
        query.append(key, String(value))
      );

      return query.toString();
    },
    [filters, reportKey, dimension]
  );

  /* =================================================================
     LOAD THE DROPDOWNS
     ---------------------------------------------------------------
     Once, when the page opens. It also tells us the SCOPE, which is
     the badge in the header - a page of numbers whose reader is not
     sure whether they cover the whole company or only their own team
     is a page that invites a wrong decision.
     ================================================================= */
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const result = await api.get("/api/report/options");

        setOptions(result.data);
        setScope(result.data.scope);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    };

    fetchOptions();
  }, []);

  /* =================================================================
     RUN THE REPORT
     ================================================================= */
  const fetchReport = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        const result = await api.get(
          `/api/report/${reportKey}?${buildQuery({ page, limit: PAGE_SIZE })}`,
          { signal }
        );

        setReport(result.data.report);
        setScope(result.data.scope);
        setTotalPages(result.data.pagination.totalPages);
        setTotalRows(result.data.pagination.totalRows);
      } catch (error) {
        if (isCancelledError(error)) {
          return;
        }

        toast.error(getErrorMessage(error));
        setReport(null);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [reportKey, buildQuery, page]
  );

  /*
    The 300 ms timer is the same debounce the other list pages use.
    Here it matters for a different reason: typing a year into the
    date field fires an onChange for "2", "20", "202" and "2026", and
    three of those four are aggregations over a range starting in the
    year 2 - which is slow, and then thrown away.

    Which is exactly why the AbortController beside it matters more on
    this page than anywhere else: those three throwaway aggregations
    are the SLOWEST requests the app makes, so they are the ones most
    likely to answer last. Cancelling them stops the year-2 report
    landing on top of the 2026 one, and takes the work off the
    database at the same time.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchReport(controller.signal);
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchReport]);

  /*
    Changing the report or a filter goes back to page 1. Staying on
    page 6 of a report that now has two pages would show an empty
    table, which reads as a bug rather than as a filter.
  */
  useEffect(() => {
    setPage(1);
  }, [reportKey, dimension, filters]);

  /* =================================================================
     DOWNLOAD
     ---------------------------------------------------------------
     The export routes answer with a FILE, not with JSON, so these
     calls ask axios for a `blob` and click a temporary link in code -
     see the long note in ExportButtons.jsx for why a plain <a href>
     cannot do this.
     ================================================================= */
  const handleExport = async (format) => {
    setExporting(format);

    const extension =
      EXPORT_FORMATS.find((one) => one.key === format)?.extension || format;

    try {
      await downloadFile(
        `/api/report/${reportKey}/export?${buildQuery({ format })}`,
        stampedFileName([reportKey, "report"], extension)
      );

      toast.success(`${report?.title || "Report"} exported`);
    } catch (error) {
      /*
        downloadFile has already read the blob back as text for us. An
        error to a blob request arrives as a blob too, so the usual
        getErrorMessage() would find nothing on it and fall back to
        "Request failed with status code 403" - which tells the reader
        nothing about the date range they need to narrow.
      */
      toast.error(error.message);
    } finally {
      setExporting("");
    }
  };

  /* =================================================================
     THE FILTER HANDLERS
     ================================================================= */
  const handleFilterChange = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const handleQuickRange = (from, to) =>
    setFilters((current) => ({ ...current, from, to }));

  const handleClearFilters = () => setFilters(EMPTY_FILTERS);

  const activeTab = REPORT_TABS.find((tab) => tab.key === reportKey);

  const scopeStyle = SCOPE_STYLES[scope?.level] || SCOPE_STYLES.own;

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-slate-800">Reports</h1>

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
            {activeTab?.hint}
          </p>
        </div>

        {/*
          The export buttons only exist for somebody with
          report:export. Hiding them is a courtesy, not security - the
          backend refuses the route either way.
        */}
        {canExport && (
          <ExportButtons
            onExport={handleExport}
            busy={exporting}
            disabled={loading || !report}
          />
        )}
      </div>

      {/* ==================== which report ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex flex-wrap gap-1">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setReportKey(tab.key)}
            className={`px-4 h-10 rounded-lg text-sm font-medium transition-colors ${
              reportKey === tab.key
                ? "bg-blue-50 text-blue-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== the filters ==================== */}
      <ReportFilters
        filters={filters}
        onChange={handleFilterChange}
        onQuickRange={handleQuickRange}
        onClear={handleClearFilters}
        options={options}
      />

      {/*
        THE ONE FILTER THAT BELONGS TO A SINGLE REPORT.

        It sits apart from the shared filter card on purpose: it is not
        a filter at all, it changes what the rows ARE. Putting it in
        with the others would suggest it narrows them.
      */}
      {reportKey === "approval-time" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 mr-1">
            Measure
          </span>

          {APPROVAL_TIME_DIMENSIONS.map((option) => (
            <button
              key={option.key}
              onClick={() => setDimension(option.key)}
              className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                dimension === option.key
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* ==================== the headline numbers ==================== */}
      {!loading && report && <ReportSummary items={report.summary} />}

      {/* ==================== the table ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* ---------- what is in it, and what it was filtered by ---------- */}
        {!loading && report && (
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{report.title}</span>
              <span className="text-slate-400">
                {" "}
                &middot; {totalRows} row{totalRows === 1 ? "" : "s"}
              </span>
            </p>

            {/*
              The same filter line the PDF prints across its header. It
              is here as well so the screen and the file say the same
              thing, and so a screenshot of this page is still worth
              something a week later.
            */}
            <p className="text-xs text-slate-400">
              {report.filters
                .map((filter) => `${filter.label}: ${filter.value}`)
                .join("   |   ")}
            </p>
          </div>
        )}

        {/* ---------- the truncation warning ---------- */}
        {!loading && report?.truncated && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800">
            <MdOutlineWarningAmber size={16} className="shrink-0" />
            Only the first {totalRows} rows are included, here and in any
            export. Narrow the date range or the filters to see the rest.
          </div>
        )}

        {loading ? (
          <div className="p-16 flex justify-center">
            <ClipLoader size={35} color="#4f46e5" />
          </div>
        ) : !report ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            This report could not be generated.
          </div>
        ) : (
          <ReportTable
            columns={report.columns}
            rows={report.rows}
            empty="Nothing matched these filters."
          />
        )}

        {/* ==================== pagination ==================== */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
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

      {/*
        THE SUMMARY NEVER CHANGES WHEN THE PAGE DOES, and that is worth
        saying out loud on screen rather than leaving somebody to wonder
        whether the total above only counts the twenty-five rows below.
      */}
      {!loading && report && totalPages > 1 && (
        <p className="text-xs text-slate-400 -mt-2">
          The figures above cover the whole report, not just this page.
        </p>
      )}
    </div>
  );
}

export default Reports;
