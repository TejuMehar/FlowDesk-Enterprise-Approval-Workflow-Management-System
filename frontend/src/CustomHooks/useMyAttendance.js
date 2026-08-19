/*
=========================================================================
  HOOK: useMyAttendance          (Module 11 - Attendance Management)
=========================================================================
  Everything about the logged in user's own working day, in one place:
  today's record, where they are right now, the four punch actions, and
  a clock that ticks.

  IT IS A HOOK AND NOT A REDUX SLICE, deliberately. The punch card
  appears in exactly two places - the dashboard widget and the
  Attendance page - and both of them want a LIVE reading. Redux would
  give them a shared cache, which is the opposite of what a running
  clock needs, and would add a slice to maintain for two components.

  THE TICKING CLOCK, AND WHY IT IS NOT A SECOND REQUEST
  -----------------------------------------------------
  The elapsed time on screen has to move, or the card looks frozen.
  Asking the server every second would be a request per second per
  employee for a number that is arithmetic.

  So the server's answer carries the two things that matter - when the
  day started, and how many minutes of break are already banked - and
  the browser counts forward from them locally. The server clock is sent
  with every answer (`today.serverTime`), and the offset against the
  browser's own clock is measured once, so a laptop whose clock is ten
  minutes fast still shows the right elapsed time.

  THAT DRIFT CORRECTION IS FOR DISPLAY ONLY. Nothing the browser
  measures is ever sent back as a punch - see the rule at the top of
  backend/config/attendanceService.js. The browser is allowed to draw
  the clock; it is not allowed to be one.
=========================================================================
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { api, getErrorMessage } from "../utils/api.js";

function useMyAttendance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // true only while a punch is in flight, so the buttons can be disabled
  const [busy, setBusy] = useState(false);

  // re-rendered once a second purely to move the clock
  const [tick, setTick] = useState(0);

  /*
    How far the browser's clock is from the server's, in milliseconds.

    A ref rather than state: changing it must not cause a render, and
    nothing draws it - it only ever adjusts a subtraction.
  */
  const clockOffset = useRef(0);

  const load = useCallback(async (options = {}) => {
    if (!options.quiet) {
      setLoading(true);
    }

    try {
      const { data: answer } = await api.get("/api/attendance/me");

      if (answer.today?.serverTime) {
        clockOffset.current =
          new Date(answer.today.serverTime).getTime() - Date.now();
      }

      setData(answer);
    } catch (error) {
      /*
        A failed load is shown once and left. The punch card simply
        does not appear, which is far better than a dashboard that
        cannot be read because one widget could not reach its endpoint.
      */
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
    THE TICK ONLY RUNS WHILE SOMETHING IS MOVING.

    A finished day and a day not yet started have nothing to count, so
    the interval is not started at all - an idle timer waking React up
    every second on a page nobody is looking at is a battery bill for
    no picture.
  */
  const state = data?.state || "NotStarted";
  const isRunning = state === "Working" || state === "OnBreak";

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const timer = setInterval(() => setTick((value) => value + 1), 1000);

    return () => clearInterval(timer);
  }, [isRunning]);

  /*
    THE DOUBLE-CLICK GUARD, and why it is a ref and not the state.

    `busy` disables the buttons, which is what the user sees. It cannot
    also be what STOPS the second call, because setBusy is asynchronous:
    two clicks landing in the same React batch both read busy === false,
    both pass the check, and both post. Which is exactly the double
    clock-in the flag was added to prevent - and the fastest way to
    produce it is an impatient double click on a slow morning.

    A ref changes the instant it is written, so the second call sees
    the first one and turns back.
  */
  const inFlight = useRef(false);

  /*
    ONE FUNCTION FOR ALL FOUR PUNCHES.

    They differ only in their URL and in what the answer is called, and
    writing them out four times would be four places to forget the
    guard above.
  */
  const punch = useCallback(
    async (path, body = {}) => {
      if (inFlight.current) {
        return null;
      }

      inFlight.current = true;
      setBusy(true);

      try {
        const { data: answer } = await api.post(path, body);

        setData((previous) => ({
          ...previous,
          record: answer.record,
          state: answer.state,
        }));

        toast.success(answer.message);

        /*
          A warning is a second, quieter toast rather than part of the
          first. Ending a break that ran long IS a success - the
          employee did the right thing by pressing the button - and
          showing it as an error would teach them not to.
        */
        if (answer.warning) {
          toast.warn(answer.warning);
        }

        /*
          The month summary under the clock is now out of date, so the
          whole thing is fetched again - quietly, without the spinner,
          because the card is already showing the new state from the
          answer above.
        */
        load({ quiet: true });

        return answer;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    /*
      `busy` is deliberately NOT a dependency any more. It was one only
      because the old guard read it, and it meant all four punch
      functions changed identity twice on every click - which made them
      useless as dependencies anywhere else.
    */
    [load]
  );

  const clockIn = useCallback(() => punch("/api/attendance/clock-in"), [punch]);

  const clockOut = useCallback(
    (note) => punch("/api/attendance/clock-out", { note }),
    [punch]
  );

  const startBreak = useCallback(
    (type, note) => punch("/api/attendance/break/start", { type, note }),
    [punch]
  );

  const endBreak = useCallback(() => punch("/api/attendance/break/end"), [punch]);

  /* =====================================================================
     THE LIVE NUMBERS
     ---------------------------------------------------------------------
     Worked out here, from the record, on every tick.

     WORKED TIME EXCLUDES THE BREAK THAT IS RUNNING, so the number never
     goes backwards while somebody is at lunch. It simply stops, which is
     the honest picture of what is happening, and it is the same rule the
     server keeps when it stores the total.
     ===================================================================== */
  const now = Date.now() + clockOffset.current;

  const record = data?.record || null;

  const runningBreak = record?.breaks?.find((entry) => entry.isRunning) || null;

  const currentBreakMinutes = runningBreak
    ? Math.max(0, Math.floor((now - new Date(runningBreak.startedAt).getTime()) / 60000))
    : 0;

  const bankedBreakMinutes =
    record?.breaks
      ?.filter((entry) => !entry.isRunning)
      .reduce((sum, entry) => sum + (entry.minutes || 0), 0) || 0;

  const liveBreakMinutes = bankedBreakMinutes + currentBreakMinutes;

  const grossMinutes = record?.clockInAt
    ? Math.max(0, Math.floor((now - new Date(record.clockInAt).getTime()) / 60000))
    : 0;

  const liveWorkedMinutes = record?.clockOutAt
    ? record.workedMinutes
    : Math.max(0, grossMinutes - liveBreakMinutes);

  return {
    // the raw answer, for the parts of the page that want the whole thing
    data,
    loading,
    busy,
    reload: load,

    // where we are
    state,
    record,
    policy: data?.policy || null,
    today: data?.today || null,
    monthSummary: data?.monthSummary || null,
    breakTypes: data?.breakTypes || [],

    // the moving numbers
    liveWorkedMinutes,
    liveBreakMinutes,
    currentBreakMinutes,
    runningBreak,

    // tick is returned so a component can depend on it if it draws seconds
    tick,

    // the four verbs
    clockIn,
    clockOut,
    startBreak,
    endBreak,
  };
}

export default useMyAttendance;
