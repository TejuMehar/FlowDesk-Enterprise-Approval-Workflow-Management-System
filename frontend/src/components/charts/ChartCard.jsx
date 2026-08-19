/*
=========================================================================
  COMPONENT: ChartCard
=========================================================================
  The frame every chart sits in: a title, a legend, and the switch
  between the picture and the numbers.

  WHY EVERY CHART HAS A TABLE
  ---------------------------
  A chart is a shortcut, not the data. Somebody using a screen reader,
  somebody who cannot separate two of the colours, and somebody who
  simply wants the exact figure all need the numbers themselves. The
  "Table" button gives the same data as plain rows, so the picture is
  always an extra way to read it and never the only way.

  WHY THE LEGEND IS ALWAYS THERE
  ------------------------------
  With two or more series the reader must never have to work out which
  colour is which by guessing. The legend is the dependable channel; the
  labels on the marks are a bonus on top of it.
=========================================================================
*/

import { useState } from "react";
import { MdBarChart, MdTableRows } from "react-icons/md";

/*
  @param title     what the chart answers, e.g. "Monthly Requests"
  @param subtitle  one quiet line of context under it
  @param legend    [{ label, color }] - leave empty for a single series
  @param headline  optional node shown on the right of the header
  @param table     the <table> shown when the user switches views
  @param isEmpty   true when there is nothing to draw
  @param children  the chart itself
*/
function ChartCard({
  title,
  subtitle,
  legend = [],
  headline = null,
  table = null,
  isEmpty = false,
  emptyText = "There is nothing to show for this period yet.",
  children,
}) {
  const [view, setView] = useState("chart"); // "chart" | "table"

  const toggleClass = (isActive) =>
    `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
      isActive
        ? "bg-white text-slate-800 shadow-sm"
        : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="bg-white rounded-lg border border-slate-300 p-5">
      {/* ==================== header ==================== */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {headline}

          {/*
            The two views sit in one grey track so they read as a switch
            and not as two separate buttons.
          */}
          {table && (
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setView("chart")}
                className={toggleClass(view === "chart")}
                aria-pressed={view === "chart"}
              >
                <MdBarChart size={14} />
                Chart
              </button>

              <button
                type="button"
                onClick={() => setView("table")}
                className={toggleClass(view === "table")}
                aria-pressed={view === "table"}
              >
                <MdTableRows size={14} />
                Table
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ==================== legend ==================== */}
      {legend.length > 0 && view === "chart" && !isEmpty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          {legend.map((item) => (
            <span
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-slate-600"
            >
              {/*
                The colour lives in this little dot, never in the text.
                A light chart colour is unreadable as 11px type, so the
                label stays in normal ink and the dot carries the identity.
              */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
              {item.value !== undefined && (
                <b className="text-slate-800 font-semibold">{item.value}</b>
              )}
            </span>
          ))}
        </div>
      )}

      {/* ==================== body ==================== */}
      <div className="mt-4">
        {isEmpty ? (
          <div className="h-[200px] flex items-center justify-center text-center">
            <p className="text-sm text-slate-500 max-w-xs">{emptyText}</p>
          </div>
        ) : view === "chart" ? (
          children
        ) : (
          /* a wide table must scroll inside its own card, never push the page sideways */
          <div className="overflow-x-auto">{table}</div>
        )}
      </div>
    </div>
  );
}

export default ChartCard;
