/*
=========================================================================
  COMPONENT: CorrectionModal
=========================================================================
  Fixing one day: the laptop that died, the morning spent at a
  customer's office, the clock out the system guessed at the shift end.

  THE FORM ONLY OFFERS FACTS, NEVER CONCLUSIONS
  ---------------------------------------------
  Two punch times and a list of breaks - the things a person can
  testify to. There is no field for the status, the hours worked or the
  minutes late, and there must never be one: those are worked out from
  the punches by the server, and a form that let somebody set them
  directly could record "Present" over a day with no hours in it.

  So the preview at the bottom is a PREVIEW, not an input. It shows
  what the corrected punches will add up to, using the same arithmetic
  the backend will redo when it saves.

  THE REASON IS REQUIRED, AND IT IS THE POINT
  -------------------------------------------
  A correction with no reason is indistinguishable from a manager
  rewriting somebody's hours. It goes on the record AND into the audit
  log (AttendanceCorrected), with the before and after - so the
  correction is itself evidence rather than a gap in one.

  TIMES ARE TYPED AS TIMES, NOT AS TIMESTAMPS
  -------------------------------------------
  The boxes are <input type="time">, and the day they belong to is
  already known. A correction dialog that asked for a full ISO datetime
  would be asking somebody to retype a date they can see in the title.
  The date is taken from the record and only the clock is edited.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { MdOutlineWarningAmber, MdDeleteOutline, MdAdd } from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import Modal from "../Modal.jsx";
import {
  formatMinutes,
  formatDateKey,
  clockToMinutes,
} from "../../utils/attendanceConstants.js";

/*
  A Date -> the "HH:MM" the input shows.

  IT USES THE BROWSER'S TIMEZONE, and that is the honest choice here
  rather than a compromise: the manager typing the correction is
  sitting in the office whose day they are correcting, and showing them
  a time that is not the one on their own wall clock would be the
  confusing option. The value is sent back as a full instant, so the
  server still stores an unambiguous moment.
*/
const toTimeInput = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
};

// "HH:MM" + the day this record belongs to -> a real instant
const toInstant = (dateKey, time) => {
  const minutes = clockToMinutes(time);

  if (minutes === null) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  ).toISOString();
};

function CorrectionModal({ day, employee, onClose, onSaved }) {
  const record = day.record;

  const [clockIn, setClockIn] = useState(toTimeInput(record?.clockInAt));
  const [clockOut, setClockOut] = useState(toTimeInput(record?.clockOutAt));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const [breaks, setBreaks] = useState(
    (record?.breaks || []).map((entry) => ({
      type: entry.type,
      start: toTimeInput(entry.startedAt),
      end: toTimeInput(entry.endedAt),
      note: entry.note || "",
    }))
  );

  const setBreakField = (index, field, value) =>
    setBreaks((old) =>
      old.map((entry, position) =>
        position === index ? { ...entry, [field]: value } : entry
      )
    );

  /* =====================================================================
     THE PREVIEW
     ---------------------------------------------------------------------
     The same subtraction the server will do: gross time minus the
     breaks. It is here so a manager can see the consequence of what
     they typed BEFORE they save it - "17:30 becomes 7h 15m" is the
     sentence that catches a typed 07:30.
     ===================================================================== */
  const inMinutes = clockToMinutes(clockIn);
  const outMinutes = clockToMinutes(clockOut);

  const breakMinutes = breaks.reduce((sum, entry) => {
    const start = clockToMinutes(entry.start);
    const end = clockToMinutes(entry.end);

    if (start === null || end === null || end <= start) {
      return sum;
    }

    return sum + (end - start);
  }, 0);

  const workedMinutes =
    inMinutes !== null && outMinutes !== null && outMinutes > inMinutes
      ? outMinutes - inMinutes - breakMinutes
      : null;

  const problem = (() => {
    if (inMinutes === null) {
      return "The clock in has to be a time of day";
    }

    if (clockOut && outMinutes === null) {
      return "The clock out has to be a time of day";
    }

    if (outMinutes !== null && outMinutes <= inMinutes) {
      return "The clock out has to be after the clock in";
    }

    const badBreak = breaks.find((entry) => {
      const start = clockToMinutes(entry.start);
      const end = clockToMinutes(entry.end);

      if (start === null || end === null) {
        return true;
      }

      if (end <= start) {
        return true;
      }

      return start < inMinutes || (outMinutes !== null && end > outMinutes);
    });

    if (badBreak) {
      return "Every break has to be a real span inside the working day";
    }

    if (workedMinutes !== null && workedMinutes < 0) {
      return "The breaks add up to more than the whole day";
    }

    if (reason.trim().length < 5) {
      return "Please say why this record is being corrected";
    }

    return "";
  })();

  const handleSave = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);

    try {
      const { data } = await api.patch(
        `/api/attendance/record/${record._id}`,
        {
          clockInAt: toInstant(day.dateKey, clockIn),
          clockOutAt: clockOut ? toInstant(day.dateKey, clockOut) : null,
          breaks: breaks.map((entry) => ({
            type: entry.type,
            startedAt: toInstant(day.dateKey, entry.start),
            endedAt: toInstant(day.dateKey, entry.end),
            note: entry.note,
          })),
          reason: reason.trim(),
        }
      );

      toast.success(data.message);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="max-w-2xl"
      title={`Correct ${employee?.firstName || "this"} ${
        employee?.lastName || ""
      } - ${formatDateKey(day.dateKey)}`}
    >
      {/* ---------- why this day looks the way it does ---------- */}
      {record?.isAutoClosed && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 text-amber-800 rounded-lg px-4 py-3 text-sm mb-5">
          <MdOutlineWarningAmber size={18} className="shrink-0 mt-0.5 text-amber-600" />
          <span>
            No clock out was recorded, so this day was closed automatically at
            the end of the shift. Correcting it replaces the system's guess with
            what really happened.
          </span>
        </div>
      )}

      {/* ---------- the two punches ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Clocked in
          </label>
          <input
            type="time"
            value={clockIn}
            onChange={(event) => setClockIn(event.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Clocked out
          </label>
          <input
            type="time"
            value={clockOut}
            onChange={(event) => setClockOut(event.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Leave empty to put the day back to "still working"
          </p>
        </div>
      </div>

      {/* ---------- the breaks ---------- */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-700">Breaks</label>

          <button
            type="button"
            onClick={() =>
              setBreaks((old) => [
                ...old,
                { type: "Lunch", start: "", end: "", note: "" },
              ])
            }
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            <MdAdd size={15} />
            Add a break
          </button>
        </div>

        {breaks.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No breaks on this day.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {breaks.map((entry, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
              >
                <select
                  value={entry.type}
                  onChange={(event) =>
                    setBreakField(index, "type", event.target.value)
                  }
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {["Lunch", "Tea", "Personal", "Other"].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>

                <input
                  type="time"
                  value={entry.start}
                  onChange={(event) =>
                    setBreakField(index, "start", event.target.value)
                  }
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />

                <span className="text-xs text-slate-400">to</span>

                <input
                  type="time"
                  value={entry.end}
                  onChange={(event) =>
                    setBreakField(index, "end", event.target.value)
                  }
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />

                <button
                  type="button"
                  onClick={() =>
                    setBreaks((old) => old.filter((_, position) => position !== index))
                  }
                  className="ml-auto text-slate-400 hover:text-red-600 transition-colors"
                  title="Remove this break"
                >
                  <MdDeleteOutline size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- what it will add up to ---------- */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          After saving
        </span>

        <Preview
          label="Worked"
          value={workedMinutes === null ? "-" : formatMinutes(workedMinutes)}
          was={formatMinutes(record?.workedMinutes)}
        />

        <Preview
          label="Break"
          value={formatMinutes(breakMinutes)}
          was={formatMinutes(record?.breakMinutes)}
        />
      </div>

      {/* ---------- the reason ---------- */}
      <div className="mt-5">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Why is this being corrected? <span className="text-red-500">*</span>
        </label>

        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={300}
          placeholder="e.g. Laptop failed at 14:00 - hours confirmed with the team"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <p className="text-[11px] text-slate-400 mt-1">
          This is kept on the record and in the audit log, with what the times
          were before and after.
        </p>
      </div>

      {/* ---------- the buttons ---------- */}
      <div className="flex items-center justify-end gap-3 mt-6 pt-5 border-t border-slate-200">
        {problem && (
          <p className="mr-auto text-xs text-red-600">{problem}</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || Boolean(problem)}
          className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save correction"}
        </button>
      </div>
    </Modal>
  );
}

/* one before/after pair in the preview strip */
function Preview({ label, value, was }) {
  const changed = value !== was;

  return (
    <span className="flex items-baseline gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <b
        className={`text-sm font-semibold tabular-nums ${
          changed ? "text-indigo-700" : "text-slate-700"
        }`}
      >
        {value}
      </b>
      {changed && (
        <span className="text-[11px] text-slate-400 line-through">{was}</span>
      )}
    </span>
  );
}

export default CorrectionModal;
