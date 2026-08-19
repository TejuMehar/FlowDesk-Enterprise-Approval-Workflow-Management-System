/*
=========================================================================
  COMPONENT: WorkingPatternModal
=========================================================================
  Where a department manager sets the shift, the grace period and - the
  reason they actually opened this screen - THE BREAK ALLOWANCE.

  THE FORM IS IN THE UNITS A PERSON THINKS IN, NOT THE ONES THE
  DATABASE USES
  -----------------------------------------------------------------
  The backend stores every time as minutes past local midnight, because
  a number can be compared and subtracted with nothing in between (see
  backend/config/attendanceConstants.js). Nobody types 570.

  So the two shift boxes are <input type="time"> and are converted on
  the way in and out, and the durations are typed in minutes with the
  hours shown beside them as you type. The conversion lives in exactly
  two functions in utils/attendanceConstants.js.

  INHERITANCE IS SHOWN, NOT HIDDEN
  --------------------------------
  A department with no pattern of its own inherits the company's. A form
  pre-filled with inherited values and no word about it turns that
  inheritance into a COPY the first time somebody presses Save - and
  then the department silently stops following the company default for
  ever. So the banner says where the numbers came from, and every field
  that differs from the company gets a quiet marker.

  THE CROSS-FIELD RULES ARE CHECKED HERE **AND** ON THE SERVER
  ------------------------------------------------------------
  A shift that ends before it starts is refused twice: here, so the
  message arrives while the cursor is still in the box, and in the
  controller, because a form is not a security boundary and never was.
=========================================================================
*/

import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdOutlineInfo, MdOutlineRestartAlt } from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import Modal from "../Modal.jsx";
import {
  formatMinutes,
  minutesToClock,
  clockToMinutes,
} from "../../utils/attendanceConstants.js";

/*
  The fields, in the order they matter to the person filling the form.

  `kind` decides which control is drawn, and `hint` is the sentence that
  explains what the number actually does - a policy screen full of
  unlabelled durations is a policy screen people set wrong once and
  never touch again.
*/
const FIELDS = [
  {
    key: "shiftStartMinutes",
    label: "Shift starts",
    kind: "time",
    hint: "Arriving after this (plus the grace period) counts as late",
  },
  {
    key: "shiftEndMinutes",
    label: "Shift ends",
    kind: "time",
    hint: "A forgotten clock out is closed at this time, never later",
  },
  {
    key: "breakAllowanceMinutes",
    label: "Break allowance",
    kind: "minutes",
    hint: "Total paid break in one day, across every break taken",
    highlight: true,
  },
  {
    key: "maxSingleBreakMinutes",
    label: "Longest single break",
    kind: "minutes",
    hint: "Going over is recorded and flagged, never blocked",
  },
  {
    key: "maxBreaksPerDay",
    label: "Breaks per day",
    kind: "count",
    hint: "How many separate breaks somebody may start in one day",
  },
  {
    key: "fullDayMinutes",
    label: "A full day of work",
    kind: "minutes",
    hint: "Real work with breaks removed - usually less than the shift",
  },
  {
    key: "halfDayMinutes",
    label: "A half day",
    kind: "minutes",
    hint: "Below this, the day is recorded as a half day",
  },
  {
    key: "graceMinutes",
    label: "Grace period",
    kind: "minutes",
    hint: "Traffic. Arriving inside this is not late",
  },
  {
    key: "overtimeAfterMinutes",
    label: "Overtime starts after",
    kind: "minutes",
    hint: "Work beyond this is counted as overtime",
  },
];

/*
  @param isOpen
  @param onClose
  @param departmentId  null for the company-wide default
  @param departmentName
  @param onSaved       called after a successful save
*/
function WorkingPatternModal({
  isOpen,
  onClose,
  departmentId = null,
  departmentName = "",
  onSaved = null,
}) {
  const [answer, setAnswer] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const load = async () => {
      setLoading(true);

      try {
        const { data } = await api.get("/api/attendance/policy", {
          params: departmentId ? { department: departmentId } : {},
        });

        setAnswer(data);

        // only the editable fields, so the form never carries `source`
        const values = {};
        FIELDS.forEach((field) => {
          values[field.key] = data.policy[field.key];
        });
        values.autoCloseAtShiftEnd = data.policy.autoCloseAtShiftEnd;

        setForm(values);
      } catch (error) {
        toast.error(getErrorMessage(error));
        onClose();
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, departmentId]);

  const setField = (key, value) =>
    setForm((old) => ({ ...old, [key]: value }));

  /*
    THE SAME THREE CROSS-FIELD RULES THE SERVER KEEPS.

    Checked here so the answer arrives instantly, and there so it is
    actually enforced - describePolicyConflict() in
    backend/config/attendanceConstants.js is the copy that counts.
  */
  const conflict = (() => {
    if (form.shiftEndMinutes <= form.shiftStartMinutes) {
      return "The shift has to end after it starts";
    }

    if (form.halfDayMinutes >= form.fullDayMinutes) {
      return "A half day has to be shorter than a full day";
    }

    if (
      form.breakAllowanceMinutes > 0 &&
      form.maxSingleBreakMinutes > form.breakAllowanceMinutes
    ) {
      return "One break cannot be longer than the whole day's allowance";
    }

    if (form.fullDayMinutes > form.shiftEndMinutes - form.shiftStartMinutes) {
      return "A full day of work does not fit inside the shift";
    }

    return "";
  })();

  const handleSave = async () => {
    if (conflict) {
      toast.error(conflict);
      return;
    }

    setSaving(true);

    try {
      const { data } = await api.put("/api/attendance/policy", {
        department: departmentId || undefined,
        ...form,
      });

      toast.success(data.message);

      if (onSaved) {
        onSaved(data.policy);
      }

      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // put every field back to what the company default says
  const resetToCompany = () => {
    if (!answer?.companyPolicy) {
      return;
    }

    const values = {};
    FIELDS.forEach((field) => {
      values[field.key] = answer.companyPolicy[field.key];
    });
    values.autoCloseAtShiftEnd = answer.companyPolicy.autoCloseAtShiftEnd;

    setForm(values);
    toast.info("Filled in the company pattern - press Save to apply it");
  };

  const title = departmentId
    ? `Working pattern - ${departmentName}`
    : "Company working pattern";

  return (
    <Modal isOpen={isOpen} title={title} onClose={onClose} maxWidth="max-w-3xl">
      {loading ? (
        <div className="py-10 flex justify-center">
          <ClipLoader size={26} color="#4f46e5" />
        </div>
      ) : !answer?.canEdit ? (
        <p className="text-sm text-slate-600 py-4">
          You can see this working pattern but not change it. A department's
          pattern is set by its manager; the company-wide one needs the
          "Set Company Working Pattern" permission.
        </p>
      ) : (
        <>
          {/* ---------- where the numbers came from ---------- */}
          <div className="flex items-start gap-2.5 bg-sky-50 border border-sky-200 border-l-4 border-l-sky-500 text-sky-800 rounded-lg px-4 py-3 text-sm mb-5">
            <MdOutlineInfo size={18} className="shrink-0 mt-0.5 text-sky-600" />

            <div>
              {departmentId ? (
                answer.policy.hasDepartmentPolicy ? (
                  <span>
                    This department has its own pattern. Changing it affects
                    nobody else.
                  </span>
                ) : (
                  <span>
                    This department has <b>no pattern of its own</b> and is
                    following the company default. Saving here gives it one, and
                    it will stop following the company default from then on.
                  </span>
                )
              ) : (
                <span>
                  This is the pattern every department without one of its own
                  follows. Changing it moves all of them at once.
                </span>
              )}
            </div>
          </div>

          {/* ---------- the fields ---------- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {FIELDS.map((field) => {
              const differs =
                departmentId &&
                answer.companyPolicy &&
                form[field.key] !== answer.companyPolicy[field.key];

              return (
                <div
                  key={field.key}
                  className={
                    field.highlight
                      ? "sm:col-span-2 bg-amber-50/60 border border-amber-200 rounded-lg p-3 -mx-1"
                      : ""
                  }
                >
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                    {field.label}

                    {/* a quiet mark, not a colour change - the field is
                        not wrong, it is simply not the company's */}
                    {differs && (
                      <span
                        className="text-[10px] font-normal text-slate-400"
                        title={`the company default is ${
                          field.kind === "time"
                            ? minutesToClock(answer.companyPolicy[field.key])
                            : answer.companyPolicy[field.key]
                        }`}
                      >
                        (differs from company)
                      </span>
                    )}
                  </label>

                  <div className="flex items-center gap-2">
                    {field.kind === "time" ? (
                      <input
                        type="time"
                        value={minutesToClock(form[field.key])}
                        onChange={(event) => {
                          const minutes = clockToMinutes(event.target.value);

                          if (minutes !== null) {
                            setField(field.key, minutes);
                          }
                        }}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <>
                        <input
                          type="number"
                          min={0}
                          value={form[field.key]}
                          onChange={(event) =>
                            setField(field.key, Number(event.target.value))
                          }
                          className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />

                        {/*
                          The same number in hours, live, beside the box.
                          Typing "480" and seeing "8h" appear is what
                          stops somebody entering 48 and wondering why
                          everybody is suddenly working overtime.
                        */}
                        <span className="text-xs text-slate-500 tabular-nums w-16">
                          {field.kind === "minutes"
                            ? formatMinutes(form[field.key])
                            : "per day"}
                        </span>
                      </>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 mt-1">{field.hint}</p>
                </div>
              );
            })}
          </div>

          {/* ---------- the forgotten clock out ---------- */}
          <label className="flex items-start gap-3 mt-5 pt-5 border-t border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(form.autoCloseAtShiftEnd)}
              onChange={(event) =>
                setField("autoCloseAtShiftEnd", event.target.checked)
              }
              className="mt-0.5 w-4 h-4 accent-indigo-600"
            />

            <span>
              <span className="text-sm font-medium text-slate-700">
                Close a forgotten day at the end of the shift
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">
                People close the laptop and go home. With this on, a day left
                open is closed at the shift end and clearly marked as the
                system's guess. With it off, the day stays open for a manager to
                correct by hand.
              </span>
            </span>
          </label>

          {/* ---------- what is wrong, if anything ---------- */}
          {conflict && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {conflict}
            </p>
          )}

          {/* ---------- the buttons ---------- */}
          <div className="flex flex-wrap items-center justify-end gap-3 mt-6 pt-5 border-t border-slate-200">
            {departmentId && (
              <button
                type="button"
                onClick={resetToCompany}
                className="mr-auto flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                <MdOutlineRestartAlt size={16} />
                Fill in the company pattern
              </button>
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
              disabled={saving || Boolean(conflict)}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Save pattern"}
            </button>
          </div>

          {/*
            WHAT SAVING DOES NOT DO, said out loud.

            Every attendance record freezes the policy it was judged by,
            so changing the pattern today cannot rewrite what last month
            meant - see appliedPolicy in
            backend/model/attendanceModel.js. A manager about to press
            Save deserves to know that before they wonder about it
            afterwards.
          */}
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            This applies from now on. Attendance already recorded keeps the
            pattern it was measured against, so past days and past reports do
            not change.
          </p>
        </>
      )}
    </Modal>
  );
}

export default WorkingPatternModal;
