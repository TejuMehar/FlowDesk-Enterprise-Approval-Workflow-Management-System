/*
=========================================================================
  COMPONENT: TopbarClock
=========================================================================
  The date and the running time, in the top bar of every page.

  IT SHOWS THE COMPANY'S TIME, NOT THE BROWSER'S
  ----------------------------------------------
  This is the whole reason the component is more than four lines, and
  it is not a detail. FlowDesk decides what "today" is in the company's
  timezone (Module 9's working calendar), and Module 11 judges every
  punch against it: whether a clock-in was late, which day it belongs
  to, whether the day is a weekend at all.

  A bar showing the LAPTOP's clock would therefore disagree with the
  app underneath it for anybody working outside the office's zone. At
  23:40 in London against an Asia/Kolkata company, the bar would say
  Tuesday while the attendance page - correctly - had already moved on
  to Wednesday. The employee is not confused about their own watch;
  they are confused about which day FlowDesk thinks it is, and only one
  of those two clocks can answer that.

  So the time is formatted with `timeZone: company.timezone`, and when
  that differs from the browser's own zone the label says which zone is
  on screen. Somebody remote should be able to see at a glance that the
  bar is showing the office's clock rather than their own.

  WHY IT TICKS ON A setTimeout AND NOT A setInterval
  --------------------------------------------------
  setInterval(1000) drifts: the browser is free to run it late, and the
  lateness accumulates, so a clock left open eventually skips a second
  visibly. Each tick here schedules the next one for the next whole
  SECOND of real time, so the display changes when the second changes.
=========================================================================
*/

import { useEffect, useMemo, useState } from "react";
import { MdOutlineSchedule } from "react-icons/md";

import useCompanySettings from "../CustomHooks/useCompanySettings.js";

/*
  Intl throws a RangeError on a timezone it does not recognise, and the
  company timezone is a value an admin typed into a settings form. A bad
  one must not take the whole top bar down with it - every page in
  FlowDesk renders inside this bar - so a broken zone quietly falls back
  to the browser's own.

  @returns an Intl.DateTimeFormat, never null
*/
const buildFormatter = (timezone, options) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", options);
  }
};

/*
  Splits a formatted 12 hour time into the digits and the AM/PM.

      "02:07:22 pm"  ->  { clock: "02:07:22", meridiem: "PM" }

  WHY THE TWO HALVES ARE SEPARATED AT ALL
  ---------------------------------------
  They are drawn differently: the digits are the number somebody reads,
  and the meridiem is a two letter label beside it. Printing the string
  whole would make "PM" the same size and weight as the time, which is
  the one part of a clock nobody has to look at twice.

  IT IS PULLED OUT OF THE PARTS, NEVER SLICED OFF THE STRING. A browser
  is free to write "pm", "p.m." or "PM", to put it in front of the
  digits, and to separate it with a normal space or a narrow one - all
  of which are correct, and none of which survive a split(" ").

  The hour is padded here rather than being left to the formatter,
  because `hour: "2-digit"` is quietly ignored by some browsers on a 12
  hour clock. Without the pad the whole bar jumps sideways as 9:59
  becomes 10:00, which is exactly what tabular-nums is there to stop.
*/
const splitTime = (formatter, date) => {
  try {
    const parts = formatter.formatToParts(date);

    const clock = parts
      .filter((part) => ["hour", "minute", "second", "literal"].includes(part.type))
      .map((part) => (part.type === "hour" ? part.value.padStart(2, "0") : part.value))
      .join("")
      .trim();

    const meridiem =
      parts
        .find((part) => part.type === "dayPeriod")
        ?.value.replace(/\./g, "")
        .toUpperCase() || "";

    return { clock, meridiem };
  } catch {
    // a formatter that cannot be taken apart can still be printed
    return { clock: formatter.format(date), meridiem: "" };
  }
};

// "Asia/Kolkata" and "Asia/Calcutta" are the same clock under two names,
// so the comparison is of what the two zones actually READ right now
const sameZone = (timezone) => {
  try {
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (here === timezone) {
      return true;
    }

    const now = new Date();

    return (
      buildFormatter(here, { timeStyle: "short", dateStyle: "short" }).format(now) ===
      buildFormatter(timezone, { timeStyle: "short", dateStyle: "short" }).format(now)
    );
  } catch {
    return true; // cannot tell -> say nothing rather than warn wrongly
  }
};

function TopbarClock() {
  const { company } = useCompanySettings();

  const timezone = company?.timezone || "UTC";

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = null;

    const tick = () => {
      setNow(new Date());

      // the next whole second, measured from the real clock each time
      timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    };

    timer = setTimeout(tick, 1000 - (Date.now() % 1000));

    return () => clearTimeout(timer);
  }, []);

  /*
    Built once per timezone rather than once per second. An
    Intl.DateTimeFormat is expensive to construct and free to reuse, and
    this one runs 86,400 times a day on a tab somebody leaves open.
  */
  const formatters = useMemo(
    () => ({
      // "Sat, 02 Aug 2026"
      date: buildFormatter(timezone, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),

      /*
        "02:07:22 PM" - TWELVE HOUR, WITH AM/PM.

        It used to be 24 hour, to match the shift times Module 11 is
        configured with ("09:00 - 18:00"). That was consistent with the
        settings screen and wrong for the people reading it: nobody in
        an Indian office says "it is 14:07", and a bar that does forces
        a subtraction on every glance at the one number that should
        need none.

        The shift times keep their 24 hour form where they are TYPED -
        an input box wants an unambiguous value - and the clock is
        read, so it gets the words. en-IN rather than en-GB because it
        is the locale whose 12 hour clock this is.
      */
      time: buildFormatter(timezone, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),

      /*
        The zone, shown only when it is not the reader's own. What it
        reads is up to the browser's data - "UTC" for UTC, but
        "GMT+5:30" rather than "IST" for Asia/Kolkata under en-GB - so
        nothing below may assume a fixed shape or length for it.
      */
      zone: buildFormatter(timezone, {
        hour: "2-digit",
        timeZoneName: "short",
      }),
    }),
    [timezone]
  );

  const isLocal = useMemo(() => sameZone(timezone), [timezone]);

  /*
    The short zone name, dug out of the formatted parts rather than
    sliced off the string - "GMT+5:30" and "IST" are different lengths
    and both are legitimate answers for the same zone.
  */
  const zoneLabel = useMemo(() => {
    try {
      return (
        formatters.zone
          .formatToParts(now)
          .find((part) => part.type === "timeZoneName")?.value || ""
      );
    } catch {
      return "";
    }
    // the label only changes with the zone, but `now` is what it reads;
    // re-deriving it each second is one array scan and keeps it honest
    // across a daylight-saving change on a tab nobody reloaded
  }, [formatters, now]);

  // the digits and the AM/PM, re-read every second along with the clock
  const { clock, meridiem } = splitTime(formatters.time, now);

  return (
    <div
      className="hidden sm:flex items-center gap-2 text-slate-600"
      /*
        The full sentence for a screen reader and for a hover, because
        the visible version is abbreviated on purpose.
      */
      title={`${formatters.date.format(now)}, ${clock} ${meridiem}${
        zoneLabel ? ` (${zoneLabel})` : ""
      }`}
    >
      <MdOutlineSchedule size={17} className="shrink-0 text-slate-400" />

      <div className="leading-tight">
        {/*
          THE TIME IS THE BIGGER OF THE TWO. A clock is read for the
          time; the date is the context underneath it.

          tabular-nums stops the whole bar twitching sideways every
          second as the digits change width - the one piece of styling
          here that is doing real work rather than decoration.
        */}
        <p className="text-sm font-semibold text-slate-800 tabular-nums">
          {clock}

          {/*
            AM / PM, smaller and lighter than the digits: it is the
            half of the reading that only ever has two answers, so it
            does not need the same weight as the four that change.
          */}
          {meridiem && (
            <span className="ml-1 text-[11px] font-semibold text-slate-500">
              {meridiem}
            </span>
          )}

          {/*
            Only for somebody whose own clock says something else. An
            employee sitting in the office does not need to be told
            which timezone they are in.
          */}
          {!isLocal && zoneLabel && (
            <span className="ml-1.5 text-[10px] font-medium text-indigo-600 align-middle">
              {zoneLabel}
            </span>
          )}
        </p>

        <p className="hidden md:block text-[11px] text-slate-500">
          {formatters.date.format(now)}
        </p>
      </div>
    </div>
  );
}

export default TopbarClock;
