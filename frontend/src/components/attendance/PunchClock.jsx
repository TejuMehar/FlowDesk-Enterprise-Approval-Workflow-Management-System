/*
=========================================================================
  COMPONENT: PunchClock            (Module 11 - Attendance Management)
=========================================================================
  "Start work" / "Take a break" / "Back" / "End work", and the running
  clock between them.

  IT IS THE ONLY WRITE AN ORDINARY EMPLOYEE MAKES ALL DAY, so it is
  built to be unmistakable: one big button that says the one thing that
  can happen next, and never two buttons that both look like the answer.

  THE BUTTON IS DERIVED FROM THE STATE, NEVER FROM A GUESS
  -------------------------------------------------------
      NotStarted -> Start work
      Working    -> Take a break   (+ End work, quieter)
      OnBreak    -> Back to work   (and NOTHING else)
      Finished   -> nothing, just the summary of the day

  The OnBreak case is the one worth pointing at. There is deliberately
  no "End work" button while somebody is on a break: the server would
  accept it and close the break for them, but a screen that offers two
  ways out of a break is a screen where people pick the wrong one and
  then ask their manager to fix the day.

  IT COMES IN TWO SIZES
  ---------------------
  `compact` is the dashboard widget - one line, the state, the clock and
  the button. The full one adds the shift, the break allowance and the
  list of today's breaks. Same component, because the two must never
  disagree about what state somebody is in, and a second copy is exactly
  how they would.
=========================================================================
*/

import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipLoader } from "react-spinners";
import {
  MdPlayArrow,
  MdStop,
  MdOutlineFreeBreakfast,
  MdOutlineWorkHistory,
  MdOutlineSchedule,
  MdOutlineTimer,
  MdOutlineWarningAmber,
  MdArrowForward,
} from "react-icons/md";

import {
  formatMinutes,
  minutesToClock,
  stateMeta,
  statusMeta,
} from "../../utils/attendanceConstants.js";

/*
  @param attendance  the whole return value of useMyAttendance()
  @param compact     true for the dashboard widget
*/
function PunchClock({ attendance, compact = false }) {
  const {
    state,
    record,
    policy,
    today,
    busy,
    loading,
    liveWorkedMinutes,
    liveBreakMinutes,
    currentBreakMinutes,
    runningBreak,
    breakTypes,
    clockIn,
    clockOut,
    startBreak,
    endBreak,
  } = attendance;

  /*
    Which kind of break, chosen before pressing the button.

    "" rather than a hard-coded "Lunch". The list of break types is
    configured on the server, and a company that renamed Lunch to Meal
    got a <select> whose value matched none of its own options - which
    browsers draw as the first option while still holding the old
    string, so the button sent "Lunch" and the backend rejected a break
    the screen said it had selected. `chosenBreakType` below falls back
    to whatever the server actually offered first.
  */
  const [breakType, setBreakType] = useState("");

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-6 flex justify-center">
        <ClipLoader size={24} color="#4f46e5" />
      </div>
    );
  }

  const meta = stateMeta(state);

  /*
    The kind of break the button will actually send: what the user
    picked, or the first one the server offers if they have not picked
    anything. Never a name the server has not heard of.
  */
  const chosenBreakType =
    breakTypes.includes(breakType) ? breakType : breakTypes[0] || "";

  /*
    HOW MUCH OF THE DAY IS DONE.

    A bar rather than a number, because "6h 10m of 8h" is a comparison,
    and a comparison is the one thing a length is better at than type.
    It is capped at 100% so a twelve hour day does not draw a bar
    outside its own track - the overtime is called out in words instead.
  */
  const fullDayMinutes = policy?.fullDayMinutes || 480;
  const progress = Math.min((liveWorkedMinutes / fullDayMinutes) * 100, 100);

  const overtimeMinutes = Math.max(0, liveWorkedMinutes - fullDayMinutes);

  const allowanceMinutes = policy?.breakAllowanceMinutes ?? 60;
  const breakLeft = Math.max(0, allowanceMinutes - liveBreakMinutes);
  const overBreak = liveBreakMinutes > allowanceMinutes;

  /* =====================================================================
     THE ONE BUTTON
     ===================================================================== */
  const primaryButton = () => {
    if (state === "NotStarted") {
      return (
        <button
          type="button"
          onClick={clockIn}
          disabled={busy}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <MdPlayArrow size={18} />
          Start work
        </button>
      );
    }

    if (state === "OnBreak") {
      return (
        <button
          type="button"
          onClick={endBreak}
          disabled={busy}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <MdOutlineWorkHistory size={18} />
          Back to work
        </button>
      );
    }

    if (state === "Working") {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startBreak(chosenBreakType)}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm font-semibold hover:bg-amber-100 disabled:opacity-60 transition-colors"
          >
            <MdOutlineFreeBreakfast size={18} />
            Take a break
          </button>

          <button
            type="button"
            onClick={() => clockOut()}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-60 transition-colors"
          >
            <MdStop size={18} />
            End work
          </button>
        </div>
      );
    }

    // Finished - nothing left to press today
    return (
      <span className="text-sm text-slate-500">
        Finished at <b className="text-slate-800">{record?.clockOutClock}</b>
      </span>
    );
  };

  /* =====================================================================
     THE HEADLINE
     ---------------------------------------------------------------------
     Never two clocks at once. On a break, the number that moves is the
     BREAK, because that is what the person is watching; the worked time
     is beside it, still, which is exactly what it is doing.
     ===================================================================== */
  const headline =
    state === "OnBreak" ? (
      <>
        <p className="text-3xl font-semibold text-amber-600 tabular-nums">
          {formatMinutes(currentBreakMinutes)}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          on {runningBreak?.type?.toLowerCase() || "break"} - worked{" "}
          {formatMinutes(liveWorkedMinutes)} so far
        </p>
      </>
    ) : (
      <>
        <p className="text-3xl font-semibold text-slate-900 tabular-nums">
          {formatMinutes(liveWorkedMinutes)}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {state === "NotStarted"
            ? `Shift ${minutesToClock(policy?.shiftStartMinutes)} - ${minutesToClock(
                policy?.shiftEndMinutes
              )}`
            : `of ${formatMinutes(fullDayMinutes)}${
                overtimeMinutes > 0
                  ? ` - ${formatMinutes(overtimeMinutes)} overtime`
                  : ""
              }`}
        </p>
      </>
    );

  /* =====================================================================
     THE COMPACT VERSION - the dashboard widget
     ===================================================================== */
  if (compact) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 border-l-4 border-l-indigo-500 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span
              className={`w-11 h-11 shrink-0 rounded-lg flex items-center justify-center ${
                state === "OnBreak"
                  ? "bg-amber-50 text-amber-600"
                  : state === "Working"
                  ? "bg-green-50 text-green-600"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              <MdOutlineTimer size={22} />
            </span>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800">Today</h2>

                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: meta.dot }}
                  />
                  {meta.label}
                </span>
              </div>

              {headline}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {primaryButton()}

            <Link
              to="/attendance"
              className="hidden sm:flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              My attendance <MdArrowForward size={13} />
            </Link>
          </div>
        </div>

        {/* the progress bar, only once there is progress to show */}
        {state !== "NotStarted" && (
          <div className="mt-4 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                overtimeMinutes > 0 ? "bg-indigo-500" : "bg-green-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  /* =====================================================================
     THE FULL CARD - the Attendance page
     ===================================================================== */
  return (
    <div className="bg-white rounded-lg border border-slate-300 p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-slate-600">
              {today?.label}
            </h2>

            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: meta.dot }}
              />
              {meta.label}
            </span>

            {/*
              A day the company is closed is said OUT LOUD before
              anybody starts working on it, rather than being noticed
              in a summary at the end of the month.
            */}
            {today && !today.isWorkingDay && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                <MdOutlineSchedule size={13} />
                {today.reason}
              </span>
            )}
          </div>

          <div className="mt-2">{headline}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* the kind of break is chosen BEFORE the button, so the button
              stays one press */}
          {state === "Working" && breakTypes.length > 0 && (
            <select
              value={chosenBreakType}
              onChange={(event) => setBreakType(event.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {breakTypes.map((type) => (
                <option key={type} value={type}>
                  {type} break
                </option>
              ))}
            </select>
          )}

          {primaryButton()}
        </div>
      </div>

      {/* ==================== the day in numbers ==================== */}
      {state !== "NotStarted" && (
        <>
          <div className="mt-5 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                overtimeMinutes > 0 ? "bg-indigo-500" : "bg-green-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-200">
            <Fact label="Clocked in" value={record?.clockInClock || "-"} />
            <Fact
              label="Clocked out"
              value={record?.clockOutClock || "still working"}
            />
            <Fact
              label="Break taken"
              value={formatMinutes(liveBreakMinutes)}
              tone={overBreak ? "text-red-600" : undefined}
              note={
                overBreak
                  ? `${formatMinutes(liveBreakMinutes - allowanceMinutes)} over`
                  : `${formatMinutes(breakLeft)} left`
              }
            />
            <Fact
              label="Status"
              value={statusMeta(record?.status).label}
              note={
                record?.lateMinutes > 0
                  ? `${formatMinutes(record.lateMinutes)} late`
                  : null
              }
            />
          </div>
        </>
      )}

      {/* ==================== today's breaks ==================== */}
      {record?.breaks?.length > 0 && (
        <div className="mt-5 pt-5 border-t border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            Breaks today
          </p>

          <div className="flex flex-wrap gap-2">
            {record.breaks.map((entry) => (
              <span
                key={entry._id}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                  entry.isRunning
                    ? "text-amber-700 bg-amber-50 border-amber-200"
                    : "text-slate-600 bg-slate-50 border-slate-200"
                }`}
              >
                <MdOutlineFreeBreakfast size={13} />
                {entry.type}
                <b className="tabular-nums">
                  {entry.isRunning
                    ? formatMinutes(currentBreakMinutes)
                    : formatMinutes(entry.minutes)}
                </b>
                {entry.isRunning && <span className="text-[10px]">running</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/*
        THE SYSTEM'S GUESS, SAID PLAINLY.

        A day the server closed at the shift end and a day the employee
        closed must never look the same - see the note on isAutoClosed
        in backend/model/attendanceModel.js.
      */}
      {record?.isAutoClosed && (
        <div className="mt-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 text-amber-800 rounded-lg px-4 py-3 text-sm">
          <MdOutlineWarningAmber size={18} className="shrink-0 mt-0.5 text-amber-600" />
          <span>
            This day was closed automatically at the end of the shift because no
            clock out was recorded. Ask your manager if the hours need
            correcting.
          </span>
        </div>
      )}
    </div>
  );
}

/* one label + value of the four under the clock */
function Fact({ label, value, note = null, tone = "text-slate-800" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-medium mt-0.5 truncate ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>}
    </div>
  );
}

export default PunchClock;
