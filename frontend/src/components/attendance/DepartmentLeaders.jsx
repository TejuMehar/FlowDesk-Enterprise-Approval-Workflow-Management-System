/*
=========================================================================
  COMPONENT: DepartmentLeaders
=========================================================================
  "Who is top of EACH department?" - the admin's version of the
  question PerformerList answers for one team.

  WHY THIS IS NOT JUST A LONGER PerformerList
  -------------------------------------------
  An admin's scope is the whole company, and one ranked list across it
  is a list of whichever department runs the tightest shift. Every other
  team is missing from it, which is exactly the opposite of what an
  admin opened the page for.

  Worse, it invites a comparison the numbers cannot carry: a 91 in the
  warehouse (07:00 start) and a 91 in the office (09:30 start) were
  scored against two different working patterns. Ranking INSIDE each
  department keeps every comparison between people who agreed to the
  same pattern, and leaves the department-vs-department question to the
  department table, where it belongs.

  A CARD PER DEPARTMENT, INCLUDING THE QUIET ONES
  -----------------------------------------------
  A department with nobody rankable still gets its card, saying so. The
  alternative is a department that silently disappears from the page,
  which reads as "no such team" rather than "everybody here joined last
  week" - and only one of those is worth acting on.

  AND IT IS ONLY ABOUT ATTENDANCE
  -------------------------------
  The same warning PerformerList carries, in the same words, because
  this is the screen where it matters most: the more senior the reader,
  the further this list can travel from the context that explains it.
  It measures keeping to a working pattern. It cannot see anybody's
  work.
=========================================================================
*/

import {
  MdOutlineWorkspacePremium,
  MdOutlineApartment,
  MdOutlineChevronRight,
} from "react-icons/md";

import { getPhotoUrl } from "../../utils/config.js";
import {
  formatRate,
  scoreTone,
  formatMinutes,
} from "../../utils/attendanceConstants.js";

/*
  The first three places. Gold, silver and bronze are doing the same job
  the rank number does in PerformerList - they are just readable at a
  glance across a grid of cards, where a column of small "1 2 3" is not.
*/
const MEDALS = [
  "bg-amber-100 text-amber-700 ring-amber-200",
  "bg-slate-100 text-slate-600 ring-slate-200",
  "bg-orange-100 text-orange-700 ring-orange-200",
];

/*
  @param groups        from rankPerformersByDepartment() on the server
  @param minDaysToRank the floor the backend applied, so an empty card
                       can explain itself instead of just being empty
  @param title         overridden by the manager view, which is looking
                       at its own teams rather than at the company
  @param onSelect      called with a user id - opens the drill-down
*/
function DepartmentLeaders({
  groups = [],
  minDaysToRank = 5,
  title = "Top performers by department",
  subtitle = "Attendance only - not a measure of anybody's work",
  onSelect = null,
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-300 p-5">
      <div className="flex items-start gap-2.5 mb-4">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <MdOutlineWorkspacePremium size={18} />
        </span>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {groups.map((group) => (
          <DepartmentCard
            key={group.departmentId || "none"}
            group={group}
            minDaysToRank={minDaysToRank}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/*
        HOW THE SCORE IS BUILT, in the same words PerformerList uses.
        Repeating it is deliberate: the two lists are rarely on screen
        together, and a number about a person that will not explain
        itself is one people either over-trust or ignore.
      */}
      <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100 leading-relaxed">
        Score = 40% being there + 25% arriving on time + 25% hours worked +
        10% keeping inside the break allowance. Overtime does not raise it.
        People are ranked against their own department&apos;s working pattern,
        never against another department&apos;s.
      </p>
    </div>
  );
}

/* =====================================================================
   ONE DEPARTMENT
   ---------------------------------------------------------------------
   The card carries its headcount next to its name, because "top of a
   department of 3" and "top of a department of 60" are not the same
   achievement and the reader should never have to go and look it up.
   ===================================================================== */
function DepartmentCard({ group, minDaysToRank, onSelect }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <MdOutlineApartment size={15} className="shrink-0 text-slate-400" />

        <p className="text-sm font-semibold text-slate-800 truncate">
          {group.name}
        </p>

        <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums">
          {group.employees} {group.employees === 1 ? "person" : "people"}
        </span>
      </div>

      {group.leaders.length === 0 ? (
        /*
          THE TWO EMPTY STATES ARE DIFFERENT ANSWERS and are worded as
          such. An empty department is an admin's problem; a department
          of recent joiners is nobody's problem and only needs a wider
          date range.
        */
        <p className="text-xs text-slate-500 py-4 text-center">
          {group.employees === 0
            ? "Nobody is filed under this department."
            : `Nobody here has ${minDaysToRank} expected days in this period yet. Widen the date range to rank them fairly.`}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100">
          {group.leaders.map((row, index) => {
            const tone = scoreTone(row.score);
            const photo = getPhotoUrl(row.user.photoUrl);

            return (
              <button
                key={row.user._id}
                type="button"
                onClick={() => onSelect && onSelect(row.user._id)}
                disabled={!onSelect}
                className={`group flex items-center gap-2.5 py-2.5 text-left first:pt-0 last:pb-0 ${
                  onSelect ? "hover:bg-slate-50 -mx-2 px-2 rounded-lg" : ""
                } transition-colors`}
              >
                <span
                  className={`w-5 h-5 shrink-0 rounded-full ring-1 flex items-center justify-center text-[10px] font-bold tabular-nums ${
                    MEDALS[index] || "bg-slate-50 text-slate-400 ring-slate-200"
                  }`}
                >
                  {index + 1}
                </span>

                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-8 h-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                    {row.user.firstName?.charAt(0)?.toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {row.user.firstName} {row.user.lastName}
                  </p>

                  {/* the parts the score is made of, so the total is
                      always readable as a sum of checkable things */}
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {row.expectedPresentDays}/{row.workingDays} days
                    {" · "}
                    {formatRate(row.punctualityRate)} on time
                    {" · "}
                    {formatMinutes(row.workedMinutes)}
                  </p>
                </div>

                <span
                  className={`shrink-0 text-base font-semibold tabular-nums ${tone.text}`}
                >
                  {row.score}
                </span>

                {onSelect && (
                  <MdOutlineChevronRight
                    size={16}
                    className="shrink-0 text-slate-300 group-hover:text-slate-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/*
        How many of the department could be ranked at all. Without it a
        podium of three out of sixty people looks like a podium of
        three out of three.
      */}
      {group.leaders.length > 0 && group.rankable > group.leaders.length && (
        <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-100">
          Top {group.leaders.length} of {group.rankable} ranked
        </p>
      )}
    </div>
  );
}

export default DepartmentLeaders;
