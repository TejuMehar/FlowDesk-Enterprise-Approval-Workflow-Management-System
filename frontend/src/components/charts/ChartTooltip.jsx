/*
=========================================================================
  COMPONENT: ChartTooltip
=========================================================================
  The little box that follows the pointer over a chart.

  It is written as normal HTML sitting ON TOP of the SVG rather than as
  SVG text, because HTML gives us wrapping, padding and a shadow for
  free - and because a tooltip is not part of the picture.

  A TOOLTIP MAY NEVER BE THE ONLY WAY TO READ A NUMBER.
  Somebody on a touch screen, on a keyboard, or using a screen reader
  never sees it. That is why every chart also has direct labels and the
  "Table" view - the tooltip only saves the reader a click.
=========================================================================
*/

/*
  @param x, y   where the pointer is, in pixels inside the chart box
  @param title  the heading, e.g. "Jul 2026"
  @param rows   [{ label, value, color }]
  @param total  optional footer line
  @param boxWidth  how wide the chart is, so we can flip near the edge
*/
function ChartTooltip({ x, y, title, rows = [], total = null, boxWidth = 0 }) {
  const TOOLTIP_WIDTH = 168;

  /*
    Near the right edge the tooltip would hang off the card, so it flips
    to the other side of the pointer instead.
  */
  const flip = boxWidth > 0 && x + TOOLTIP_WIDTH + 16 > boxWidth;

  const left = flip ? x - TOOLTIP_WIDTH - 12 : x + 12;

  return (
    <div
      // pointer-events-none: the tooltip must never steal the hover from the mark
      className="absolute z-10 pointer-events-none rounded-lg border border-slate-200 bg-white shadow-lg px-3 py-2"
      style={{
        width: TOOLTIP_WIDTH,
        left: Math.max(0, left),
        top: Math.max(0, y - 12),
      }}
    >
      <p className="text-xs font-semibold text-slate-800">{title}</p>

      <div className="flex flex-col gap-1 mt-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="flex items-center gap-1.5 text-slate-500 min-w-0">
              {row.color && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: row.color }}
                />
              )}
              <span className="truncate">{row.label}</span>
            </span>

            {/* tabular-nums keeps the numbers in a straight column */}
            <span className="font-medium text-slate-800 tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {total !== null && (
        <div className="flex items-center justify-between gap-3 text-xs mt-1.5 pt-1.5 border-t border-slate-100">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold text-slate-800 tabular-nums">
            {total}
          </span>
        </div>
      )}
    </div>
  );
}

export default ChartTooltip;
