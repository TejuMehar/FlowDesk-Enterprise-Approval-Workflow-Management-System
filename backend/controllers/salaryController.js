/*
=========================================================================
  CONTROLLER: Salary                              ( the "C" of MVC )
=========================================================================
  Module 12 - Payroll & Salary.

  FUNCTIONS IN THIS FILE

    -- the employee's own pay --
    getMySalary        GET   /api/salary/me
    getMyPayslips      GET   /api/salary/me/payslips
    getPayslip         GET   /api/salary/payslip/:id
    downloadPayslip    GET   /api/salary/payslip/:id/receipt

    -- what the payroll screen needs --
    getOptions         GET   /api/salary/options
    getPayrollMonth    GET   /api/salary/payroll
    getStructures      GET   /api/salary/structure
    getStructure       GET   /api/salary/structure/:userId

    -- doing payroll --
    saveStructure      PUT   /api/salary/structure/:userId
    generateMonth      POST  /api/salary/payroll/:monthKey/generate
    publishMonth       POST  /api/salary/payroll/:monthKey/publish
    adjustPayslip      PATCH /api/salary/payslip/:id
    payPayslip         POST  /api/salary/payslip/:id/pay
    cancelPayslip      POST  /api/salary/payslip/:id/cancel

    -- the files --
    exportSalary       GET   /api/salary/export/:reportType

  THIS FILE IS DELIBERATELY THIN, like every controller since Module 8:

    what a month is worth      -> config/salaryService.js
    whose pay may I see        -> config/salaryScope.js
    what a payslip is made of  -> config/salaryConstants.js
    the receipt                -> config/payslipDocument.js
    the two reports            -> config/salaryReports.js
                                  + config/reportExport.js (Module 8)

  THE FOUR ROUTES AT THE TOP ARE THE WHOLE POINT OF THE MODULE FOR
  ALMOST EVERYBODY WHO USES IT. Three hundred employees will only ever
  call those; the rest of the file exists so that the two people in
  finance can make the first four true.
=========================================================================
*/

import Payslip from "../model/payslipModel.js";
import SalaryStructure from "../model/salaryStructureModel.js";
import User from "../model/userModel.js";
import Settings from "../model/settingsModel.js";

import { isValidObjectId } from "../config/validation.js";
import { recordAudit, buildChanges, describePerson } from "../config/auditService.js";
import { PERMISSIONS } from "../config/permissions.js";
import { notifySalaryPublished } from "../config/notificationService.js";

import {
  resolveSalaryScope,
  canViewSalaryOf,
  resolveScopedEmployees,
  getSelectableDepartments,
} from "../config/salaryScope.js";

import {
  generatePayroll,
  applyAdjustments,
  presentPayslip,
  getCurrentMonthKey,
  countWorkingDays,
  isMonthFinished,
  refuse,
} from "../config/salaryService.js";

import {
  EARNING_COMPONENTS,
  DEDUCTION_COMPONENTS,
  EARNING_KEYS,
  DEDUCTION_KEYS,
  COMPONENT_LABELS,
  PAYSLIP_STATUSES,
  PAYSLIP_STATUS_LABELS,
  EMPLOYEE_VISIBLE_STATUSES,
  SALARY_REPORT_TYPES,
  isValidMonthKey,
  formatMonthLong,
  shiftMonthKey,
  isValidAmount,
  roundMoney,
} from "../config/salaryConstants.js";

import { buildSalaryReport, describeSalaryFilters } from "../config/salaryReports.js";
import { streamPayslip, buildPayslipFileName } from "../config/payslipDocument.js";

import { EXPORT_FORMATS, EXPORT_FILE_META } from "../config/reportConstants.js";
import {
  toCsv,
  toExcelBuffer,
  streamPdf,
  buildFileName,
} from "../config/reportExport.js";

/* =====================================================================
   HELPER 1 - answering a refused action
   ---------------------------------------------------------------------
   The service throws refusals with a `statusCode` on them. "That month
   has already been generated" is the user's business, not a server
   fault, and answering it with 500 would be a lie the UI cannot tell
   from a real crash. The same contract Module 11 established.
   ===================================================================== */
const answerError = (res, error, label) => {
  if (error?.isSalaryRefusal) {
    return res.status(error.statusCode || 409).json({ message: error.message });
  }

  return res.status(500).json({ message: `${label} Error ${error}` });
};

/* =====================================================================
   HELPER 2 - the structure, as the browser wants it
   ---------------------------------------------------------------------
   The three totals are worked out HERE rather than being stored (see
   the note at the bottom of model/salaryStructureModel.js), and the
   annual CTC is twelve times the monthly gross - derived, never
   stored, so the two can never disagree.
   ===================================================================== */
const presentStructure = (structure) => {
  if (!structure) {
    return null;
  }

  const grossEarnings = roundMoney(
    EARNING_KEYS.reduce((total, key) => total + (structure.earnings?.[key] || 0), 0)
  );

  const totalDeductions = roundMoney(
    DEDUCTION_KEYS.reduce((total, key) => total + (structure.deductions?.[key] || 0), 0)
  );

  return {
    _id: structure._id,
    user: structure.user,

    earnings: EARNING_COMPONENTS.map((component) => ({
      key: component.key,
      label: component.label,
      amount: roundMoney(structure.earnings?.[component.key] || 0),
    })),

    deductions: DEDUCTION_COMPONENTS.map((component) => ({
      key: component.key,
      label: component.label,
      amount: roundMoney(structure.deductions?.[component.key] || 0),
    })),

    grossEarnings,
    totalDeductions,
    netPay: roundMoney(grossEarnings - totalDeductions),
    annualCtc: roundMoney(grossEarnings * 12),

    bankName: structure.bankName || "",
    accountLast4: structure.accountLast4 || "",
    pan: structure.pan || "",
    pfNumber: structure.pfNumber || "",
    uan: structure.uan || "",

    effectiveFrom: structure.effectiveFrom || "",
    effectiveFromLabel: structure.effectiveFrom
      ? formatMonthLong(structure.effectiveFrom)
      : "",
    notes: structure.notes || "",
    isActive: structure.isActive !== false,

    revisedAt: structure.revisedAt || null,
    revisedBy: structure.revisedBy || null,
  };
};

/* =====================================================================
   HELPER 3 - the months the payroll screen may offer
   ---------------------------------------------------------------------
   The last twelve FINISHED months, newest first.

   The current month is deliberately absent: it cannot be paid until it
   has happened (see the refusal list in config/salaryService.js), and a
   dropdown that offers a month whose button always says no is a
   dropdown that teaches people the application is broken.
   ===================================================================== */
const buildPayrollMonths = async (count = 12) => {
  const current = await getCurrentMonthKey();

  return Array.from({ length: count }, (_, index) => {
    const monthKey = shiftMonthKey(current, -(index + 1));

    return { key: monthKey, label: formatMonthLong(monthKey) };
  });
};

/* =====================================================================
   HELPER 4 - the month a route was asked for
   ---------------------------------------------------------------------
   Every write route takes the month from the URL, and a bad one has to
   die here rather than three functions later as a query that matches
   nothing and reports "0 employees".
   ===================================================================== */
const readMonthKey = (value) => {
  if (!isValidMonthKey(value)) {
    throw refuse("That is not a valid payroll month. Use the format 2026-07.", 400);
  }

  return value;
};

/* =====================================================================
   1) MY SALARY
   ---------------------------------------------------------------------
   GET /api/salary/me

   Everything the employee's Salary page needs above the history table:
   what they earn, their latest payslip, and what the year has paid so
   far.

   NO PERMISSION IS CHECKED, and there is nothing here for an admin to
   grant - it reads req.userId and nothing else. Your own pay is your
   own paperwork, the fifth time FlowDesk makes that decision after
   notifications, search, the request timeline and clocking in.

   A NEW JOINER WITH NO STRUCTURE GETS null AND NOT AN ERROR. "Payroll
   has not set this up yet" is a normal state on somebody's first
   Monday, and it is the page's job to say so gently rather than the
   API's job to fail.
   ===================================================================== */
export const getMySalary = async (req, res) => {
  try {
    const [structure, payslips, currentMonth] = await Promise.all([
      SalaryStructure.findOne({ user: req.userId }).lean(),
      Payslip.find({
        user: req.userId,
        status: { $in: EMPLOYEE_VISIBLE_STATUSES },
      })
        .sort({ monthKey: -1 })
        .limit(1)
        .lean(),
      getCurrentMonthKey(),
    ]);

    const year = Number(currentMonth.slice(0, 4));

    /*
      THE YEAR SO FAR, counted from the payslips and never from the
      structure. What somebody has been paid this year is the sum of
      the documents that were issued - a cancelled month is not in it,
      and a month with a bonus in it is bigger than twelve times the
      standing pay.
    */
    const yearRows = await Payslip.find({
      user: req.userId,
      monthKey: { $gte: `${year}-01`, $lte: `${year}-12` },
      status: { $in: ["Published", "Paid"] },
    })
      .select("grossEarnings totalDeductions netPay")
      .lean();

    const yearToDate = yearRows.reduce(
      (totals, payslip) => ({
        months: totals.months + 1,
        gross: roundMoney(totals.gross + payslip.grossEarnings),
        deductions: roundMoney(totals.deductions + payslip.totalDeductions),
        net: roundMoney(totals.net + payslip.netPay),
      }),
      { months: 0, gross: 0, deductions: 0, net: 0 }
    );

    return res.status(200).json({
      structure: presentStructure(structure),
      latestPayslip: payslips[0] ? presentPayslip(payslips[0]) : null,
      yearToDate: { ...yearToDate, year },
      currentMonth,
    });
  } catch (error) {
    return answerError(res, error, "Get My Salary");
  }
};

/* =====================================================================
   2) MY PAYSLIP HISTORY
   ---------------------------------------------------------------------
   GET /api/salary/me/payslips?year=2026

   THE DRAFTS ARE NOT IN IT, and that is the only filter on this route.
   A draft is finance's working copy of a number that is still being
   checked - see the note on the payslip life cycle in
   config/salaryConstants.js. Everything else the company has ever said
   about this person's pay is here, including the cancelled ones, which
   stay visible on purpose: a payslip somebody has already seen must
   never silently disappear.
   ===================================================================== */
export const getMyPayslips = async (req, res) => {
  try {
    const filter = {
      user: req.userId,
      status: { $in: EMPLOYEE_VISIBLE_STATUSES },
    };

    /*
      The year is a plain prefix match on the month key, which is the
      whole reason a payroll month is stored as text - see
      config/salaryConstants.js.
    */
    if (req.query.year && /^\d{4}$/.test(String(req.query.year))) {
      filter.monthKey = {
        $gte: `${req.query.year}-01`,
        $lte: `${req.query.year}-12`,
      };
    }

    const payslips = await Payslip.find(filter).sort({ monthKey: -1 }).lean();

    /*
      WHICH YEARS THIS PERSON HAS BEEN PAID IN, for the year dropdown.
      Worked out from their own payslips rather than from a range of
      years, so a joiner's dropdown holds one year rather than ten
      empty ones.
    */
    const allMonths = await Payslip.find({
      user: req.userId,
      status: { $in: EMPLOYEE_VISIBLE_STATUSES },
    })
      .select("monthKey")
      .lean();

    const years = [
      ...new Set(allMonths.map((payslip) => Number(payslip.monthKey.slice(0, 4)))),
    ].sort((left, right) => right - left);

    const totals = payslips
      .filter((payslip) => payslip.status !== "Cancelled")
      .reduce(
        (sum, payslip) => ({
          gross: roundMoney(sum.gross + payslip.grossEarnings),
          deductions: roundMoney(sum.deductions + payslip.totalDeductions),
          net: roundMoney(sum.net + payslip.netPay),
        }),
        { gross: 0, deductions: 0, net: 0 }
      );

    return res.status(200).json({
      payslips: payslips.map(presentPayslip),
      years,
      totals,
    });
  } catch (error) {
    return answerError(res, error, "Get My Payslips");
  }
};

/* =====================================================================
   3) ONE PAYSLIP
   ---------------------------------------------------------------------
   GET /api/salary/payslip/:id

   No permission on the route, because the check is not a permission:
   it is "is this yours, or may you see everybody's?", which needs the
   scope, the document and the database (config/salaryScope.js).

   IT ANSWERS 404 AND NOT 403 for a payslip outside the caller's scope.
   403 would confirm that a payslip with that id exists, which is
   already more than somebody probing ids should learn about another
   employee's pay.
   ===================================================================== */
export const getPayslip = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "That payslip id is not valid" });
    }

    const payslip = await Payslip.findById(req.params.id).lean();

    if (!payslip) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    const scope = resolveSalaryScope(req);

    if (!canViewSalaryOf(scope, payslip.user, req.userId)) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    /*
      A DRAFT IS NOT SHOWN TO ITS OWNER, even though it is theirs. It is
      not a payslip yet - it is finance's working copy - and the
      employee has not been told about it. Only somebody at org level
      (payroll) can open one.
    */
    if (payslip.status === "Draft" && scope.level !== "org") {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    return res.status(200).json({ payslip: presentPayslip(payslip) });
  } catch (error) {
    return answerError(res, error, "Get Payslip");
  }
};

/* =====================================================================
   4) THE RECEIPT
   ---------------------------------------------------------------------
   GET /api/salary/payslip/:id/receipt

   The PDF an employee downloads and keeps. Same access rules as the
   route above, plus one: A DRAFT HAS NO RECEIPT. A receipt is a
   document, and a draft is a number that is still being checked - the
   file would be indistinguishable from a real payslip the moment it
   left the application.

   THE DOWNLOAD IS NOT AUDITED, the same decision Module 10 made about
   attachments: an employee opening their own payslip for the fourth
   time is not an event, and the log would be buried under it. What IS
   audited is everything that happens TO the payslip.
   ===================================================================== */
export const downloadPayslip = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "That payslip id is not valid" });
    }

    const payslip = await Payslip.findById(req.params.id).lean();

    if (!payslip) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    const scope = resolveSalaryScope(req);

    if (!canViewSalaryOf(scope, payslip.user, req.userId)) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    if (payslip.status === "Draft") {
      return res.status(409).json({
        message: "This payslip is still a draft. It can be downloaded once payroll publishes it.",
      });
    }

    const settings = await Settings.getSettings();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${buildPayslipFileName(payslip)}"`
    );

    /*
      Streamed straight to the response - PDFKit writes as it draws, so
      nothing is held in memory waiting to be sent. The same reason the
      report PDF is streamed and the Excel file is not.
    */
    return streamPayslip(payslip, settings, res);
  } catch (error) {
    return answerError(res, error, "Download Payslip");
  }
};

/* =====================================================================
   5) WHAT CAN I ASK FOR?
   ---------------------------------------------------------------------
   GET /api/salary/options

   The dropdowns, the scope label and the "may I draw this button"
   answers, in one small call the payroll page makes on every visit -
   exactly like /api/report/options and /api/attendance/options.

   THE PERMISSION FLAGS ARE SENT AS DATA rather than being worked out
   in React from the user's role, so the page and the routes can never
   disagree about who may press what.
   ===================================================================== */
export const getOptions = async (req, res) => {
  try {
    const scope = resolveSalaryScope(req);
    const permissions = req.user.role?.permissions || [];

    const [departments, months, currentMonth] = await Promise.all([
      getSelectableDepartments(scope),
      buildPayrollMonths(),
      getCurrentMonthKey(),
    ]);

    return res.status(200).json({
      scope: { level: scope.level, label: scope.label },
      months,
      currentMonth,
      departments,
      statuses: PAYSLIP_STATUSES.map((status) => ({
        key: status,
        label: PAYSLIP_STATUS_LABELS[status],
      })),
      components: {
        earnings: EARNING_COMPONENTS,
        deductions: DEDUCTION_COMPONENTS,
      },
      can: {
        readAll: scope.level === "org",
        structure: permissions.includes(PERMISSIONS.SALARY_STRUCTURE),
        process: permissions.includes(PERMISSIONS.SALARY_PROCESS),
        export: permissions.includes(PERMISSIONS.SALARY_EXPORT),
      },
    });
  } catch (error) {
    return answerError(res, error, "Get Salary Options");
  }
};

/* =====================================================================
   6) ONE PAYROLL MONTH
   ---------------------------------------------------------------------
   GET /api/salary/payroll?month=2026-07&departmentId=&status=

   The payroll screen: every payslip of the month, the totals, and -
   the part that makes it usable - WHO IS MISSING.

   A run skips an employee with no salary structure and reports them.
   That report is gone the moment the page is refreshed, so the count
   is worked out again here on every load: "312 employees, 309 payslips,
   3 without a structure" is the sentence payroll actually needs, and it
   is a sentence no list of payslips can say on its own.
   ===================================================================== */
export const getPayrollMonth = async (req, res) => {
  try {
    const scope = resolveSalaryScope(req);

    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : shiftMonthKey(await getCurrentMonthKey(), -1);

    const departmentId = isValidObjectId(req.query.departmentId)
      ? req.query.departmentId
      : null;

    const employees = await resolveScopedEmployees(scope, { departmentId });

    const filter = {
      monthKey,
      user: { $in: employees.map((employee) => employee._id) },
    };

    if (PAYSLIP_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [payslips, structures, workingDays] = await Promise.all([
      Payslip.find(filter).sort({ employeeName: 1 }).lean(),
      SalaryStructure.find({
        user: { $in: employees.map((employee) => employee._id) },
        isActive: true,
      })
        .select("user")
        .lean(),
      countWorkingDays(monthKey),
    ]);

    /*
      The totals cover the whole month as filtered, and a CANCELLED
      payslip is left out of them: it is money that is not going out.
      It is still in the list, because it is still something that
      happened.
    */
    const totals = payslips
      .filter((payslip) => payslip.status !== "Cancelled")
      .reduce(
        (sum, payslip) => ({
          gross: roundMoney(sum.gross + payslip.grossEarnings),
          deductions: roundMoney(sum.deductions + payslip.totalDeductions),
          net: roundMoney(sum.net + payslip.netPay),
        }),
        { gross: 0, deductions: 0, net: 0 }
      );

    const byStatus = PAYSLIP_STATUSES.reduce(
      (counts, status) => ({
        ...counts,
        [status]: payslips.filter((payslip) => payslip.status === status).length,
      }),
      {}
    );

    const withStructure = new Set(structures.map((row) => String(row.user)));
    const paid = new Set(payslips.map((payslip) => String(payslip.user)));

    const missing = employees.filter(
      (employee) =>
        !paid.has(String(employee._id)) && !withStructure.has(String(employee._id))
    );

    return res.status(200).json({
      monthKey,
      monthLabel: formatMonthLong(monthKey),
      workingDays,
      scope: { level: scope.level, label: scope.label },

      payslips: payslips.map((payslip) => ({
        ...presentPayslip(payslip),
        user: payslip.user,
      })),

      summary: {
        employees: employees.length,
        generated: payslips.length,
        ...totals,
        byStatus,
      },

      /*
        Named, not counted. "3 employees have no salary structure" is a
        number somebody has to go and investigate; three names are
        something they can fix in the next two minutes.
      */
      missingStructure: missing.slice(0, 25).map((employee) => ({
        _id: employee._id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeId: employee.employeeId,
        departmentName: employee.department?.name || "",
      })),
      missingStructureCount: missing.length,
    });
  } catch (error) {
    return answerError(res, error, "Get Payroll Month");
  }
};

/* =====================================================================
   7) THE SALARY STRUCTURES
   ---------------------------------------------------------------------
   GET /api/salary/structure?search=&departmentId=

   One row per employee - INCLUDING the ones who have no structure yet,
   which is the whole reason this is a list of employees with their
   structure attached rather than a list of structures.

   A screen that showed only the structures that exist would be a screen
   on which a new joiner is invisible until somebody remembers they
   exist, and "who have we not set up?" is the question this page is
   opened to answer.
   ===================================================================== */
export const getStructures = async (req, res) => {
  try {
    const scope = resolveSalaryScope(req);

    const departmentId = isValidObjectId(req.query.departmentId)
      ? req.query.departmentId
      : null;

    const employees = await resolveScopedEmployees(scope, { departmentId });

    const structures = await SalaryStructure.find({
      user: { $in: employees.map((employee) => employee._id) },
    }).lean();

    const structureMap = new Map(
      structures.map((structure) => [String(structure.user), structure])
    );

    const search = String(req.query.search || "").trim().toLowerCase();

    const rows = employees
      .filter((employee) => {
        if (!search) {
          return true;
        }

        const haystack = `${employee.firstName} ${employee.lastName} ${
          employee.employeeId || ""
        } ${employee.designation || ""}`.toLowerCase();

        return haystack.includes(search);
      })
      .map((employee) => {
        const structure = structureMap.get(String(employee._id));

        return {
          user: {
            _id: employee._id,
            name: `${employee.firstName} ${employee.lastName}`.trim(),
            employeeId: employee.employeeId,
            designation: employee.designation,
            departmentName: employee.department?.name || "",
            photoUrl: employee.photoUrl,
            isActive: employee.isActive,
          },
          structure: presentStructure(structure),
        };
      });

    return res.status(200).json({
      rows,
      total: rows.length,
      withoutStructure: rows.filter((row) => !row.structure).length,
    });
  } catch (error) {
    return answerError(res, error, "Get Salary Structures");
  }
};

/* =====================================================================
   8) ONE EMPLOYEE'S STRUCTURE
   ---------------------------------------------------------------------
   GET /api/salary/structure/:userId

   Scoped rather than gated, so an employee asking for their own is
   answered - it is the same document their own Salary page shows.
   ===================================================================== */
export const getStructure = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "That employee id is not valid" });
    }

    const scope = resolveSalaryScope(req);

    if (!canViewSalaryOf(scope, req.params.userId, req.userId)) {
      return res.status(404).json({ message: "That employee was not found" });
    }

    const structure = await SalaryStructure.findOne({ user: req.params.userId }).lean();

    return res.status(200).json({ structure: presentStructure(structure) });
  } catch (error) {
    return answerError(res, error, "Get Salary Structure");
  }
};

/* =====================================================================
   9) SETTING WHAT SOMEBODY EARNS
   ---------------------------------------------------------------------
   PUT /api/salary/structure/:userId          needs salary:structure

   Creates the structure if there is not one yet (upsert), because
   "give this new joiner a salary" and "give this person a raise" are
   the same action on the same screen, and making them two endpoints
   would only mean the page had to know which one it was looking at.

   THE CHANGES ARE AUDITED FIELD BY FIELD, which is the reason
   buildChanges() exists. "Ravi's salary was updated" is not a useful
   sentence six months later; "Basic Salary: 40,000 -> 46,000" is the
   one somebody is actually looking for.
   ===================================================================== */
export const saveStructure = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "That employee id is not valid" });
    }

    const employee = await User.findOne({
      _id: req.params.userId,
      isDeleted: false,
    })
      .select("firstName lastName employeeId")
      .lean();

    if (!employee) {
      return res.status(404).json({ message: "That employee was not found" });
    }

    const { earnings = {}, deductions = {} } = req.body;

    /*
      ONLY THE KEYS WE KNOW ARE READ, and everything else in the body is
      thrown away. Copying req.body into the document would let a
      caller invent a component - or write `isActive` from a form that
      does not have that field on it.
    */
    const cleanEarnings = {};
    const cleanDeductions = {};

    for (const key of EARNING_KEYS) {
      const value = earnings[key] ?? 0;

      if (!isValidAmount(value)) {
        return res.status(400).json({
          message: `${COMPONENT_LABELS[key]} must be a number that is not negative`,
        });
      }

      cleanEarnings[key] = roundMoney(value);
    }

    for (const key of DEDUCTION_KEYS) {
      const value = deductions[key] ?? 0;

      if (!isValidAmount(value)) {
        return res.status(400).json({
          message: `${COMPONENT_LABELS[key]} must be a number that is not negative`,
        });
      }

      cleanDeductions[key] = roundMoney(value);
    }

    /*
      BASIC PAY IS REQUIRED. Every statutory calculation in an Indian
      payslip is a percentage of it, and a structure whose basic is
      zero is a structure somebody has half filled in - see the
      `required` flag in config/salaryConstants.js.
    */
    if (cleanEarnings.basic <= 0) {
      return res.status(400).json({ message: "Basic Salary is required" });
    }

    const gross = EARNING_KEYS.reduce((total, key) => total + cleanEarnings[key], 0);
    const deducted = DEDUCTION_KEYS.reduce(
      (total, key) => total + cleanDeductions[key],
      0
    );

    /*
      A NET PAY THAT IS NOT POSITIVE IS REFUSED rather than saved.
      Deductions bigger than the pay is always a typo (a yearly figure
      typed into a monthly box, usually), and the first place it would
      otherwise show up is a payslip in somebody's hand.
    */
    if (deducted >= gross) {
      return res.status(400).json({
        message: "The deductions add up to more than the earnings. Check the amounts.",
      });
    }

    const effectiveFrom = req.body.effectiveFrom || "";

    if (effectiveFrom && !isValidMonthKey(effectiveFrom)) {
      return res.status(400).json({
        message: "The effective month is not valid. Use the format 2026-07.",
      });
    }

    const accountLast4 = String(req.body.accountLast4 || "").trim();

    /*
      FOUR DIGITS, OR NOTHING. Anything longer is a full account number
      being pasted in, and this application must not become the place
      one is stored - see the note on the field in
      model/salaryStructureModel.js.
    */
    if (accountLast4 && !/^\d{4}$/.test(accountLast4)) {
      return res.status(400).json({
        message: "Enter only the LAST FOUR digits of the bank account",
      });
    }

    const existing = await SalaryStructure.findOne({ user: req.params.userId });

    const update = {
      user: req.params.userId,
      earnings: cleanEarnings,
      deductions: cleanDeductions,
      bankName: String(req.body.bankName || "").trim(),
      accountLast4,
      pan: String(req.body.pan || "").trim().toUpperCase(),
      pfNumber: String(req.body.pfNumber || "").trim(),
      uan: String(req.body.uan || "").trim(),
      effectiveFrom,
      notes: String(req.body.notes || "").trim(),
      isActive: req.body.isActive !== false,
      revisedBy: req.userId,
      revisedAt: new Date(),
    };

    const structure = await SalaryStructure.findOneAndUpdate(
      { user: req.params.userId },
      update,
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    /* ---------------- the audit trail ---------------- */
    const labels = {
      ...COMPONENT_LABELS,
      bankName: "Bank",
      accountLast4: "Account (last 4)",
      pan: "PAN",
      effectiveFrom: "Effective from",
      isActive: "Salary active",
    };

    const flatten = (document) => ({
      ...EARNING_KEYS.reduce(
        (flat, key) => ({ ...flat, [key]: document?.earnings?.[key] || 0 }),
        {}
      ),
      ...DEDUCTION_KEYS.reduce(
        (flat, key) => ({ ...flat, [key]: document?.deductions?.[key] || 0 }),
        {}
      ),
      bankName: document?.bankName || "",
      accountLast4: document?.accountLast4 || "",
      pan: document?.pan || "",
      effectiveFrom: document?.effectiveFrom || "",
      isActive: document?.isActive !== false,
    });

    await recordAudit(req, {
      action: "SalaryStructureUpdated",
      description: `${describePerson(req.user)} ${
        existing ? "changed" : "set"
      } the salary of ${employee.firstName} ${employee.lastName}`,
      targetType: "SalaryStructure",
      targetId: structure._id,
      targetLabel: `${employee.firstName} ${employee.lastName}`.trim(),
      changes: buildChanges(flatten(existing), flatten(structure), labels),
    });

    return res.status(200).json({
      message: existing ? "Salary structure updated" : "Salary structure created",
      structure: presentStructure(structure.toObject()),
    });
  } catch (error) {
    return answerError(res, error, "Save Salary Structure");
  }
};

/* =====================================================================
   10) RUNNING A MONTH
   ---------------------------------------------------------------------
   POST /api/salary/payroll/:monthKey/generate      needs salary:process

   Produces a DRAFT payslip for every employee in scope who has a
   structure and has not already been paid for the month. Nobody is told
   anything - see publishMonth() below for the half of this that the
   employees can see.

   The refusals and the skips are explained where they are decided, in
   config/salaryService.js.
   ===================================================================== */
export const generateMonth = async (req, res) => {
  try {
    const monthKey = readMonthKey(req.params.monthKey);

    if (!(await isMonthFinished(monthKey))) {
      return res.status(400).json({
        message: `${formatMonthLong(
          monthKey
        )} has not finished yet. A month can only be paid once it is over.`,
      });
    }

    const scope = resolveSalaryScope(req);

    const departmentId = isValidObjectId(req.body.departmentId)
      ? req.body.departmentId
      : null;

    const employees = await resolveScopedEmployees(scope, { departmentId });

    const result = await generatePayroll({
      employees,
      monthKey,
      actorId: req.userId,
    });

    await recordAudit(req, {
      action: "PayrollGenerated",
      description: `${describePerson(req.user)} generated payroll for ${formatMonthLong(
        monthKey
      )} - ${result.created} payslip(s)`,
      targetType: "Payslip",
      // a RUN is about the month, not about one document - see auditConstants.js
      targetId: null,
      targetLabel: formatMonthLong(monthKey),
    });

    return res.status(201).json({
      message: `${result.created} payslip(s) generated for ${formatMonthLong(monthKey)}`,
      ...result,
    });
  } catch (error) {
    return answerError(res, error, "Generate Payroll");
  }
};

/* =====================================================================
   11) RELEASING THE MONTH TO THE EMPLOYEES
   ---------------------------------------------------------------------
   POST /api/salary/payroll/:monthKey/publish       needs salary:process

   The moment the module exists for: every draft of the month becomes a
   payslip the employee can see and download, and everybody is told
   once.

   IT IS ONE ACTION FOR THE WHOLE MONTH, not one per payslip, because
   that is how payroll is actually released - and because publishing
   them one at a time would mean the first employee finds out about
   payday twenty minutes before the last.

   THE NOTIFICATION IS SENT AFTER THE WRITE, and its failure cannot
   undo it: config/notificationService.js never throws, and a mail
   problem must not leave a month half published.
   ===================================================================== */
export const publishMonth = async (req, res) => {
  try {
    const monthKey = readMonthKey(req.params.monthKey);

    const scope = resolveSalaryScope(req);
    const employees = await resolveScopedEmployees(scope, {});

    const drafts = await Payslip.find({
      monthKey,
      status: "Draft",
      user: { $in: employees.map((employee) => employee._id) },
    })
      .select("user")
      .lean();

    if (drafts.length === 0) {
      return res.status(409).json({
        message: `There are no draft payslips left to publish for ${formatMonthLong(
          monthKey
        )}.`,
      });
    }

    await Payslip.updateMany(
      { _id: { $in: drafts.map((payslip) => payslip._id) } },
      {
        $set: {
          status: "Published",
          publishedBy: req.userId,
          publishedAt: new Date(),
        },
      }
    );

    await recordAudit(req, {
      action: "PayrollPublished",
      description: `${describePerson(req.user)} published payroll for ${formatMonthLong(
        monthKey
      )} - ${drafts.length} payslip(s)`,
      targetType: "Payslip",
      targetId: null,
      targetLabel: formatMonthLong(monthKey),
    });

    /*
      No actor is passed on purpose. deliver() drops the actor from its
      own guest list ("you are never told about your own click"), which
      is right for an approval and wrong here: somebody in payroll has
      a payslip too, and theirs should arrive like everybody else's.
    */
    const told = await notifySalaryPublished(
      drafts.map((payslip) => payslip.user),
      formatMonthLong(monthKey)
    );

    return res.status(200).json({
      message: `${drafts.length} payslip(s) published. ${told} employee(s) were notified.`,
      published: drafts.length,
      notified: told,
    });
  } catch (error) {
    return answerError(res, error, "Publish Payroll");
  }
};

/* =====================================================================
   12) EDITING A DRAFT
   ---------------------------------------------------------------------
   PATCH /api/salary/payslip/:id                    needs salary:process

   The loss of pay the run proposed, a one-off bonus, and the remark
   printed on the slip. PATCH rather than PUT: three fields change and
   everything derived is rebuilt from them by the service.

   WHAT CANNOT BE EDITED HERE IS THE POINT: the components. Basic pay
   is a property of the employment, not of a month - a raise is a change
   to the structure, on another screen, behind another permission. See
   the note above applyAdjustments() in config/salaryService.js.
   ===================================================================== */
export const adjustPayslip = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "That payslip id is not valid" });
    }

    const payslip = await Payslip.findById(req.params.id);

    if (!payslip) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    const before = {
      lopDays: payslip.lopDays,
      netPay: payslip.netPay,
    };

    applyAdjustments(payslip, {
      lopDays: req.body.lopDays,
      bonus: req.body.bonus,
      remarks: req.body.remarks,
    });

    await payslip.save();

    await recordAudit(req, {
      action: "PayslipAdjusted",
      description: `${describePerson(req.user)} adjusted the ${formatMonthLong(
        payslip.monthKey
      )} payslip of ${payslip.employeeName}`,
      targetType: "Payslip",
      targetId: payslip._id,
      targetLabel: `${payslip.employeeName} - ${formatMonthLong(payslip.monthKey)}`,
      changes: buildChanges(
        before,
        { lopDays: payslip.lopDays, netPay: payslip.netPay },
        { lopDays: "Loss of pay (days)", netPay: "Net pay" }
      ),
    });

    return res.status(200).json({
      message: "Payslip updated",
      payslip: presentPayslip(payslip.toObject()),
    });
  } catch (error) {
    return answerError(res, error, "Adjust Payslip");
  }
};

/* =====================================================================
   13) THE MONEY HAS GONE OUT
   ---------------------------------------------------------------------
   POST /api/salary/payslip/:id/pay                 needs salary:process

   FlowDesk does not move money and never will. This records that a
   transfer happened somewhere else, with the date it happened and the
   bank's reference - which is the only part of it an employee can use
   to chase a payment that has not arrived.

   ONLY A PUBLISHED PAYSLIP CAN BE PAID. Marking a draft paid would
   mean the employee was paid for a slip they were never shown.
   ===================================================================== */
export const payPayslip = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "That payslip id is not valid" });
    }

    const payslip = await Payslip.findById(req.params.id);

    if (!payslip) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    if (payslip.status !== "Published") {
      return res.status(409).json({
        message:
          payslip.status === "Draft"
            ? "Publish this payslip before marking it paid."
            : `This payslip is already ${payslip.status.toLowerCase()}.`,
      });
    }

    const paidOn = req.body.paidOn ? new Date(req.body.paidOn) : new Date();

    if (isNaN(paidOn.getTime())) {
      return res.status(400).json({ message: "That payment date is not valid" });
    }

    payslip.status = "Paid";
    payslip.paidBy = req.userId;
    payslip.paidAt = new Date();
    payslip.paidOn = paidOn;
    payslip.paymentReference = String(req.body.paymentReference || "").trim();

    await payslip.save();

    await recordAudit(req, {
      action: "PayslipPaid",
      description: `${describePerson(req.user)} marked the ${formatMonthLong(
        payslip.monthKey
      )} payslip of ${payslip.employeeName} as paid`,
      targetType: "Payslip",
      targetId: payslip._id,
      targetLabel: `${payslip.employeeName} - ${formatMonthLong(payslip.monthKey)}`,
    });

    return res.status(200).json({
      message: "Payslip marked as paid",
      payslip: presentPayslip(payslip.toObject()),
    });
  } catch (error) {
    return answerError(res, error, "Pay Payslip");
  }
};

/* =====================================================================
   14) WITHDRAWING A PAYSLIP
   ---------------------------------------------------------------------
   POST /api/salary/payslip/:id/cancel              needs salary:process

   IT IS NOT A DELETE, and the reason is the whole design of the state:
   by the time anybody wants to cancel a payslip the employee has
   usually already seen it. It stays on their page, struck through, with
   the reason underneath - and the receipt they may already have
   downloaded says CANCELLED across the top from then on.

   THE REASON IS REQUIRED, because it is written to be read BY THEM. A
   cancellation with no explanation on a document about somebody's
   money is the worst thing this module could show anybody.
   ===================================================================== */
export const cancelPayslip = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "That payslip id is not valid" });
    }

    const reason = String(req.body.reason || "").trim();

    if (reason.length < 5) {
      return res.status(400).json({
        message: "Say why this payslip is being cancelled - the employee will read it",
      });
    }

    const payslip = await Payslip.findById(req.params.id);

    if (!payslip) {
      return res.status(404).json({ message: "That payslip was not found" });
    }

    if (payslip.status === "Cancelled") {
      return res.status(409).json({ message: "That payslip is already cancelled" });
    }

    /*
      A PAID PAYSLIP CANNOT BE CANCELLED. The money has left the
      company; cancelling the paperwork afterwards would leave a
      transfer with nothing to explain it. What that situation needs is
      a correction in the NEXT month, which is an adjustment on a new
      payslip and not a rewriting of an old one.
    */
    if (payslip.status === "Paid") {
      return res.status(409).json({
        message:
          "This payslip has already been paid. Correct it on the next month's payslip instead.",
      });
    }

    payslip.status = "Cancelled";
    payslip.cancelledBy = req.userId;
    payslip.cancelledAt = new Date();
    payslip.cancellationReason = reason;

    await payslip.save();

    await recordAudit(req, {
      action: "PayslipCancelled",
      description: `${describePerson(req.user)} cancelled the ${formatMonthLong(
        payslip.monthKey
      )} payslip of ${payslip.employeeName}: ${reason}`,
      targetType: "Payslip",
      targetId: payslip._id,
      targetLabel: `${payslip.employeeName} - ${formatMonthLong(payslip.monthKey)}`,
    });

    return res.status(200).json({
      message: "Payslip cancelled",
      payslip: presentPayslip(payslip.toObject()),
    });
  } catch (error) {
    return answerError(res, error, "Cancel Payslip");
  }
};

/* =====================================================================
   15) THE FILES
   ---------------------------------------------------------------------
   GET /api/salary/export/:reportType?format=pdf    needs salary:export

   Two reports times three formats, with no export code of its own -
   config/salaryReports.js builds Module 8's envelope and
   config/reportExport.js turns it into the file.

   DRAFTS ARE NEVER EXPORTED. A file leaves the building; a draft is a
   number that is still being checked, and the two must not meet. The
   register is the file that goes to the bank, and it must only ever
   contain payslips the company has actually stood behind.

   THE EXPORT IS AUDITED and the reading is not - the same split
   audit:export, report:export and attendance:export all make. Walking
   out with a spreadsheet of what everybody earns is a different act
   from looking at the screen.
   ===================================================================== */
export const exportSalary = async (req, res) => {
  try {
    const { reportType } = req.params;

    if (!SALARY_REPORT_TYPES.includes(reportType)) {
      return res.status(400).json({ message: "That salary report does not exist" });
    }

    const format = EXPORT_FORMATS.includes(req.query.format) ? req.query.format : "pdf";

    const scope = resolveSalaryScope(req);

    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : shiftMonthKey(await getCurrentMonthKey(), -1);

    const departmentId = isValidObjectId(req.query.departmentId)
      ? req.query.departmentId
      : null;

    const employees = await resolveScopedEmployees(scope, { departmentId });

    const payslips = await Payslip.find({
      monthKey,
      user: { $in: employees.map((employee) => employee._id) },
      status: { $ne: "Draft" },
    })
      .sort({ employeeName: 1 })
      .lean();

    const departments = await getSelectableDepartments(scope);

    const departmentName = departmentId
      ? departments.find((department) => String(department._id) === String(departmentId))
          ?.name
      : "";

    const report = buildSalaryReport(reportType, {
      payslips,
      monthKey,
      scope,
      departments,
      filters: describeSalaryFilters({
        monthKey,
        scope,
        departmentName,
        statusLabel: "Published, paid and cancelled",
      }),
    });

    await recordAudit(req, {
      action: "SalaryExported",
      description: `${describePerson(req.user)} exported the ${
        report.title
      } for ${formatMonthLong(monthKey)} as ${format.toUpperCase()}`,
      targetType: "Payslip",
      targetId: null,
      targetLabel: `${report.title} - ${formatMonthLong(monthKey)}`,
    });

    const meta = EXPORT_FILE_META[format];
    const fileName = buildFileName(report, meta.extension);

    res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    if (format === "csv") {
      return res.status(200).send(toCsv(report));
    }

    if (format === "excel") {
      // exceljs only knows the length of its zip at the end, so it cannot stream
      const buffer = await toExcelBuffer(report);

      return res.status(200).send(Buffer.from(buffer));
    }

    return streamPdf(report, res);
  } catch (error) {
    return answerError(res, error, "Export Salary");
  }
};
