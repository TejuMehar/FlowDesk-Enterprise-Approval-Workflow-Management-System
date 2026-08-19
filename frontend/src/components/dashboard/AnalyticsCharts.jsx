/*
=========================================================================
  COMPONENT: AnalyticsCharts   (Module 5 - the four charts)
=========================================================================
  The bottom half of the dashboard: Monthly Requests, Approval Trends,
  Department Performance and Request Categories.

  ONE ENDPOINT, ONE FILTER ROW, FOUR CARDS
  ----------------------------------------
  All four charts come from a single call to /api/dashboard/charts, and
  the "last N months" buttons sit ABOVE all of them rather than inside
  each card. That is not only tidier - four charts that could each be set
  to a different period would let a reader compare May with December and
  never notice.

  THE SCOPE
    org  -> the whole company        (needs the "analytics:read" permission)
    team -> the departments I manage (needs no permission - see the
            backend controller for why)
  The backend decides which one the caller may have; this component only
  says which one it is asking for.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { ClipLoader } from "react-spinners";
import { MdInsights } from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import {
  CHART_INK,
  MONTH_RANGE_OPTIONS,
  REQUEST_OUTCOME_SERIES,
  APPROVAL_TREND_SERIES,
  DEFAULT_CHART_MONTHS,
  formatNumber,
} from "../../utils/dashboardConstants.js";

import ChartCard from "../charts/ChartCard.jsx";
import StackedColumnChart from "../charts/StackedColumnChart.jsx";
import LineChart from "../charts/LineChart.jsx";
import SplitBarList from "../charts/SplitBarList.jsx";
import RankedBarList from "../charts/RankedBarList.jsx";

/*
  The department bar has a fourth, deliberately colourless piece.

  Without it the bar would show only the requests that were submitted,
  while the number beside it counts every request - and the two would
  quietly disagree. Grey says "these exist but nobody has been asked
  about them yet", which is exactly what a draft is.
*/
const DEPARTMENT_SERIES = [
  ...REQUEST_OUTCOME_SERIES,
  { key: "other", label: "Not submitted", color: "#cbd5e1" },
];

/* a table cell, so the four tables below all look the same */
const headCell = "px-3 py-2 text-left font-medium text-slate-500";
const bodyCell = "px-3 py-2 text-slate-700 tabular-nums";

function AnalyticsCharts({ scope = "org", title, subtitle }) {
  const [months, setMonths] = useState(DEFAULT_CHART_MONTHS);
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCharts = useCallback(async () => {
    setLoading(true);

    try {
      const result = await api.get(
        `/api/dashboard/charts?scope=${scope}&months=${months}`
      );

      setCharts(result.data.charts);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [scope, months]);

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  /* ---------------- the very first load ---------------- */
  if (loading && !charts) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-10 flex justify-center">
        <ClipLoader size={28} color="#4f46e5" />
      </div>
    );
  }

  if (error && !charts) {
    return (
      <div className="bg-white rounded-lg border border-slate-300 p-8 text-center">
        <p className="text-sm text-slate-500">{error}</p>
      </div>
    );
  }

  if (!charts) {
    return null;
  }

  const { monthlyRequests, approvalTrends, departmentPerformance, requestCategories } =
    charts;

  /* the totals shown next to each legend entry, for the whole period */
  const outcomeTotals = REQUEST_OUTCOME_SERIES.map((item) => ({
    ...item,
    value: formatNumber(
      monthlyRequests.reduce((sum, row) => sum + row[item.key], 0)
    ),
  }));

  const trendTotals = APPROVAL_TREND_SERIES.map((item) => ({
    ...item,
    value: formatNumber(
      approvalTrends.reduce((sum, row) => sum + row[item.key], 0)
    ),
  }));

  // add the grey "not submitted" remainder to every department row
  const departmentRows = departmentPerformance.map((row) => ({
    ...row,
    other: Math.max(0, row.total - row.approved - row.rejected - row.pending),
  }));

  const totalRequestsInPeriod = monthlyRequests.reduce(
    (sum, row) => sum + row.total,
    0
  );

  return (
    <div>
      {/* ==================== the header + the one filter row ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {MONTH_RANGE_OPTIONS.map((option) => (
            <button
              key={option.months}
              type="button"
              onClick={() => setMonths(option.months)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                months === option.months
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              aria-pressed={months === option.months}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        While a new period is loading we keep the OLD charts on screen at
        a lower opacity instead of replacing them with a spinner. A
        skeleton here would make the whole page jump every time somebody
        presses "12 months".
      */}
      <div
        className={`grid grid-cols-1 xl:grid-cols-2 gap-4 transition-opacity ${
          loading ? "opacity-50" : "opacity-100"
        }`}
      >
        {/* ==================== 1) MONTHLY REQUESTS ==================== */}
        <ChartCard
          title="Monthly Requests"
          subtitle="How many requests were raised each month, and how they turned out"
          legend={outcomeTotals}
          isEmpty={totalRequestsInPeriod === 0}
          emptyText="No requests were raised in this period."
          table={
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className={headCell}>Month</th>
                  <th className={headCell}>Approved</th>
                  <th className={headCell}>Rejected</th>
                  <th className={headCell}>In progress</th>
                  <th className={headCell}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyRequests.map((row) => (
                  <tr key={row.month}>
                    <td className={bodyCell}>{row.fullLabel}</td>
                    <td className={bodyCell}>{row.approved}</td>
                    <td className={bodyCell}>{row.rejected}</td>
                    <td className={bodyCell}>{row.pending}</td>
                    <td className={`${bodyCell} font-semibold text-slate-900`}>
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <StackedColumnChart
            data={monthlyRequests}
            series={REQUEST_OUTCOME_SERIES}
          />
        </ChartCard>

        {/* ==================== 2) APPROVAL TRENDS ==================== */}
        <ChartCard
          title="Approval Trends"
          subtitle="Decisions approvers actually made, by the month they made them"
          legend={trendTotals}
          isEmpty={trendTotals.every((item) => item.value === "0")}
          emptyText="No approval decisions were made in this period."
          headline={
            charts.approvalRate === null ? null : (
              /*
                The approval rate is a PERCENTAGE while the chart plots
                counts. Two scales must never share one y axis, so it
                lives here as a number instead of as a fourth line.
              */
              <div className="text-right">
                <p className="text-lg font-semibold text-slate-900 leading-none">
                  {charts.approvalRate}%
                </p>
                <p className="text-[11px] text-slate-500 mt-1">approval rate</p>
              </div>
            )
          }
          table={
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className={headCell}>Month</th>
                  <th className={headCell}>Approved</th>
                  <th className={headCell}>Rejected</th>
                  <th className={headCell}>Returned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {approvalTrends.map((row) => (
                  <tr key={row.month}>
                    <td className={bodyCell}>{row.fullLabel}</td>
                    <td className={bodyCell}>{row.approved}</td>
                    <td className={bodyCell}>{row.rejected}</td>
                    <td className={bodyCell}>{row.returned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <LineChart data={approvalTrends} series={APPROVAL_TREND_SERIES} />
        </ChartCard>

        {/* ==================== 3) DEPARTMENT PERFORMANCE ==================== */}
        <ChartCard
          title="Department Performance"
          subtitle="The share of each department's requests that made it through"
          legend={DEPARTMENT_SERIES}
          isEmpty={departmentRows.length === 0}
          emptyText="No department has raised a request yet."
          table={
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className={headCell}>Department</th>
                  <th className={headCell}>Approved</th>
                  <th className={headCell}>Rejected</th>
                  <th className={headCell}>In progress</th>
                  <th className={headCell}>Total</th>
                  <th className={headCell}>Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departmentRows.map((row) => (
                  <tr key={row.departmentId || row.name}>
                    <td className={bodyCell}>{row.name}</td>
                    <td className={bodyCell}>{row.approved}</td>
                    <td className={bodyCell}>{row.rejected}</td>
                    <td className={bodyCell}>{row.pending}</td>
                    <td className={bodyCell}>{row.total}</td>
                    <td className={`${bodyCell} font-semibold text-slate-900`}>
                      {row.approvalRate === null ? "-" : `${row.approvalRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <SplitBarList rows={departmentRows} series={DEPARTMENT_SERIES} />
        </ChartCard>

        {/* ==================== 4) REQUEST CATEGORIES ==================== */}
        <ChartCard
          title="Request Categories"
          subtitle="What people ask for, counted by request type"
          isEmpty={requestCategories.length === 0}
          emptyText="No requests have been raised yet."
          table={
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className={headCell}>Type</th>
                  <th className={headCell}>Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requestCategories.map((row) => (
                  <tr key={row.type}>
                    <td className={bodyCell}>{row.type}</td>
                    <td className={`${bodyCell} font-semibold text-slate-900`}>
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <RankedBarList rows={requestCategories} />
        </ChartCard>
      </div>

      {/* a quiet footnote, so nobody wonders which requests are in here */}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-3">
        <MdInsights size={13} style={{ color: CHART_INK.muted }} />
        Every chart covers the last {months} months.
        {scope === "team"
          ? " Only the employees of the departments you manage are counted."
          : " Every department in the company is counted."}
      </p>
    </div>
  );
}

export default AnalyticsCharts;
