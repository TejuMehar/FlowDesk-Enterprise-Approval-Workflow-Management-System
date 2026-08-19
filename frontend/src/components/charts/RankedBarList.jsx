/*
=========================================================================
  CHART: Ranked bars              ("Request Categories")
=========================================================================
  One row per kind of request, longest first:

      Leave      ####################   48   34%
      Purchase   ############           29   21%
      Laptop     #####                  12    9%

  WHY NOT A PIE OR A DONUT
  ------------------------
  A donut is the obvious choice for "share of the total", and it is the
  wrong one here. Comparing the size of two wedges is genuinely hard -
  people misjudge angles by a wide margin - and eight wedges would need
  eight colours that stay apart for a colour-blind reader, which is a
  problem with no good answer. Bars sit on a common left edge, so the
  comparison is a straight length against length, and the row LABEL
  carries the identity so no colour has to.

  That is why every bar here is the same blue. The colour is not saying
  anything; the length is.
=========================================================================
*/

import { CHART_COLORS, formatNumber, toPercent } from "../../utils/dashboardConstants.js";

/*
  @param rows  [{ type, total }]
*/
function RankedBarList({ rows = [] }) {
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  // the longest bar fills the track; every other bar is measured against it
  const biggest = Math.max(...rows.map((row) => row.total), 0);

  // longest first, so the eye reads the answer straight down the list
  const sorted = [...rows].sort((a, b) => b.total - a.total);

  return (
    <div className="flex flex-col gap-2.5">
      {sorted.map((row) => (
        <div key={row.type} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-slate-600 truncate">
            {row.type}
          </span>

          {/* the track the bar grows in, so every bar starts at the same edge */}
          <span className="flex-1 h-3 bg-slate-100 rounded-[4px] overflow-hidden">
            <span
              className="block h-full rounded-[4px]"
              style={{
                width: `${biggest > 0 ? (row.total / biggest) * 100 : 0}%`,
                backgroundColor: CHART_COLORS.magnitude,
              }}
            />
          </span>

          {/*
            The value is printed on every row rather than hidden in a
            tooltip. With ten rows that is not clutter, it is the point -
            and it means the chart still works on a touch screen, where
            there is no such thing as hovering.
          */}
          <span className="w-20 shrink-0 text-right text-xs tabular-nums">
            <b className="text-slate-800 font-semibold">
              {formatNumber(row.total)}
            </b>
            <span className="text-slate-400">
              {" "}
              {toPercent(row.total, grandTotal)}%
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default RankedBarList;
