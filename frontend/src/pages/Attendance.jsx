/*
=========================================================================
  PAGE: Attendance                (Module 11 - Attendance Management)
=========================================================================
  "My attendance" - the employee's own working day and their own record
  of it.

  IT NEEDS NO PERMISSION, in App.jsx or in the backend. Your own working
  day is your own paperwork, the same decision /notifications and
  /search already made - see the note in backend/config/permissions.js.
  Every request this page makes reads req.userId, so it can only ever
  show the person who is logged in.

  THE PAGE IS THE PUNCH CARD PLUS ITS OWN HISTORY
  -----------------------------------------------
    1. the clock            what is happening right now
    2. the five numbers     how the chosen period went
    3. the calendar         WHICH days, which no total can say
    4. the table            the same days as rows, and the weekly and
                            monthly roll-ups of them

  WHY THE PERIOD SWITCHER CHANGES THE TABLE AND NOT THE PAGE
  ----------------------------------------------------------
  Daily, weekly and monthly are the SAME days bucketed three ways - the
  backend builds them from one array - so the cards and the calendar
  above stay exactly where they are while the table underneath changes
  shape. A period switcher that reloaded the whole page would suggest
  three different answers, when there is only one.
=========================================================================
*/

import { useCallback, useEffect, useState } from "react";
import { ClipLoader } from "react-spinners";
import { toast } from "react-toastify";
import {
  MdOutlineSchedule,
  MdOutlineFreeBreakfast,
  MdOutlineInfo,
  MdOutlineCalendarMonth,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import useMyAttendance from "../CustomHooks/useMyAttendance.js";
import {
  formatMinutes,
  minutesToClock,
  QUICK_RANGES,
  shiftDateKey,
  todayKey,
} from "../utils/attendanceConstants.js";

import PunchClock from "../components/attendance/PunchClock.jsx";
import AttendanceSummaryCards from "../components/attendance/AttendanceSummaryCards.jsx";
import AttendanceCalendar from "../components/attendance/AttendanceCalendar.jsx";
import AttendanceHistoryTable from "../components/attendance/AttendanceHistoryTable.jsx";

function Attendance() {
  const attendance = useMyAttendance();

  const [period, setPeriod] = useState("daily");

  /*
    The range starts at "the last 30 days" rather than at this calendar
    month, because a month that is two days old shows two rows - and a
    page that looks empty on the 2nd looks broken.
  */
  const [range, setRange] = useState(() => ({
    from: shiftDateKey(todayKey(), -29),
    to: todayKey(),
  }));

  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoading(true);

    try {
      const { data } = await api.get("/api/attendance/me/history", {
        params: { period, from: range.from, to: range.to },
      });

      setHistory(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [period, range.from, range.to]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /*
    A PUNCH CHANGES THE HISTORY TOO.

    Clocking out adds a finished day to the very table underneath, and
    a page where the clock says "Finished" while the table below still
    shows today as absent is a page nobody believes. The record's own
    state is the trigger, so this fires once per real change rather
    than on every tick.
  */
  useEffect(() => {
    if (attendance.state === "Finished" || attendance.state === "Working") {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance.state]);

  const applyQuickRange = (days) => {
    setRange({ from: shiftDateKey(todayKey(), -(days - 1)), to: todayKey() });
  };

  const policy = attendance.policy;

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== the clock ==================== */}
      <div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">
          My Attendance
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          Start and end your working day, take your breaks, and see how the
          month is going.
        </p>

        <PunchClock attendance={attendance} />
      </div>

      {/* ==================== the working pattern ====================
          READ-ONLY, and it is here on purpose. An employee has an
          absolute right to know what shift they are being judged
          against and how much break time they are allowed - a system
          that measures somebody by a rule it will not show them is not
          a system anybody should trust. */}
      {policy && (
        <div className="bg-white rounded-lg border border-slate-300 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <MdOutlineInfo size={15} />
              My working pattern
            </span>

            <PatternFact
              icon={<MdOutlineSchedule size={15} />}
              label="Shift"
              value={`${minutesToClock(policy.shiftStartMinutes)} - ${minutesToClock(
                policy.shiftEndMinutes
              )}`}
            />

            <PatternFact
              icon={<MdOutlineCalendarMonth size={15} />}
              label="Full day"
              value={formatMinutes(policy.fullDayMinutes)}
            />

            <PatternFact
              icon={<MdOutlineFreeBreakfast size={15} />}
              label="Break allowance"
              value={`${formatMinutes(policy.breakAllowanceMinutes)} a day`}
            />

            <PatternFact
              icon={<MdOutlineSchedule size={15} />}
              label="Grace period"
              value={formatMinutes(policy.graceMinutes)}
            />

            <span className="text-xs text-slate-400">
              {policy.source === "department"
                ? "set by your department"
                : policy.source === "company"
                ? "the company default"
                : "the built-in default"}
            </span>
          </div>
        </div>
      )}

      {/* ==================== the filter bar ==================== */}
      <div className="bg-white rounded-lg border border-slate-300 p-4 flex flex-wrap items-end gap-4">
        {/* the four one-click periods, so nobody has to type two dates */}
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

        {/* ---- daily / weekly / monthly ---- */}
        <div className="ml-auto">
          <p className="text-xs font-medium text-slate-500 mb-1.5">View</p>

          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {(history?.periods || []).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriod(option.key)}
                aria-pressed={period === option.key}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  period === option.key
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ==================== the numbers ==================== */}
      {loading ? (
        <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
          <ClipLoader size={28} color="#4f46e5" />
        </div>
      ) : (
        history && (
          <>
            <AttendanceSummaryCards summary={history.summary} />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* the calendar is narrow; the table wants the room */}
              <div className="xl:col-span-1">
                <AttendanceCalendar days={history.days} />
              </div>

              <div className="xl:col-span-2">
                <h2 className="text-sm font-semibold text-slate-600 mb-3">
                  {history.periods.find((entry) => entry.key === period)?.label}
                  <span className="font-normal text-slate-400 ml-2">
                    {history.range.label}
                  </span>
                </h2>

                <AttendanceHistoryTable rows={history.rows} period={period} />
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

/* one fact of the working pattern strip */
function PatternFact({ icon, label, value }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      <span className="text-xs text-slate-500">{label}</span>
      <b className="text-sm font-medium text-slate-800">{value}</b>
    </span>
  );
}

export default Attendance;
