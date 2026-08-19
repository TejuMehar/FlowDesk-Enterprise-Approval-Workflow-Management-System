/*
=========================================================================
  COMPONENT: ReportSummary   (Module 8 - Reports & Search)
=========================================================================
  The row of headline numbers above a report's table.

  It is drawn from report.summary, which the BACKEND decides - so this
  component has no idea which of the six reports it is showing, and a
  seventh report would get its summary drawn without a line changing
  here. That is the same trick ReportTable.jsx plays with the columns.

  WHY THE SUMMARY IS ABOVE THE TABLE AND NOT UNDER IT
  ---------------------------------------------------
  Because it answers the question the table only supports. Somebody
  opening the Expense report wants "how much" first and the itemised
  list second; a total hiding under 400 rows is a total nobody reads.
=========================================================================
*/

import { formatValue } from "../../utils/reportConstants.js";

/*
  @param items - report.summary: [{ label, value, type }]
*/
function ReportSummary({ items = [] }) {
  /*
    An item with no value is left out entirely rather than drawn as a
    dash. On a page of headline figures an empty tile reads as "we
    could not work this out", which is worse than one tile fewer -
    a rejection report with no rejections in it should be quiet, not
    apologetic.
  */
  const visible = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== ""
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {visible.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-lg border border-slate-300 px-4 py-3"
        >
          <p className="text-[11px] uppercase tracking-wider text-slate-400 truncate">
            {item.label}
          </p>

          {/*
            The value is allowed to break onto a second line ("Finance
            Review" is a perfectly good summary value) but never to
            shrink the tile, so the row stays a straight line of
            equal blocks.
          */}
          <p className="text-lg font-semibold text-slate-900 mt-1 leading-snug break-words">
            {formatValue(item.value, item.type)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default ReportSummary;
