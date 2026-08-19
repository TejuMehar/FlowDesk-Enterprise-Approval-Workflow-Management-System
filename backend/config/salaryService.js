/*
=========================================================================
  SALARY SERVICE   (Module 12 - Payroll & Salary)
=========================================================================
  Everything payroll actually DOES lives here, so
  controllers/salaryController.js can stay what every controller in
  FlowDesk is: read the request, hand over, answer.

    what a month is worth        buildPayslipLines()
    how many days were payable   countWorkingDays() + countPresentDays()
    running a whole month        generatePayroll()
    editing a draft              applyAdjustments()
    the three totals             recalculateTotals()

  TWO RULES THIS FILE KEEPS
  -------------------------
  1. THE TOTALS ARE NEVER WRITTEN BY HAND. Every path ends in
     recalculateTotals(), which throws the stored numbers away and adds
     the lines up again. A total is a cache of the lines, and the lines
     are the payslip. (attendanceModel.js's recalculate() makes the same
     promise about punches.)

  2. NOTHING IS RECOMPUTED AFTER PUBLISHING. A published payslip is a
     statement the company has made. The only thing that may happen to
     it afterwards is being marked Paid, or being cancelled in public.

  WHY A REFUSAL IS NOT AN ERROR
  -----------------------------
  "That month has already been generated" and "the database is down"
  are both exceptions in javascript and completely different things to
  the person clicking the button. Refusals thrown here carry
  `isSalaryRefusal` and a statusCode, and the controller answers with
  it; anything else keeps its 500 and its console line. The same
  contract config/attendanceService.js established.
=========================================================================
*/

import mongoose from "mongoose";

import Payslip from "../model/payslipModel.js";
import SalaryStructure from "../model/salaryStructureModel.js";
import Attendance from "../model/attendanceModel.js";

import { getCalendar, getLocalDateKey } from "./workingCalendar.js";
import {
  listDateKeys,
  describeDateKey,
  PRESENT_STATUSES,
} from "./attendanceConstants.js";

import {
  EARNING_COMPONENTS,
  DEDUCTION_COMPONENTS,
  LOSS_OF_PAY_LABEL,
  BONUS_LABEL,
  EDITABLE_STATUSES,
  MAX_PAYROLL_EMPLOYEES,
  monthRange,
  formatMonthLong,
  roundMoney,
} from "./salaryConstants.js";

/* =====================================================================
   HELPER - a refusal the user is allowed to see
   ===================================================================== */
export const refuse = (message, statusCode = 409) => {
  const error = new Error(message);

  error.isSalaryRefusal = true;
  error.statusCode = statusCode;

  return error;
};

/* =====================================================================
   1) WHICH MONTH IS IT, AT THE COMPANY?
   ---------------------------------------------------------------------
   Not on the server. A payroll month has to be the same page of the
   calendar for everybody who opens the screen, and Module 9 already
   knows which calendar the company is on - see the long note at the top
   of components/TopbarClock.jsx for the same argument about the clock.
   ===================================================================== */
export const getCurrentMonthKey = async () => {
  const calendar = await getCalendar();

  return getLocalDateKey(new Date(), calendar.timezone).slice(0, 7);
};

/* =====================================================================
   2) HOW MANY DAYS THE COMPANY WAS OPEN IN A MONTH
   ---------------------------------------------------------------------
   Weekends off, holidays off - Module 9's working calendar, the same
   one attendance is judged by and reminders are held back on.

   THIS IS THE DIVISOR OF THE WHOLE MODULE. The per-day rate that a
   loss-of-pay deduction is worked out from is the month's gross
   divided by this number, so a month with a public holiday in it has a
   slightly higher day rate than one without - which is correct, and is
   how a monthly salary actually behaves.

   It is worked out ONCE PER RUN and frozen onto every payslip, not
   re-read when a slip is displayed: adding a holiday in September must
   not change what August's slip says it was counted against.
   ===================================================================== */
export const countWorkingDays = async (monthKey) => {
  const calendar = await getCalendar();

  const { from, to } = monthRange(monthKey);

  return listDateKeys(from, to).filter(
    (dateKey) => describeDateKey(calendar, dateKey).isWorkingDay
  ).length;
};

/* =====================================================================
   3) WHO WAS ACTUALLY THERE
   ---------------------------------------------------------------------
   One aggregation for the whole run rather than one query per
   employee: a 300 person payroll is one trip to the database.

   AN ATTENDANCE RECORD IS PRESENCE. Module 11 never stores an absence
   (there is no "Absent" document - see its model), so counting the
   records that exist is the only honest way to count the days somebody
   was at work.

   @returns a Map of "userId" -> number of days present
   ===================================================================== */
export const countPresentDays = async (userIds, monthKey) => {
  const { from, to } = monthRange(monthKey);

  const rows = await Attendance.aggregate([
    {
      $match: {
        user: { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        dateKey: { $gte: from, $lte: to },
        status: { $in: PRESENT_STATUSES },
      },
    },
    { $group: { _id: "$user", days: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.days]));
};

/* =====================================================================
   4) THE LOSS OF PAY A RUN PROPOSES
   ---------------------------------------------------------------------
   PROPOSED. NEVER FINAL. This is the one number in the module that the
   system is not allowed to be sure about, and pretending otherwise
   would take money off somebody's pay for a day their manager had
   approved.

   FlowDesk has no leave BALANCE. Leave is raised as an ordinary
   request in Module 2 and approved through Module 4, and nothing
   anywhere says whether an approved absence was paid or unpaid - which
   is exactly what this arithmetic would need to know.

   So the run works out the days with no attendance record, writes them
   into the DRAFT as a starting point, and payroll corrects them before
   publishing. The number is on the payslip either way, so the employee
   can see the arithmetic rather than just its result.

   THE FLOOR AT ZERO IS NOT PARANOIA: somebody who came in on a Sunday
   has more present days than the month had working days, and a
   negative loss of pay would quietly become a bonus.
   ===================================================================== */
export const proposeLopDays = (workingDays, presentDays) =>
  Math.max(0, workingDays - presentDays);

/* =====================================================================
   5) THE LINES OF ONE PAYSLIP
   ---------------------------------------------------------------------
   The heart of the module. A structure plus a month's days becomes the
   list of lines that will be PRINTED - see the note on payslipLineSchema
   in model/payslipModel.js for why a payslip stores lines and not
   components.

   THE ORDER OF THE DEDUCTIONS IS DELIBERATE: the standing ones first,
   in the order of the constants file, and loss of pay LAST. It is the
   line an employee looks for, and a line somebody is looking for should
   not be in the middle of a list.

   Zero lines are dropped. A payslip that lists five allowances the
   employee does not get is a payslip nobody reads to the bottom.

   @param structure  the employee's SalaryStructure (a plain object or a
                     document - only its numbers are read)
   @param workingDays / lopDays   the month's days
   @param bonus      a one-off amount for THIS month only
   @returns { earnings: [line], deductions: [line] }
   ===================================================================== */
export const buildPayslipLines = ({ structure, workingDays, lopDays = 0, bonus = 0 }) => {
  const earnings = EARNING_COMPONENTS.map((component) => ({
    key: component.key,
    label: component.label,
    amount: roundMoney(structure?.earnings?.[component.key] || 0),
  })).filter((line) => line.amount > 0);

  const deductions = DEDUCTION_COMPONENTS.map((component) => ({
    key: component.key,
    label: component.label,
    amount: roundMoney(structure?.deductions?.[component.key] || 0),
  })).filter((line) => line.amount > 0);

  /*
    THE PER-DAY RATE IS BUILT FROM THE STANDING PAY ONLY.

    A bonus is not part of what a day is worth, so it is added after
    the rate has been taken - otherwise a month with a bonus in it
    would make each missed day more expensive than the same day in the
    month before, which is a rule nobody agreed to.
  */
  const standingGross = roundMoney(
    earnings.reduce((total, line) => total + line.amount, 0)
  );

  if (bonus > 0) {
    earnings.push({ key: "bonus", label: BONUS_LABEL, amount: roundMoney(bonus) });
  }

  if (lopDays > 0 && workingDays > 0 && standingGross > 0) {
    const perDay = standingGross / workingDays;

    deductions.push({
      key: "lossOfPay",
      /*
        The label carries the DAYS, because "Loss of Pay 12,000" on its
        own is a number somebody has to come and ask about, and "Loss
        of Pay (2 days)" is an answer.
      */
      label: `${LOSS_OF_PAY_LABEL} (${lopDays} ${lopDays === 1 ? "day" : "days"})`,
      /*
        Never more than the standing gross. Without the cap, a data
        problem in attendance - a month of missing records for somebody
        who was working all along - could produce a payslip with a
        NEGATIVE net pay, which is a document that should not be
        capable of existing.
      */
      amount: roundMoney(Math.min(perDay * lopDays, standingGross)),
    });
  }

  return { earnings, deductions };
};

/* =====================================================================
   6) THE THREE TOTALS
   ---------------------------------------------------------------------
   The ONLY writer of grossEarnings, totalDeductions and netPay. It
   never trusts what is stored - it adds the lines up again.
   ===================================================================== */
export const recalculateTotals = (payslip) => {
  const gross = roundMoney(
    (payslip.earnings || []).reduce((total, line) => total + (line.amount || 0), 0)
  );

  const deducted = roundMoney(
    (payslip.deductions || []).reduce((total, line) => total + (line.amount || 0), 0)
  );

  payslip.grossEarnings = gross;
  payslip.totalDeductions = deducted;
  payslip.netPay = roundMoney(gross - deducted);

  return payslip;
};

/* =====================================================================
   7) EDITING A DRAFT
   ---------------------------------------------------------------------
   The three things payroll may change after a run and before anybody
   is told: the loss of pay it proposed, a one-off bonus, and the
   remark printed on the slip.

   IT REBUILDS THE TWO DERIVED LINES FROM THE STANDING ONES rather than
   nudging the old ones, for the same reason recalculate() rebuilds
   attendance totals: an "adjust the existing line" shortcut is correct
   until the day somebody edits twice, and then it is silently wrong on
   a document about money.

   THE COMPONENTS THEMSELVES ARE NOT EDITABLE HERE, on purpose. Basic
   pay is a property of the EMPLOYMENT, not of a month: changing it for
   one payslip would produce a slip that disagrees with the structure it
   claims to come from, and the next month would quietly go back. A
   raise is a change to the structure, which is a different screen and a
   different permission.
   ===================================================================== */
export const applyAdjustments = (payslip, { lopDays, bonus, remarks }) => {
  if (!EDITABLE_STATUSES.includes(payslip.status)) {
    throw refuse(
      `This payslip is ${payslip.status.toLowerCase()} and its numbers can no longer be changed.`,
      409
    );
  }

  // the lines that came from the structure, without the two derived ones
  const standingEarnings = (payslip.earnings || []).filter(
    (line) => line.key !== "bonus"
  );

  const standingDeductions = (payslip.deductions || []).filter(
    (line) => line.key !== "lossOfPay"
  );

  const nextLop = lopDays === undefined ? payslip.lopDays : Math.max(0, Number(lopDays));

  const currentBonus =
    (payslip.earnings || []).find((line) => line.key === "bonus")?.amount || 0;

  const nextBonus = bonus === undefined ? currentBonus : Math.max(0, Number(bonus));

  if (nextLop > payslip.workingDays) {
    throw refuse(
      `${formatMonthLong(payslip.monthKey)} had only ${payslip.workingDays} working days.`,
      400
    );
  }

  /*
    buildPayslipLines() is handed the standing lines dressed up as a
    structure, so the derived lines are worked out by exactly the same
    code that built them in the first place. Two functions that both
    know how to price a day is one function too many.
  */
  const asStructure = {
    earnings: Object.fromEntries(
      standingEarnings.map((line) => [line.key, line.amount])
    ),
    deductions: Object.fromEntries(
      standingDeductions.map((line) => [line.key, line.amount])
    ),
  };

  const rebuilt = buildPayslipLines({
    structure: asStructure,
    workingDays: payslip.workingDays,
    lopDays: nextLop,
    bonus: nextBonus,
  });

  /*
    The labels of the standing lines are kept as they were PRINTED, not
    as the constants call them today - a payslip is a document. Only
    the derived two are taken from the rebuild.
  */
  payslip.earnings = [
    ...standingEarnings,
    ...rebuilt.earnings.filter((line) => line.key === "bonus"),
  ];

  payslip.deductions = [
    ...standingDeductions,
    ...rebuilt.deductions.filter((line) => line.key === "lossOfPay"),
  ];

  payslip.lopDays = nextLop;
  payslip.payableDays = Math.max(0, payslip.workingDays - nextLop);

  if (remarks !== undefined) {
    payslip.remarks = remarks;
  }

  return recalculateTotals(payslip);
};

/* =====================================================================
   8) RUNNING A WHOLE MONTH
   ---------------------------------------------------------------------
   POST /api/salary/payroll/:month/generate ends up here.

   WHAT IT REFUSES, AND WHY EACH ONE IS A REFUSAL AND NOT A SKIP
   -------------------------------------------------------------
     a month that has not finished   ->  refused outright. Paying August
                                         on the 3rd of August means the
                                         loss of pay is worked out
                                         against a month that has not
                                         happened, and every employee
                                         looks absent for the rest of it.
     an employee with no structure   ->  SKIPPED, and reported by name.
                                         Nobody is paid a number nobody
                                         entered; the run tells payroll
                                         who is missing so they can fix
                                         it and run again.
     an employee already paid        ->  SKIPPED. The unique index in
                                         model/payslipModel.js is the
                                         real guard; this is the polite
                                         version of it.

   THE RUN IS RE-RUNNABLE. That is what makes the skips safe: fix the
   two people it reported, press the button again, and only the two are
   added. Nothing already generated is touched, so a second run can
   never disturb a slip somebody has already been shown.

   @returns { created, skipped: [{ name, reason }], monthKey, workingDays }
   ===================================================================== */
export const generatePayroll = async ({ employees, monthKey, actorId }) => {
  if (employees.length === 0) {
    throw refuse("There are no employees in this payroll.", 400);
  }

  if (employees.length > MAX_PAYROLL_EMPLOYEES) {
    throw refuse(
      `A single run can cover at most ${MAX_PAYROLL_EMPLOYEES} employees.`,
      400
    );
  }

  const workingDays = await countWorkingDays(monthKey);

  const userIds = employees.map((employee) => employee._id);

  /* ---------------- what we already know about these people ---------------- */
  const [structures, presentMap, existing] = await Promise.all([
    SalaryStructure.find({ user: { $in: userIds } }).lean(),
    countPresentDays(userIds, monthKey),
    Payslip.find({ user: { $in: userIds }, monthKey }).select("user").lean(),
  ]);

  const structureMap = new Map(
    structures.map((structure) => [String(structure.user), structure])
  );

  const alreadyPaid = new Set(existing.map((payslip) => String(payslip.user)));

  const { to: lastDay } = monthRange(monthKey);

  const documents = [];
  const skipped = [];

  employees.forEach((employee) => {
    const id = String(employee._id);

    if (alreadyPaid.has(id)) {
      skipped.push({
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        reason: "already generated",
      });
      return;
    }

    const structure = structureMap.get(id);

    if (!structure || !structure.isActive) {
      skipped.push({
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        reason: structure ? "salary is on hold" : "no salary structure",
      });
      return;
    }

    /*
      A RAISE ENTERED IN ADVANCE MUST NOT LEAK BACKWARDS.

      effectiveFrom is the month the pay starts. A structure that
      starts in October is not what September should be paid on, and
      the person who typed it in early was being organised, not making
      a mistake - so the run refuses that one employee rather than
      silently overpaying them.
    */
    if (structure.effectiveFrom && structure.effectiveFrom > monthKey) {
      skipped.push({
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        reason: `pay starts ${formatMonthLong(structure.effectiveFrom)}`,
      });
      return;
    }

    const presentDays = presentMap.get(id) || 0;
    const lopDays = proposeLopDays(workingDays, presentDays);

    const { earnings, deductions } = buildPayslipLines({
      structure,
      workingDays,
      lopDays,
    });

    const payslip = {
      user: employee._id,
      monthKey,

      // the frozen identity - see the note at the top of payslipModel.js
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeId || "",
      designation: employee.designation || "",
      department: employee.department?._id || employee.department || null,
      departmentName: employee.department?.name || "",
      dateOfJoining: employee.dateOfJoining || null,

      bankName: structure.bankName || "",
      accountLast4: structure.accountLast4 || "",
      pan: structure.pan || "",
      pfNumber: structure.pfNumber || "",
      uan: structure.uan || "",

      workingDays,
      presentDays,
      lopDays,
      payableDays: Math.max(0, workingDays - lopDays),

      earnings,
      deductions,

      status: "Draft",
      generatedBy: actorId,
      generatedAt: new Date(),
    };

    documents.push(recalculateTotals(payslip));
  });

  if (documents.length === 0) {
    throw refuse(
      `Nothing to generate for ${formatMonthLong(monthKey)} - every employee was skipped.`,
      409
    );
  }

  /*
    ordered: false means one bad document does not abandon the rest.

    The case it is really there for is the unique index doing its job:
    two finance managers pressing the button at the same moment. The
    second insert loses the race on the people the first one wrote, and
    those duplicate-key errors are exactly what SHOULD be ignored -
    the employee has a payslip either way, which is the outcome we
    wanted. Anything else is re-thrown.
  */
  let created = 0;

  try {
    const inserted = await Payslip.insertMany(documents, { ordered: false });

    created = inserted.length;
  } catch (error) {
    if (error?.code === 11000 || error?.writeErrors) {
      created =
        error.insertedDocs?.length ??
        error.result?.insertedCount ??
        error.result?.nInserted ??
        0;

      const duplicates = (error.writeErrors || []).filter(
        (writeError) => writeError?.err?.code === 11000 || writeError?.code === 11000
      );

      // a write that failed for any OTHER reason is a real bug
      if (duplicates.length !== (error.writeErrors || []).length) {
        throw error;
      }

      duplicates.forEach(() => {
        skipped.push({ name: "An employee", reason: "already generated" });
      });
    } else {
      throw error;
    }
  }

  return { created, skipped, monthKey, workingDays, lastDay };
};

/* =====================================================================
   9) HAS THIS MONTH FINISHED?
   ---------------------------------------------------------------------
   Asked before a run. See the refusal list above for why a month that
   is still running cannot be paid.

   The comparison is on month KEYS, as text, which is the whole reason
   they are text: "2026-07" < "2026-08" is true as a string exactly as
   it is as a date, with no timezone anywhere in it.
   ===================================================================== */
export const isMonthFinished = async (monthKey) => {
  const current = await getCurrentMonthKey();

  return monthKey < current;
};

/* =====================================================================
   10) ONE PAYSLIP, AS THE BROWSER WANTS IT
   ---------------------------------------------------------------------
   The API shape, in one place, so the employee's page, the payroll
   screen and the receipt all describe a payslip the same way.

   `canDownload` is answered HERE rather than being worked out by each
   screen: a draft has no receipt, because the receipt is a document
   and a draft is not one yet.
   ===================================================================== */
export const presentPayslip = (payslip) => ({
  _id: payslip._id,
  monthKey: payslip.monthKey,
  monthLabel: formatMonthLong(payslip.monthKey),

  employeeName: payslip.employeeName,
  employeeCode: payslip.employeeCode,
  designation: payslip.designation,
  departmentName: payslip.departmentName,

  workingDays: payslip.workingDays,
  presentDays: payslip.presentDays,
  lopDays: payslip.lopDays,
  payableDays: payslip.payableDays,

  earnings: payslip.earnings,
  deductions: payslip.deductions,

  grossEarnings: payslip.grossEarnings,
  totalDeductions: payslip.totalDeductions,
  netPay: payslip.netPay,

  bankName: payslip.bankName,
  accountLast4: payslip.accountLast4,
  pan: payslip.pan,
  pfNumber: payslip.pfNumber,
  uan: payslip.uan,

  status: payslip.status,
  remarks: payslip.remarks,

  publishedAt: payslip.publishedAt,
  paidOn: payslip.paidOn,
  paymentReference: payslip.paymentReference,
  cancelledAt: payslip.cancelledAt,
  cancellationReason: payslip.cancellationReason,

  canDownload: payslip.status !== "Draft",
});
