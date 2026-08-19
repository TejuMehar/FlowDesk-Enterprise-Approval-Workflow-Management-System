/*
=========================================================================
  PAGE: TeamAttendance          (Module 11 - Attendance Management)
=========================================================================
  The manager's, the director's and the admin's view of everybody
  else's attendance.

  ONE PAGE, THREE AUDIENCES, AND NOT ONE `if (role === ...)`
  ----------------------------------------------------------
  The same decision Dashboard.jsx made in Module 5. The page asks the
  backend what this user may see and draws what comes back:

    a DEPARTMENT MANAGER   gets their department - because a department
                           points at them, not because of a permission
    a DIRECTOR or ADMIN    also gets the "By department" tab, because
                           they hold attendance:read-all
    anybody else           gets a board with one row on it: their own

  So there is no role name anywhere in this file, and a person who is
  both an admin and a department manager sees both tabs without the
  page knowing either of those words.

  THE TWO TABS ARE TWO QUESTIONS, NOT TWO PAGES
  ---------------------------------------------
    People       who was here, who was late, who is top of the
                 department - the question a manager opens this for
    Departments  how the teams compare - the question a director opens
                 it for, and one that has no honest smaller version

  The second tab simply is not drawn when the backend did not offer it.
=========================================================================
*/

import { useCallback, useEffect, useState } from "react";
import { ClipLoader } from "react-spinners";
import { toast } from "react-toastify";
import {
  MdOutlineGroups,
  MdOutlineApartment,
  MdOutlineTune,
  MdOutlineFileDownload,
  MdOutlineEventAvailable,
  MdOutlineCancel,
  MdOutlineAlarm,
  MdOutlineTimer,
  MdOutlinePendingActions,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { downloadFile, stampedFileName } from "../utils/download.js";
import StatCard from "../components/dashboard/StatCard.jsx";
import {
  formatMinutes,
  formatRate,
  scoreTone,
  QUICK_RANGES,
  shiftDateKey,
  todayKey,
  ATTENDANCE_REPORTS,
  EXPORT_FORMATS,
} from "../utils/attendanceConstants.js";

import LiveBoard from "../components/attendance/LiveBoard.jsx";
import PerformerList from "../components/attendance/PerformerList.jsx";
import DepartmentLeaders from "../components/attendance/DepartmentLeaders.jsx";
import TeamAttendanceTable from "../components/attendance/TeamAttendanceTable.jsx";
import AttendanceTrend from "../components/attendance/AttendanceTrend.jsx";
import EmployeeAttendanceModal from "../components/attendance/EmployeeAttendanceModal.jsx";
import WorkingPatternModal from "../components/attendance/WorkingPatternModal.jsx";

function TeamAttendance() {
  const [options, setOptions] = useState(null);
  const [team, setTeam] = useState(null);
  const [organisation, setOrganisation] = useState(null);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("people");

  const [departmentId, setDepartmentId] = useState("");
  const [range, setRange] = useState(() => ({
    from: shiftDateKey(todayKey(), -29),
    to: todayKey(),
  }));

  const [selectedUser, setSelectedUser] = useState(null);
  const [patternFor, setPatternFor] = useState(null); // { id, name } or null

  /* ---------------- the dropdowns, once ---------------- */
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get("/api/attendance/options");
        setOptions(data);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    };

    load();
  }, []);

  /* ---------------- the board ---------------- */
  const loadBoard = useCallback(
    async (signal) => {
      if (!options) {
        return;
      }

      setLoading(true);

      /*
        Both calls go out at once, and allSettled rather than all: a user
        without attendance:read-all gets a 403 from /organisation, and
        Promise.all would throw that away along with the team board that
        arrived perfectly well. The same reasoning Dashboard.jsx gives.
      */
      const results = await Promise.allSettled([
        api.get("/api/attendance/team", {
          params: {
            from: range.from,
            to: range.to,
            department: departmentId || undefined,
          },
          signal,
        }),
        options.scope.level === "org"
          ? api.get("/api/attendance/organisation", {
              params: { from: range.from, to: range.to },
              signal,
            })
          : Promise.resolve(null),
      ]);

      /*
        A cancelled pair is a pair we asked for and then stopped wanting -
        the user moved the date range again. Returning here leaves the
        spinner up for the request that replaced this one, which is
        exactly right: something IS still loading.
      */
      if (signal?.aborted) {
        return;
      }

      const [teamResult, orgResult] = results;

      if (teamResult.status === "fulfilled") {
        setTeam(teamResult.value.data);
      } else if (!isCancelledError(teamResult.reason)) {
        toast.error(getErrorMessage(teamResult.reason));
      }

      if (orgResult.status === "fulfilled" && orgResult.value) {
        setOrganisation(orgResult.value.data);
      }

      setLoading(false);
    },
    [options, range.from, range.to, departmentId]
  );

  /*
    THE DATE INPUTS ARE WHY THIS NEEDS CANCELLING.

    Typing a year into <input type="date"> fires onChange several times
    on the way to "2026", and each one asks for a board over a range
    starting in the year 2 - the slowest query this page can make, and
    therefore the one most likely to answer last and overwrite the
    range the manager actually wanted.
  */
  useEffect(() => {
    const controller = new AbortController();

    loadBoard(controller.signal);

    return () => controller.abort();
  }, [loadBoard]);

  /* =====================================================================
     THE EXPORT
     ---------------------------------------------------------------------
     THIS USED TO BE A window.open, and the comment above it claimed
     that was "the same shape the Reports page uses". It was not - the
     Reports page and the Audit page both fetch the file through axios -
     and the difference was not cosmetic.

     window.open leaves the app entirely, which means it leaves the
     token refresh in utils/api.js behind with it. FlowDesk's access
     token lives for fifteen minutes. So a manager who opened this page,
     read the board for a quarter of an hour and then pressed Export got
     a new blank tab containing the words

         {"message":"Access token expired"}

     with nothing on the page to say what had happened, and pressing the
     button again did exactly the same thing - nothing in that path ever
     asks for a fresh token. It only ever worked in the first fifteen
     minutes of a session, which is why it survived testing.

     Going through downloadFile() puts these four exports back on the
     same road as every other request in the app: the interceptor
     refreshes the token, repeats the call, and the file arrives.
     ===================================================================== */
  const [downloading, setDownloading] = useState("");

  const download = async (reportType, format) => {
    const params = new URLSearchParams({
      format,
      from: range.from,
      to: range.to,
    });

    if (departmentId) {
      params.set("department", departmentId);
    }

    const extension =
      EXPORT_FORMATS.find((entry) => entry.key === format)?.extension || format;

    setDownloading(`${reportType}-${format}`);

    try {
      await downloadFile(
        `/api/attendance/export/${reportType}?${params.toString()}`,
        stampedFileName(["attendance", reportType], extension)
      );

      toast.success("Export downloaded");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloading("");
    }
  };

  const applyQuickRange = (days) =>
    setRange({ from: shiftDateKey(todayKey(), -(days - 1)), to: todayKey() });

  /*
    WHICH PATTERN DOES THE BUTTON OPEN?

    The rule matters, because the two are edited by different people:
    a DEPARTMENT's pattern belongs to its manager, and the COMPANY
    default needs attendance:policy. Opening the wrong one shows
    somebody a form they cannot save.

      a department is filtered  -> that one, obviously
      exactly one is managed    -> that one, because it is "theirs"
      several are managed       -> the first, which is at least editable
      none                      -> the company default, which only
                                   somebody with the permission can be
                                   seeing this button for at all
  */
  const patternTarget = () => {
    const pick = (department) => ({
      id: String(department._id),
      name: department.name,
    });

    if (departmentId) {
      const chosen = options.departments.find(
        (entry) => String(entry._id) === departmentId
      );

      if (chosen) {
        return pick(chosen);
      }
    }

    if (options.scope.level !== "org" && options.departments.length > 0) {
      return pick(options.departments[0]);
    }

    return { id: null, name: "" };
  };

  const summary = team?.summary;

  const tabs = [
    { key: "people", label: "People", icon: <MdOutlineGroups size={16} />, show: true },
    {
      key: "departments",
      label: "Departments",
      icon: <MdOutlineApartment size={16} />,
      show: Boolean(organisation),
    },
  ].filter((entry) => entry.show);

  const activeTab = tabs.some((entry) => entry.key === tab) ? tab : "people";

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== the header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            Team Attendance
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {options?.scope.label || "Loading..."}
            {team?.range && (
              <span className="text-slate-400"> · {team.range.label}</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            THE WORKING PATTERN BUTTON is drawn from an answer the
            backend gave, not from a permission the browser guessed at.
            "May I set THIS department's pattern" is half permission and
            half data (does a department point at me?), and only the
            server knows the second half.
          */}
          {options?.can?.setDepartmentPolicy && (
            <button
              type="button"
              onClick={() => setPatternFor(patternTarget())}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <MdOutlineTune size={17} />
              Working pattern
            </button>
          )}

          {options?.can?.export && (
            <ExportMenu onDownload={download} busy={downloading} />
          )}
        </div>
      </div>

      {/* ==================== the filters ==================== */}
      <div className="bg-white rounded-lg border border-slate-300 p-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1.5">Period</p>

          <div className="flex flex-wrap items-center gap-1">
            {QUICK_RANGES.map((quick) => {
              const isActive =
                range.to === todayKey() &&
                range.from === shiftDateKey(todayKey(), -(quick.days - 1));

              return (
                <button
                  key={quick.key}
                  type="button"
                  onClick={() => applyQuickRange(quick.days)}
                  aria-pressed={isActive}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    isActive
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {quick.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            From
          </label>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) =>
              setRange((old) => ({ ...old, from: event.target.value }))
            }
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            To
          </label>
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={todayKey()}
            onChange={(event) =>
              setRange((old) => ({ ...old, to: event.target.value }))
            }
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/*
          The department list is already narrowed to what this user may
          pick - a dropdown that offers a filter which can only come
          back empty is a dropdown that makes the app look broken.
        */}
        {options?.departments?.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Department
            </label>
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All departments</option>
              {options.departments.map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
          <ClipLoader size={28} color="#4f46e5" />
        </div>
      ) : (
        <>
          {/* ==================== the tabs ==================== */}
          {tabs.length > 1 && (
            <div className="flex items-center gap-1 border-b border-slate-200">
              {tabs.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setTab(entry.key)}
                  aria-pressed={activeTab === entry.key}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === entry.key
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          {/* ==================== PEOPLE ==================== */}
          {activeTab === "people" && team && (
            <div className="flex flex-col gap-6">
              {summary && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                  <StatCard
                    label="Employees"
                    value={summary.employees}
                    icon={<MdOutlineGroups size={20} />}
                    tone="indigo"
                    note={`${summary.workingDays} expected days`}
                  />
                  <StatCard
                    label="Days present"
                    value={summary.presentDays}
                    icon={<MdOutlineEventAvailable size={20} />}
                    tone="green"
                    note={
                      summary.workingDays > 0
                        ? `${formatRate(
                            (summary.presentDays / summary.workingDays) * 100
                          )} attendance`
                        : null
                    }
                  />
                  <StatCard
                    label="Days absent"
                    value={summary.absentDays}
                    icon={<MdOutlineCancel size={20} />}
                    tone={summary.absentDays > 0 ? "red" : "slate"}
                  />
                  <StatCard
                    label="Late arrivals"
                    value={summary.lateDays}
                    icon={<MdOutlineAlarm size={20} />}
                    tone={summary.lateDays > 0 ? "amber" : "slate"}
                  />
                  <StatCard
                    label="Hours worked"
                    value={Math.round(summary.workedMinutes / 60)}
                    icon={<MdOutlineTimer size={20} />}
                    tone="sky"
                    note={
                      summary.overtimeMinutes > 0
                        ? `${formatMinutes(summary.overtimeMinutes)} overtime`
                        : null
                    }
                  />
                </div>
              )}

              {/*
                THE RECORDS THAT ARE NOT QUITE FACTS, called out where a
                manager will see them rather than buried in a column.
                A board resting on twelve days the system guessed at is
                a board that needs twelve corrections, and nobody would
                find them by scrolling.
              */}
              {(summary?.autoClosedDays > 0 || summary?.openDays > 0) && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 text-amber-800 rounded-lg px-4 py-3 text-sm">
                  <MdOutlinePendingActions
                    size={18}
                    className="shrink-0 mt-0.5 text-amber-600"
                  />
                  <span>
                    {summary.autoClosedDays > 0 && (
                      <>
                        <b>{summary.autoClosedDays}</b> day
                        {summary.autoClosedDays === 1 ? " was" : "s were"} closed
                        automatically because no clock out was recorded
                        {summary.openDays > 0 ? ", and " : ". "}
                      </>
                    )}
                    {summary.openDays > 0 && (
                      <>
                        <b>{summary.openDays}</b> day
                        {summary.openDays === 1 ? " is" : "s are"} still open.{" "}
                      </>
                    )}
                    Open somebody's record to correct the hours.
                  </span>
                </div>
              )}

              <LiveBoard
                live={team.live}
                employees={team.employees.map((row) => row.user)}
                onSelect={setSelectedUser}
              />

              <AttendanceTrend trend={team.trend} />

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <PerformerList
                  rows={team.topPerformers}
                  variant="top"
                  minDaysToRank={options?.minDaysToRank}
                  onSelect={setSelectedUser}
                />

                <PerformerList
                  rows={team.needsAttention}
                  variant="attention"
                  minDaysToRank={options?.minDaysToRank}
                  onSelect={setSelectedUser}
                />
              </div>

              {/*
                ONLY WHEN THERE IS MORE THAN ONE DEPARTMENT ON THE BOARD.

                A manager of a single department is already looking at
                that department - splitting it by department would draw
                one card repeating the list directly above it. It earns
                its place for somebody who manages two or three teams,
                whose top performers must not be mixed into one ranking:
                the teams may not even share a working pattern.
              */}
              {team.departmentLeaders?.length > 1 && (
                <DepartmentLeaders
                  groups={team.departmentLeaders}
                  minDaysToRank={options?.minDaysToRank}
                  /*
                    An admin's People tab is the whole company, a
                    manager's is the two or three teams that point at
                    them. "My departments" would be a small lie on the
                    first, so the header follows the scope the backend
                    resolved rather than assuming either.
                  */
                  title={
                    options?.scope.level === "org"
                      ? "Top performers by department"
                      : "Top performers in each of my departments"
                  }
                  onSelect={setSelectedUser}
                />
              )}

              <div>
                <h2 className="text-sm font-semibold text-slate-600 mb-3">
                  Everybody
                </h2>

                <TeamAttendanceTable
                  rows={team.employees}
                  onSelect={setSelectedUser}
                  showDepartment={!departmentId}
                />
              </div>
            </div>
          )}

          {/* ==================== DEPARTMENTS ==================== */}
          {activeTab === "departments" && organisation && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                  label="Departments"
                  value={organisation.summary.departments}
                  icon={<MdOutlineApartment size={20} />}
                  tone="violet"
                  note={`${organisation.summary.employees} employees`}
                />
                <StatCard
                  label="Working now"
                  value={organisation.liveWorking}
                  icon={<MdOutlineGroups size={20} />}
                  tone="green"
                  note={`${organisation.liveOnBreak} on a break`}
                />
                <StatCard
                  label="Days absent"
                  value={organisation.summary.absentDays}
                  icon={<MdOutlineCancel size={20} />}
                  tone={organisation.summary.absentDays > 0 ? "red" : "slate"}
                  note={`${organisation.summary.lateDays} late arrivals`}
                />
                <StatCard
                  label="Hours worked"
                  value={Math.round(organisation.summary.workedMinutes / 60)}
                  icon={<MdOutlineTimer size={20} />}
                  tone="sky"
                  note={`${formatMinutes(
                    organisation.summary.overtimeMinutes
                  )} overtime`}
                />
              </div>

              <AttendanceTrend
                trend={organisation.trend}
                title="The whole company, day by day"
              />

              <DepartmentTable rows={organisation.departments} />

              {/*
                THE ADMIN'S TOP PERFORMERS, ONE PODIUM PER DEPARTMENT,
                and it sits ABOVE the two company-wide lists on purpose.
                A single top-ten across the whole company is the list
                that hides every department but one, so it is the
                supporting answer here, not the headline.
              */}
              <DepartmentLeaders
                groups={organisation.departmentLeaders}
                minDaysToRank={options?.minDaysToRank}
                onSelect={setSelectedUser}
              />

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <PerformerList
                  rows={organisation.topPerformers}
                  variant="top"
                  minDaysToRank={options?.minDaysToRank}
                  onSelect={setSelectedUser}
                />

                <PerformerList
                  rows={organisation.needsAttention}
                  variant="attention"
                  minDaysToRank={options?.minDaysToRank}
                  onSelect={setSelectedUser}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== the two pop-ups ==================== */}
      {selectedUser && (
        <EmployeeAttendanceModal
          userId={selectedUser}
          range={range}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {patternFor && (
        <WorkingPatternModal
          isOpen
          departmentId={patternFor.id}
          departmentName={patternFor.name}
          onClose={() => setPatternFor(null)}
          /*
            Wrapped rather than passed straight through: loadBoard's
            first argument is an AbortSignal now, and the modal calls
            its callback with whatever it happens to have.
          */
          onSaved={() => loadBoard()}
        />
      )}
    </div>
  );
}

/* =====================================================================
   THE DEPARTMENT TABLE
   ---------------------------------------------------------------------
   The director's answer: one row per department, sorted by score, so
   the comparison the whole tab exists for is the first thing on it.
   ===================================================================== */
function DepartmentTable({ rows = [] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-10 text-center">
        <p className="text-sm text-slate-500">
          No department has any attendance in this period.
        </p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3 text-right">People</th>
              <th className="px-4 py-3 text-right">Expected</th>
              <th className="px-4 py-3 text-right">Present</th>
              <th className="px-4 py-3 text-right">Absent</th>
              <th className="px-4 py-3 text-right">Late</th>
              <th className="px-4 py-3 text-right">Avg day</th>
              <th className="px-4 py-3 text-right">Attendance</th>
              <th className="px-4 py-3 text-right">Score</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sorted.map((row) => {
              const tone = scoreTone(row.score);

              return (
                <tr
                  key={row.departmentId || "none"}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="text-[11px] text-slate-400">{row.code}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {row.employees}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                    {row.workingDays}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-800 font-medium">
                    {row.expectedPresentDays}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.absentDays > 0 ? (
                      <span className="text-red-600 font-medium">
                        {row.absentDays}
                      </span>
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.lateDays > 0 ? (
                      <span className="text-amber-600 font-medium">
                        {row.lateDays}
                      </span>
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 whitespace-nowrap">
                    {row.avgDayMinutes === null
                      ? "-"
                      : formatMinutes(row.avgDayMinutes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                        <span
                          className={`block h-full rounded-full ${
                            row.attendanceRate === null
                              ? ""
                              : row.attendanceRate >= 90
                              ? "bg-green-500"
                              : row.attendanceRate >= 75
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${row.attendanceRate || 0}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-slate-800 font-medium w-10 text-right">
                        {formatRate(row.attendanceRate)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-semibold tabular-nums ${tone.text}`}>
                      {row.score === null ? "-" : row.score}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =====================================================================
   THE EXPORT MENU
   ---------------------------------------------------------------------
   Four reports times three formats is twelve downloads, which is too
   many for a row of buttons and exactly right for a small menu: pick
   the question first, then the file.
   ===================================================================== */
function ExportMenu({ onDownload, busy = "" }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={Boolean(busy)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {busy ? (
          <ClipLoader size={16} color="white" />
        ) : (
          <MdOutlineFileDownload size={17} />
        )}
        {busy ? "Preparing..." : "Export"}
      </button>

      {open && (
        <>
          {/* clicking anywhere else closes it */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-20 p-2">
            {ATTENDANCE_REPORTS.map((report) => (
              <div
                key={report.key}
                className="px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <p className="text-sm font-medium text-slate-800">
                  {report.label}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{report.hint}</p>

                <div className="flex items-center gap-1.5 mt-2">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.key}
                      type="button"
                      onClick={() => {
                        onDownload(report.key, format.key);
                        setOpen(false);
                      }}
                      className="px-2.5 py-1 rounded-md border border-slate-300 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      {format.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <p className="text-[11px] text-slate-400 px-3 py-2 border-t border-slate-100 mt-1">
              The file holds exactly what this page is showing - the same
              period, the same department, the same people.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default TeamAttendance;
