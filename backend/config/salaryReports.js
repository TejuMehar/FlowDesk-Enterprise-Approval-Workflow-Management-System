/*
=========================================================================
  SALARY REPORTS   (Module 12 - Payroll & Salary)
=========================================================================
  The two payroll reports, built in Module 8's REPORT ENVELOPE:

      { key, title, subtitle, generatedAt, scope, filters,
        columns, rows, summary, orientation }

  Nothing new is written to turn them into files. config/reportExport.js
  reads the envelope and produces the PDF, the Excel workbook and the
  CSV, exactly as it does for the six request reports and the four
  attendance ones - the third module to collect on that, and the
  clearest demonstration of why the envelope was worth having.

    register    one row per employee: every component, the totals, and
                whether the money has actually gone out
    department  one row per department: what it cost, and for how many
                people

  THE REGISTER IS THE ONE PAYROLL ACTUALLY USES. It is the file that
  gets emailed to the bank, checked against the transfer list and filed.
  The department report is for whoever asks what a team costs.

  THE PAYSLIP ITSELF IS NOT HERE - it is a document rather than a
  table, and it is drawn by config/payslipDocument.js. See the note at
  the top of that file.
=========================================================================
*/

import {
  SALARY_REPORT_META,
  getSalaryReportColumns,
  formatMonthLong,
  roundMoney,
} from "./salaryConstants.js";

/* =====================================================================
   WHAT THE REPORT WAS RUN WITH
   ---------------------------------------------------------------------
   Printed at the top of every file. The most important line on the
   page after the title: a payroll register with no record of which
   month and which departments it covers is a page of numbers nobody
   can check, and somebody always asks three weeks later.
   ===================================================================== */
export const describeSalaryFilters = ({ monthKey, scope, departmentName, statusLabel }) => {
  const filters = [
    { label: "Month", value: formatMonthLong(monthKey) },
    { label: "Scope", value: scope.label },
  ];

  if (departmentName) {
    filters.push({ label: "Department", value: departmentName });
  }

  filters.push({ label: "Status", value: statusLabel || "All except drafts" });

  return filters;
};

/*
  The envelope every builder below fills in. Written once so the two
  reports cannot disagree about the shape - the exact trick
  config/attendanceReports.js uses.
*/
const buildEnvelope = (reportType, { filters, rows, summary, scope }) => {
  const meta = SALARY_REPORT_META[reportType];

  return {
    key: `salary-${reportType}`,
    title: meta.title,
    subtitle: meta.subtitle,
    orientation: meta.orientation,
    generatedAt: new Date(),
    scope: scope.level,
    filters,
    columns: getSalaryReportColumns(reportType),
    rows,
    summary,
    truncated: false,
  };
};

/* =====================================================================
   1) THE SALARY REGISTER
   ---------------------------------------------------------------------
   One row per payslip. Everything is read off the PAYSLIP and not off
   the employee - a register of July has to show what July's slips
   said, including for the two people who have since changed
   department. That is the whole reason those fields are frozen onto
   the payslip in the first place.
   ===================================================================== */
export const buildSalaryRegisterReport = ({ payslips, monthKey, scope, filters }) => {
  const rows = payslips.map((payslip) => ({
    employeeId: payslip.employeeCode || "-",
    name: payslip.employeeName,
    departmentName: payslip.departmentName || "-",
    designation: payslip.designation || "-",
    payableDays: payslip.payableDays,
    lopDays: payslip.lopDays,
    grossEarnings: payslip.grossEarnings,
    totalDeductions: payslip.totalDeductions,
    netPay: payslip.netPay,
    status: payslip.status,
    paidOn: payslip.paidOn || null,
  }));

  const totals = rows.reduce(
    (sum, row) => ({
      gross: sum.gross + row.grossEarnings,
      deductions: sum.deductions + row.totalDeductions,
      net: sum.net + row.netPay,
    }),
    { gross: 0, deductions: 0, net: 0 }
  );

  return buildEnvelope("register", {
    scope,
    filters,
    rows,
    summary: [
      { label: "Employees paid", value: rows.length, type: "number" },
      { label: "Gross earnings", value: roundMoney(totals.gross), type: "money" },
      { label: "Total deductions", value: roundMoney(totals.deductions), type: "money" },
      { label: "Net payout", value: roundMoney(totals.net), type: "money" },
      {
        /*
          The average is here because the total on its own answers
          "what did we spend" and says nothing about whether the
          number is reasonable. Null rather than 0 when there is
          nobody: a month with no payslips has NO average pay, and
          printing 0 would say the company pays nothing.
        */
        label: "Average net pay",
        value: rows.length > 0 ? roundMoney(totals.net / rows.length) : null,
        type: "money",
      },
      { label: "Month", value: formatMonthLong(monthKey), type: "text" },
    ],
  });
};

/* =====================================================================
   2) THE DEPARTMENT REPORT
   ---------------------------------------------------------------------
   The register, folded up by department.

   IT IS FOLDED IN NODE RATHER THAN IN AN AGGREGATION PIPELINE, for the
   same reason config/attendanceStats.js counts in node: the rows have
   already been fetched for the register, and a second trip to the
   database to group what is already in memory is a trip for nothing.

   A payslip whose employee had no department is grouped under
   "Unassigned" rather than dropped - a report whose total does not
   match the register it came from is a report that will be trusted
   once and never again.
   ===================================================================== */
export const buildDepartmentSalaryReport = ({
  payslips,
  monthKey,
  scope,
  filters,
  departments = [],
}) => {
  // "which code goes with which name", for the first column
  const codeByName = new Map(
    departments.map((department) => [department.name, department.code])
  );

  const groups = new Map();

  payslips.forEach((payslip) => {
    const name = payslip.departmentName || "Unassigned";

    const group = groups.get(name) || {
      code: codeByName.get(name) || "-",
      name,
      employees: 0,
      grossEarnings: 0,
      totalDeductions: 0,
      netPay: 0,
    };

    group.employees += 1;
    group.grossEarnings += payslip.grossEarnings;
    group.totalDeductions += payslip.totalDeductions;
    group.netPay += payslip.netPay;

    groups.set(name, group);
  });

  const rows = [...groups.values()]
    .map((group) => ({
      ...group,
      grossEarnings: roundMoney(group.grossEarnings),
      totalDeductions: roundMoney(group.totalDeductions),
      netPay: roundMoney(group.netPay),
    }))
    // the most expensive department first - the row anybody opens this for
    .sort((left, right) => right.netPay - left.netPay);

  const netTotal = rows.reduce((sum, row) => sum + row.netPay, 0);

  return buildEnvelope("department", {
    scope,
    filters,
    rows,
    summary: [
      { label: "Departments", value: rows.length, type: "number" },
      {
        label: "Employees paid",
        value: rows.reduce((sum, row) => sum + row.employees, 0),
        type: "number",
      },
      { label: "Net payout", value: roundMoney(netTotal), type: "money" },
      {
        label: "Largest department cost",
        value: rows.length > 0 ? rows[0].netPay : null,
        type: "money",
      },
      { label: "Month", value: formatMonthLong(monthKey), type: "text" },
    ],
  });
};

/*
  One entry point, so the controller never has a switch in it - the
  same shape config/attendanceReports.js and config/reportBuilders.js
  both present.
*/
export const buildSalaryReport = (reportType, context) => {
  if (reportType === "department") {
    return buildDepartmentSalaryReport(context);
  }

  return buildSalaryRegisterReport(context);
};
