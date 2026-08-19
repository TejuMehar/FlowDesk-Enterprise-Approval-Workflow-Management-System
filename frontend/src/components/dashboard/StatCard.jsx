/*
=========================================================================
  COMPONENT: StatCard
=========================================================================
  One number with a label, an icon and (optionally) a link.

  A single number does NOT want a chart. A one-bar bar chart says nothing
  the number does not already say, and costs a hundred pixels to say it.
  So the headline figures on every dashboard are plain type, and the
  charts are kept for the questions that really need a shape.

  The colour of the tile is not decoration - it is the same colour the
  rest of FlowDesk already uses for that subject, so "amber" means
  "waiting" on this card exactly as it does on a status badge.
=========================================================================
*/

import { Link } from "react-router-dom";
import { MdArrowForward } from "react-icons/md";

import { CARD_TONES, formatNumber } from "../../utils/dashboardConstants.js";

/*
  @param label  what the number is, e.g. "Pending Requests"
  @param value  the number itself
  @param icon   a react-icons element
  @param tone   a key of CARD_TONES: "indigo" | "green" | "amber" ...
  @param note   a small line under the value, e.g. "82% of 45"
  @param to     where clicking the card goes. Leave out for a plain card.
*/
function StatCard({ label, value, icon, tone = "indigo", note = null, to = null }) {
  const colors = CARD_TONES[tone] || CARD_TONES.indigo;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>

        <span
          className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${colors.tile}`}
        >
          {icon}
        </span>
      </div>

      {/*
        Proportional figures on purpose: tabular-nums gives every digit
        the width of a zero, which makes a big number like 121 look full
        of holes. Tabular belongs in the tables and the axis ticks, where
        digits have to line up in a column.
      */}
      <p className="text-2xl font-semibold text-slate-900 mt-3">
        {formatNumber(value)}
      </p>

      <div className="flex items-center justify-between mt-1 h-5">
        <span className={`text-xs font-medium ${colors.accent}`}>
          {note || ""}
        </span>

        {to && (
          /* the arrow only appears on hover, so the card reads as a link */
          <span
            className={`flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity ${colors.accent}`}
          >
            View <MdArrowForward size={13} />
          </span>
        )}
      </div>
    </>
  );

  const shell = `group bg-white rounded-lg border border-slate-300 p-5 transition-all ${
    to ? `hover:shadow-md ${colors.hover}` : ""
  }`;

  if (!to) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link to={to} className={shell}>
      {body}
    </Link>
  );
}

export default StatCard;
