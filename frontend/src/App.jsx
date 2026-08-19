/*
=========================================================================
  APP  -  the router of the whole application
=========================================================================
  Here we decide which page belongs to which URL.

  There are three kinds of routes:

  1. PUBLIC        -> anybody can open them (login, reset password ...)
  2. PROTECTED     -> only a logged in user  (<ProtectedRoute>)
  3. PERMISSION    -> logged in AND has the right permission
                      (<PermissionRoute permission="user:read">)

  All protected pages are drawn inside <Layout>, which paints the
  sidebar and the navbar around them.
=========================================================================
*/

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

import useGetCurrentUser from "./CustomHooks/getCurrentUser.js";
import { PERMISSIONS } from "./utils/permissions.js";

import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PermissionRoute from "./components/PermissionRoute.jsx";
import FullPageLoader from "./components/FullPageLoader.jsx";

/* =====================================================================
   MODULE 10 - LAZY LOADING
   ---------------------------------------------------------------------
   Every import below used to be a normal one, which meant `npm run
   build` produced ONE javascript file containing all twenty pages. An
   employee opening the login screen downloaded the workflow builder,
   the six reports, the audit log and the settings page - all of it
   before the password box appeared, and most of it for screens their
   role cannot even open.

   lazy() splits each page into its own file, fetched the first time
   somebody actually goes there. The login page now costs the login
   page.

   THE FOUR PUBLIC PAGES STAY EAGER, and that is the interesting half of
   the decision. They are the FIRST thing anybody sees, so splitting
   them would trade a smaller download for an extra network round trip
   at the worst possible moment - a spinner before the login form, on
   the slowest connection of the day. Everything behind the login is
   opened by somebody who is already sitting in the application, where
   an extra 200ms once per page is invisible.

   <Suspense> is the waiting room React shows while one of these files
   is on its way. Without it, React throws.
   ===================================================================== */

import Login from "./pages/Login.jsx";
import ForgetPassword from "./pages/ForgetPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";

const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Roles = lazy(() => import("./pages/Roles.jsx"));
const Departments = lazy(() => import("./pages/Departments.jsx"));
const Requests = lazy(() => import("./pages/Requests.jsx"));
const Approvals = lazy(() => import("./pages/Approvals.jsx"));
const Workflows = lazy(() => import("./pages/Workflows.jsx"));
const WorkflowBuilder = lazy(() => import("./pages/WorkflowBuilder.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const Search = lazy(() => import("./pages/Search.jsx"));
const AuditLogs = lazy(() => import("./pages/AuditLogs.jsx"));
const Attendance = lazy(() => import("./pages/Attendance.jsx"));
const TeamAttendance = lazy(() => import("./pages/TeamAttendance.jsx"));
const Salary = lazy(() => import("./pages/Salary.jsx"));
const Payroll = lazy(() => import("./pages/Payroll.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const ChangePassword = lazy(() => import("./pages/ChangePassword.jsx"));
const Unauthorized = lazy(() => import("./pages/Unauthorized.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));

/*
  The backend address, exported here so any file can do
      import { serverUrl } from "../App"
  It really lives in utils/config.js.
*/
export { serverUrl } from "./utils/config.js";

function App() {
  // asks the backend "who is logged in?" once, when the app starts
  useGetCurrentUser();

  const { authChecked } = useSelector((state) => state.user);

  /*
    While that first question is still running we show a loader.
    Without it the login page would flash for a moment on every refresh.
  */
  if (!authChecked) {
    return <FullPageLoader message="Loading FlowDesk..." />;
  }

  return (
    /*
      MODULE 10 - one Suspense around the whole router rather than one
      per route. Only ever ONE page is being fetched at a time (you can
      only navigate to one place), so twenty boundaries would all be
      idle except the same one.
    */
    <Suspense fallback={<FullPageLoader message="Loading..." />}>
      <Routes>
      {/* ---------------- PUBLIC PAGES ---------------- */}
      <Route path="/login" element={<Login />} />
      <Route path="/forget-password" element={<ForgetPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* ---------------- PRIVATE PAGES ----------------
          Everything inside here first passes through ProtectedRoute
          (must be logged in) and is then drawn inside Layout.       */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* every logged in user */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />

        {/*
          Module 6. No PermissionRoute around it: a notification is only
          ever shown to the person it was sent to, so there is nothing
          for an admin to grant first.
        */}
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/change-password" element={<ChangePassword />} />

        {/*
          Module 11. NEITHER attendance route has a PermissionRoute, and
          they are ungated for two different reasons.

          /attendance is the employee's OWN working day - clock in,
          clock out, take a break, see their own month. Every request it
          makes reads req.userId, so it can only ever show the person
          who is logged in. The same decision /notifications made above.

          /team-attendance is the more interesting one. The backend
          resolves a SCOPE rather than checking a permission: a
          department manager gets their department (because a department
          points at them - a fact about the data, not a grant),
          somebody with attendance:read-all gets everybody, and an
          ordinary employee gets a board with exactly one row on it,
          their own. That is not a leak - it is the same page answering
          the same question honestly at a smaller size, and it is the
          pattern /search already established.

          Putting a PermissionRoute here would have to pick ONE
          permission, and the department manager - the person the page
          was built for - does not hold one.
        */}
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/team-attendance" element={<TeamAttendance />} />

        {/*
          Module 12. NO PermissionRoute, and this is the clearest case
          in the application: /salary shows the logged in employee their
          own pay, their own payslips and the receipt for each one.
          Every request it makes reads req.userId.

          Gating it would mean an admin could accidentally take away
          somebody's ability to see what they were paid, which is not a
          setting anybody should be able to get wrong. The same decision
          /notifications, /search and /attendance already made.

          THE PAYROLL SIDE IS BEHIND salary:read-all, one route below -
          the two halves of Module 12 are deliberately two pages,
          because they are two different jobs done by two different
          people.
        */}
        <Route path="/salary" element={<Salary />} />

        <Route
          path="/payroll"
          element={
            <PermissionRoute permission={PERMISSIONS.SALARY_READ_ALL}>
              <Payroll />
            </PermissionRoute>
          }
        />

        {/* a permission is required for these three */}
        <Route
          path="/users"
          element={
            <PermissionRoute permission={PERMISSIONS.USER_READ}>
              <Users />
            </PermissionRoute>
          }
        />

        <Route
          path="/roles"
          element={
            <PermissionRoute permission={PERMISSIONS.ROLE_READ}>
              <Roles />
            </PermissionRoute>
          }
        />

        <Route
          path="/departments"
          element={
            <PermissionRoute permission={PERMISSIONS.DEPARTMENT_READ}>
              <Departments />
            </PermissionRoute>
          }
        />

        <Route
          path="/requests"
          element={
            <PermissionRoute permission={PERMISSIONS.REQUEST_READ}>
              <Requests />
            </PermissionRoute>
          }
        />

        {/* the other side of /requests: what is waiting for MY decision */}
        <Route
          path="/approvals"
          element={
            <PermissionRoute permission={PERMISSIONS.APPROVAL_READ}>
              <Approvals />
            </PermissionRoute>
          }
        />

        {/* the workflow list, and the builder for one workflow */}
        <Route
          path="/workflows"
          element={
            <PermissionRoute permission={PERMISSIONS.WORKFLOW_READ}>
              <Workflows />
            </PermissionRoute>
          }
        />

        <Route
          path="/workflows/:id"
          element={
            <PermissionRoute permission={PERMISSIONS.WORKFLOW_READ}>
              <WorkflowBuilder />
            </PermissionRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <PermissionRoute permission={PERMISSIONS.SETTINGS_READ}>
              <Settings />
            </PermissionRoute>
          }
        />

        {/*
          Module 7. The company wide audit log.

          audit:export is NOT checked here - it only decides whether the
          Export button is drawn on the page. Somebody who may read the
          log but not download it still opens this route normally.

          The ACTIVITY TIMELINE of a single request has no route of its
          own: it lives inside the request and the approval pop-ups,
          because that is where the question is asked.
        */}
        <Route
          path="/audit-logs"
          element={
            <PermissionRoute permission={PERMISSIONS.AUDIT_READ}>
              <AuditLogs />
            </PermissionRoute>
          }
        />

        {/*
          Module 8. The six reports.

          report:export is NOT checked here, exactly like audit:export
          above - it only decides whether the three download buttons are
          drawn on the page.

          report:read is the door, not the size of the room: how much of
          the company the reports actually cover is worked out per user
          by the backend, so a Manager and an Admin both pass this check
          and see very different numbers.
        */}
        <Route
          path="/reports"
          element={
            <PermissionRoute permission={PERMISSIONS.REPORT_READ}>
              <Reports />
            </PermissionRoute>
          }
        />

        {/*
          The other half of Module 8, and it needs NO PermissionRoute -
          the same decision /notifications made above. The backend
          narrows a search to what the caller may already see, so for an
          ordinary employee this page finds their own requests and
          nothing else. Gating it would mean an admin could accidentally
          take away somebody's ability to find their own paperwork.
        */}
        <Route path="/search" element={<Search />} />
      </Route>

      {/* ---------------- ANY OTHER URL ---------------- */}
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
