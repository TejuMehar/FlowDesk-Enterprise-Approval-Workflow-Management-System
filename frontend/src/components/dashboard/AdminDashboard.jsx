/*
=========================================================================
  COMPONENT: AdminDashboard        ("Organisation")
=========================================================================
  The company wide view. This is the only part of Module 5 that needs a
  permission ("analytics:read"), because it is the only part that shows
  other people's numbers.

  Six cards and four charts, in that order on purpose: the cards answer
  "how big is this company and what is stuck", the charts answer "which
  way is it going". Somebody who only wants the first answer never has
  to scroll.
=========================================================================
*/

import {
  MdOutlinePeopleAlt,
  MdOutlineApartment,
  MdOutlineAssignment,
  MdOutlineAccountTree,
  MdOutlineFactCheck,
  MdOutlineCheckCircle,
} from "react-icons/md";

import { toPercent } from "../../utils/dashboardConstants.js";

import StatCard from "./StatCard.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import RequestMiniList from "./RequestMiniList.jsx";
import AnalyticsCharts from "./AnalyticsCharts.jsx";

function AdminDashboard({ data }) {
  if (!data) {
    return null;
  }

  const { stats, requestStats, recentRequests, recentActivity } = data;

  const cards = [
    {
      label: "Total Users",
      value: stats.totalUsers,
      icon: <MdOutlinePeopleAlt size={20} />,
      tone: "indigo",
      to: "/users",
      note:
        stats.totalUsers > 0
          ? `${toPercent(stats.activeUsers, stats.totalUsers)}% active`
          : null,
    },
    {
      label: "Departments",
      value: stats.totalDepartments,
      icon: <MdOutlineApartment size={20} />,
      tone: "sky",
      to: "/departments",
    },
    {
      label: "Requests",
      value: stats.totalRequests,
      icon: <MdOutlineAssignment size={20} />,
      tone: "violet",
      note: `${requestStats.pending} still moving`,
    },
    {
      label: "Active Workflows",
      value: stats.activeWorkflows,
      icon: <MdOutlineAccountTree size={20} />,
      tone: "green",
      to: "/workflows",
      /*
        A workflow is built as a draft and only starts routing requests
        once somebody switches it on (Module 3). The difference between
        "built" and "switched on" is exactly the thing an admin forgets,
        so the card says it out loud.
      */
      note:
        stats.totalWorkflows > stats.activeWorkflows
          ? `${stats.totalWorkflows - stats.activeWorkflows} still a draft`
          : null,
    },
    {
      label: "Pending Approvals",
      value: stats.pendingApprovals,
      icon: <MdOutlineFactCheck size={20} />,
      tone: "amber",
      note: stats.pendingApprovals > 0 ? "standing at a stage" : null,
    },
    {
      label: "Approved",
      value: requestStats.approved,
      icon: <MdOutlineCheckCircle size={20} />,
      tone: "green",
      note:
        requestStats.approved + requestStats.rejected > 0
          ? `${toPercent(
              requestStats.approved,
              requestStats.approved + requestStats.rejected
            )}% of decided requests`
          : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== the six numbers ==================== */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">
          Organisation
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      </div>

      {/* ==================== the four charts ==================== */}
      <AnalyticsCharts
        scope="org"
        title="Analytics"
        subtitle="Every department in the company"
      />

      {/* ==================== what has been happening ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RequestMiniList
          title="Latest Requests"
          requests={recentRequests}
          showRequester
          emptyText="Nobody has submitted a request yet."
        />

        <div>
          <h2 className="text-sm font-semibold text-slate-600 mb-3">
            Recent Activity
          </h2>

          <ActivityFeed
            items={recentActivity}
            emptyText="Nothing has happened yet. Activity shows up here as soon as somebody submits a request."
          />
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
