/*
=========================================================================
  COMPONENT: Sidebar   ->  ROLE BASED NAVIGATION
=========================================================================
  The menu on the left.

  Every menu item carries the permission it needs. We then use .filter()
  to keep only the items the logged in user is actually allowed to open.

  That is what "Role Based Navigation" means:
    - an Employee sees   Dashboard, My Profile
    - a Manager sees     Dashboard, Employees, Departments, My Profile
    - a Super Admin sees everything

  The items are grouped into sections (Main / Administration / Account)
  the way business software usually does it. A section disappears on its
  own when the user may not open a single item inside it.
=========================================================================
*/

import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  MdOutlineSpaceDashboard,
  MdOutlinePeopleAlt,
  MdOutlineShield,
  MdOutlineApartment,
  MdOutlineAssignment,
  MdOutlineFactCheck,
  MdOutlineAccountTree,
  MdOutlineNotificationsNone,
  MdOutlinePersonOutline,
  MdOutlineLock,
  MdOutlineLogout,
  MdOutlineSettings,
  MdOutlineHistory,
  MdOutlineSearch,
  MdOutlineAssessment,
  MdOutlineTimer,
  MdOutlineGroups,
  MdOutlineAccountBalanceWallet,
  MdOutlinePayments,
  MdClose,
} from "react-icons/md";

import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import useCompanySettings from "../CustomHooks/useCompanySettings.js";
import useAttendanceScope from "../CustomHooks/useAttendanceScope.js";
// the same logout the Navbar uses - it used to be written out twice
import useLogout from "../CustomHooks/useLogout.js";
import { CompanyMark, CompanyWordmark } from "./Logo.jsx";

function Sidebar({ isOpen, onClose }) {
  const { userData } = useSelector((state) => state.user);

  const { logout, loggingOut } = useLogout();

  /*
    MODULE 9 - the company's own name and logo, from the Settings page.
    Falls back to the FlowDesk mark when nothing has been uploaded, so
    this never waits on a request to draw something.
  */
  const { company } = useCompanySettings();

  /*
    MODULE 11 - the one menu item a permission cannot decide.

    "Team Attendance" belongs to whoever has somebody else's attendance
    to look at, and for a department manager that is a fact about the
    data (a department points at them), not a permission. Only the
    backend knows it, so it is asked once per session - see
    CustomHooks/useAttendanceScope.js.
  */
  const { seesOtherPeople } = useAttendanceScope();

  /* ---------------- LOGOUT ---------------- */
  const handleLogout = () => {
    // shut the mobile menu first, so it is not still sliding over /login
    onClose();

    return logout();
  };

  /*
    The full menu, split into sections.

    permission: null  ->  everybody can see this item
    show: false       ->  hidden for a reason that is not a permission
                          (Module 11 added the first of these - see the
                          note on useAttendanceScope above)
  */
  const menuSections = [
    {
      title: "Main",
      items: [
        {
          label: "Dashboard",
          path: "/",
          icon: <MdOutlineSpaceDashboard size={18} />,
          permission: null,
        },
        {
          label: "My Requests",
          path: "/requests",
          icon: <MdOutlineAssignment size={18} />,
          permission: PERMISSIONS.REQUEST_READ,
        },
        {
          label: "Approvals",
          path: "/approvals",
          icon: <MdOutlineFactCheck size={18} />,
          permission: PERMISSIONS.APPROVAL_READ,
        },
        {
          /*
            Module 11. No permission, and none is possible: this is the
            page where an employee starts and ends their own working
            day. It sits in "Main" beside My Requests because it is the
            same kind of thing - your own paperwork, every day.
          */
          label: "My Attendance",
          path: "/attendance",
          icon: <MdOutlineTimer size={18} />,
          permission: null,
        },
        {
          /*
            Module 12. No permission, like My Attendance above and for
            an even plainer reason: this page shows the employee their
            own payslips and lets them download the receipt for each
            one. Nobody should have to be granted the right to see what
            they were paid.
          */
          label: "My Salary",
          path: "/salary",
          icon: <MdOutlineAccountBalanceWallet size={18} />,
          permission: null,
        },
        {
          /*
            Module 6. Like the Dashboard it needs no permission: it only
            ever shows the notifications sent to THIS user.
          */
          label: "Notifications",
          path: "/notifications",
          icon: <MdOutlineNotificationsNone size={18} />,
          permission: null,
        },
        {
          /*
            Module 8. Search needs no permission either, and for the
            same reason: the backend narrows every search to what the
            caller may already see, so for an ordinary employee this is
            a fast way through their own requests.

            It sits in "Main" rather than "Administration" because it
            is an everyday tool for everybody, unlike Reports below.
          */
          label: "Search",
          path: "/search",
          icon: <MdOutlineSearch size={18} />,
          permission: null,
        },
      ],
    },
    {
      title: "Administration",
      items: [
        {
          label: "Employees",
          path: "/users",
          icon: <MdOutlinePeopleAlt size={18} />,
          permission: PERMISSIONS.USER_READ,
        },
        {
          label: "Roles & Permissions",
          path: "/roles",
          icon: <MdOutlineShield size={18} />,
          permission: PERMISSIONS.ROLE_READ,
        },
        {
          label: "Departments",
          path: "/departments",
          icon: <MdOutlineApartment size={18} />,
          permission: PERMISSIONS.DEPARTMENT_READ,
        },
        {
          label: "Workflows",
          path: "/workflows",
          icon: <MdOutlineAccountTree size={18} />,
          permission: PERMISSIONS.WORKFLOW_READ,
        },
        {
          /*
            Module 11. The ONLY item in this menu whose visibility is
            not a permission at all.

            A department manager sees their team's attendance because a
            Department points at them, which no permission can express -
            so the backend resolves the scope and this asks it. The
            route itself is open to everybody and simply shrinks to one
            row for an ordinary employee; hiding the link is about not
            offering somebody a page that would only show them what
            "My Attendance" already does.
          */
          label: "Team Attendance",
          path: "/team-attendance",
          icon: <MdOutlineGroups size={18} />,
          permission: null,
          show: seesOtherPeople,
        },
        {
          /*
            Module 12. The finance side: running a month, releasing it
            and recording the payments.

            Gated on salary:read-all only - the three write permissions
            decide which BUTTONS the page draws, not whether it opens,
            exactly like audit:export and report:export below.

            NOTICE WHAT IS NOT HERE: a "Team Salary" item. Team
            Attendance above appears for a department manager because a
            department points at them, and there is deliberately no
            equivalent for pay - see the note in
            backend/config/salaryScope.js. This is the one menu item in
            FlowDesk that a manager only sees if somebody has decided
            they belong in payroll.
          */
          label: "Payroll",
          path: "/payroll",
          icon: <MdOutlinePayments size={18} />,
          permission: PERMISSIONS.SALARY_READ_ALL,
        },
        {
          /*
            Module 7. Gated on audit:read only - audit:export decides
            whether the Export button appears ON the page, not whether
            the page can be opened at all.
          */
          label: "Audit Logs",
          path: "/audit-logs",
          icon: <MdOutlineHistory size={18} />,
          permission: PERMISSIONS.AUDIT_READ,
        },
        {
          /*
            Module 8. Gated on report:read only, exactly like the audit
            page above - report:export decides whether the three
            download buttons appear ON the page.

            A Manager holds report:read too, and still only ever sees
            their own department's numbers: the SIZE of a report is
            worked out from the data (which departments point at you as
            their manager), never from a permission.
          */
          label: "Reports",
          path: "/reports",
          icon: <MdOutlineAssessment size={18} />,
          permission: PERMISSIONS.REPORT_READ,
        },
        {
          label: "Settings",
          path: "/settings",
          icon: <MdOutlineSettings size={18} />,
          permission: PERMISSIONS.SETTINGS_READ,
        },
      ],
    },
    {
      title: "Account",
      items: [
        {
          label: "My Profile",
          path: "/profile",
          icon: <MdOutlinePersonOutline size={18} />,
          permission: null,
        },
        {
          label: "Change Password",
          path: "/change-password",
          icon: <MdOutlineLock size={18} />,
          permission: null,
        },
      ],
    },
  ];

  /*
    Keep an item when it needs no permission, OR when the user has it -
    and drop it anyway when an explicit `show: false` said so.
    Then drop the whole section when nothing is left inside it.
  */
  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // `show` is only consulted when the item really declares one,
        // so every item without it behaves exactly as it always did
        if (item.show === false) {
          return false;
        }

        if (!item.permission) {
          return true;
        }

        return hasPermission(userData, item.permission);
      }),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {/*
        THE DARK BACKGROUND ON MOBILE
        Only visible when the menu is open on a small screen.
        Clicking it closes the menu.
      */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/*
        THE SIDEBAR ITSELF
        - on a big screen (lg:) it is always visible
        - on a small screen it slides in from the left
      */}
      <aside
        className={`fixed lg:static top-0 left-0 z-40 h-screen w-64 shrink-0
          bg-white border-r border-slate-200 text-slate-700
          flex flex-col transition-transform duration-300
          ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* ---------- logo ---------- */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
          {/* clicking the logo takes you home, the way it does in most apps */}
          <NavLink
            to="/"
            onClick={onClose}
            className="flex items-center gap-2.5 min-w-0"
          >
            <CompanyMark company={company} className="w-9 h-9" />
            <CompanyWordmark company={company} />
          </NavLink>

          {/* the X button, only on mobile */}
          <button
            onClick={onClose}
            className="lg:hidden text-slate-400 hover:text-slate-700"
          >
            <MdClose size={20} />
          </button>
        </div>

        {/* ---------- the menu ---------- */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {visibleSections.map((section) => (
            <div key={section.title} className="mb-5 last:mb-0">
              <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </p>

              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  /*
                    NavLink is like a normal link, but it also tells us whether
                    it is the page we are on right now ({ isActive }).
                    "end" makes "/" match only the dashboard, not every URL.
                  */
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    onClick={onClose}
                    className={({ isActive }) =>
                      /*
                        The inactive item keeps a transparent left border so
                        the text does not jump sideways when it becomes active.
                      */
                      `flex items-center gap-3 pl-3 pr-3 py-2 rounded-md text-sm border-l-2 transition-colors ${
                        isActive
                          ? "bg-blue-50 border-blue-700 text-blue-700 font-medium"
                          : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      }`
                    }
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ---------- the role of the user + logout ---------- */}
        <div className="px-3 py-4 border-t border-slate-200">
          <div className="px-2 mb-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">
              Signed in as
            </p>
            <p className="text-sm text-slate-700 font-medium mt-0.5 truncate">
              {userData?.role?.name || "No Role"}
            </p>
          </div>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 transition-colors"
          >
            <MdOutlineLogout size={18} />
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
