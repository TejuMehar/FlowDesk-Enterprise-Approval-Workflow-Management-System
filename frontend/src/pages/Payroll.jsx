/*
=========================================================================
  PAGE: Payroll                   (Module 12 - Payroll & Salary)
=========================================================================
  The finance side of the module: run a month, check it, release it,
  record that the money went out - and set what people earn.

  IT IS GATED ON salary:read-all, and nothing else. The three write
  permissions (structure / process / export) decide which BUTTONS are
  drawn, not whether the page opens - the same shape the Audit Logs and
  Reports pages already have, and the backend checks every one of them
  again anyway.

  THE TWO TABS ARE THE TWO HALVES OF THE JOB
  ------------------------------------------
    Payroll run  one month: generate the drafts, check them, publish,
                 then mark each one paid as the transfers go out
    Salaries     what each employee earns, standing - including the
                 people who have none yet, which is the question this
                 tab is really opened to answer

  WHY GENERATE AND PUBLISH ARE TWO BUTTONS
  ----------------------------------------
  Generating writes DRAFTS that only this page can see. Publishing is
  what three hundred employees find out about. One button that did both
  would remove the only chance anybody has to check a number before it
  becomes somebody's payslip - see the payslip life cycle in
  backend/config/salaryConstants.js.
=========================================================================
*/

import { useCallback, useEffect, useState } from "react";
import { ClipLoader } from "react-spinners";
import { toast } from "react-toastify";
import {
  MdOutlinePlayArrow,
  MdOutlineSend,
  MdOutlineFileDownload,
  MdOutlineWarningAmber,
  MdOutlineEdit,
  MdOutlinePayments,
  MdOutlineCancel,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { downloadFile, stampedFileName } from "../utils/download.js";
import {
  formatMoney,
  formatMoneyShort,
  formatMonthLong,
  payslipStatusStyle,
  EXPORT_FORMATS,
  SALARY_REPORTS,
} from "../utils/salaryConstants.js";

import ConfirmDialog from "../components/ConfirmDialog.jsx";
import PayslipModal from "../components/salary/PayslipModal.jsx";
import SalaryStructureModal from "../components/salary/SalaryStructureModal.jsx";

function Payroll() {
  const [options, setOptions] = useState(null);
  const [tab, setTab] = useState("run");

  /* ---------------- the payroll run tab ---------------- */
  const [month, setMonth] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [payroll, setPayroll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null);

  /* ---------------- the salaries tab ---------------- */
  const [structures, setStructures] = useState(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);

  /* =====================================================================
     WHAT CAN I ASK FOR?
     ---------------------------------------------------------------------
     One call on arrival: the months, the departments, the components
     and the "may I draw this button" answers. The permission flags are
     data from the server rather than something worked out from the
     user's role here, so the page and the routes cannot disagree.
     ===================================================================== */
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get("/api/salary/options");

        setOptions(data);

        // the newest FINISHED month - the one payroll is about to run
        setMonth(data.months[0]?.key || "");
      } catch (error) {
        toast.error(getErrorMessage(error));
        setLoading(false);
      }
    };

    load();
  }, []);

  const loadPayroll = useCallback(async () => {
    if (!month) {
      return;
    }

    setLoading(true);

    try {
      const { data } = await api.get("/api/salary/payroll", {
        params: { month, departmentId: departmentId || undefined },
      });

      setPayroll(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [month, departmentId]);

  useEffect(() => {
    if (tab === "run") {
      loadPayroll();
    }
  }, [tab, loadPayroll]);

  const loadStructures = useCallback(async () => {
    setLoading(true);

    try {
      const { data } = await api.get("/api/salary/structure", {
        params: { search: search || undefined, departmentId: departmentId || undefined },
      });

      setStructures(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [search, departmentId]);

  useEffect(() => {
    if (tab !== "salaries") {
      return undefined;
    }

    /*
      The search box is debounced, like every list page in FlowDesk -
      a request per keystroke over a company's payroll is a request per
      keystroke too many.
    */
    const timer = setTimeout(loadStructures, 350);

    return () => clearTimeout(timer);
  }, [tab, loadStructures]);

  /* =====================================================================
     THE FOUR PAYROLL ACTIONS
     ---------------------------------------------------------------------
     All four end with a reload rather than patching the row in place:
     a run changes the summary, the missing-structure list and every
     status at once, and a page that half updated after payroll ran is
     a page nobody trusts.
     ===================================================================== */
  const runAction = async (call, successKey = "message") => {
    setBusy(true);

    try {
      const { data } = await call();

      toast.success(data[successKey]);

      /*
        The skipped list is the useful half of a run's answer -
        "3 payslips generated" with no word about the 2 employees who
        were left out is how somebody gets missed on payday.
      */
      if (data.skipped?.length > 0) {
        toast.warn(
          `Skipped ${data.skipped.length}: ${data.skipped
            .slice(0, 3)
            .map((entry) => `${entry.name} (${entry.reason})`)
            .join(", ")}${data.skipped.length > 3 ? "..." : ""}`
        );
      }

      await loadPayroll();

      return data;
    } catch (error) {
      toast.error(getErrorMessage(error));
      return null;
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const handleGenerate = () =>
    runAction(() =>
      api.post(`/api/salary/payroll/${month}/generate`, {
        departmentId: departmentId || undefined,
      })
    );

  const handlePublish = () =>
    runAction(() => api.post(`/api/salary/payroll/${month}/publish`));

  const handleExport = async (reportType, format) => {
    const meta = EXPORT_FORMATS.find((entry) => entry.key === format);

    try {
      await downloadFile(
        `/api/salary/export/${reportType}?format=${format}&month=${month}${
          departmentId ? `&departmentId=${departmentId}` : ""
        }`,
        stampedFileName(["salary", reportType, month], meta.extension)
      );

      toast.success("Export downloaded");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const can = options?.can || {};
  const summary = payroll?.summary;

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== heading ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">Payroll</h1>
          <p className="text-sm text-slate-500">
            Run a month, check it, release it to employees, and record the
            payments.
          </p>
        </div>

        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {[
            { key: "run", label: "Payroll run" },
            { key: "salaries", label: "Salaries" },
          ].map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              aria-pressed={tab === entry.key}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === entry.key
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== the filter bar ==================== */}
      <div className="bg-white rounded-lg border border-slate-300 p-4 flex flex-wrap items-end gap-4">
        {tab === "run" && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Payroll month
            </label>
            <select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(options?.months || []).map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
            {/*
              The current month is deliberately not in the list: it
              cannot be paid until it has finished, and offering a
              choice whose button always says no teaches people the
              application is broken.
            */}
          </div>
        )}

        {tab === "salaries" && (
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, employee ID or designation"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {(options?.departments || []).length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Department
            </label>
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Every department</option>
              {options.departments.map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === "run" && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {can.process && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: `Generate payroll for ${formatMonthLong(month)}?`,
                      message:
                        "This creates a DRAFT payslip for every employee with a salary structure. Nobody is told anything yet - you publish when the numbers are right.",
                      confirmText: "Generate drafts",
                      onConfirm: handleGenerate,
                    })
                  }
                  disabled={busy}
                  className="px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
                >
                  <MdOutlinePlayArrow size={17} />
                  Generate
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: `Publish ${formatMonthLong(month)}?`,
                      message: `${
                        summary?.byStatus?.Draft || 0
                      } draft payslip(s) will become visible to the employees, and everybody will be notified. The numbers can no longer be changed afterwards.`,
                      confirmText: "Publish to employees",
                      onConfirm: handlePublish,
                    })
                  }
                  disabled={busy || !summary?.byStatus?.Draft}
                  className="px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5"
                >
                  <MdOutlineSend size={16} />
                  Publish
                </button>
              </>
            )}

            {can.export && (
              <ExportMenu onExport={handleExport} disabled={!summary?.generated} />
            )}
          </div>
        )}
      </div>

      {/* ==================== the run ==================== */}
      {loading ? (
        <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
          <ClipLoader size={28} color="#4f46e5" />
        </div>
      ) : tab === "run" ? (
        <RunTab
          payroll={payroll}
          can={can}
          onOpen={setSelected}
          onFixSalaries={() => setTab("salaries")}
        />
      ) : (
        <SalariesTab
          structures={structures}
          can={can}
          onEdit={(row) => setEditing(row)}
        />
      )}

      {/* ==================== the pop-ups ==================== */}
      <PayslipModal
        isOpen={Boolean(selected)}
        payslip={selected}
        showEmployee
        onClose={() => setSelected(null)}
        footer={
          can.process && selected ? (
            <PayslipActions
              payslip={selected}
              onDone={async () => {
                setSelected(null);
                await loadPayroll();
              }}
            />
          ) : null
        }
      />

      {editing && (
        <SalaryStructureModal
          isOpen={Boolean(editing)}
          employee={editing.user}
          structure={editing.structure}
          components={options?.components}
          onClose={() => setEditing(null)}
          onSaved={() => loadStructures()}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        loading={busy}
        onConfirm={() => confirm?.onConfirm?.()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* =====================================================================
   THE PAYROLL RUN TAB
   ===================================================================== */
function RunTab({ payroll, can, onOpen, onFixSalaries }) {
  if (!payroll) {
    return null;
  }

  const { summary } = payroll;

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------- the five numbers ---------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card
          label="Employees"
          value={summary.employees}
          hint={`${payroll.workingDays} working days`}
        />
        <Card
          label="Payslips"
          value={`${summary.generated}/${summary.employees}`}
          tone={summary.generated < summary.employees ? "warn" : "good"}
        />
        <Card label="Gross" value={formatMoneyShort(summary.gross)} />
        <Card label="Deductions" value={formatMoneyShort(summary.deductions)} />
        <Card label="Net payout" value={formatMoneyShort(summary.net)} tone="indigo" />
      </div>

      {/*
        WHO IS MISSING, BY NAME.

        "3 employees have no salary structure" is a number somebody has
        to go and investigate; three names are something they can fix
        in two minutes - and this is the sentence that stops somebody
        being missed on payday.
      */}
      {payroll.missingStructureCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <MdOutlineWarningAmber size={17} />
            {payroll.missingStructureCount} employee
            {payroll.missingStructureCount === 1 ? " has" : "s have"} no salary
            structure, so every run skips them.
          </p>

          <p className="text-xs text-amber-700 mt-1">
            {payroll.missingStructure.map((person) => person.name).join(", ")}
            {payroll.missingStructureCount > payroll.missingStructure.length && ", ..."}
          </p>

          {can.structure && (
            <button
              type="button"
              onClick={onFixSalaries}
              className="mt-2 text-xs font-medium text-amber-900 underline underline-offset-2"
            >
              Set their salaries
            </button>
          )}
        </div>
      )}

      {/* ---------------- the payslips ---------------- */}
      {payroll.payslips.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-300 p-10 text-center">
          <p className="text-sm text-slate-500">
            {payroll.monthLabel} has not been generated yet.
          </p>
          {can.process && (
            <p className="text-xs text-slate-400 mt-1">
              Press Generate to build the draft payslips.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Paid days</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Deductions</th>
                  <th className="px-4 py-3 text-right">Net pay</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {payroll.payslips.map((payslip) => {
                  const status = payslipStatusStyle(payslip.status);

                  return (
                    <tr
                      key={payslip._id}
                      onClick={() => onOpen(payslip)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-700">
                          {payslip.employeeName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {payslip.employeeCode}
                        </p>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {payslip.departmentName || "-"}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {payslip.payableDays}
                        <span className="text-slate-400">/{payslip.workingDays}</span>
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(payslip.grossEarnings, { withSymbol: false })}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(payslip.totalDeductions, { withSymbol: false })}
                      </td>

                      <td
                        className={`px-4 py-3 text-right tabular-nums font-semibold ${
                          payslip.status === "Cancelled"
                            ? "line-through text-slate-400"
                            : "text-slate-800"
                        }`}
                      >
                        {formatMoney(payslip.netPay, { withSymbol: false })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   THE SALARIES TAB
   ---------------------------------------------------------------------
   One row per EMPLOYEE, including the ones with no structure - the
   whole reason this is a list of employees rather than a list of
   structures. A screen showing only what exists is a screen on which a
   new joiner is invisible until somebody remembers them.
   ===================================================================== */
function SalariesTab({ structures, can, onEdit }) {
  if (!structures) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
      {structures.withoutStructure > 0 && (
        <p className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          {structures.withoutStructure} of {structures.total} employees have no
          salary set. They are skipped by every payroll run until they do.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3 text-right">Monthly gross</th>
              <th className="px-4 py-3 text-right">Monthly net</th>
              <th className="px-4 py-3 text-right">Annual CTC</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {structures.rows.map((row) => (
              <tr key={row.user._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-700">{row.user.name}</p>
                  <p className="text-xs text-slate-400">
                    {row.user.employeeId}
                    {row.user.designation ? ` · ${row.user.designation}` : ""}
                  </p>
                </td>

                <td className="px-4 py-3 text-slate-600">
                  {row.user.departmentName || "-"}
                </td>

                {row.structure ? (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(row.structure.grossEarnings, { withSymbol: false })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                      {formatMoney(row.structure.netPay, { withSymbol: false })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {formatMoneyShort(row.structure.annualCtc)}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-4 py-3 text-right">
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      No salary set
                    </span>
                  </td>
                )}

                <td className="px-4 py-3 text-right">
                  {can.structure && (
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      className="px-2.5 py-1.5 rounded-lg text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1.5"
                    >
                      <MdOutlineEdit size={14} />
                      {row.structure ? "Edit" : "Set"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {structures.rows.length === 0 && (
        <p className="p-10 text-center text-sm text-slate-500">
          Nobody matched that search.
        </p>
      )}
    </div>
  );
}

/* =====================================================================
   THE THREE THINGS PAYROLL CAN DO TO ONE PAYSLIP
   ---------------------------------------------------------------------
   Drawn inside the payslip pop-up, under the breakdown, because that is
   where somebody is standing when they decide to do any of them.

   WHICH ONES APPEAR DEPENDS ON THE STATE, and the states are the
   reason: a draft can be adjusted, a published slip can be paid, and
   only an unpaid one can be cancelled. The backend refuses the rest -
   this only avoids offering a button that would say no.
   ===================================================================== */
function PayslipActions({ payslip, onDone }) {
  const [mode, setMode] = useState(null); // "adjust" | "pay" | "cancel"
  const [busy, setBusy] = useState(false);

  const [lopDays, setLopDays] = useState(String(payslip.lopDays ?? 0));
  const [bonus, setBonus] = useState("");
  const [remarks, setRemarks] = useState(payslip.remarks || "");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const send = async (call) => {
    setBusy(true);

    try {
      const { data } = await call();

      toast.success(data.message);
      await onDone();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {payslip.status === "Draft" && (
          <ActionButton
            icon={<MdOutlineEdit size={15} />}
            label="Adjust"
            active={mode === "adjust"}
            onClick={() => setMode(mode === "adjust" ? null : "adjust")}
          />
        )}

        {payslip.status === "Published" && (
          <ActionButton
            icon={<MdOutlinePayments size={15} />}
            label="Mark paid"
            active={mode === "pay"}
            onClick={() => setMode(mode === "pay" ? null : "pay")}
          />
        )}

        {payslip.status !== "Paid" && payslip.status !== "Cancelled" && (
          <ActionButton
            icon={<MdOutlineCancel size={15} />}
            label="Cancel payslip"
            danger
            active={mode === "cancel"}
            onClick={() => setMode(mode === "cancel" ? null : "cancel")}
          />
        )}
      </div>

      {/* ---------------- adjust a draft ---------------- */}
      {mode === "adjust" && (
        <div className="flex flex-wrap items-end gap-3">
          <SmallField
            label="Unpaid days"
            type="number"
            value={lopDays}
            onChange={setLopDays}
            hint="Attendance proposed this - correct it for approved leave"
          />
          <SmallField label="Bonus" type="number" value={bonus} onChange={setBonus} />
          <SmallField
            label="Remark on the slip"
            value={remarks}
            onChange={setRemarks}
            wide
          />

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              send(() =>
                api.patch(`/api/salary/payslip/${payslip._id}`, {
                  lopDays: Number(lopDays),
                  bonus: bonus === "" ? undefined : Number(bonus),
                  remarks,
                })
              )
            }
            className="px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}

      {/* ---------------- record the transfer ---------------- */}
      {mode === "pay" && (
        <div className="flex flex-wrap items-end gap-3">
          <SmallField label="Paid on" type="date" value={paidOn} onChange={setPaidOn} />
          <SmallField
            label="Transfer reference"
            value={reference}
            onChange={setReference}
            wide
          />

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              send(() =>
                api.post(`/api/salary/payslip/${payslip._id}/pay`, {
                  paidOn,
                  paymentReference: reference,
                })
              )
            }
            className="px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          >
            Mark paid
          </button>
        </div>
      )}

      {/* ---------------- withdraw it ---------------- */}
      {mode === "cancel" && (
        <div className="flex flex-wrap items-end gap-3">
          <SmallField
            label="Why (the employee will read this)"
            value={reason}
            onChange={setReason}
            wide
          />

          <button
            type="button"
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              send(() =>
                api.post(`/api/salary/payslip/${payslip._id}/cancel`, { reason })
              )
            }
            className="px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
          >
            Cancel payslip
          </button>
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   SMALL PIECES
   ===================================================================== */

function ExportMenu({ onExport, disabled }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
      >
        <MdOutlineFileDownload size={17} />
        Export
      </button>

      {open && (
        <>
          {/* clicking anywhere else shuts it, the way a menu should */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute right-0 mt-1 z-20 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {SALARY_REPORTS.map((report) => (
              <div key={report.key} className="px-3 py-1.5">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                  {report.label}
                </p>

                <div className="flex gap-1">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.key}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onExport(report.key, format.key);
                      }}
                      className="flex-1 px-2 py-1 rounded text-xs text-slate-600 border border-slate-200 hover:bg-slate-50"
                    >
                      {format.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, hint, tone = "slate" }) {
  const ring =
    tone === "indigo"
      ? "border-indigo-200 bg-indigo-50"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50"
      : tone === "good"
      ? "border-emerald-200 bg-emerald-50"
      : "border-slate-300 bg-white";

  return (
    <div className={`rounded-lg border px-4 py-3 ${ring}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function ActionButton({ icon, label, onClick, active, danger = false }) {
  const base = danger
    ? "border-red-200 text-red-600 hover:bg-red-50"
    : "border-slate-300 text-slate-600 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 ${base} ${
        active ? "ring-2 ring-offset-1 ring-slate-200" : ""
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SmallField({ label, value, onChange, type = "text", hint = "", wide = false }) {
  return (
    <div className={wide ? "flex-1 min-w-[200px]" : ""}>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
          wide ? "w-full" : "w-32"
        }`}
      />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default Payroll;
