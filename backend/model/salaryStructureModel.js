/*
=========================================================================
  MODEL: SalaryStructure                          ( the "M" of MVC )
=========================================================================
  Module 12 - Payroll & Salary.

  ONE DOCUMENT = ONE EMPLOYEE'S CURRENT PAY.

  Not one per month, and not one per revision. This is the standing
  answer to "what does this person earn?", and the payroll run copies it
  into a payslip every month.

  WHERE THE HISTORY IS, SINCE IT IS NOT HERE
  ------------------------------------------
  In the payslips. Every one of them carries a frozen copy of the
  components it was built from, so "what was Ravi on in March?" is
  answered by March's payslip - by the document that was actually
  issued, rather than by a version table that nobody ever reconciled
  against it.

  That is the whole reason this collection can afford to be one row per
  person: it is a WORKING VALUE, and the record of what was paid lives
  in the documents that were paid out. A structure with no payslips
  behind it has never paid anybody anything.

  WHAT IS DELIBERATELY NOT HERE
  -----------------------------
  THE BANK ACCOUNT NUMBER. A payslip shows the last four digits so the
  employee can tell which account it went to, and that is all this
  application ever needs - it does not move money. Storing the full
  number would make FlowDesk's database worth stealing for a reason that
  has nothing to do with FlowDesk, in exchange for a feature nobody
  asked for. See the note on `accountLast4` below.
=========================================================================
*/

import mongoose from "mongoose";

import {
  EARNING_COMPONENTS,
  DEDUCTION_COMPONENTS,
  roundMoney,
} from "../config/salaryConstants.js";

/*
  The two component blocks are built FROM the constants rather than
  typed out here.

  A component added to config/salaryConstants.js has to appear in the
  schema, in the calculator, on the payslip and in the exports. Three of
  those read the list already; a hand-written schema would be the one
  place that silently did not, and the symptom would be a component that
  an admin can type into a form and that mongoose then throws away
  without a word.
*/
const buildComponentSchema = (components) =>
  components.reduce(
    (fields, component) => ({
      ...fields,
      [component.key]: {
        type: Number,
        default: 0,
        min: [0, `${component.label} cannot be negative`],
      },
    }),
    {}
  );

const salaryStructureSchema = new mongoose.Schema(
  {
    /* ================================================================
       1) WHOSE PAY THIS IS
       ================================================================ */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A salary structure must belong to an employee"],
      unique: true, // one standing structure per person - see the note above
    },

    /* ================================================================
       2) THE MONTHLY COMPONENTS
       ----------------------------------------------------------------
       Monthly, never annual. The annual CTC on screen is twelve times
       the gross below, worked out on read, so the two can never
       disagree - see the note at the top of config/salaryConstants.js.
       ================================================================ */
    earnings: buildComponentSchema(EARNING_COMPONENTS),

    deductions: buildComponentSchema(DEDUCTION_COMPONENTS),

    /* ================================================================
       3) WHERE THE MONEY GOES
       ----------------------------------------------------------------
       Printed on the payslip so the employee can see which account was
       used, and useful for nothing else.
       ================================================================ */

    bankName: {
      type: String,
      trim: true,
      default: "",
      maxlength: [80, "A bank name cannot be more than 80 characters"],
    },

    /*
      THE LAST FOUR DIGITS, AND NOTHING ELSE.

      Four digits identify an account to the person who owns it and to
      nobody else, which is exactly the job the payslip needs done. The
      controller refuses anything longer, so a well-meaning finance
      manager pasting a full account number into this box does not
      quietly turn it into a stored credential.
    */
    accountLast4: {
      type: String,
      trim: true,
      default: "",
      maxlength: [4, "Store only the last four digits of the account"],
    },

    /* ================================================================
       4) THE STATUTORY IDENTIFIERS
       ----------------------------------------------------------------
       They belong on an Indian payslip, they belong to the EMPLOYEE,
       and they are shown only to them and to payroll - which is the
       same audience as the pay itself, so they need no separate rule.
       ================================================================ */

    pan: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
      maxlength: [10, "A PAN is 10 characters"],
    },

    pfNumber: {
      type: String,
      trim: true,
      default: "",
      maxlength: [40, "A PF number cannot be more than 40 characters"],
    },

    uan: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "A UAN cannot be more than 20 characters"],
    },

    /* ================================================================
       5) WHEN THIS PAY STARTED, AND WHO SET IT
       ----------------------------------------------------------------
       effectiveFrom is a payroll MONTH ("2026-07"), not a date: pay
       changes take effect from a month, because that is the unit a
       payslip is issued in.

       IT IS ALSO A GUARD. The payroll run refuses to pay a structure
       that starts after the month being run, so a raise entered in
       advance for October cannot leak into September's payroll.
       ================================================================ */

    effectiveFrom: {
      type: String,
      trim: true,
      default: "",
    },

    /*
      WHO LAST CHANGED SOMEBODY'S PAY, AND WHEN.

      The audit log records it too, and this is not a duplicate of that
      for once: the audit log answers "what happened in the company",
      while this answers "who owns this number" on the screen where the
      number is being looked at. The one question a payroll query
      always ends in is "who approved that?", and making the reader go
      to another page for it is how it stops being asked.
    */
    revisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    revisedAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "A note cannot be more than 300 characters"],
    },

    /*
      A structure can be switched OFF without being deleted - for
      somebody on unpaid sabbatical, or who has left. The payroll run
      skips them, and their old payslips are untouched.
    */
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

/* =====================================================================
   THE THREE TOTALS
   ---------------------------------------------------------------------
   Methods rather than stored fields, and this is the one place in
   FlowDesk where a total is deliberately NOT cached.

   attendanceModel.js stores its totals because a month of attendance
   for a department is a $group over hundreds of documents. A salary
   structure is one document per employee, read one at a time on a
   screen somebody is looking at, and the sum of six numbers is free.
   Storing it would only create the possibility of it being wrong.
   ===================================================================== */

salaryStructureSchema.methods.grossEarnings = function () {
  return roundMoney(
    EARNING_COMPONENTS.reduce(
      (total, component) => total + (this.earnings?.[component.key] || 0),
      0
    )
  );
};

salaryStructureSchema.methods.totalDeductions = function () {
  return roundMoney(
    DEDUCTION_COMPONENTS.reduce(
      (total, component) => total + (this.deductions?.[component.key] || 0),
      0
    )
  );
};

salaryStructureSchema.methods.netPay = function () {
  return roundMoney(this.grossEarnings() - this.totalDeductions());
};

const SalaryStructure = mongoose.model("SalaryStructure", salaryStructureSchema);

export default SalaryStructure;
