/*
=========================================================================
  COMPONENT: WorkingCalendarSettings  (Module 9)
=========================================================================
  Which days the company works, and which days it does not.

  WHAT THIS ACTUALLY CHANGES
  --------------------------
  The reminder engine (backend, config/reminderEngine.js) asks these
  two settings before it does anything at all. Before Module 9 it ran
  on the server's clock, which meant a server hosted in UTC would email
  an approver "you have been sitting on this for two days" on a Sunday
  morning, and again on a public holiday.

  Nothing is CANCELLED by a day off, only DELAYED - a request that went
  quiet on Friday is still waiting on Monday and is reminded then. The
  card says so, because an admin ticking boxes deserves to know whether
  they are silencing a reminder or postponing it.

  THE DATES ARE TEXT, ALL THE WAY DOWN
  ------------------------------------
  A holiday is "2026-01-26" from the date picker, through this
  component, into MongoDB and back. It is never turned into a Date -
  see utils/settingsConstants.js. The one place a Date appears is
  formatHolidayDate(), purely to print it.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import {
  MdOutlineCalendarMonth,
  MdAdd,
  MdOutlineDelete,
  MdOutlineEventBusy,
} from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import {
  WEEKDAYS,
  formatHolidayDate,
  holidayWeekday,
  isUpcoming,
  todayAsInputDate,
} from "../../utils/settingsConstants.js";
import SettingsCard, {
  settingsInputClass,
  settingsLabelClass,
} from "./SettingsCard.jsx";

function WorkingCalendarSettings({ settings, canEdit, onSaved }) {
  const [workingDays, setWorkingDays] = useState(settings.workingDays || []);
  const [holidays, setHolidays] = useState(settings.holidays || []);

  // the "add a holiday" row
  const [newHoliday, setNewHoliday] = useState({ name: "", date: "" });

  const [saving, setSaving] = useState(false);

  /* =================================================================
     TICK / UNTICK A WORKING DAY
     ================================================================= */
  const toggleDay = (day) => {
    setWorkingDays((previous) =>
      previous.includes(day)
        ? previous.filter((entry) => entry !== day)
        : // kept sorted so the summary line always reads Sun -> Sat
          [...previous, day].sort((a, b) => a - b)
    );
  };

  /* =================================================================
     ADD A HOLIDAY
     -----------------------------------------------------------------
     Added to the list on screen only. Nothing reaches the database
     until Save is pressed, so an admin can type five holidays and
     change their mind about all of them.
     ================================================================= */
  const addHoliday = () => {
    const name = newHoliday.name.trim();
    const date = newHoliday.date;

    if (!name) {
      toast.error("Give the holiday a name");
      return;
    }

    if (!date) {
      toast.error("Choose a date for the holiday");
      return;
    }

    // the backend refuses two holidays on one day, so we say so first
    if (holidays.some((holiday) => holiday.date === date)) {
      toast.error(`There is already a holiday on ${formatHolidayDate(date)}`);
      return;
    }

    setHolidays((previous) =>
      [...previous, { name, date }].sort((a, b) => a.date.localeCompare(b.date))
    );

    setNewHoliday({ name: "", date: "" });
  };

  const removeHoliday = (date) => {
    setHolidays((previous) =>
      previous.filter((holiday) => holiday.date !== date)
    );
  };

  /* =================================================================
     SAVE
     ================================================================= */
  const handleSave = async () => {
    if (workingDays.length === 0) {
      toast.error("Choose at least one working day");
      return;
    }

    setSaving(true);

    try {
      const result = await api.put("/api/settings", { workingDays, holidays });

      toast.success(result.data.message);
      onSaved(result.data.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // the holidays still ahead of us, for the little count at the top
  const upcomingCount = holidays.filter((holiday) =>
    isUpcoming(holiday.date)
  ).length;

  return (
    <SettingsCard
      icon={<MdOutlineCalendarMonth size={20} />}
      title="Working days & holidays"
      description="When the company is at work. Reminders, escalations and the daily summary are not sent on a day off - they wait for the next working day rather than being skipped."
      onSave={handleSave}
      saving={saving}
      canEdit={canEdit}
    >
      {/* ==================== working days ==================== */}
      <label className={settingsLabelClass}>Working days</label>

      <div className="flex flex-wrap gap-2 mt-3">
        {WEEKDAYS.map((weekday) => {
          const isWorking = workingDays.includes(weekday.day);

          return (
            <button
              key={weekday.day}
              type="button"
              onClick={() => canEdit && toggleDay(weekday.day)}
              disabled={!canEdit}
              title={weekday.label}
              className={`h-10 w-14 rounded-lg text-sm font-medium border transition-colors disabled:cursor-not-allowed ${
                isWorking
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
              }`}
            >
              {weekday.short}
            </button>
          );
        })}
      </div>

      {workingDays.length === 0 && (
        <p className="text-xs text-red-500 mt-2">
          With no working days the reminder engine would never send
          anything again. Choose at least one.
        </p>
      )}

      {/* ==================== holidays ==================== */}
      <div className="mt-6 pt-5 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3 mb-3">
          <label className={settingsLabelClass}>
            Holidays
            <span className="ml-2 text-xs font-normal text-slate-400">
              {holidays.length} in the calendar
              {upcomingCount > 0 && `, ${upcomingCount} still to come`}
            </span>
          </label>
        </div>

        {/* ---------- add a holiday ---------- */}
        {canEdit && (
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={newHoliday.name}
              onChange={(event) =>
                setNewHoliday({ ...newHoliday, name: event.target.value })
              }
              placeholder="e.g. Republic Day"
              className={`${settingsInputClass} sm:flex-1`}
            />

            <input
              type="date"
              value={newHoliday.date}
              min={todayAsInputDate()}
              onChange={(event) =>
                setNewHoliday({ ...newHoliday, date: event.target.value })
              }
              className={`${settingsInputClass} sm:w-48`}
            />

            <button
              type="button"
              onClick={addHoliday}
              className="h-11 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              <MdAdd size={18} /> Add
            </button>
          </div>
        )}

        {/* ---------- the list ---------- */}
        {holidays.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center gap-1.5 text-slate-400">
            <MdOutlineEventBusy size={26} />
            <p className="text-sm">No holidays yet</p>
            <p className="text-xs">
              Only weekends are treated as days off until you add some.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {holidays.map((holiday) => {
              const stillToCome = isUpcoming(holiday.date);

              return (
                <div
                  key={holiday.date}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm truncate ${
                        stillToCome
                          ? "text-slate-800 font-medium"
                          : "text-slate-400"
                      }`}
                    >
                      {holiday.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatHolidayDate(holiday.date)} ·{" "}
                      {holidayWeekday(holiday.date)}
                      {/* a past holiday is kept, but it is clearly over */}
                      {!stillToCome && " · past"}
                    </p>
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeHoliday(holiday.date)}
                      className="w-8 h-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center shrink-0"
                    >
                      <MdOutlineDelete size={18} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-slate-400 mt-3">
          Past holidays are kept on purpose - they are what the calendar
          was when the reminders of that week were sent.
        </p>
      </div>
    </SettingsCard>
  );
}

export default WorkingCalendarSettings;
