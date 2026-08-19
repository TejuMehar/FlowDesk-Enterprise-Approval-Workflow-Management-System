/*
=========================================================================
  COMPONENT: ReportFilters   (Module 8 - Reports & Search)
=========================================================================
  The bar above every report: a date range, a department, a request
  type, a status and a priority.

  ONE FILTER OBJECT, ONE onChange. The page above holds the state, this
  component only draws it - which is what lets the page hand exactly the
  same object to the table request and to the export request, and is
  therefore half of the promise that the downloaded file holds what was
  on the screen. (The other half is buildReportArguments() in the
  backend controller.)

  THE QUICK RANGES ARE THE POINT OF THE DATE ROW
  ----------------------------------------------
  Two date pickers are four clicks and two calendars. Nine times out of
  ten the answer wanted is "this month" or "last 6 months", so those are
  one click and the pickers are there for the tenth.
=========================================================================
*/

import { MdOutlineFilterAltOff } from "react-icons/md";

import { QUICK_RANGES, toInputDate } from "../../utils/reportConstants.js";

/*
  @param filters    { from, to, department, type, status, priority }
  @param onChange   (key, value) => void
  @param onQuickRange (from, to) => void
  @param onClear    () => void
  @param options    what the dropdowns may contain, from /api/report/options
  @param show       which dropdowns this page wants. The Search page
                    reuses this component with a different set.
*/
function ReportFilters({
  filters,
  onChange,
  onQuickRange,
  onClear,
  options = {},
  show = { department: true, type: true, status: true, priority: true },
}) {
  const {
    departments = [],
    requestTypes = [],
    requestStatuses = [],
    requestPriorities = [],
  } = options;

  // is anything filtered at all? decides whether to draw the Clear button
  const hasFilters = Object.values(filters).some((value) => value);

  const selectClass =
    "h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white text-slate-700";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
      {/* ==================== the quick ranges ==================== */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-400 mr-1">
          Period
        </span>

        {QUICK_RANGES.map((range) => {
          const { from, to } = range.build();

          const isActive =
            filters.from === toInputDate(from) && filters.to === toInputDate(to);

          return (
            <button
              key={range.key}
              onClick={() => onQuickRange(toInputDate(from), toInputDate(to))}
              className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                isActive
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {range.label}
            </button>
          );
        })}
      </div>

      {/* ==================== the exact dates ==================== */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">From</label>
          <input
            type="date"
            value={filters.from || ""}
            onChange={(event) => onChange("from", event.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">To</label>
          <input
            type="date"
            value={filters.to || ""}
            onChange={(event) => onChange("to", event.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        {hasFilters && (
          <button
            onClick={onClear}
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50 flex items-center gap-1.5"
          >
            <MdOutlineFilterAltOff size={17} /> Clear filters
          </button>
        )}
      </div>

      {/* ==================== the dropdowns ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/*
          The department dropdown disappears completely when there is
          nothing in it. Somebody who manages no department and has no
          analytics permission is looking at their own requests, and
          offering to filter those by department would be offering a
          filter that can only ever return the same rows or none.
        */}
        {show.department && departments.length > 0 && (
          <select
            value={filters.department || ""}
            onChange={(event) => onChange("department", event.target.value)}
            className={selectClass}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department._id} value={department._id}>
                {department.name}
              </option>
            ))}
          </select>
        )}

        {show.type && (
          <select
            value={filters.type || ""}
            onChange={(event) => onChange("type", event.target.value)}
            className={selectClass}
          >
            <option value="">All request types</option>
            {requestTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        )}

        {show.status && (
          <select
            value={filters.status || ""}
            onChange={(event) => onChange("status", event.target.value)}
            className={selectClass}
          >
            <option value="">Any status</option>
            {requestStatuses.map((status) => (
              <option key={status} value={status}>
                {status === "InProgress" ? "In Progress" : status}
              </option>
            ))}
          </select>
        )}

        {show.priority && (
          <select
            value={filters.priority || ""}
            onChange={(event) => onChange("priority", event.target.value)}
            className={selectClass}
          >
            <option value="">Any priority</option>
            {requestPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export default ReportFilters;
