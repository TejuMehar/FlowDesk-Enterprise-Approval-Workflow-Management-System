/*
=========================================================================
  COMPONENT: LiveBoard
=========================================================================
  "Who is at work right now?"

  The first thing a department manager looks at in the morning, and the
  only part of the attendance module that is about THIS MOMENT rather
  than about a period. Everything else on the team page is a summary of
  a range; this is a photograph.

  IT IS TODAY ONLY, WHATEVER THE RANGE IS SET TO, and the backend
  enforces that rather than trusting the filter bar. "Who is on a break"
  is a question about now, and answering it over a date range in the
  past would be nonsense dressed up as data.

  THE THREE GROUPS ARE THE THREE ANSWERS
  --------------------------------------
    Working     nothing to do about these
    On break    also fine - the number is the useful part, not the names
    Not started the only group anybody acts on, so it is last and it is
                the one that carries a count of who is missing

  Somebody who has FINISHED is not in the picture at all. They were
  here, they left, and a board of people who have gone home is a board
  that grows all afternoon and says less every hour.
=========================================================================
*/

import {
  MdOutlineWorkHistory,
  MdOutlineFreeBreakfast,
  MdOutlineDoNotDisturbOn,
  MdOutlineAlarm,
} from "react-icons/md";

import { getPhotoUrl } from "../../utils/config.js";
import { formatMinutes } from "../../utils/attendanceConstants.js";

/*
  @param live       what getLiveBoard() produced on the backend
  @param employees  every employee on the board, so the people with no
                    record today can be worked out
  @param onSelect   optional, called with a user id
*/
function LiveBoard({ live = [], employees = [], onSelect = null }) {
  const working = live.filter((entry) => entry.state === "Working");
  const onBreak = live.filter((entry) => entry.state === "OnBreak");

  /*
    NOT STARTED IS A SUBTRACTION, not a query.

    Somebody who has not clocked in has no record at all today - the
    absence of a document, exactly as an absent day is - so the only
    way to name them is to take everybody with a record away from
    everybody who is expected.
  */
  const punchedIds = new Set(live.map((entry) => String(entry.user?._id)));

  const notStarted = employees.filter(
    (employee) => !punchedIds.has(String(employee._id))
  );

  const groups = [
    {
      key: "working",
      title: "Working",
      icon: <MdOutlineWorkHistory size={16} />,
      tone: "text-green-700 bg-green-50 border-green-200",
      dot: "bg-green-500",
      entries: working,
    },
    {
      key: "break",
      title: "On a break",
      icon: <MdOutlineFreeBreakfast size={16} />,
      tone: "text-amber-700 bg-amber-50 border-amber-200",
      dot: "bg-amber-500",
      entries: onBreak,
    },
  ];

  return (
    <div className="bg-white rounded-lg border border-slate-300 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Right now</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Today only - who has started, who is away from their desk
          </p>
        </div>

        {/* the three counts, which is what most people actually read */}
        <div className="flex items-center gap-3 text-xs">
          <Count value={working.length} label="working" tone="text-green-600" />
          <Count value={onBreak.length} label="on break" tone="text-amber-600" />
          <Count
            value={notStarted.length}
            label="not in"
            tone={notStarted.length > 0 ? "text-red-600" : "text-slate-400"}
          />
        </div>
      </div>

      {live.length === 0 && notStarted.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          Nobody is on this board yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) =>
            group.entries.length === 0 ? null : (
              <div key={group.key}>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${group.dot}`} />
                  {group.title} ({group.entries.length})
                </p>

                <div className="flex flex-wrap gap-2">
                  {group.entries.map((entry) => (
                    <button
                      key={entry.recordId}
                      type="button"
                      onClick={() => onSelect && onSelect(entry.user?._id)}
                      disabled={!onSelect}
                      className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-xs transition-colors ${group.tone} ${
                        onSelect ? "hover:brightness-95 cursor-pointer" : "cursor-default"
                      }`}
                      title={
                        entry.state === "OnBreak"
                          ? `${entry.currentBreakType} break, ${formatMinutes(
                              entry.currentBreakMinutes
                            )} so far`
                          : `${formatMinutes(entry.workedMinutes)} worked today`
                      }
                    >
                      <Avatar user={entry.user} />

                      <span className="font-medium">
                        {entry.user?.firstName} {entry.user?.lastName}
                      </span>

                      <span className="tabular-nums opacity-80">
                        {entry.state === "OnBreak"
                          ? formatMinutes(entry.currentBreakMinutes)
                          : formatMinutes(entry.workedMinutes)}
                      </span>

                      {/*
                        A late arrival is marked HERE and not only in
                        the monthly summary. A manager who can see it
                        the same morning can ask about it while it is
                        still a conversation rather than a statistic.
                      */}
                      {entry.lateMinutes > 0 && (
                        <span
                          className="flex items-center text-amber-600"
                          title={`arrived ${formatMinutes(entry.lateMinutes)} late`}
                        >
                          <MdOutlineAlarm size={13} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {notStarted.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <MdOutlineDoNotDisturbOn size={13} className="text-slate-300" />
                Not started ({notStarted.length})
              </p>

              <div className="flex flex-wrap gap-2">
                {notStarted.map((employee) => (
                  <button
                    key={employee._id}
                    type="button"
                    onClick={() => onSelect && onSelect(employee._id)}
                    disabled={!onSelect}
                    className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-500 text-xs ${
                      onSelect ? "hover:bg-slate-100 cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <Avatar user={employee} muted />
                    {employee.firstName} {employee.lastName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* the small round photo, or the initial circle the rest of the app uses */
function Avatar({ user, muted = false }) {
  const photo = getPhotoUrl(user?.photoUrl);

  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="w-5 h-5 rounded-full object-cover shrink-0"
      />
    );
  }

  return (
    <span
      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
        muted ? "bg-slate-200 text-slate-500" : "bg-white/70 text-slate-600"
      }`}
    >
      {user?.firstName?.charAt(0)?.toUpperCase()}
    </span>
  );
}

function Count({ value, label, tone }) {
  return (
    <span className="flex items-baseline gap-1">
      <b className={`text-base font-semibold tabular-nums ${tone}`}>{value}</b>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

export default LiveBoard;
