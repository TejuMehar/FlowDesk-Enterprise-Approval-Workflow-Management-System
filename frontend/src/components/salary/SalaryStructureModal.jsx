/*
=========================================================================
  COMPONENT: SalaryStructureModal  (Module 12 - Payroll & Salary)
=========================================================================
  The form behind "set what this person earns".

  THE COMPONENT LIST COMES FROM THE SERVER, not from a list typed in
  here (GET /api/salary/options). A component added to
  backend/config/salaryConstants.js has to appear on this form without a
  frontend release - the same reason the Requests page downloads its
  request types instead of holding a copy of them.

  THE TOTALS ARE WORKED OUT WHILE YOU TYPE, and that is the one piece of
  real work this form does. Payroll enters six numbers and needs to see
  the seventh - the net pay, which is what the employee will actually
  receive - before pressing Save, not on the payslip a month later.

  THE BANK BOX ASKS FOR FOUR DIGITS AND THE BACKEND REFUSES ANYTHING
  ELSE. FlowDesk does not move money, so a full account number would be
  a stored credential in exchange for nothing - see the note on the
  field in backend/model/salaryStructureModel.js.
=========================================================================
*/

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";

import Modal from "../Modal.jsx";
import { api, getErrorMessage } from "../../utils/api.js";
import { formatMoney } from "../../utils/salaryConstants.js";

/*
  @param employee   { _id, name, employeeId, designation, departmentName }
  @param structure  the existing one, or null for a first-time setup
  @param components { earnings: [{key,label}], deductions: [...] }
  @param onSaved    called with the saved structure
*/
function SalaryStructureModal({
  isOpen,
  employee,
  structure,
  components,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const earningComponents = components?.earnings || [];
  const deductionComponents = components?.deductions || [];

  /*
    The form is rebuilt whenever a different employee is opened.

    Every amount is held as TEXT, not as a number, so a half-typed
    "1200" is not turned into 1200 and back into "1200" under the
    cursor - and an emptied box stays empty instead of snapping to 0,
    which is the single most annoying thing a numeric form can do.
  */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const amounts = {};

    earningComponents.forEach((component) => {
      const line = structure?.earnings?.find((entry) => entry.key === component.key);

      amounts[`e_${component.key}`] = line?.amount ? String(line.amount) : "";
    });

    deductionComponents.forEach((component) => {
      const line = structure?.deductions?.find((entry) => entry.key === component.key);

      amounts[`d_${component.key}`] = line?.amount ? String(line.amount) : "";
    });

    setForm({
      ...amounts,
      bankName: structure?.bankName || "",
      accountLast4: structure?.accountLast4 || "",
      pan: structure?.pan || "",
      pfNumber: structure?.pfNumber || "",
      uan: structure?.uan || "",
      effectiveFrom: structure?.effectiveFrom || "",
      notes: structure?.notes || "",
      isActive: structure ? structure.isActive : true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, employee?._id, structure]);

  const change = (field, value) =>
    setForm((old) => ({ ...old, [field]: value }));

  /* ---------------- the running totals ---------------- */
  const totals = useMemo(() => {
    const sum = (prefix, list) =>
      list.reduce((total, component) => {
        const value = Number(form[`${prefix}_${component.key}`]);

        return total + (Number.isFinite(value) ? value : 0);
      }, 0);

    const gross = sum("e", earningComponents);
    const deducted = sum("d", deductionComponents);

    return { gross, deducted, net: gross - deducted };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, earningComponents, deductionComponents]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setSaving(true);

    try {
      const readAmounts = (prefix, list) =>
        list.reduce((amounts, component) => {
          const value = Number(form[`${prefix}_${component.key}`]);

          return { ...amounts, [component.key]: Number.isFinite(value) ? value : 0 };
        }, {});

      const { data } = await api.put(`/api/salary/structure/${employee._id}`, {
        earnings: readAmounts("e", earningComponents),
        deductions: readAmounts("d", deductionComponents),
        bankName: form.bankName,
        accountLast4: form.accountLast4,
        pan: form.pan,
        pfNumber: form.pfNumber,
        uan: form.uan,
        effectiveFrom: form.effectiveFrom,
        notes: form.notes,
        isActive: form.isActive,
      });

      toast.success(data.message);
      onSaved(data.structure);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-3xl"
      title={structure ? `Edit salary - ${employee?.name}` : `Set salary - ${employee?.name}`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <p className="text-xs text-slate-500">
          {employee?.employeeId}
          {employee?.designation ? ` · ${employee.designation}` : ""}
          {employee?.departmentName ? ` · ${employee.departmentName}` : ""}
          <span className="block mt-1">
            Every amount is a MONTHLY amount. The annual CTC is worked out from
            it.
          </span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ---------------- earnings ---------------- */}
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Earnings
            </legend>

            <div className="flex flex-col gap-3">
              {earningComponents.map((component) => (
                <AmountField
                  key={component.key}
                  label={component.label}
                  required={component.required}
                  value={form[`e_${component.key}`] || ""}
                  onChange={(value) => change(`e_${component.key}`, value)}
                />
              ))}
            </div>
          </fieldset>

          {/* ---------------- deductions ---------------- */}
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-rose-700">
              Deductions
            </legend>

            <div className="flex flex-col gap-3">
              {deductionComponents.map((component) => (
                <AmountField
                  key={component.key}
                  label={component.label}
                  value={form[`d_${component.key}`] || ""}
                  onChange={(value) => change(`d_${component.key}`, value)}
                />
              ))}
            </div>
          </fieldset>
        </div>

        {/* ---------------- the running total ---------------- */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <Total label="Monthly gross" value={totals.gross} />
          <Total label="Deductions" value={totals.deducted} />
          <Total label="Monthly net" value={totals.net} strong />
          <Total label="Annual CTC" value={totals.gross * 12} />
        </div>

        {/*
          The one warning this form draws itself rather than waiting for
          the server: deductions bigger than the earnings is always a
          typo (an annual figure in a monthly box), and finding out
          after pressing Save is finding out too late.
        */}
        {totals.net <= 0 && totals.gross > 0 && (
          <p className="text-sm text-red-600">
            The deductions add up to more than the earnings. Check the amounts.
          </p>
        )}

        {/* ---------------- the rest ---------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField
            label="Bank"
            value={form.bankName || ""}
            onChange={(value) => change("bankName", value)}
            placeholder="HDFC Bank"
          />

          <TextField
            label="Account (last 4 digits)"
            value={form.accountLast4 || ""}
            onChange={(value) => change("accountLast4", value.replace(/\D/g, "").slice(0, 4))}
            placeholder="4821"
            hint="Only the last four - never the full number"
          />

          <TextField
            label="PAN"
            value={form.pan || ""}
            onChange={(value) => change("pan", value.toUpperCase().slice(0, 10))}
            placeholder="ABCDE1234F"
          />

          <TextField
            label="UAN"
            value={form.uan || ""}
            onChange={(value) => change("uan", value)}
          />

          <TextField
            label="PF number"
            value={form.pfNumber || ""}
            onChange={(value) => change("pfNumber", value)}
          />

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Effective from
            </label>
            <input
              type="month"
              value={form.effectiveFrom || ""}
              onChange={(event) => change("effectiveFrom", event.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Payroll will not use this pay for a month before it.
            </p>
          </div>
        </div>

        <TextField
          label="Notes"
          value={form.notes || ""}
          onChange={(value) => change("notes", value)}
          placeholder="Why this was changed - visible to payroll only"
        />

        {/*
          "On hold" rather than a delete. Somebody on unpaid leave is
          skipped by the run and keeps every payslip they have ever had.
        */}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={form.isActive !== false}
            onChange={(event) => change("isActive", event.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Include this employee in payroll runs
        </label>

        <div className="flex justify-end gap-2 pt-1 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saving && <ClipLoader size={14} color="#ffffff" />}
            {structure ? "Save changes" : "Set salary"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* one money box */
function AmountField({ label, value, onChange, required = false }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>

      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        className="w-32 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-right tabular-nums text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder = "", hint = "" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Total({ label, value, strong = false }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p
        className={`tabular-nums ${
          strong ? "text-lg font-semibold text-slate-800" : "text-sm text-slate-700"
        }`}
      >
        {formatMoney(value)}
      </p>
    </div>
  );
}

export default SalaryStructureModal;
