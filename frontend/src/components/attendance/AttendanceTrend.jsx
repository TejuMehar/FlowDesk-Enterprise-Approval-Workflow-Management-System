/*
=========================================================================
  CHART: AttendanceTrend
=========================================================================
  One column per day: how many of the team were present, how many
  arrived late, and how many were not there at all.

  DRAWN BY HAND, WITH NO CHART LIBRARY, exactly like the four charts in
  Module 5 - a stacked column chart is three lines of arithmetic:

      scale  = plotHeight / the biggest column
      height = value * scale
      y      = baseline - height

  WHY A COLUMN PER DAY AND NOT PER WEEK
  -------------------------------------
  The pattern a manager is looking for is the SHAPE of a week - the
  Monday that is always thin, the Friday that empties after lunch - and
  a weekly column averages exactly that away. Sixty days is still under
  a hundred marks, which is a picture rather than a wall.

  NON-WORKING DAYS ARE DRAWN AS GAPS
  ----------------------------------
  A weekend with nobody at work is not a bad day; it is a day off. It
  gets a hairline on the baseline instead of a column, so the eye reads
  the rhythm of the week without a row of alarming empty slots. A
  weekend somebody DID work still draws its column, because that really
  is something to notice.
=========================================================================
*/

import { useState } from "react";

import useElementWidth from "../../CustomHooks/useElementWidth.js";
import { CHART_INK, CHART_COLORS } from "../../utils/dashboardConstants.js";
import ChartCard from "../charts/ChartCard.jsx";
import { formatDateKey } from "../../utils/attendanceConstants.js";

const HEIGHT = 200;
const PADDING = { top: 16, right: 6, bottom: 24, left: 30 };
const MAX_COLUMN_WIDTH = 22;
const SEGMENT_GAP = 2;

const SERIES = [
  { key: "present", label: "On time", color: CHART_COLORS.approved },
  { key: "late", label: "Late", color: CHART_COLORS.pending },
  { key: "absent", label: "Absent", color: CHART_COLORS.rejected },
];

function AttendanceTrend({ trend = [], title = "Attendance day by day" }) {
  const [container, width] = useElementWidth();
  const [hovered, setHovered] = useState(null);

  const isEmpty =
    trend.length === 0 ||
    trend.every((day) => day.present + day.late + day.absent === 0);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 10);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  // the tallest column decides the scale for all of them
  const biggest = Math.max(
    ...trend.map((day) => day.present + day.late + day.absent),
    1
  );

  const slotWidth = trend.length > 0 ? plotWidth / trend.length : 0;
  const columnWidth = Math.min(slotWidth * 0.62, MAX_COLUMN_WIDTH);

  /*
    ONE LABEL IN EVERY N, worked out from how many actually fit.

    Sixty dates written under sixty columns is a grey smear. The step
    is computed rather than fixed so the same chart is readable at
    seven days and at ninety.
  */
  const labelStep = Math.max(1, Math.ceil(trend.length / (plotWidth / 52)));

  const legend = SERIES.map((series) => ({
    label: series.label,
    color: series.color,
  }));

  const table = (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-200">
        <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <th className="py-2 pr-4">Day</th>
          <th className="py-2 pr-4 text-right">On time</th>
          <th className="py-2 pr-4 text-right">Late</th>
          <th className="py-2 text-right">Absent</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {trend.map((day) => (
          <tr key={day.dateKey}>
            <td className="py-1.5 pr-4 text-slate-600 whitespace-nowrap">
              {formatDateKey(day.dateKey)}
              {!day.isWorkingDay && (
                <span className="text-slate-400 text-xs ml-1.5">{day.reason}</span>
              )}
            </td>
            <td className="py-1.5 pr-4 text-right tabular-nums">{day.present}</td>
            <td className="py-1.5 pr-4 text-right tabular-nums">{day.late}</td>
            <td className="py-1.5 text-right tabular-nums">{day.absent}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard
      title={title}
      subtitle="Every day in the range - non-working days are left as gaps"
      legend={legend}
      table={table}
      isEmpty={isEmpty}
      emptyText="Nobody has clocked in during this period yet."
    >
      <div ref={container} className="relative w-full">
        <svg width="100%" height={HEIGHT} role="img" aria-label={title}>
          {/* ---------- the axis ---------- */}
          {[0, 0.5, 1].map((fraction) => {
            const y = baseline - fraction * plotHeight;

            return (
              <g key={fraction}>
                <line
                  x1={PADDING.left}
                  y1={y}
                  x2={PADDING.left + plotWidth}
                  y2={y}
                  stroke={fraction === 0 ? CHART_INK.axis : CHART_INK.grid}
                  strokeWidth={1}
                />
                <text
                  x={PADDING.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill={CHART_INK.muted}
                  className="tabular-nums"
                >
                  {Math.round(biggest * fraction)}
                </text>
              </g>
            );
          })}

          {/* ---------- the columns ---------- */}
          {trend.map((day, index) => {
            const total = day.present + day.late + day.absent;

            const x =
              PADDING.left + index * slotWidth + (slotWidth - columnWidth) / 2;

            /* a day off with nobody at work: a hairline, not a column */
            if (!day.isWorkingDay && total === 0) {
              return (
                <line
                  key={day.dateKey}
                  x1={x}
                  y1={baseline}
                  x2={x + columnWidth}
                  y2={baseline}
                  stroke={CHART_INK.grid}
                  strokeWidth={2}
                />
              );
            }

            let cursor = baseline;

            return (
              <g
                key={day.dateKey}
                onMouseEnter={() => setHovered({ ...day, index })}
                onMouseLeave={() => setHovered(null)}
              >
                {/* an invisible full-height target, so the tooltip does
                    not demand precision from the pointer */}
                <rect
                  x={PADDING.left + index * slotWidth}
                  y={PADDING.top}
                  width={slotWidth}
                  height={plotHeight}
                  fill="transparent"
                />

                {SERIES.map((series) => {
                  const value = day[series.key];

                  if (!value) {
                    return null;
                  }

                  const height = (value / biggest) * plotHeight;

                  cursor -= height;

                  return (
                    <rect
                      key={series.key}
                      x={x}
                      y={cursor}
                      width={columnWidth}
                      /*
                        The 2px gap is painted in the CARD's colour
                        rather than drawn as a border, so the pieces
                        separate without every column gaining an
                        outline. The same trick StackedColumnChart uses.
                      */
                      height={Math.max(height - SEGMENT_GAP, 1)}
                      fill={series.color}
                      rx={2}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* ---------- the dates ---------- */}
          {trend.map((day, index) =>
            index % labelStep === 0 ? (
              <text
                key={`label-${day.dateKey}`}
                x={PADDING.left + index * slotWidth + slotWidth / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={10}
                fill={CHART_INK.label}
              >
                {day.label}
              </text>
            ) : null
          )}
        </svg>

        {/* ---------- the tooltip ---------- */}
        {hovered && (
          <div
            className="absolute pointer-events-none bg-white border border-slate-300 rounded-lg shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(
                Math.max(PADDING.left + hovered.index * slotWidth - 40, 0),
                Math.max(width - 150, 0)
              ),
              top: 0,
            }}
          >
            <p className="font-semibold text-slate-800 whitespace-nowrap">
              {formatDateKey(hovered.dateKey)}
            </p>

            {!hovered.isWorkingDay && (
              <p className="text-slate-400 mb-1">{hovered.reason}</p>
            )}

            {SERIES.map((series) => (
              <p
                key={series.key}
                className="flex items-center gap-1.5 text-slate-600 mt-0.5"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.label}
                <b className="text-slate-800 tabular-nums ml-auto pl-3">
                  {hovered[series.key]}
                </b>
              </p>
            ))}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export default AttendanceTrend;
