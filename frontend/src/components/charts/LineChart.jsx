/*
=========================================================================
  CHART: Lines                    ("Approval Trends")
=========================================================================
  One line per kind of decision, one point per month.

  Columns are for "how much"; lines are for "which way is it going".
  This chart is about the SHAPE - is the approved line pulling away from
  the rejected one, is everything sagging in December - so the marks are
  deliberately thin and there are no dots along the way.

  WHY THERE IS NO SECOND Y AXIS
  -----------------------------
  The obvious extra line here is the approval RATE, as a percentage. It
  is deliberately not on this chart. Two different scales sharing one
  picture (counts on the left, percent on the right) let the reader see a
  "crossing point" that is pure coincidence - move one scale and the
  story changes. The rate is shown as a plain number next to the title
  instead, where it cannot pretend to be part of the shape.

  WHY ONLY THE LAST POINT HAS A DOT
  ---------------------------------
  Three lines over twelve months is thirty-six points. A dot on each one
  turns the picture into a rash. The last dot marks "where we are now",
  and the hover crosshair puts a dot on any month the reader asks about.
=========================================================================
*/

import { useState } from "react";

import useElementWidth from "../../CustomHooks/useElementWidth.js";
import {
  CHART_INK,
  formatNumber,
  niceAxisMax,
  buildAxisTicks,
} from "../../utils/dashboardConstants.js";
import ChartTooltip from "./ChartTooltip.jsx";

const HEIGHT = 220;
const PADDING = { top: 18, right: 14, bottom: 26, left: 34 };
const LINE_WIDTH = 2;
const MARKER_RADIUS = 4; // an 8px dot, the smallest that stays visible

/*
  @param data    [{ label, fullLabel, approved, rejected, returned }]
  @param series  [{ key, label, color }] - one line each
*/
function LineChart({ data = [], series = [] }) {
  const [boxRef, width] = useElementWidth();
  const [hovered, setHovered] = useState(null);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 0);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  // the biggest value anywhere in any line decides the top of the axis
  const biggest = data.reduce((max, row) => {
    const rowMax = Math.max(...series.map((item) => row[item.key] || 0));
    return Math.max(max, rowMax);
  }, 0);

  const axisMax = niceAxisMax(biggest);
  const ticks = buildAxisTicks(axisMax);
  const scale = plotHeight / axisMax;

  // the first point sits on the y axis and the last on the right edge
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;

  const pointX = (index) => PADDING.left + index * step;
  const pointY = (value) => baseline - (value || 0) * scale;

  const labelStep = step < 30 ? 2 : 1;

  return (
    <div ref={boxRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Approval decisions per month. ${series
            .map(
              (item) =>
                `${item.label}: ${data
                  .map((row) => `${row.label} ${row[item.key] || 0}`)
                  .join(", ")}`
            )
            .join(". ")}.`}
        >
          {/* ---------- gridlines + y axis numbers ---------- */}
          {ticks.map((tick) => {
            const y = baseline - tick * scale;

            return (
              <g key={tick}>
                <line
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke={tick === 0 ? CHART_INK.axis : CHART_INK.grid}
                  strokeWidth={1}
                />

                <text
                  x={PADDING.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill={CHART_INK.muted}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

          {/* ---------- the crosshair, under the lines ---------- */}
          {hovered !== null && (
            <line
              x1={pointX(hovered)}
              x2={pointX(hovered)}
              y1={PADDING.top}
              y2={baseline}
              stroke={CHART_INK.axis}
              strokeWidth={1}
            />
          )}

          {/* ---------- the lines ---------- */}
          {series.map((item) => {
            const points = data
              .map((row, index) => `${pointX(index)},${pointY(row[item.key])}`)
              .join(" ");

            return (
              <polyline
                key={item.key}
                points={points}
                fill="none"
                stroke={item.color}
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* ---------- the dot at the end of each line ---------- */}
          {data.length > 0 &&
            series.map((item) => (
              <circle
                key={item.key}
                cx={pointX(data.length - 1)}
                cy={pointY(data[data.length - 1][item.key])}
                r={MARKER_RADIUS}
                fill={item.color}
                /*
                  The 2px ring is the CARD's own colour. Where two lines
                  end at the same value the ring is what keeps the two
                  dots from melting into one blob.
                */
                stroke={CHART_INK.surface}
                strokeWidth={2}
              />
            ))}

          {/* ---------- the dots the crosshair puts down ---------- */}
          {hovered !== null &&
            series.map((item) => (
              <circle
                key={item.key}
                cx={pointX(hovered)}
                cy={pointY(data[hovered][item.key])}
                r={MARKER_RADIUS}
                fill={item.color}
                stroke={CHART_INK.surface}
                strokeWidth={2}
              />
            ))}

          {/* ---------- month names + the hit areas ---------- */}
          {data.map((row, index) => (
            <g key={row.month || row.label}>
              {index % labelStep === 0 && (
                <text
                  x={pointX(index)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill={CHART_INK.label}
                >
                  {row.label}
                </text>
              )}

              {/*
                A band half a step wide on each side of the point, so the
                reader only has to be near the month, not on the line.
              */}
              <rect
                x={pointX(index) - step / 2}
                y={PADDING.top}
                width={step || plotWidth}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${row.fullLabel}: ${series
                  .map((item) => `${item.label} ${row[item.key] || 0}`)
                  .join(", ")}`}
                className="outline-none focus-visible:fill-slate-900/5"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
              />
            </g>
          ))}
        </svg>
      )}

      {hovered !== null && data[hovered] && (
        <ChartTooltip
          x={pointX(hovered)}
          y={PADDING.top}
          boxWidth={width}
          title={data[hovered].fullLabel}
          rows={series.map((item) => ({
            label: item.label,
            value: formatNumber(data[hovered][item.key] || 0),
            color: item.color,
          }))}
        />
      )}
    </div>
  );
}

export default LineChart;
