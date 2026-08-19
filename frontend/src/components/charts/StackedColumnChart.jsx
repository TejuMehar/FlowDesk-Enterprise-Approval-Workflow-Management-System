/*
=========================================================================
  CHART: Stacked columns          ("Monthly Requests")
=========================================================================
  One column per month. The column is cut into pieces, one per outcome,
  so the reader gets two answers from one picture:

      how TALL is the column  -> how many requests that month
      how the column is CUT   -> how they turned out

  DRAWN BY HAND, WITH NO CHART LIBRARY
  ------------------------------------
  An SVG is just a picture described in numbers, and a column chart is
  four lines of arithmetic:

      scale  = plotHeight / the biggest value
      height = value * scale
      y      = baseline - height

  Everything below is that, plus the care that makes it readable.

  THE THREE DETAILS THAT DO THE WORK
    1. a 2px gap in the CARD's colour between the stacked pieces, so
       they separate without drawing a border around each one
    2. a 4px rounded top on the topmost piece only - the bottom of the
       column sits on the baseline and must stay square, or it would
       look like it floats
    3. columns capped at 24px wide. A bar that fills its whole slot
       reads as a heavy block; the leftover space is what makes the
       chart look calm
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

/* the fixed shape of the chart - see the comment block above */
const HEIGHT = 220;
const PADDING = { top: 18, right: 6, bottom: 26, left: 34 };
const MAX_COLUMN_WIDTH = 24;
const SEGMENT_GAP = 2;
const CORNER_RADIUS = 4;

/*
  The path of ONE piece of a column.
  The topmost piece gets two rounded corners, every other piece is a
  plain rectangle - so only the top of the whole column is rounded.
*/
const buildSegmentPath = (x, y, width, height, rounded) => {
  // a piece shorter than the corner radius cannot be rounded without bulging
  const radius = rounded ? Math.min(CORNER_RADIUS, height / 2, width / 2) : 0;

  if (radius <= 0) {
    return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
  }

  return [
    `M ${x} ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    `H ${x + width - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}`,
    `V ${y + height}`,
    `H ${x}`,
    "Z",
  ].join(" ");
};

/*
  @param data    [{ label, fullLabel, approved, rejected, pending }]
  @param series  [{ key, label, color }] - stacked bottom to top
*/
function StackedColumnChart({ data = [], series = [] }) {
  const [boxRef, width] = useElementWidth();
  const [hovered, setHovered] = useState(null); // the index under the pointer

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 0);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  // the total of each column, and the tallest of them
  const totals = data.map((row) =>
    series.reduce((sum, item) => sum + (row[item.key] || 0), 0)
  );

  const axisMax = niceAxisMax(Math.max(...totals, 0));
  const ticks = buildAxisTicks(axisMax);
  const scale = plotHeight / axisMax;

  const band = data.length > 0 ? plotWidth / data.length : 0;
  const columnWidth = Math.min(MAX_COLUMN_WIDTH, band * 0.55);

  /*
    With twelve months on a phone the month names would overlap, so we
    print every second one. The tooltip and the table still carry all of
    them, so nothing is lost.
  */
  const labelStep = band < 30 ? 2 : 1;

  // the running total is only worth printing when there is room for it
  const showTotals = band >= 34;

  return (
    <div ref={boxRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Requests per month, split by outcome. ${data
            .map((row, index) => `${row.fullLabel}: ${totals[index]}`)
            .join(", ")}.`}
        >
          {/* ---------- gridlines + y axis numbers ---------- */}
          {ticks.map((tick) => {
            const y = baseline - tick * scale;

            return (
              <g key={tick}>
                {/* solid hairline, one shade off the surface - never dashed */}
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

          {/* ---------- the columns ---------- */}
          {data.map((row, index) => {
            const bandStart = PADDING.left + index * band;
            const x = bandStart + (band - columnWidth) / 2;

            // the highest piece that actually has a value gets the rounded top
            const topSeriesIndex = series.reduce(
              (last, item, itemIndex) =>
                (row[item.key] || 0) > 0 ? itemIndex : last,
              -1
            );

            let stacked = 0; // how much of the column is already drawn
            let isLowestPiece = true;

            return (
              <g key={row.month || row.label}>
                {series.map((item, itemIndex) => {
                  const value = row[item.key] || 0;

                  if (value <= 0) {
                    return null;
                  }

                  const segmentTop = baseline - (stacked + value) * scale;
                  const segmentBottom = baseline - stacked * scale;

                  /*
                    Every piece except the lowest one gives 2px back at
                    its bottom edge. That gap is the CARD showing through,
                    which is what separates the pieces.
                  */
                  const drawnBottom = isLowestPiece
                    ? segmentBottom
                    : segmentBottom - SEGMENT_GAP;

                  const height = drawnBottom - segmentTop;

                  stacked += value;
                  isLowestPiece = false;

                  if (height <= 0) {
                    return null;
                  }

                  return (
                    <path
                      key={item.key}
                      d={buildSegmentPath(
                        x,
                        segmentTop,
                        columnWidth,
                        height,
                        itemIndex === topSeriesIndex
                      )}
                      fill={item.color}
                    />
                  );
                })}

                {/* the total, printed on the cap of the column */}
                {showTotals && totals[index] > 0 && (
                  <text
                    x={bandStart + band / 2}
                    y={baseline - totals[index] * scale - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill={CHART_INK.strong}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {totals[index]}
                  </text>
                )}

                {/* the month name */}
                {index % labelStep === 0 && (
                  <text
                    x={bandStart + band / 2}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill={CHART_INK.label}
                  >
                    {row.label}
                  </text>
                )}

                {/*
                  THE HIT AREA.
                  An invisible rectangle covering the WHOLE month, not
                  just the column - a 12px wide bar would be a cruel
                  thing to have to point at. It is also focusable, so the
                  same information is one Tab key away.
                */}
                <rect
                  x={bandStart}
                  y={PADDING.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${row.fullLabel}: ${totals[index]} requests`}
                  className="outline-none focus-visible:fill-slate-900/5"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {/* ---------- the tooltip ---------- */}
      {hovered !== null && data[hovered] && (
        <ChartTooltip
          x={PADDING.left + hovered * band + band / 2}
          y={PADDING.top}
          boxWidth={width}
          title={data[hovered].fullLabel}
          rows={series.map((item) => ({
            label: item.label,
            value: formatNumber(data[hovered][item.key] || 0),
            color: item.color,
          }))}
          total={formatNumber(totals[hovered])}
        />
      )}
    </div>
  );
}

export default StackedColumnChart;
