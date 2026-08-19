/*
=========================================================================
  COMPONENT: PerformerList
=========================================================================
  "Who is the top performing employee in my department?" - and the
  other end of the same list.

  THE SCORE IS NEVER SHOWN ALONE
  ------------------------------
  Every row prints the four parts it is made of - presence,
  punctuality, hours and breaks - next to the total. That is the whole
  design of this component, and it is not decoration:

    - a single number invites a decision nobody can defend. "78" is not
      a reason; "was here 19 days out of 20 but arrived late on 6 of
      them" is a reason, and it points at a conversation rather than at
      a conclusion
    - the parts are also how somebody DISAGREES with the score, which a
      score about people has to allow

  AND IT IS ONLY ABOUT ATTENDANCE
  -------------------------------
  The header says so in words. This list cannot see code shipped, deals
  closed or tickets answered - it measures whether somebody keeps to the
  working pattern their department agreed, and nothing else. Letting it
  be read as "who is good at their job" is the single easiest way for
  this feature to do harm.

  THE BOTTOM LIST IS CALLED "NEEDS ATTENTION", NOT "WORST"
  --------------------------------------------------------
  Somebody at 40% attendance is far more likely to be quietly ill, or to
  have a rota nobody updated, than to be a problem. The honest framing
  is a list of people to ASK ABOUT, and the wording is doing real work.
=========================================================================
*/

import {
  MdOutlineEmojiEvents,
  MdOutlineHelpOutline,
  MdOutlineChevronRight,
} from "react-icons/md";

import { getPhotoUrl } from "../../utils/config.js";
import { formatRate, scoreTone, formatMinutes } from "../../utils/attendanceConstants.js";

/*
  @param rows          from rankPerformers() or rankNeedsAttention()
  @param variant       "top" | "attention"
  @param minDaysToRank the floor the backend applied, so the empty
                       state can explain itself
  @param onSelect      called with a user id
*/
function PerformerList({
  rows = [],
  variant = "top",
  minDaysToRank = 5,
  onSelect = null,
}) {
  const isTop = variant === "top";

  return (
    <div className="bg-white rounded-lg border border-slate-300 p-5">
      <div className="flex items-start gap-2.5 mb-4">
        <span
          className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
            isTop ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          {isTop ? (
            <MdOutlineEmojiEvents size={18} />
          ) : (
            <MdOutlineHelpOutline size={18} />
          )}
        </span>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">
            {isTop ? "Top attendance" : "Worth asking about"}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {isTop
              ? "Attendance only - not a measure of anybody's work"
              : "Low attendance is a question, not a conclusion"}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          {isTop
            ? `Nobody has ${minDaysToRank} expected days in this period yet. Widen the date range to rank people fairly.`
            : "Nobody in this period needs a second look."}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((row, index) => {
            const tone = scoreTone(row.score);
            const photo = getPhotoUrl(row.user.photoUrl);

            return (
              <button
                key={row.user._id}
                type="button"
                onClick={() => onSelect && onSelect(row.user._id)}
                disabled={!onSelect}
                className={`group flex items-center gap-3 py-3 text-left first:pt-0 last:pb-0 ${
                  onSelect ? "hover:bg-slate-50 -mx-2 px-2 rounded-lg" : ""
                } transition-colors`}
              >
                {/* the rank, only on the top list - a countdown of the
                    people who are struggling is not a leaderboard */}
                {isTop && (
                  <span className="w-5 shrink-0 text-xs font-semibold text-slate-400 tabular-nums">
                    {index + 1}
                  </span>
                )}

                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-9 h-9 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                    {row.user.firstName?.charAt(0)?.toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {row.user.firstName} {row.user.lastName}
                  </p>

                  {/*
                    THE FOUR PARTS. Everything the score is made of, in
                    the order the weights run, so the total is always
                    readable as a sum of things somebody can check.
                  */}
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {/* the EXPECTED present days, so this can never read
                        "6/5" for somebody who worked a Saturday */}
                    {row.expectedPresentDays}/{row.workingDays} days
                    {" · "}
                    {formatRate(row.punctualityRate)} on time
                    {" · "}
                    {formatMinutes(row.workedMinutes)}
                    {row.overBreakDays > 0 &&
                      ` · ${row.overBreakDays} day${
                        row.overBreakDays === 1 ? "" : "s"
                      } over break`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className={`text-lg font-semibold tabular-nums ${tone.text}`}>
                    {row.score}
                  </p>

                  {/* the bar repeats the number as a length, which is
                      what makes two rows comparable at a glance */}
                  <span className="block w-14 h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                    <span
                      className={`block h-full rounded-full ${tone.bg}`}
                      style={{ width: `${row.score}%` }}
                    />
                  </span>
                </div>

                {onSelect && (
                  <MdOutlineChevronRight
                    size={18}
                    className="shrink-0 text-slate-300 group-hover:text-slate-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/*
        HOW THE SCORE IS BUILT, printed under the list rather than
        hidden in a tooltip. A number about a person that will not
        explain itself is a number people either over-trust or ignore,
        and both are worse than a line of small type.
      */}
      {rows.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100 leading-relaxed">
          Score = 40% being there + 25% arriving on time + 25% hours worked +
          10% keeping inside the break allowance. Overtime does not raise it.
        </p>
      )}
    </div>
  );
}

export default PerformerList;
