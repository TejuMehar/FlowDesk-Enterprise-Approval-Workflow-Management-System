/*
=========================================================================
  COMPONENT: EmployeeDashboard     ("My Requests")
=========================================================================
  The part of the dashboard EVERY user sees, whatever their role - even
  a Super Admin raises leave requests.

  It answers one question: "what is happening with the things I asked
  for?" Everything on it is filtered by "requester: me" on the backend,
  so this section can never show somebody else's paperwork.

  THE FOUR CARDS ARE NOT THE SEVEN STATUSES
  -----------------------------------------
  A request can be in one of seven states, but a dashboard is a glance,
  not an inventory. The three that matter are "waiting", "passed" and
  "failed"; drafts and returned requests get their own card only because
  they are the two that need ME to do something next.

  MODULE 11 PUT THE PUNCH CLOCK AT THE TOP
  ----------------------------------------
  Above the four cards, and above everything else on the page, because
  it is the only thing here somebody has to DO rather than read - and
  they have to do it twice a day, at the two moments they are least
  inclined to go looking for a page.

  It is the compact form of the same <PunchClock> the Attendance page
  draws, not a second copy of the logic. A widget that could disagree
  with the real page about whether somebody is on a break would be
  worse than no widget.
=========================================================================
*/

import { Link } from "react-router-dom";
import {
  MdOutlineSchedule,
  MdOutlineCheckCircle,
  MdOutlineCancel,
  MdOutlineEdit,
  MdOutlineUndo,
  MdOutlineFactCheck,
  MdOutlineEventAvailable,
  MdOutlineTimer,
  MdOutlineAlarm,
} from "react-icons/md";

import StatCard from "./StatCard.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import RequestMiniList from "./RequestMiniList.jsx";
import PunchClock from "../attendance/PunchClock.jsx";
import useMyAttendance from "../../CustomHooks/useMyAttendance.js";
import {
  formatMinutes,
  formatRate,
} from "../../utils/attendanceConstants.js";

function EmployeeDashboard({ data }) {
  /*
    THE HOOK IS CALLED BEFORE THE EARLY RETURN, and it has to be.

    React requires every hook to run on every render of a component, so
    a `if (!data) return null` above this line would break the rules of
    hooks the moment the dashboard data arrived. The attendance card
    stands on its own data anyway - it has nothing to do with requests -
    so it is fetched whatever the request dashboard is doing.
  */
  const attendance = useMyAttendance();

  if (!data) {
    return null;
  }

  const { stats, pendingApprovals, recentRequests, recentActivity } = data;

  const month = attendance.monthSummary;

  /*
    The cards, in the order a person actually cares about them:
    what is still moving, what worked, what did not, what needs me.
  */
  const cards = [
    {
      label: "Pending Requests",
      value: stats.pending,
      icon: <MdOutlineSchedule size={20} />,
      tone: "amber",
      note: stats.pending > 0 ? "waiting for a decision" : null,
    },
    {
      label: "Approved Requests",
      value: stats.approved,
      icon: <MdOutlineCheckCircle size={20} />,
      tone: "green",
      note:
        stats.total > 0
          ? `${Math.round((stats.approved / stats.total) * 100)}% of ${stats.total}`
          : null,
    },
    {
      label: "Rejected Requests",
      value: stats.rejected,
      icon: <MdOutlineCancel size={20} />,
      tone: "red",
      note: stats.rejected > 0 ? "final, cannot be revived" : null,
    },
    {
      /*
        Drafts and returned requests are grouped because they are the
        same job: both are sitting with ME and both need editing before
        anything else can happen.
      */
      label: "Needs My Action",
      value: stats.draft + stats.returned,
      icon: stats.returned > 0 ? <MdOutlineUndo size={20} /> : <MdOutlineEdit size={20} />,
      tone: stats.returned > 0 ? "orange" : "slate",
      note:
        stats.returned > 0
          ? `${stats.returned} returned for correction`
          : stats.draft > 0
          ? `${stats.draft} draft${stats.draft === 1 ? "" : "s"}`
          : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== MODULE 11 - today's working day ====================
          First on the page, because it is the only thing here that
          needs doing rather than reading. */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">
          My Working Day
        </h2>

        <PunchClock attendance={attendance} compact />

        {/*
          THE MONTH SO FAR, three numbers under the clock.

          It is this calendar month rather than "the last 30 days"
          because that is the period a person actually thinks in - and
          the one their payslip is cut on. Three, not five: the full
          set lives on the Attendance page, and a dashboard is a glance.
        */}
        {month && month.workingDays > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <StatCard
              label="Present this month"
              value={month.presentDays}
              icon={<MdOutlineEventAvailable size={20} />}
              tone="green"
              to="/attendance"
              note={`${formatRate(month.attendanceRate)} of ${
                month.workingDays
              } days`}
            />

            <StatCard
              label="Hours this month"
              value={Math.round(month.workedMinutes / 60)}
              icon={<MdOutlineTimer size={20} />}
              tone="sky"
              to="/attendance"
              note={
                month.avgDayMinutes !== null
                  ? `${formatMinutes(month.avgDayMinutes)} a day`
                  : null
              }
            />

            <StatCard
              label="Late arrivals"
              value={month.lateDays}
              icon={<MdOutlineAlarm size={20} />}
              tone={month.lateDays > 0 ? "amber" : "slate"}
              to="/attendance"
              note={
                month.lateDays > 0
                  ? `${formatMinutes(month.lateMinutes)} in total`
                  : "never late"
              }
            />
          </div>
        )}
      </div>

      {/* ==================== the numbers ==================== */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">My Requests</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((card) => (
            <StatCard key={card.label} to="/requests" {...card} />
          ))}
        </div>
      </div>

      {/*
        WAITING FOR MY DECISION.

        This is on the EMPLOYEE dashboard on purpose. A workflow stage
        may name any employee as its approver, so an ordinary employee
        can perfectly well have three requests waiting on their answer -
        and there is no worse place for them to sit than unnoticed.
      */}
      {pendingApprovals > 0 && (
        <div className="bg-white rounded-lg border border-slate-300 border-l-4 border-l-amber-500 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 shrink-0 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <MdOutlineFactCheck size={20} />
            </span>

            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {pendingApprovals} request{pendingApprovals === 1 ? "" : "s"}{" "}
                waiting for your decision
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Somebody cannot move on until you approve, reject or return
                {pendingApprovals === 1 ? " it" : " them"}.
              </p>
            </div>
          </div>

          <Link
            to="/approvals"
            className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Review
          </Link>
        </div>
      )}

      {/* ==================== the two lists ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RequestMiniList
          title="My Recent Requests"
          requests={recentRequests}
          emptyText="You have not raised a request yet. Use My Requests to create one."
        />

        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3">
            Recent Activity
          </h2>

          <ActivityFeed
            items={recentActivity}
            emptyText="Nothing has happened to your requests yet. Submit one and every approval step will show up here."
          />
        </div>
      </div>
    </div>
  );
}

export default EmployeeDashboard;
