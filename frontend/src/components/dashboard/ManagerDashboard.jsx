/*
=========================================================================
  COMPONENT: ManagerDashboard      ("My Team")
=========================================================================
  Shown only to somebody who really manages a department.

  "Manager" is NOT a role here. The backend asks the data - "which
  departments point at this user as their manager?" - and answers with
  isManager:false when the answer is none. That means a person who is
  made the manager of Engineering this morning sees Engineering this
  afternoon without anybody touching a role, and stops seeing it the
  moment they are replaced.

  The Team Statistics section reuses the very same four charts as the
  admin dashboard, only scoped to the manager's own people. Building a
  second, smaller set of "team charts" would have meant two pieces of
  code that must always agree - and would eventually disagree.
=========================================================================
*/

import { Link } from "react-router-dom";
import {
  MdOutlineGroups,
  MdOutlineAssignment,
  MdOutlineFactCheck,
  MdOutlineCheckCircle,
  MdOutlineApartment,
} from "react-icons/md";

import { getPhotoUrl } from "../../utils/config.js";
import { describePerson } from "../../utils/approvalConstants.js";
import { toPercent } from "../../utils/dashboardConstants.js";

import StatCard from "./StatCard.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import RequestMiniList from "./RequestMiniList.jsx";
import AnalyticsCharts from "./AnalyticsCharts.jsx";

function ManagerDashboard({ data }) {
  // not a manager of anything -> this whole section simply does not exist
  if (!data || !data.isManager) {
    return null;
  }

  const {
    departments,
    teamSize,
    pendingApprovals,
    teamStats,
    teamRequests,
    topRequesters,
    recentActivity,
  } = data;

  const departmentNames = departments.map((department) => department.name);

  const cards = [
    {
      label: "Team Requests",
      value: teamStats.total,
      icon: <MdOutlineAssignment size={20} />,
      tone: "indigo",
      note: `${teamSize} team member${teamSize === 1 ? "" : "s"}`,
    },
    {
      label: "Pending Approvals",
      value: pendingApprovals,
      icon: <MdOutlineFactCheck size={20} />,
      tone: "amber",
      note: pendingApprovals > 0 ? "waiting for your decision" : null,
      to: "/approvals",
    },
    {
      label: "In Progress",
      value: teamStats.pending,
      icon: <MdOutlineGroups size={20} />,
      tone: "sky",
      note: teamStats.pending > 0 ? "travelling down a workflow" : null,
    },
    {
      label: "Approved",
      value: teamStats.approved,
      icon: <MdOutlineCheckCircle size={20} />,
      tone: "green",
      note:
        teamStats.approved + teamStats.rejected > 0
          ? `${toPercent(
              teamStats.approved,
              teamStats.approved + teamStats.rejected
            )}% of decided requests`
          : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== which team is this? ==================== */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-600">My Team</h2>

          {/* the departments this person manages, in the app's department colour */}
          {departmentNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full"
            >
              <MdOutlineApartment size={12} />
              {name}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      </div>

      {/* ==================== the team's requests + who raises them ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RequestMiniList
          title="Latest Team Requests"
          requests={teamRequests}
          showRequester
          emptyText="Nobody on your team has submitted a request yet."
        />

        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3">
            Most Requests
          </h2>

          {topRequesters.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
              <span className="w-11 h-11 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3">
                <MdOutlineGroups size={22} />
              </span>
              <p className="text-sm text-slate-500">
                Nobody on your team has submitted a request yet.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-300 divide-y divide-slate-100">
              {topRequesters.map((person) => {
                const photo = getPhotoUrl(person.photoUrl);

                return (
                  <div
                    key={person.userId}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    {photo ? (
                      <img
                        src={photo}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover border border-slate-200"
                      />
                    ) : (
                      <span className="w-9 h-9 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                        {person.firstName?.charAt(0).toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {describePerson(person)}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {person.designation || person.employeeId}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-900 tabular-nums">
                        {person.total}
                      </p>
                      <p className="text-xs text-slate-500">
                        {person.pending} pending
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ==================== what has been happening ==================== */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">
          Team Activity
        </h2>

        <ActivityFeed
          items={recentActivity}
          emptyText="Nothing has happened to your team's requests yet."
        />
      </div>

      {/* ==================== Team Statistics: the four charts ==================== */}
      {teamSize > 0 && (
        <AnalyticsCharts
          scope="team"
          title="Team Statistics"
          subtitle={`Only the employees of ${
            departmentNames.length === 1
              ? departmentNames[0]
              : `${departmentNames.length} departments you manage`
          } are counted.`}
        />
      )}

      {/* a manager with an empty department gets an explanation, not an empty chart */}
      {teamSize === 0 && (
        <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
          <span className="w-11 h-11 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center mx-auto mb-3">
            <MdOutlineApartment size={22} />
          </span>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            You manage {departmentNames.join(", ")}, but nobody is assigned to
            it yet. Team statistics appear as soon as an employee joins.
          </p>

          <Link
            to="/departments"
            className="inline-block mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Open Departments
          </Link>
        </div>
      )}
    </div>
  );
}

export default ManagerDashboard;
