/*
=========================================================================
  PAGE: Dashboard                 (Module 5 - Dashboard & Analytics)
=========================================================================
  The first page after login, and the only page in FlowDesk that looks
  different for different people.

  IT IS BUILT FROM SECTIONS, NOT FROM ROLES
  -----------------------------------------
  There is no "if the user is a Manager" anywhere in this file. Instead
  the page asks the backend four questions and shows a section for each
  answer that came back with something in it:

    My Requests   always. Everybody raises requests, including the
                  Super Admin.
    My Approvals  when anything is waiting for this user's decision, or
                  they have ever decided anything.
    My Team       when at least one department points at this user as
                  its manager (the backend decides, from the data).
    Organisation  when the user has the "analytics:read" permission.

  So a person who is both an admin and a department manager sees four
  sections, and an ordinary employee sees one - without a single role
  name being written down anywhere.

  WHY "MY APPROVALS" IS NOT PART OF "MY TEAM"
  -------------------------------------------
  They count different things. "My Team" is about a DEPARTMENT - the
  requests raised by the people who report to you. "My Approvals" is
  about a JOB - the requests that stopped at you, whoever raised them.
  For an Engineering Manager the two nearly agree; for a Finance
  Manager, who reviews purchases from every department but manages only
  Finance, they barely overlap at all.

  WHY TABS AND NOT ONE LONG PAGE
  ------------------------------
  Somebody with all three sections would otherwise face four charts, six
  cards and three lists in one scroll. The tabs only appear when there is
  more than one section, so an ordinary employee never sees a tab bar
  with a single tab in it.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineApartment,
  MdOutlineCheckCircle,
  MdOutlineWarningAmber,
  MdOutlineBadge,
  MdOutlineShield,
  MdOutlineEventAvailable,
  MdOutlineSchedule,
  MdOutlineAssignment,
  MdOutlineGroups,
  MdOutlineInsights,
  MdOutlineFactCheck,
} from "react-icons/md";

import { api } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import { formatDate, getPhotoUrl } from "../utils/config.js";

import EmployeeDashboard from "../components/dashboard/EmployeeDashboard.jsx";
import ManagerDashboard from "../components/dashboard/ManagerDashboard.jsx";
import ApproverDashboard from "../components/dashboard/ApproverDashboard.jsx";
import AdminDashboard from "../components/dashboard/AdminDashboard.jsx";

function Dashboard() {
  const { userData } = useSelector((state) => state.user);

  const [employeeData, setEmployeeData] = useState(null);
  const [managerData, setManagerData] = useState(null);
  const [approverData, setApproverData] = useState(null);
  const [adminData, setAdminData] = useState(null);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("me");

  const canReadAnalytics = hasPermission(userData, PERMISSIONS.ANALYTICS_READ);

  useEffect(() => {
    const fetchDashboards = async () => {
      setLoading(true);

      /*
        All three calls go out at once instead of one after the other.

        Promise.allSettled (not Promise.all) is the important part: if
        the admin call were to fail, "all" would throw away the employee
        answer that already arrived and the page would show nothing. With
        allSettled a broken section simply does not appear.
      */
      const results = await Promise.allSettled([
        api.get("/api/dashboard/employee"),
        api.get("/api/dashboard/manager"),
        api.get("/api/dashboard/approver"),
        canReadAnalytics ? api.get("/api/dashboard/admin") : Promise.resolve(null),
      ]);

      const [employee, manager, approver, admin] = results;

      if (employee.status === "fulfilled") {
        setEmployeeData(employee.value.data);
      }

      if (manager.status === "fulfilled") {
        setManagerData(manager.value.data);
      }

      if (approver.status === "fulfilled") {
        setApproverData(approver.value.data);
      }

      if (admin.status === "fulfilled" && admin.value) {
        setAdminData(admin.value.data);
      }

      setLoading(false);
    };

    fetchDashboards();
  }, [canReadAnalytics]);

  /*
    The tabs that really have something behind them. A section that came
    back empty (or that this user may not see) is simply not in the list,
    so the tab bar can never lead to a blank page.
  */
  const sections = [
    {
      key: "me",
      label: "My Requests",
      icon: <MdOutlineAssignment size={16} />,
      show: true,
    },
    /*
      Second, and above "My Team" on purpose: this is the only tab with
      something WAITING on the user. A Finance Manager opens the
      dashboard to find out what needs deciding, not to read statistics.
    */
    {
      key: "approvals",
      label: "My Approvals",
      icon: <MdOutlineFactCheck size={16} />,
      show: Boolean(approverData?.isApprover),
    },
    {
      key: "team",
      label: "My Team",
      icon: <MdOutlineGroups size={16} />,
      show: Boolean(managerData?.isManager),
    },
    {
      key: "org",
      label: "Organisation",
      icon: <MdOutlineInsights size={16} />,
      show: Boolean(adminData),
    },
  ].filter((section) => section.show);

  // the chosen tab may have disappeared (e.g. the user stopped managing)
  const activeTab = sections.some((section) => section.key === tab)
    ? tab
    : "me";

  const photo = getPhotoUrl(userData?.photoUrl);

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== welcome card ==================== */}
      <div className="bg-white rounded-lg border border-slate-300 p-6">
        <div className="flex items-center gap-4">
          {photo ? (
            <img
              src={photo}
              alt="profile"
              className="w-16 h-16 rounded-full object-cover border-2 border-indigo-100"
            />
          ) : (
            /* same indigo initial-circle the Employees page and the profile use */
            <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 border-2 border-indigo-200 flex items-center justify-center text-2xl font-semibold">
              {userData?.firstName?.charAt(0).toUpperCase()}
            </div>
          )}

          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              Welcome back, {userData?.firstName}
            </h1>

            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-sm text-slate-500">
                {userData?.designation || "Employee"}
              </span>

              {/* the department, in the same sky tone the Departments page uses */}
              <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
                <MdOutlineApartment size={13} />
                {userData?.department?.name || "No department"}
              </span>

              {/* verified / not verified - green and amber, as on the profile */}
              {userData?.isEmailVerified ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  <MdOutlineCheckCircle size={13} />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <MdOutlineWarningAmber size={13} />
                  Not verified
                </span>
              )}
            </div>
          </div>
        </div>

        {/* a warning strip when the email is not verified yet */}
        {!userData?.isEmailVerified && (
          <div className="mt-5 flex items-start gap-2.5 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 text-amber-800 rounded-lg px-4 py-3 text-sm">
            <MdOutlineWarningAmber
              size={18}
              className="shrink-0 mt-0.5 text-amber-600"
            />
            <span>
              Your email address is not verified yet. Please open the
              verification link we sent to <b>{userData?.email}</b>.
            </span>
          </div>
        )}

        {/*
          A few quick facts. Each one gets a small tinted icon so the eye
          can find the right field without reading all four labels.
        */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-200">
          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
              <MdOutlineBadge size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Employee ID</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                {userData?.employeeId || "-"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 shrink-0 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
              <MdOutlineShield size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Role</p>
              <p className="text-sm font-medium text-violet-700 mt-0.5 truncate">
                {userData?.role?.name || "-"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 shrink-0 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <MdOutlineEventAvailable size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Joined on</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                {formatDate(userData?.dateOfJoining)}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 shrink-0 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
              <MdOutlineSchedule size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Last login</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                {formatDate(userData?.lastLoginAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== the dashboards ==================== */}
      {loading ? (
        <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
          {/* indigo-600 - the primary colour of the app */}
          <ClipLoader size={28} color="#4f46e5" />
        </div>
      ) : (
        <>
          {/* the tab bar, only when there is more than one thing to switch between */}
          {sections.length > 1 && (
            <div className="flex items-center gap-1 border-b border-slate-200">
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setTab(section.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === section.key
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                  aria-pressed={activeTab === section.key}
                >
                  {section.icon}
                  {section.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === "me" && <EmployeeDashboard data={employeeData} />}
          {activeTab === "approvals" && (
            <ApproverDashboard data={approverData} />
          )}
          {activeTab === "team" && <ManagerDashboard data={managerData} />}
          {activeTab === "org" && <AdminDashboard data={adminData} />}
        </>
      )}
    </div>
  );
}

export default Dashboard;
