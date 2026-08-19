/*
=========================================================================
  COMPONENT: PayslipBreakdown     (Module 12 - Payroll & Salary)
=========================================================================
  One payslip, opened up: the earnings on the left, the deductions on
  the right, and the net pay underneath.

  IT IS THE SAME LAYOUT AS THE PDF RECEIPT, on purpose. An employee who
  checks the breakdown on screen and then downloads the file must not
  have to find their way around a second time - and if the two ever
  disagree, the difference has to be obvious rather than hidden by two
  different arrangements of the same numbers.

  THE COMPONENT IS SHARED between the employee's own page and the
  payroll screen, so finance is always looking at exactly what the
  employee will see. A "finance view" of a payslip that showed
  something different is how a payroll query becomes an argument.
=========================================================================
*/

import {
  MdOutlineArrowUpward,
  MdOutlineArrowDownward,
  MdOutlineInfo,
} from "react-icons/md";

import { formatMoney, formatMonthLong, payslipStatusStyle } from "../../utils/salaryConstants.js";
import { formatDate } from "../../utils/config.js";

function PayslipBreakdown({ payslip, showEmployee = false }) {
  if (!payslip) {
    return null;
  }

  const status = payslipStatusStyle(payslip.status);

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== who and when ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">
            Payslip for
          </p>
          <p className="text-lg font-semibold text-slate-800">
            {formatMonthLong(payslip.monthKey)}
          </p>

          {showEmployee && (
            <p className="text-sm text-slate-500 mt-0.5">
              {payslip.employeeName}
              {payslip.employeeCode ? ` · ${payslip.employeeCode}` : ""}
              {payslip.departmentName ? ` · ${payslip.departmentName}` : ""}
            </p>
          )}
        </div>

        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      {/* ==================== the days it was paid for ====================
          The arithmetic, not just its result. An employee whose pay is
          short by a day is owed the working out. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DayFact label="Working days" value={payslip.workingDays} />
        <DayFact label="Days present" value={payslip.presentDays} />
        <DayFact
          label="Unpaid days"
          value={payslip.lopDays}
          tone={payslip.lopDays > 0 ? "warn" : "normal"}
        />
        <DayFact label="Paid days" value={payslip.payableDays} tone="good" />
      </div>

      {/* ==================== the two columns ==================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LineColumn
          title="Earnings"
          icon={<MdOutlineArrowUpward size={14} />}
          tone="emerald"
          lines={payslip.earnings}
          total={payslip.grossEarnings}
          totalLabel="Gross earnings"
        />

        <LineColumn
          title="Deductions"
          icon={<MdOutlineArrowDownward size={14} />}
          tone="rose"
          lines={payslip.deductions}
          total={payslip.totalDeductions}
          totalLabel="Total deductions"
        />
      </div>

      {/* ==================== the net pay ====================
          The one number the whole page exists for, so it gets a block
          of its own - the same decision the PDF makes. */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-indigo-500">Net pay</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {formatMoney(payslip.netPay)}
          </p>
        </div>

        <div className="text-right text-xs text-slate-500">
          {payslip.bankName || payslip.accountLast4 ? (
            <p>
              {payslip.bankName || "Account"}
              {payslip.accountLast4 ? ` ****${payslip.accountLast4}` : ""}
            </p>
          ) : null}

          {payslip.paidOn && <p>Paid on {formatDate(payslip.paidOn)}</p>}

          {payslip.paymentReference && (
            <p className="text-slate-400">Ref {payslip.paymentReference}</p>
          )}
        </div>
      </div>

      {/* ==================== anything the employee has to be told ====================
          A cancelled payslip says so HERE, loudly, with the reason. By
          the time one is cancelled the employee has usually already
          seen it, and a withdrawal with no explanation is the worst
          thing this module can show anybody. */}
      {payslip.status === "Cancelled" && (
        <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <MdOutlineInfo size={16} className="shrink-0 mt-0.5" />
          <span>
            This payslip was cancelled
            {payslip.cancellationReason ? `: ${payslip.cancellationReason}` : "."}
          </span>
        </p>
      )}

      {payslip.remarks && (
        <p className="text-sm text-slate-500 border-l-2 border-slate-200 pl-3">
          {payslip.remarks}
        </p>
      )}
    </div>
  );
}

/* one of the four day counts */
function DayFact({ label, value, tone = "normal" }) {
  const colour =
    tone === "warn"
      ? "text-amber-600"
      : tone === "good"
      ? "text-emerald-600"
      : "text-slate-800";

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${colour}`}>{value ?? "-"}</p>
    </div>
  );
}

/* one column of lines, with its own subtotal */
function LineColumn({ title, icon, tone, lines = [], total, totalLabel }) {
  const head =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div
        className={`flex items-center gap-2 px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider ${head}`}
      >
        {icon}
        {title}
      </div>

      <div className="divide-y divide-slate-100">
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-400">Nothing on this side.</p>
        ) : (
          lines.map((line) => (
            <div
              key={line.key}
              className="px-4 py-2 flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-slate-600">{line.label}</span>
              <span className="text-slate-800 tabular-nums">
                {formatMoney(line.amount, { withSymbol: false })}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {totalLabel}
        </span>
        <span className="text-sm font-semibold text-slate-800 tabular-nums">
          {formatMoney(total)}
        </span>
      </div>
    </div>
  );
}

export default PayslipBreakdown;
