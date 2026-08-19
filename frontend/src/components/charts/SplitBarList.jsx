/*
=========================================================================
  CHART: Split bars               ("Department Performance")
=========================================================================
  One row per department. Each row is a full-width bar cut into the
  three outcomes, so the reader compares SHAPES down the column:

      Engineering  ############----##      42 requests
      Finance      ######----########      18 requests

  WHY EVERY BAR IS THE SAME LENGTH
  --------------------------------
  Departments raise wildly different numbers of requests. If the bars
  were as long as the volume, the small departments would be slivers and
  the question this chart exists for - "which department gets its
  requests through?" - would be unreadable. So the bar is the SHARE and
  the volume is printed next to it as a number, where it stays honest.

  WHY THIS ONE IS HTML AND NOT SVG
  --------------------------------
  The two charts above have an axis, a scale and geometry, which is what
  SVG is for. This is a list of rows with text at both ends, which is
  what HTML is for - and HTML gets the wrapping, truncating and
  responsive widths right without a single calculation.
=========================================================================
*/

import { useRef, useState } from "react";

import { CHART_INK, formatNumber } from "../../utils/dashboardConstants.js";
import ChartTooltip from "./ChartTooltip.jsx";

/*
  @param rows    [{ name, code, total, approved, rejected, pending, approvalRate }]
  @param series  [{ key, label, color }] - the pieces of each bar
*/
function SplitBarList({ rows = [], series = [] }) {
  const boxRef = useRef(null);
  const [hovered, setHovered] = useState(null); // { index, x, y }

  /*
    The pointer position has to be measured against the LIST, not the
    page, because the tooltip is positioned inside the list.
  */
  const handleMove = (event, index) => {
    const box = boxRef.current?.getBoundingClientRect();

    if (!box) {
      return;
    }

    setHovered({
      index,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  return (
    <div ref={boxRef} className="relative flex flex-col gap-3">
      {rows.map((row, index) => (
        <div
          key={row.departmentId || row.name}
          className="group"
          onMouseMove={(event) => handleMove(event, index)}
          onMouseLeave={() => setHovered(null)}
        >
          {/* ---------- the labels above the bar ---------- */}
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-xs font-medium text-slate-700 truncate">
              {row.name}
            </span>

            <span className="text-xs text-slate-500 shrink-0 tabular-nums">
              {/*
                The approval rate is the point of the chart, so it is the
                one number that gets emphasis. It is null while nothing
                has been decided yet - a department whose requests are all
                still travelling has no rate, and inventing 0% would be a
                lie about people who have done nothing wrong.
              */}
              {row.approvalRate === null ? (
                <span className="text-slate-400">no decisions yet</span>
              ) : (
                <>
                  <b className="text-slate-800 font-semibold">
                    {row.approvalRate}%
                  </b>{" "}
                  approved
                </>
              )}
              <span className="text-slate-400"> · {formatNumber(row.total)}</span>
            </span>
          </div>

          {/* ---------- the bar ---------- */}
          {/*
            The pieces are sized with flex-grow rather than a width in
            percent. Percentages plus a 2px gap would add up to slightly
            MORE than the bar, and the last piece would be clipped;
            flex-grow shares out whatever is left after the gaps, so the
            proportions stay exact at any width.
          */}
          <div
            className="flex h-3 w-full rounded-[4px] overflow-hidden gap-[2px]"
            tabIndex={0}
            role="img"
            aria-label={`${row.name}: ${series
              .map((item) => `${row[item.key] || 0} ${item.label}`)
              .join(", ")}, ${row.total} requests in total`}
            onFocus={() => setHovered({ index, x: 0, y: 24 })}
            onBlur={() => setHovered(null)}
          >
            {series.map((item) => {
              const value = row[item.key] || 0;

              if (value <= 0) {
                return null;
              }

              return (
                <span
                  key={item.key}
                  className="h-full transition-opacity"
                  style={{
                    flexGrow: value,
                    flexBasis: 0,
                    backgroundColor: item.color,
                    // the hovered row stays solid, the rest step back a little
                    opacity:
                      hovered && hovered.index !== index ? 0.55 : 1,
                  }}
                />
              );
            })}

            {/*
              A safety net. The caller adds a grey "not submitted" piece
              so the bar always adds up to the total, but if a row ever
              arrived with nothing in it at all, an empty track is a
              better answer than a bar of zero width.
            */}
            {row.total === 0 && (
              <span
                className="h-full w-full"
                style={{ backgroundColor: CHART_INK.grid }}
              />
            )}
          </div>
        </div>
      ))}

      {hovered && rows[hovered.index] && (
        <ChartTooltip
          x={hovered.x}
          y={hovered.y}
          boxWidth={boxRef.current?.clientWidth || 0}
          title={rows[hovered.index].name}
          rows={series.map((item) => ({
            label: item.label,
            value: formatNumber(rows[hovered.index][item.key] || 0),
            color: item.color,
          }))}
          total={formatNumber(rows[hovered.index].total)}
        />
      )}
    </div>
  );
}

export default SplitBarList;
