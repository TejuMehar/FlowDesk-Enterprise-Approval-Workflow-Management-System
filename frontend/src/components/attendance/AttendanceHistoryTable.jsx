/*
=========================================================================
  COMPONENT: AttendanceHistoryTable
=========================================================================
  The daily / weekly / monthly table on the Attendance page and on the
  employee drill-down.

  THREE PERIODS, TWO TABLES
  -------------------------
  A DAILY row is one day: it has punch times, a status and a break. A
  WEEKLY or MONTHLY row is a summary: it has counts and rates and no
  punch times at all, because a week does not have a clock-in.

  So the component draws two different tables and picks between them,
  instead of one table with half its columns empty. A "Clock in" column
  reading "-" on every monthly row is a column that teaches the reader
  to ignore a column.

  THE ROW A MANAGER IS LOOKING FOR IS THE ODD ONE
  -----------------------------------------------
  Absences, late arrivals, auto-closed days and corrections all carry a
  mark. Everything else is quiet on purpose - a table where every row
  shouts is a table where nothing does.
=========================================================================
*/

import {
  MdOutlineAutoMode,
  MdOutlineEditNote,
  MdOutlineChevronRight,
} from "react-icons/md";

import {
  formatMinutes,
  formatRate,
  statusMeta,
  formatDateKey,
  weekdayOfDateKey,
} from "../../utils/attendanceConstants.js";

/*
  @param rows      what bucketDays() produced - days or buckets
  @param period    "daily" | "weekly" | "monthly"
  @param onSelect  optional, called with a daily row when it is clicked
*/
function AttendanceHistoryTable({ rows = [], period = "daily", onSelect = null }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-10 text-center">
        <p className="text-sm text-slate-500">
          There is no attendance in this period yet.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
      {/* a wide table scrolls inside its own card, never sideways on the page */}
      <div className="overflow-x-auto">
        {period === "daily" ? (
          <DailyTable rows={rows} onSelect={onSelect} />
        ) : (
          <BucketTable rows={rows} />
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   THE DAILY TABLE - one row per day
   ===================================================================== */
function DailyTable({ rows, onSelect }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">In</th>
          <th className="px-4 py-3">Out</th>
          <th className="px-4 py-3 text-right">Worked</th>
          <th className="px-4 py-3 text-right">Break</th>
          <th className="px-4 py-3 text-right">Late</th>
          <th className="px-4 py-3 text-right">Overtime</th>
          {onSelect && <th className="px-4 py-3" />}
        </tr>
      </thead>

      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => {
          const meta = statusMeta(row.status);

          /*
            A day the person had not joined yet is drawn as a quiet
            blank rather than as a status. It is not an absence and it
            is not a week off - it is simply not their day.
          */
          if (row.beforeJoining) {
            return (
              <tr key={row.dateKey} className="text-slate-300">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {weekdayOfDateKey(row.dateKey)} {formatDateKey(row.dateKey)}
                </td>
                <td className="px-4 py-2.5 text-xs" colSpan={onSelect ? 8 : 7}>
                  Before joining
                </td>
              </tr>
            );
          }

          const isOff = !row.isWorkingDay && !row.record;

          return (
            <tr
              key={row.dateKey}
              className={`${isOff ? "bg-slate-50/60" : "hover:bg-slate-50"} ${
                onSelect && row.record ? "cursor-pointer" : ""
              } transition-colors`}
              onClick={() => onSelect && row.record && onSelect(row)}
            >
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="text-slate-400 text-xs mr-1.5">
                  {weekdayOfDateKey(row.dateKey)}
                </span>
                <span
                  className={isOff ? "text-slate-400" : "text-slate-700 font-medium"}
                >
                  {formatDateKey(row.dateKey)}
                </span>
              </td>

              <td className="px-4 py-2.5 whitespace-nowrap">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: meta.dot }}
                  />
                  {row.reason && !row.record ? row.reason : meta.label}
                </span>

                {/* the two honesty marks - see attendanceModel.js */}
                {row.isAutoClosed && (
                  <span
                    className="inline-flex items-center ml-1.5 text-amber-600"
                    title="Closed automatically at the end of the shift - no clock out was recorded"
                  >
                    <MdOutlineAutoMode size={14} />
                  </span>
                )}

                {row.correctedAt && (
                  <span
                    className="inline-flex items-center ml-1.5 text-sky-600"
                    title="This record was corrected by a manager"
                  >
                    <MdOutlineEditNote size={15} />
                  </span>
                )}
              </td>

              <td className="px-4 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                {row.clockInMinuteOfDay !== null && row.clockInMinuteOfDay !== undefined
                  ? clockText(row.clockInMinuteOfDay)
                  : "-"}
              </td>

              <td className="px-4 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                {row.isOpen ? (
                  <span className="text-green-600 text-xs font-medium">
                    still working
                  </span>
                ) : row.clockOutMinuteOfDay !== null &&
                  row.clockOutMinuteOfDay !== undefined ? (
                  clockText(row.clockOutMinuteOfDay)
                ) : (
                  "-"
                )}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums text-slate-800 font-medium">
                {row.record ? formatMinutes(row.workedMinutes) : "-"}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.record ? (
                  <span
                    className={
                      row.overBreakMinutes > 0 ? "text-red-600 font-medium" : "text-slate-600"
                    }
                  >
                    {formatMinutes(row.breakMinutes)}
                  </span>
                ) : (
                  "-"
                )}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.lateMinutes > 0 ? (
                  <span className="text-amber-600 font-medium">
                    {formatMinutes(row.lateMinutes)}
                  </span>
                ) : (
                  <span className="text-slate-300">-</span>
                )}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.overtimeMinutes > 0 ? (
                  <span className="text-indigo-600 font-medium">
                    {formatMinutes(row.overtimeMinutes)}
                  </span>
                ) : (
                  <span className="text-slate-300">-</span>
                )}
              </td>

              {onSelect && (
                <td className="px-4 py-2.5 text-slate-300">
                  {row.record && <MdOutlineChevronRight size={18} />}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* =====================================================================
   THE BUCKET TABLE - one row per week or month
   ===================================================================== */
function BucketTable({ rows }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <th className="px-4 py-3">Period</th>
          <th className="px-4 py-3 text-right">Expected</th>
          <th className="px-4 py-3 text-right">Present</th>
          <th className="px-4 py-3 text-right">Absent</th>
          <th className="px-4 py-3 text-right">Late</th>
          <th className="px-4 py-3 text-right">Worked</th>
          <th className="px-4 py-3 text-right">Overtime</th>
          <th className="px-4 py-3 text-right">Attendance</th>
        </tr>
      </thead>

      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.key} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-700 font-medium whitespace-nowrap">
              {row.label}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
              {row.workingDays}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-800 font-medium">
              {row.presentDays}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">
              {row.absentDays > 0 ? (
                <span className="text-red-600 font-medium">{row.absentDays}</span>
              ) : (
                <span className="text-slate-300">0</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">
              {row.lateDays > 0 ? (
                <span className="text-amber-600 font-medium">{row.lateDays}</span>
              ) : (
                <span className="text-slate-300">0</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
              {formatMinutes(row.workedMinutes)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
              {row.overtimeMinutes > 0 ? formatMinutes(row.overtimeMinutes) : "-"}
            </td>

            {/*
              THE RATE IS A BAR AND A NUMBER, not one or the other. The
              number is the fact; the bar is what lets the eye find the
              bad week without reading eight percentages.
            */}
            <td className="px-4 py-2.5">
              <div className="flex items-center justify-end gap-2">
                <span className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                  <span
                    className={`block h-full rounded-full ${
                      row.attendanceRate === null
                        ? ""
                        : row.attendanceRate >= 90
                        ? "bg-green-500"
                        : row.attendanceRate >= 75
                        ? "bg-amber-500"
                        : "bg-red-500"
                    }`}
                    style={{ width: `${row.attendanceRate || 0}%` }}
                  />
                </span>

                <span className="tabular-nums text-slate-800 font-medium w-10 text-right">
                  {formatRate(row.attendanceRate)}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 552 -> "09:12". The backend already worked the minute out in the
// company's timezone, so this is only the last two characters of maths.
const clockText = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;

export default AttendanceHistoryTable;
