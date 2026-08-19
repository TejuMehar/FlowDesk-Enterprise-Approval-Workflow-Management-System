/*
=========================================================================
  COMPONENT: ReportTable   (Module 8 - Reports & Search)
=========================================================================
  ONE TABLE THAT DRAWS ALL SIX REPORTS.

  It is handed report.columns and report.rows exactly as the backend
  sent them, and it knows nothing else - not which report this is, not
  what the numbers mean, not how many columns there will be. Adding a
  seventh report to the backend needs no change in this file at all.

  That is the whole point of the report envelope (see the note at the
  top of backend/config/reportConstants.js): six reports times four
  outputs - screen, CSV, Excel, PDF - drawn by four pieces of code
  instead of twenty-four.

  THE COLUMN TYPE DOES THE WORK
  -----------------------------
  A column says what KIND of value it holds, never how to draw it, so
  this component can decide for itself that numbers are right aligned
  and tabular, and that a "-" should be grey rather than black - and
  every report gets that for free.
=========================================================================
*/

import { formatValue } from "../../utils/reportConstants.js";

// the types that hold something you would add up
const NUMERIC_TYPES = ["number", "money", "percent", "duration"];

/*
  @param columns  report.columns: [{ key, label, type, align }]
  @param rows     report.rows
  @param empty    what to say when there is nothing to show
*/
function ReportTable({ columns = [], rows = [], empty = "Nothing matched these filters." }) {
  if (rows.length === 0) {
    return (
      <div className="p-16 text-center text-slate-500 text-sm">{empty}</div>
    );
  }

  return (
    /*
      overflow-x-auto keeps a wide report on one screen: the table
      scrolls sideways inside its own box instead of pushing the whole
      page wide. The Employee report has eleven columns and needs it.
    */
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr className="text-left text-slate-500">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-3 font-medium whitespace-nowrap ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-slate-50/70">
              {columns.map((column, columnIndex) => {
                const value = row[column.key];

                const isEmpty =
                  value === null || value === undefined || value === "";

                const isNumeric = NUMERIC_TYPES.includes(column.type);

                return (
                  <td
                    key={column.key}
                    /*
                      tabular-nums gives every digit the width of a
                      zero, which is what makes a column of numbers
                      line up on the decimal point instead of drifting.
                      It is deliberately NOT used on the text columns -
                      see the note in StatCard.jsx.
                    */
                    className={`px-4 py-2.5 ${
                      column.align === "right"
                        ? "text-right tabular-nums"
                        : "text-left"
                    } ${
                      isEmpty
                        ? "text-slate-300"
                        : columnIndex === 0
                        ? "text-slate-800 font-medium"
                        : "text-slate-600"
                    }`}
                    /*
                      The full text on hover. A rejection reason is cut
                      off at the column width on screen, and the
                      alternative - letting one 900 character cell make
                      a row eight lines tall - would wreck the table
                      the reason is sitting in.
                    */
                    title={
                      column.type === "text" && !isEmpty ? String(value) : undefined
                    }
                  >
                    <span
                      className={
                        column.type === "text"
                          ? "block max-w-[22rem] truncate"
                          : "whitespace-nowrap"
                      }
                    >
                      {formatValue(value, column.type)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ReportTable;
