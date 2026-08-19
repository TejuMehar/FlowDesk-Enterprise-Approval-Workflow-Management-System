/*
=========================================================================
  COMPONENT: TeamAttendanceTable
=========================================================================
  Every employee on the board, one row each, sortable.

  IT IS THE FULL PICTURE THE TWO SHORT LISTS SUMMARISE. PerformerList
  shows five names at each end; this shows everybody, because a manager
  of fifteen people needs the middle of the list too - that is where
  most of their team lives.

  WHY IT SORTS IN THE BROWSER AND NOT ON THE SERVER
  -------------------------------------------------
  The whole board is already here. A department is tens of rows, not
  thousands, and the backend deliberately builds the complete result in
  one go so the screen and the export can never disagree (see the note
  in backend/controllers/attendanceController.js). Asking the server to
  sort it again would be a round trip to reorder an array we are
  holding.

  THE DEFAULT SORT IS BY NAME, NOT BY SCORE
  -----------------------------------------
  A team list that opens as a ranking makes the ranking the point of the
  page every time it is opened. A manager looking for one person's row
  wants alphabetical; somebody looking for a pattern can press the
  column. The ranking already has its own place on the page.
=========================================================================
*/

import { useState } from "react";
import { MdArrowUpward, MdArrowDownward, MdOutlineChevronRight } from "react-icons/md";

import { getPhotoUrl } from "../../utils/config.js";
import {
  formatMinutes,
  formatRate,
  scoreTone,
} from "../../utils/attendanceConstants.js";

/*
  Each column says how to read a value out of a row, so the sort is one
  function rather than a switch with eight cases.
*/
const COLUMNS = [
  { key: "name", label: "Employee", align: "left", get: (row) => `${row.user.firstName} ${row.user.lastName}` },
  { key: "workingDays", label: "Expected", align: "right", get: (row) => row.workingDays },
  /*
    The EXPECTED present days, so "Expected" and "Present" are two
    readings of the same set of days. Weekend shifts live in the
    "Worked" column, where the hours actually mean something.
  */
  { key: "presentDays", label: "Present", align: "right", get: (row) => row.expectedPresentDays },
  { key: "absentDays", label: "Absent", align: "right", get: (row) => row.absentDays },
  { key: "lateDays", label: "Late", align: "right", get: (row) => row.lateDays },
  { key: "workedMinutes", label: "Worked", align: "right", get: (row) => row.workedMinutes },
  { key: "overtimeMinutes", label: "Overtime", align: "right", get: (row) => row.overtimeMinutes },
  { key: "breakMinutes", label: "Break/day", align: "right", get: (row) => row.avgBreakMinutes ?? -1 },
  { key: "attendanceRate", label: "Attendance", align: "right", get: (row) => row.attendanceRate ?? -1 },
  { key: "score", label: "Score", align: "right", get: (row) => row.score ?? -1 },
];

function TeamAttendanceTable({ rows = [], onSelect = null, showDepartment = false }) {
  const [sort, setSort] = useState({ key: "name", direction: 1 });

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-10 text-center">
        <p className="text-sm text-slate-500">
          There is nobody on this board. Try a wider date range or a different
          department.
        </p>
      </div>
    );
  }

  const column = COLUMNS.find((entry) => entry.key === sort.key) || COLUMNS[0];

  const sorted = [...rows].sort((a, b) => {
    const left = column.get(a);
    const right = column.get(b);

    if (typeof left === "string") {
      return left.localeCompare(right) * sort.direction;
    }

    return (left - right) * sort.direction;
  });

  const toggleSort = (key) => {
    setSort((old) =>
      old.key === key
        ? { key, direction: old.direction * -1 }
        : /*
            A NEW COLUMN STARTS IN THE USEFUL DIRECTION. Names read
            A-Z; numbers read biggest first, because somebody who
            clicks "Absent" is looking for the worst, not the best.
          */
          { key, direction: key === "name" ? 1 : -1 }
    );
  };

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {COLUMNS.map((entry) => (
                <th
                  key={entry.key}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                    entry.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(entry.key)}
                    className={`inline-flex items-center gap-1 hover:text-slate-800 transition-colors ${
                      sort.key === entry.key ? "text-slate-800" : ""
                    }`}
                  >
                    {entry.label}
                    {sort.key === entry.key &&
                      (sort.direction === 1 ? (
                        <MdArrowUpward size={12} />
                      ) : (
                        <MdArrowDownward size={12} />
                      ))}
                  </button>
                </th>
              ))}
              {onSelect && <th className="px-4 py-3" />}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sorted.map((row) => {
              const tone = scoreTone(row.score);
              const photo = getPhotoUrl(row.user.photoUrl);

              return (
                <tr
                  key={row.user._id}
                  onClick={() => onSelect && onSelect(row.user._id)}
                  className={`${
                    onSelect ? "cursor-pointer hover:bg-slate-50" : ""
                  } transition-colors`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {photo ? (
                        <img
                          src={photo}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <span className="w-8 h-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                          {row.user.firstName?.charAt(0)?.toUpperCase()}
                        </span>
                      )}

                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {row.user.firstName} {row.user.lastName}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {row.user.employeeId}
                          {showDepartment && row.user.department
                            ? ` · ${row.user.department.name}`
                            : row.user.designation
                            ? ` · ${row.user.designation}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                    {row.workingDays}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-800 font-medium">
                    {row.expectedPresentDays}

                    {/* a weekend or holiday shift, marked rather than
                        folded into the count above */}
                    {row.offDayWorkedDays > 0 && (
                      <span
                        className="text-[10px] text-sky-600 ml-1"
                        title={`plus ${row.offDayWorkedDays} day(s) worked outside the shift`}
                      >
                        +{row.offDayWorkedDays}
                      </span>
                    )}
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

                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                    {formatMinutes(row.workedMinutes)}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {row.overtimeMinutes > 0 ? (
                      <span className="text-indigo-600">
                        {formatMinutes(row.overtimeMinutes)}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {row.avgBreakMinutes === null ? (
                      <span className="text-slate-300">-</span>
                    ) : (
                      <span
                        className={
                          row.overBreakDays > 0 ? "text-red-600 font-medium" : "text-slate-600"
                        }
                        title={
                          row.overBreakDays > 0
                            ? `over the ${formatMinutes(
                                row.allowanceMinutes
                              )} allowance on ${row.overBreakDays} day(s)`
                            : `allowance ${formatMinutes(row.allowanceMinutes)}`
                        }
                      >
                        {formatMinutes(row.avgBreakMinutes)}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatRate(row.attendanceRate)}
                  </td>

                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`inline-block min-w-[2.5rem] tabular-nums font-semibold ${tone.text}`}
                    >
                      {row.score === null ? "-" : row.score}
                    </span>
                  </td>

                  {onSelect && (
                    <td className="px-4 py-2.5 text-slate-300">
                      <MdOutlineChevronRight size={18} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TeamAttendanceTable;
