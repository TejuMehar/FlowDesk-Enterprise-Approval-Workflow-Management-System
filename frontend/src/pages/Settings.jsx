/*
=========================================================================
  PAGE: Settings   (Module 9 - System Configuration)
=========================================================================
  Everything FlowDesk used to hard-code, in one place an administrator
  can reach:

    Company        the name, the logo and the timezone
    Calendar       working days and holidays
    Request types  the kinds of request employees can raise
    Mail server    the SMTP account outgoing email is sent from
    Employee ID    the shape of an auto-generated employeeId (Module 1)

  THIS FILE OWNS ALMOST NOTHING
  -----------------------------
  It loads the settings once, draws the tabs, and hands each section its
  slice. All five sections live in components/settings/, and each one
  keeps its OWN form state and does its OWN save.

  That is deliberate rather than tidy-minded: one giant form with one
  Save button would mean an invalid timezone stops a holiday being
  added, and pressing Save would send back the SMTP block whether it
  was touched or not. Every section saving only its own fields is why
  the backend controller can treat every field as optional.

  WHAT `onSaved` DOES
  -------------------
  Each section hands back the settings the server returned, and this
  page stores them. So the logo preview, the SMTP "a password is saved"
  line and the company name in the sidebar all reflect what is really
  in the database - never what the form hoped it would be.

  THREE PERMISSIONS DECIDE WHAT IS EDITABLE
  -----------------------------------------
    settings:read        opens this page (App.jsx / Sidebar.jsx)
    settings:update      the Company, Calendar and Employee ID cards
    settings:smtp        the Mail server card
    request-type:manage  the Request types card

  Somebody with only settings:read sees the whole page and can change
  none of it, which is a useful thing to be.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineBusiness,
  MdOutlineCalendarMonth,
  MdOutlineCategory,
  MdOutlineMailOutline,
  MdOutlineBadge,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import useRequestTypes from "../CustomHooks/useRequestTypes.js";
import { refreshCompanySettings } from "../CustomHooks/useCompanySettings.js";

import CompanySettings from "../components/settings/CompanySettings.jsx";
import WorkingCalendarSettings from "../components/settings/WorkingCalendarSettings.jsx";
import RequestTypeSettings from "../components/settings/RequestTypeSettings.jsx";
import SmtpSettings from "../components/settings/SmtpSettings.jsx";
import EmployeeIdSettings from "../components/settings/EmployeeIdSettings.jsx";

const TABS = [
  { key: "company", label: "Company", icon: <MdOutlineBusiness size={17} /> },
  {
    key: "calendar",
    label: "Working days",
    icon: <MdOutlineCalendarMonth size={17} />,
  },
  {
    key: "types",
    label: "Request types",
    icon: <MdOutlineCategory size={17} />,
  },
  { key: "email", label: "Email", icon: <MdOutlineMailOutline size={17} /> },
  {
    key: "employeeId",
    label: "Employee ID",
    icon: <MdOutlineBadge size={17} />,
  },
];

function Settings() {
  const { userData } = useSelector((state) => state.user);

  const canUpdate = hasPermission(userData, PERMISSIONS.SETTINGS_UPDATE);
  const canSmtp = hasPermission(userData, PERMISSIONS.SETTINGS_SMTP);
  const canManageTypes = hasPermission(
    userData,
    PERMISSIONS.REQUEST_TYPE_MANAGE
  );

  const [settings, setSettings] = useState(null);
  const [options, setOptions] = useState({
    weekdays: [],
    timezones: [],
    smtpPresets: [],
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("company");

  /*
    The request types come from the shared hook rather than from this
    page's own fetch, so that editing them here also refreshes the
    dropdowns on the Requests, Approvals and Workflows pages.
  */
  const {
    types: requestTypes,
    loading: typesLoading,
    refresh: refreshTypes,
  } = useRequestTypes();

  /* =================================================================
     LOAD THE CURRENT SETTINGS
     ================================================================= */
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);

      try {
        const result = await api.get("/api/settings");

        setSettings(result.data.settings);
        setOptions(result.data.options || options);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    Called by every section after a successful save.

    refreshCompanySettings() is what makes the sidebar and the navbar
    pick up a new company name or logo without a page reload.

    It used to be clearCompanyCache(), which only threw the cached
    ANSWER away - and the sidebar was holding its own copy of it in
    component state, so nothing on screen changed until the admin
    happened to reload the browser. Uploading a logo and watching the
    old one sit there reads as the upload having failed. The hook
    notifies its users now; see the note at the top of it.
  */
  const handleSaved = (updatedSettings) => {
    setSettings(updatedSettings);
    refreshCompanySettings();
  };

  if (loading) {
    return (
      <div className="p-16 flex justify-center">
        <ClipLoader size={35} color="#4f46e5" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <p className="text-sm text-slate-500">
          The settings could not be loaded. Refresh the page to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          System-wide configuration for {settings.companyName || "FlowDesk"}.
        </p>
      </div>

      {/* ==================== tabs ====================
          A row of tabs rather than five cards down one long page: the
          sections have nothing to do with each other, and an admin
          coming here to add one holiday should not have to scroll past
          a mail server to reach it.                                  */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-indigo-600 text-indigo-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== the section ==================== */}
      <div className="max-w-3xl">
        {activeTab === "company" && (
          <CompanySettings
            /*
              `key` forces a fresh component - and with it a fresh copy
              of the form state - whenever the saved settings change.
              Without it, a section that was mounted before a save
              would keep showing the values it was born with.
            */
            key={settings.updatedAt}
            settings={settings}
            timezones={options.timezones || []}
            canEdit={canUpdate}
            onSaved={handleSaved}
          />
        )}

        {activeTab === "calendar" && (
          <WorkingCalendarSettings
            key={settings.updatedAt}
            settings={settings}
            canEdit={canUpdate}
            onSaved={handleSaved}
          />
        )}

        {activeTab === "types" && (
          <RequestTypeSettings
            types={requestTypes}
            loading={typesLoading}
            canEdit={canManageTypes}
            onChanged={refreshTypes}
          />
        )}

        {activeTab === "email" && (
          <SmtpSettings
            key={settings.updatedAt}
            settings={settings}
            presets={options.smtpPresets || []}
            canEdit={canSmtp}
            onSaved={handleSaved}
            myEmail={userData?.email}
          />
        )}

        {activeTab === "employeeId" && (
          <EmployeeIdSettings
            key={settings.updatedAt}
            settings={settings}
            canEdit={canUpdate}
            onSaved={handleSaved}
          />
        )}
      </div>
    </div>
  );
}

export default Settings;
