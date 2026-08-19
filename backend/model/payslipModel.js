/*
=========================================================================
  MODEL: Payslip                                  ( the "M" of MVC )
=========================================================================
  Module 12 - Payroll & Salary.

  ONE DOCUMENT = ONE EMPLOYEE, ONE MONTH.

  The same shape Module 11 chose for attendance, and for a stronger
  reason: a payslip is not a summary of anything, it IS the statement
  the company made about what somebody was paid.

  EVERYTHING ON IT IS FROZEN
  --------------------------
  The lines, the totals, the employee's name, their department, their
  designation, the days it was counted against, the bank the money went
  to. Not one of them is read through a `ref` when the payslip is
  displayed.

  That is deliberate and it is the whole design:

    - a raise in April must not rewrite March's payslip
    - moving from Engineering to Sales in June must not move May's
      salary cost out of Engineering's report
    - a change of surname must not alter a document somebody has
      already handed to a bank

  The user and department ObjectIds are still stored, because "every
  payslip of this person" has to be a query - but they are how the
  document is FOUND, never how it is READ. The same split
  auditModel.js makes between `actor` and `actorName`.

  THE UNIQUE INDEX IS THE RULE, NOT AN OPTIMISATION
  -------------------------------------------------
  One employee cannot be paid twice for the same month. Two finance
  managers pressing "Run payroll" at the same moment is not a rare case
  - it is the last day of the month - and only the database can settle
  it. The service catches the duplicate key error and treats that
  employee as already generated, so the second run reports the truth
  instead of writing a second slip.
=========================================================================
*/

import mongoose from "mongoose";

import { PAYSLIP_STATUSES } from "../config/salaryConstants.js";

/* =====================================================================
   SUB-SCHEMA - one printed line
   ---------------------------------------------------------------------
   A payslip does NOT store an object with a field per component, the
   way the structure does. It stores the LINES THAT WERE PRINTED, in
   order, each with the label it was printed under.

   The difference matters the day a component is renamed or retired.
   The structure is a working value and should follow the code; a
   payslip is a document, and a document that redraws itself when the
   code changes is not a document. A payslip printed under "Medical
   Allowance" still says "Medical Allowance" in five years, whatever
   config/salaryConstants.js has been renamed to since.

   `key` is kept beside the label so a report can still add the same
   component up across a year without matching on English text.
   ===================================================================== */
const payslipLineSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "A payslip line needs a key"],
      trim: true,
    },

    label: {
      type: String,
      required: [true, "A payslip line needs a label"],
      trim: true,
    },

    amount: {
      type: Number,
      required: [true, "A payslip line needs an amount"],
    },
  },
  { _id: false } // a line is never addressed on its own
);

const payslipSchema = new mongoose.Schema(
  {
    /* ================================================================
       1) WHO, AND WHICH MONTH
       ================================================================ */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A payslip must belong to an employee"],
    },

    // "2026-07" - see the note on month keys in config/salaryConstants.js
    monthKey: {
      type: String,
      required: [true, "A payslip must belong to a payroll month"],
      trim: true,
    },

    /* ================================================================
       2) THE FROZEN IDENTITY
       ----------------------------------------------------------------
       Who this person WAS when they were paid. See the note at the top
       of the file - this block is the reason it is there.
       ================================================================ */

    employeeName: {
      type: String,
      required: [true, "A payslip must name the employee"],
      trim: true,
    },

    employeeCode: {
      type: String,
      trim: true,
      default: "",
    },

    designation: {
      type: String,
      trim: true,
      default: "",
    },

    // stored for the query ("Engineering's payroll cost")...
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    // ...and separately for the reading, so a transfer cannot rewrite it
    departmentName: {
      type: String,
      trim: true,
      default: "",
    },

    dateOfJoining: {
      type: Date,
      default: null,
    },

    /* ================================================================
       3) WHERE THE MONEY WENT, AND UNDER WHICH NUMBERS
       ----------------------------------------------------------------
       Copied off the structure at generation time. An employee who
       changes bank in August has an August payslip showing the new
       account and a July payslip still showing the old one, which is
       what actually happened.
       ================================================================ */

    bankName: { type: String, trim: true, default: "" },
    accountLast4: { type: String, trim: true, default: "" },
    pan: { type: String, trim: true, default: "" },
    pfNumber: { type: String, trim: true, default: "" },
    uan: { type: String, trim: true, default: "" },

    /* ================================================================
       4) THE DAYS THIS MONTH WAS PAID FOR
       ----------------------------------------------------------------
       Module 11 is what makes these real numbers rather than a
       constant, and they are on the slip because an employee whose pay
       is short by a day is owed the arithmetic, not just the answer.

       THEY ARE FROZEN TOO. Correcting an attendance record in
       September must not change what August's payslip says it was
       counted against - the money has already moved.
       ================================================================ */

    // the days the COMPANY was open in the month (Module 9's calendar)
    workingDays: { type: Number, default: 0, min: 0 },

    // the days there is an attendance record for
    presentDays: { type: Number, default: 0, min: 0 },

    /*
      Days not worked and not paid for.

      PROPOSED BY THE SYSTEM, DECIDED BY A PERSON. The run works this
      out from attendance, and payroll can overwrite it before
      publishing - because FlowDesk has no leave BALANCE, so it cannot
      tell approved paid leave from an unexplained absence. Guessing
      would take money off somebody's pay for a day their manager had
      approved. See the note in config/salaryService.js.
    */
    lopDays: { type: Number, default: 0, min: 0 },

    // workingDays - lopDays, stored because it is what the slip prints
    payableDays: { type: Number, default: 0, min: 0 },

    /* ================================================================
       5) THE LINES AND THE TOTALS
       ================================================================ */

    earnings: { type: [payslipLineSchema], default: [] },

    deductions: { type: [payslipLineSchema], default: [] },

    /*
      The three totals ARE stored here, unlike on the structure.

      A structure's total is six numbers added up for one person on
      screen. A payroll month is "what did we pay out in July" across
      three hundred documents, and a stored total turns that into a
      $sum. More importantly: these are printed on a document, and a
      printed total that is recomputed on every read is a total that
      can one day differ from the paper.

      Nothing writes them by hand - config/salaryService.js rebuilds
      all three from the lines, the same contract attendance's
      recalculate() has.
    */
    grossEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },

    /* ================================================================
       6) WHERE IT IS IN ITS LIFE
       ----------------------------------------------------------------
       Draft -> Published -> Paid, or Cancelled. The long version is in
       config/salaryConstants.js.
       ================================================================ */

    status: {
      type: String,
      enum: {
        values: PAYSLIP_STATUSES,
        message: "{VALUE} is not a valid payslip status",
      },
      default: "Draft",
    },

    /*
      WHO DID EACH OF THE THREE THINGS, AND WHEN.

      Generating, releasing and paying are three different acts by
      possibly three different people, and a payslip that records only
      the last of them cannot answer the question anybody actually
      asks: "who released this?"
    */
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    generatedAt: { type: Date, default: null },

    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },

    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    paidAt: { type: Date, default: null },

    // the day the money actually left, which is not the day it was recorded
    paidOn: { type: Date, default: null },

    // the bank's transfer reference, so a query can be traced outwards
    paymentReference: {
      type: String,
      trim: true,
      default: "",
      maxlength: [60, "A payment reference cannot be more than 60 characters"],
    },

    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },

    /*
      WHY it was cancelled, required by the controller.

      A cancelled payslip stays on the employee's own page (see
      config/salaryConstants.js), so this sentence is written to be
      READ BY THEM. A cancellation with no reason on a document about
      somebody's money is the worst thing this module could show
      anybody.
    */
    cancellationReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "A cancellation reason cannot be more than 300 characters"],
    },

    // whatever payroll wants the employee to read on the slip itself
    remarks: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "A remark cannot be more than 300 characters"],
    },
  },
  { timestamps: true }
);

/* =====================================================================
   INDEXES
   ---------------------------------------------------------------------
   The first one is the RULE described at the top of the file: one
   employee, one month, one payslip.
   ===================================================================== */
payslipSchema.index({ user: 1, monthKey: 1 }, { unique: true });

// "my payslips, newest first" - the employee's own Salary page
payslipSchema.index({ user: 1, monthKey: -1 });

// "the whole company for July" - the payroll screen and the register
payslipSchema.index({ monthKey: 1, status: 1 });

// "what did Engineering cost in July" - the department report
payslipSchema.index({ department: 1, monthKey: 1 });

const Payslip = mongoose.model("Payslip", payslipSchema);

export default Payslip;
