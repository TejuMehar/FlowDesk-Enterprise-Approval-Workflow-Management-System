/*
=========================================================================
  COMPONENT: AttendanceCalendar
=========================================================================
  The month grid: one small square per day, coloured by what happened.

  WHY A CALENDAR AND NOT ANOTHER CHART
  ------------------------------------
  Attendance is the one thing in FlowDesk whose natural shape is
  already a calendar. The question people ask is "which days?", and a
  bar chart answers "how many" - which is a different question and one
  the summary cards have already answered above it.

  A calendar also makes the two patterns that matter VISIBLE rather
  than countable: three absences in a row is a different fact from
  three absences spread across a month, and no total can tell them
  apart.

  THE COLOUR IS NEVER THE ONLY CHANNEL
  ------------------------------------
  Every square carries its date, its tooltip says the status in words,
  and the legend underneath names each colour. Somebody who cannot
  separate the green from the amber can still read every square by
  hovering it - the colour is a shortcut, not the data.
=========================================================================
*/

import {
  statusMeta,
  formatMinutes,
  formatDateKey,
} from "../../utils/attendanceConstants.js";

/*
  @param days      the raw day objects from the backend (one per date)
  @param onSelect  optional, called with a day when a square is clicked
*/
function AttendanceCalendar({ days = [], onSelect = null }) {
  if (days.length === 0) {
    return null;
  }

  /*
    THE GRID HAS TO START ON THE RIGHT WEEKDAY.

    A month whose first day is a Wednesday needs two blank cells in
    front of it, or every square in the grid sits under the wrong
    column heading and the picture is worse than no picture. The
    weekday is read from the dateKey through Date.UTC, which is the
    one way to do it that cannot slide a day sideways.
  */
  const firstKey = days[0].dateKey;
  const [year, month, day] = firstKey.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  // Monday-first, the way a working week is read
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1;

  const legend = ["Present", "Late", "HalfDay", "Absent", "Holiday", "Weekend"];

  return (
    <div className="bg-white rounded-lg border border-slate-300 p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">
        Day by day
      </h3>

      {/* ---------- the weekday headings ---------- */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div
            key={label}
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center"
          >
            {label}
          </div>
        ))}
      </div>

      {/* ---------- the squares ---------- */}
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <div key={`blank-${index}`} />
        ))}

        {days.map((entry) => {
          const meta = statusMeta(entry.status);

          const clickable = Boolean(onSelect && entry.record);

          /*
            The tooltip is the accessible copy of the whole square: the
            date, the status in words, and the hours. Everything the
            colour is standing in for.
          */
          const title = entry.beforeJoining
            ? `${formatDateKey(entry.dateKey)} - before joining`
            : `${formatDateKey(entry.dateKey)} - ${
                entry.reason && !entry.record ? entry.reason : meta.label
              }${
                entry.record
                  ? ` - ${formatMinutes(entry.workedMinutes)} worked`
                  : ""
              }`;

          return (
            <button
              key={entry.dateKey}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => clickable && onSelect(entry)}
              disabled={!clickable}
              className={`aspect-square rounded-md border flex flex-col items-center justify-center transition-transform ${
                entry.beforeJoining
                  ? "border-dashed border-slate-200 text-slate-300"
                  : meta.badge
              } ${clickable ? "hover:scale-110 cursor-pointer" : "cursor-default"}`}
            >
              <span className="text-[11px] font-semibold tabular-nums leading-none">
                {entry.dateKey.slice(-2)}
              </span>

              {/*
                A second line only when there is one worth having. A
                grid where every square holds two numbers is a grid
                nobody scans - the hours are for the days that were
                worked, and the rest stay quiet.
              */}
              {entry.record && (
                <span className="text-[9px] leading-none mt-0.5 opacity-75 tabular-nums">
                  {Math.round(entry.workedMinutes / 60)}h
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------- the legend ---------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-slate-200">
        {legend.map((status) => {
          const meta = statusMeta(status);

          return (
            <span
              key={status}
              className="flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: meta.dot }}
              />
              {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default AttendanceCalendar;
