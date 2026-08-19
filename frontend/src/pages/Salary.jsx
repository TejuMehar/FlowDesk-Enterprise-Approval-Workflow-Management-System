/*
=========================================================================
  PAGE: Salary                    (Module 12 - Payroll & Salary)
=========================================================================
  "My salary" - what the employee earns, every payslip the company has
  ever issued them, and the receipt for each one.

  IT NEEDS NO PERMISSION, in App.jsx or in the backend. Your own pay is
  your own paperwork - the fifth time FlowDesk has made that call, after
  notifications, search, the request activity timeline and clocking in.
  Every request this page makes reads req.userId, so it can only ever
  show the person who is logged in.

  THE PAGE IS THREE ANSWERS, IN THE ORDER PEOPLE ASK THEM
  -------------------------------------------------------
    1. what am I on?          the standing salary structure
    2. what did I just get?   the latest payslip, opened up
    3. what have I had?       the history, with a receipt on every row

  WHY THE LATEST PAYSLIP IS EXPANDED AND THE REST ARE ROWS
  --------------------------------------------------------
  Because the reason anybody opens this page on the 1st of the month is
  the payslip that has just arrived. Making them find it in a table and
  click it would be making them work for the only thing they came for;
  everything older is a record, and a record is a list.

  WHAT AN EMPLOYEE NEVER SEES HERE IS A DRAFT. The backend filters them
  out of every route this page calls - a draft is payroll's working copy
  of a number that is still being checked.
=========================================================================
*/

import { useCallback, useEffect, useState } from "react";
import { ClipLoader } from "react-spinners";
import { toast } from "react-toastify";
import {
  MdOutlinePayments,
  MdOutlineFileDownload,
  MdOutlineReceiptLong,
  MdOutlineInfo,
  MdOutlineAccountBalanceWallet,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { downloadFile } from "../utils/download.js";
import {
  formatMoney,
  formatMonthLong,
  payslipStatusStyle,
  payslipFileName,
} from "../utils/salaryConstants.js";

import PayslipBreakdown from "../components/salary/PayslipBreakdown.jsx";
import PayslipModal from "../components/salary/PayslipModal.jsx";

function Salary() {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);

  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(true);

  // the payslip open in the pop-up, or null
  const [selected, setSelected] = useState(null);

  // the id of the row whose receipt is being fetched, so only IT spins
  const [downloadingId, setDownloadingId] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/api/salary/me");

      setSummary(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);

    try {
      const { data } = await api.get("/api/salary/me/payslips", {
        params: year ? { year } : {},
      });

      setHistory(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /*
    The receipt, fetched through the shared axios instance rather than
    opened as a link - see the note at the top of utils/download.js.
  */
  const handleDownload = async (payslip) => {
    setDownloadingId(payslip._id);

    try {
      await downloadFile(
        `/api/salary/payslip/${payslip._id}/receipt`,
        payslipFileName(payslip)
      );

      toast.success("Payslip downloaded");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const structure = summary?.structure;
  const latest = summary?.latestPayslip;
  const yearToDate = summary?.yearToDate;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">My Salary</h1>
        <p className="text-sm text-slate-500">
          What you earn, every payslip the company has issued you, and a receipt
          for each one.
        </p>
      </div>

      {/* ==================== what am I on? ==================== */}
      {structure ? (
        <div className="bg-white rounded-lg border border-slate-300 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <MdOutlineAccountBalanceWallet size={20} />
              </span>

              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  Monthly gross
                </p>
                <p className="text-xl font-semibold text-slate-800 tabular-nums">
                  {formatMoney(structure.grossEarnings)}
                </p>
              </div>
            </div>

            <Fact label="Deductions" value={formatMoney(structure.totalDeductions)} />
            <Fact label="Monthly net" value={formatMoney(structure.netPay)} strong />
            <Fact label="Annual CTC" value={formatMoney(structure.annualCtc)} />

            {structure.effectiveFromLabel && (
              <Fact label="Effective from" value={structure.effectiveFromLabel} />
            )}
          </div>

          {/*
            The components, listed flat. An employee has an absolute
            right to see WHAT their salary is made of and not only its
            total - the same stance the Attendance page takes on showing
            somebody the working pattern they are judged against.
          */}
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2">
            {[...structure.earnings, ...structure.deductions]
              .filter((line) => line.amount > 0)
              .map((line) => (
                <div key={line.key} className="text-sm">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 truncate">
                    {line.label}
                  </p>
                  <p className="text-slate-700 tabular-nums">
                    {formatMoney(line.amount, { withSymbol: false })}
                  </p>
                </div>
              ))}
          </div>
        </div>
      ) : (
        summary && (
          <p className="flex items-start gap-2 text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <MdOutlineInfo size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <span>
              Payroll has not set up your salary yet. Your payslips will appear
              here once they do.
            </span>
          </p>
        )
      )}

      {/* ==================== the year so far ==================== */}
      {yearToDate && yearToDate.months > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label={`Paid in ${yearToDate.year}`}
            value={formatMoney(yearToDate.net)}
            hint={`${yearToDate.months} month${yearToDate.months === 1 ? "" : "s"}`}
            tone="indigo"
          />
          <SummaryCard
            label="Gross this year"
            value={formatMoney(yearToDate.gross)}
            tone="slate"
          />
          <SummaryCard
            label="Deducted this year"
            value={formatMoney(yearToDate.deductions)}
            tone="slate"
          />
          <SummaryCard
            label="Average monthly net"
            value={formatMoney(yearToDate.net / yearToDate.months)}
            tone="slate"
          />
        </div>
      )}

      {/* ==================== the latest payslip, opened up ==================== */}
      {latest && (
        <div className="bg-white rounded-lg border border-slate-300 p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <MdOutlineReceiptLong size={17} className="text-slate-400" />
              Latest payslip
            </h2>

            {latest.canDownload && (
              <button
                type="button"
                onClick={() => handleDownload(latest)}
                disabled={downloadingId === latest._id}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5"
              >
                {downloadingId === latest._id ? (
                  <ClipLoader size={12} color="#ffffff" />
                ) : (
                  <MdOutlineFileDownload size={15} />
                )}
                Download receipt
              </button>
            )}
          </div>

          <PayslipBreakdown payslip={latest} />
        </div>
      )}

      {/* ==================== the history ==================== */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <MdOutlinePayments size={17} className="text-slate-400" />
            Salary history
          </h2>

          {/*
            The year filter is built from the years this person has
            actually been paid in, so a new joiner gets one option
            rather than ten empty ones.
          */}
          {history?.years?.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setYear("")}
                aria-pressed={year === ""}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  year === ""
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                    : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                All
              </button>

              {history.years.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setYear(String(option))}
                  aria-pressed={String(option) === year}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    String(option) === year
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
            <ClipLoader size={28} color="#4f46e5" />
          </div>
        ) : history?.payslips?.length > 0 ? (
          <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
            {/* a wide table scrolls inside its own card, never sideways on the page */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Paid days</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net pay</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {history.payslips.map((payslip) => {
                    const status = payslipStatusStyle(payslip.status);

                    return (
                      <tr
                        key={payslip._id}
                        className={`hover:bg-slate-50 ${
                          payslip.status === "Cancelled" ? "text-slate-400" : ""
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelected(payslip)}
                            className="font-medium text-slate-700 hover:text-indigo-600"
                          >
                            {formatMonthLong(payslip.monthKey)}
                          </button>
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
                              ? "line-through"
                              : "text-slate-800"
                          }`}
                        >
                          {formatMoney(payslip.netPay)}
                        </td>

                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {payslip.canDownload && (
                            <button
                              type="button"
                              onClick={() => handleDownload(payslip)}
                              disabled={downloadingId === payslip._id}
                              title="Download the receipt"
                              className="px-2.5 py-1.5 rounded-lg text-xs text-slate-600 border border-slate-300 hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-1.5"
                            >
                              {downloadingId === payslip._id ? (
                                <ClipLoader size={12} color="#475569" />
                              ) : (
                                <MdOutlineFileDownload size={15} />
                              )}
                              Receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {history.payslips.length > 1 && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-6 text-sm">
                <span className="text-slate-500">
                  {history.payslips.length} payslip
                  {history.payslips.length === 1 ? "" : "s"}
                </span>
                <span className="text-slate-500">
                  Total net{" "}
                  <b className="text-slate-800 tabular-nums">
                    {formatMoney(history.totals.net)}
                  </b>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-300 p-10 text-center">
            <p className="text-sm text-slate-500">
              No payslips yet. They appear here as soon as payroll publishes a
              month.
            </p>
          </div>
        )}
      </div>

      <PayslipModal
        isOpen={Boolean(selected)}
        payslip={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/* one fact of the salary strip */
function Fact({ label, value, strong = false }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p
        className={`tabular-nums ${
          strong ? "text-lg font-semibold text-slate-800" : "text-sm text-slate-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* one of the year-to-date cards */
function SummaryCard({ label, value, hint, tone = "slate" }) {
  const ring =
    tone === "indigo" ? "border-indigo-200 bg-indigo-50" : "border-slate-300 bg-white";

  return (
    <div className={`rounded-lg border px-4 py-3 ${ring}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default Salary;
