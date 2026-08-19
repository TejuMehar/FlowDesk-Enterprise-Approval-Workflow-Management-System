/*
=========================================================================
  THE PAYSLIP RECEIPT   (Module 12 - Payroll & Salary)
=========================================================================
  One payslip, as a PDF the employee downloads and keeps.

  WHY THIS IS NOT config/reportExport.js
  --------------------------------------
  Module 8's exporter turns a report ENVELOPE - columns, rows, summary -
  into a file, and Modules 8, 11 and the salary REGISTER all use it,
  because they are all tables.

  A payslip is not a table. It is a document about one person, with the
  company at the top of it, two columns of lines facing each other, a
  net pay in figures AND in words, and a footer that says who produced
  it. It is handed to a landlord, a bank or a visa office by somebody
  who needs it to look like a payslip, and squeezing that into a
  generic table writer would produce something that is technically the
  right numbers and obviously not the document.

  So this file is the one place in FlowDesk that draws a specific page,
  and it is worth the ~200 lines exactly once.

  IT IS STREAMED STRAIGHT TO THE RESPONSE, like the report PDF: PDFKit
  writes as it draws, so nothing is held in memory waiting to be sent.
=========================================================================
*/

import PDFDocument from "pdfkit";

import {
  formatMoney,
  amountInWords,
  formatMonthLong,
} from "./salaryConstants.js";
import { CURRENCY_CODE } from "./reportConstants.js";

/* =====================================================================
   THE INK
   ---------------------------------------------------------------------
   The same slate palette the report PDF uses, so two documents out of
   the same application look like they came from the same application.
   ===================================================================== */
const INK = {
  heading: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  rule: "#e2e8f0",
  band: "#f8fafc",
  headerFill: "#1e293b",
  accent: "#4f46e5",
  danger: "#b91c1c",
};

const MARGIN = 40;
const LINE_HEIGHT = 18;

/*
  PDFKit's built-in Helvetica only draws Latin-1. A name in Devanagari
  would come out as scattered blanks, which reads as a corrupt file
  rather than a missing font - so it is replaced with "?" and the
  reader can see that something was there. The same compromise, and the
  same note, as config/reportExport.js.
*/
const safe = (text) => String(text ?? "").replace(/[^\x00-\xFF]/g, "?");

/*
  The status stamp in the corner.

  A payslip that has been CANCELLED must say so on the page itself and
  not only in the application - by the time it is cancelled, the file is
  already on somebody's laptop, and a cancelled document that looks
  identical to a valid one is the one genuinely dangerous thing this
  module could produce.
*/
const STATUS_STAMP = {
  Published: { text: "PUBLISHED", colour: INK.accent },
  Paid: { text: "PAID", colour: "#15803d" },
  Cancelled: { text: "CANCELLED", colour: INK.danger },
};

/* =====================================================================
   THE FILE NAME
   ---------------------------------------------------------------------
   "flowdesk-payslip-EMP-0007-2026-07.pdf"

   The employee code and the month are both in it because these files
   end up in a folder with eleven of their brothers, and "payslip.pdf"
   twelve times over is a folder nobody can use. The same reasoning
   buildFileName() gives in config/reportExport.js.
   ===================================================================== */
export const buildPayslipFileName = (payslip) =>
  `flowdesk-payslip-${(payslip.employeeCode || "employee").toLowerCase()}-${
    payslip.monthKey
  }.pdf`;

/* =====================================================================
   THE DOCUMENT
   ---------------------------------------------------------------------
   @param payslip  the Payslip document (frozen - nothing is read
                   through a ref, see model/payslipModel.js)
   @param company  { companyName, companyLogo } from Module 9's Settings
   @param res      the express response, written to directly
   ===================================================================== */
export const streamPayslip = (payslip, company, res) => {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `Payslip ${formatMonthLong(payslip.monthKey)} - ${payslip.employeeName}`,
      Author: company?.companyName || "FlowDesk",
      CreationDate: new Date(),
    },
  });

  doc.pipe(res);

  const pageWidth = doc.page.width - MARGIN * 2;

  /* =================================================================
     1) THE COMPANY, AND WHAT THIS PAGE IS
     ================================================================= */
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(INK.heading)
    .text(safe(company?.companyName || "FlowDesk"), MARGIN, MARGIN, {
      width: pageWidth * 0.7,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(INK.muted)
    .text(`Payslip for ${formatMonthLong(payslip.monthKey)}`, {
      width: pageWidth * 0.7,
    });

  /* ---------------- the stamp, top right ---------------- */
  const stamp = STATUS_STAMP[payslip.status];

  if (stamp) {
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(stamp.colour)
      .text(stamp.text, MARGIN + pageWidth * 0.7, MARGIN + 4, {
        width: pageWidth * 0.3,
        align: "right",
      });

    if (payslip.status === "Paid" && payslip.paidOn) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(INK.faint)
        .text(
          `on ${new Date(payslip.paidOn).toUTCString().slice(5, 16)}`,
          MARGIN + pageWidth * 0.7,
          MARGIN + 19,
          { width: pageWidth * 0.3, align: "right" }
        );
    }
  }

  doc.y = MARGIN + 46;

  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + pageWidth, doc.y)
    .lineWidth(1)
    .strokeColor(INK.headerFill)
    .stroke();

  doc.y += 14;

  /* =================================================================
     2) WHO WAS PAID
     -----------------------------------------------------------------
     Two columns of facts. Every one of them is read off the payslip
     itself and never off the user document - the whole point of the
     frozen identity block in model/payslipModel.js.
     ================================================================= */
  const factTop = doc.y;
  const columnWidth = pageWidth / 2;

  const drawFacts = (facts, left, top) => {
    let y = top;

    facts.forEach(([label, value]) => {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(INK.faint)
        .text(safe(label.toUpperCase()), left, y, {
          width: columnWidth - 20,
          lineBreak: false,
          ellipsis: true,
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(INK.heading)
        .text(safe(value || "-"), left, y + 10, {
          width: columnWidth - 20,
          lineBreak: false,
          ellipsis: true,
        });

      y += 26;
    });

    return y;
  };

  const leftEnd = drawFacts(
    [
      ["Employee", payslip.employeeName],
      ["Employee ID", payslip.employeeCode],
      ["Designation", payslip.designation],
      ["Department", payslip.departmentName],
    ],
    MARGIN,
    factTop
  );

  const rightEnd = drawFacts(
    [
      [
        "Paid days",
        `${payslip.payableDays} of ${payslip.workingDays}${
          payslip.lopDays > 0 ? `  (${payslip.lopDays} unpaid)` : ""
        }`,
      ],
      [
        "Bank",
        payslip.accountLast4
          ? `${payslip.bankName || "Account"} ****${payslip.accountLast4}`
          : payslip.bankName,
      ],
      ["PAN", payslip.pan],
      ["UAN / PF", payslip.uan || payslip.pfNumber],
    ],
    MARGIN + columnWidth,
    factTop
  );

  doc.y = Math.max(leftEnd, rightEnd) + 4;

  /* =================================================================
     3) THE TWO COLUMNS OF LINES
     -----------------------------------------------------------------
     Earnings on the left, deductions on the right, facing each other -
     the layout every payslip in the world uses, because the question
     the reader is asking is "what came off?" and the answer has to be
     next to what went on.

     THE TWO SIDES ARE DRAWN INDEPENDENTLY and then squared up: they
     almost never have the same number of lines, and a table that
     forced them to would be full of empty cells.
     ================================================================= */
  const tableTop = doc.y;

  const drawColumnHeader = (title, amountTitle, left) => {
    doc.rect(left, tableTop, columnWidth - 10, 20).fill(INK.headerFill);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#ffffff")
      .text(safe(title), left + 8, tableTop + 6, { width: columnWidth - 100 });

    doc.text(safe(amountTitle), left + columnWidth - 90, tableTop + 6, {
      width: 72,
      align: "right",
    });
  };

  drawColumnHeader("EARNINGS", CURRENCY_CODE, MARGIN);
  drawColumnHeader("DEDUCTIONS", CURRENCY_CODE, MARGIN + columnWidth);

  const drawLines = (lines, left) => {
    let y = tableTop + 20;

    lines.forEach((line, index) => {
      if (index % 2 === 1) {
        doc.rect(left, y, columnWidth - 10, LINE_HEIGHT).fill(INK.band);
      }

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(INK.body)
        .text(safe(line.label), left + 8, y + 5, {
          width: columnWidth - 100,
          lineBreak: false,
          ellipsis: true,
        });

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(INK.heading)
        .text(formatMoney(line.amount), left + columnWidth - 90, y + 5, {
          width: 72,
          align: "right",
          lineBreak: false,
        });

      y += LINE_HEIGHT;
    });

    return y;
  };

  const earningsBottom = drawLines(payslip.earnings || [], MARGIN);
  const deductionsBottom = drawLines(payslip.deductions || [], MARGIN + columnWidth);

  const linesBottom = Math.max(earningsBottom, deductionsBottom);

  /* ---------------- the two subtotals, on one line ---------------- */
  const drawTotal = (label, amount, left) => {
    doc
      .moveTo(left, linesBottom)
      .lineTo(left + columnWidth - 10, linesBottom)
      .lineWidth(0.7)
      .strokeColor(INK.rule)
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(INK.heading)
      .text(safe(label), left + 8, linesBottom + 6, { width: columnWidth - 100 });

    doc.text(formatMoney(amount), left + columnWidth - 90, linesBottom + 6, {
      width: 72,
      align: "right",
      lineBreak: false,
    });
  };

  drawTotal("Gross Earnings", payslip.grossEarnings, MARGIN);
  drawTotal("Total Deductions", payslip.totalDeductions, MARGIN + columnWidth);

  doc.y = linesBottom + 30;

  /* =================================================================
     4) THE NET PAY
     -----------------------------------------------------------------
     The one number the whole page exists for, so it gets a block of
     its own - in figures AND in words.

     THE WORDS ARE NOT DECORATION. A figure with a digit added to it
     reads as a completely different sentence, so the two halves have
     to agree before anybody accepts the document. See the note above
     amountInWords() in config/salaryConstants.js.
     ================================================================= */
  const netTop = doc.y;

  doc.rect(MARGIN, netTop, pageWidth, 46).fill(INK.band);

  doc
    .rect(MARGIN, netTop, 4, 46)
    .fill(payslip.status === "Cancelled" ? INK.danger : INK.accent);

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(INK.faint)
    .text("NET PAY", MARGIN + 16, netTop + 8);

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(INK.heading)
    .text(`${CURRENCY_CODE} ${formatMoney(payslip.netPay)}`, MARGIN + 16, netTop + 19, {
      width: pageWidth * 0.4,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK.muted)
    .text(safe(amountInWords(payslip.netPay)), MARGIN + pageWidth * 0.45, netTop + 17, {
      width: pageWidth * 0.55 - 16,
      align: "right",
    });

  doc.y = netTop + 60;

  /* =================================================================
     5) WHAT ELSE THE READER HAS TO BE TOLD
     ================================================================= */
  if (payslip.status === "Cancelled") {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(INK.danger)
      .text(
        safe(
          `This payslip was cancelled${
            payslip.cancellationReason ? `: ${payslip.cancellationReason}` : "."
          }`
        ),
        MARGIN,
        doc.y,
        { width: pageWidth }
      );

    doc.moveDown(0.6);
  }

  if (payslip.remarks) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(INK.muted)
      .text(safe(payslip.remarks), MARGIN, doc.y, { width: pageWidth });

    doc.moveDown(0.6);
  }

  if (payslip.status === "Paid" && payslip.paymentReference) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(INK.faint)
      .text(safe(`Transfer reference: ${payslip.paymentReference}`), MARGIN, doc.y, {
        width: pageWidth,
      });
  }

  /* =================================================================
     6) THE FOOTER
     -----------------------------------------------------------------
     "COMPUTER GENERATED - NO SIGNATURE REQUIRED" is on every payslip
     ever issued by software, and it is not boilerplate: without it the
     first question anybody receiving this asks is why it is not
     signed.
     ================================================================= */
  const footerTop = doc.page.height - MARGIN - 34;

  doc
    .moveTo(MARGIN, footerTop)
    .lineTo(MARGIN + pageWidth, footerTop)
    .lineWidth(0.5)
    .strokeColor(INK.rule)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(INK.faint)
    .text(
      safe(
        "This is a computer generated payslip and does not require a signature."
      ),
      MARGIN,
      footerTop + 8,
      { width: pageWidth * 0.65, lineBreak: false }
    );

  doc.text(
    safe(`Generated ${new Date().toUTCString()}`),
    MARGIN + pageWidth * 0.65,
    footerTop + 8,
    { width: pageWidth * 0.35, align: "right", lineBreak: false }
  );

  doc.end();
};
