/*
=========================================================================
  REPORT EXPORT   (Module 8 - Reports & Search)
=========================================================================
  Turns ONE report envelope (see config/reportConstants.js) into a file,
  in three formats. Nothing in this file knows which of the six reports
  it is holding - it reads the columns, the rows and the summary, and
  that is all there is.

  That is the payoff of the envelope: six reports times three formats is
  eighteen files a user can download, written by three functions.

  THE ONE RULE THAT DECIDES EVERY FORMATTING QUESTION
  ---------------------------------------------------
      A FILE FOR A MACHINE GETS NUMBERS.
      A PAGE FOR A PERSON GETS WORDS.

  CSV and Excel are opened in a spreadsheet, where the first thing
  anybody does is sort a column, sum it or chart it. So they get the raw
  number - 52.3, not "2d 4h"; 68, not "68%" - with the unit moved into
  the column heading and, in Excel, a number format that displays it
  nicely anyway. Writing "2d 4h" into a cell would produce a column that
  cannot be added up, which is the one thing a spreadsheet is for.

  A PDF is read, printed and put in front of somebody. It gets
  "2d 4h" and "68%", because nobody sorts a printout.

  WHY THE PDF IS STREAMED AND THE OTHER TWO ARE NOT
  -------------------------------------------------
  PDFKit writes as it draws, so it can start sending page 1 while page 9
  is still being laid out. exceljs builds a zip archive and only knows
  its own length at the end, so it has to be finished before anything
  can be sent. The controller therefore treats them differently - see
  the note above sendReport() in controllers/reportController.js.
=========================================================================
*/

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import { CURRENCY_CODE, formatReportValue } from "./reportConstants.js";

/* =====================================================================
   SECTION 1 - SHARED HELPERS
   ===================================================================== */

/*
  The unit a column is measured in, added to its heading in the two
  spreadsheet formats.

  This is the other half of the "machines get numbers" rule: the moment
  a cell holds 52.3 instead of "2d 4h", the heading has to say what 52.3
  IS, or the column is meaningless.
*/
const columnUnit = (column) => {
  if (column.type === "duration") {
    return " (hours)";
  }

  if (column.type === "money") {
    return ` (${CURRENCY_CODE})`;
  }

  return "";
};

/*
  The raw value a spreadsheet cell should hold.

  Dates become real Date objects rather than text, so Excel treats them
  as dates: sortable, filterable by month, usable in a formula. A date
  written as a string is just a string that happens to look like a date.
*/
const rawCellValue = (row, column) => {
  const value = row[column.key];

  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (column.type === "date") {
    const date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }

  if (["number", "money", "percent", "duration"].includes(column.type)) {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  return String(value);
};

/*
  The file name a download arrives with, e.g.
      flowdesk-rejection-report-2026-08-01.csv

  The date is in it on purpose: a folder with four copies of
  "report.pdf" in it is a folder nobody can use.
*/
export const buildFileName = (report, extension) => {
  const day = new Date(report.generatedAt).toISOString().split("T")[0];

  return `flowdesk-${report.key}-report-${day}.${extension}`;
};

/* =====================================================================
   SECTION 2 - CSV
   ---------------------------------------------------------------------
   The plainest format, and the only one written by hand - a CSV is
   commas and quotes, and a library for that would be a dependency that
   earns nothing.
   ===================================================================== */

/*
  ESCAPING A CELL.

  A rejection reason like 'No: "budget is used up", ask in Q3' would
  tear a spreadsheet apart - the comma starts a new column and the
  quotes end the text early. The CSV rule is to wrap the cell in quotes
  and double every quote inside it.
*/
const csvCell = (value) => {
  const text = String(value === null || value === undefined ? "" : value);

  return `"${text.replace(/"/g, '""')}"`;
};

export const toCsv = (report) => {
  const lines = [];

  /*
    THE HEADER BLOCK.

    A CSV with nothing but data in it is a file nobody can identify
    three weeks later. These few lines say which report it is and what
    it was filtered by - spreadsheets show them as ordinary rows above
    the table, which is exactly where a reader expects a title.
  */
  lines.push([report.title].map(csvCell).join(","));
  lines.push([report.subtitle].map(csvCell).join(","));
  lines.push(
    ["Generated", new Date(report.generatedAt).toISOString()].map(csvCell).join(",")
  );

  report.filters.forEach((filter) => {
    lines.push([filter.label, filter.value].map(csvCell).join(","));
  });

  lines.push("");

  /* ---------------- the summary ---------------- */
  lines.push([csvCell("Summary")].join(","));

  report.summary.forEach((item) => {
    const label = `${item.label}${
      item.type === "duration" ? " (hours)" : item.type === "money" ? ` (${CURRENCY_CODE})` : ""
    }`;

    /*
      The summary follows the same "machines get numbers" rule as the
      table: the raw value goes in, and the unit is in the label beside
      it. An empty summary line is written as a blank cell rather than
      as "-", because "-" in a spreadsheet is a character, not a gap.
    */
    const value =
      item.value === null || item.value === undefined ? "" : item.value;

    lines.push([label, value].map(csvCell).join(","));
  });

  lines.push("");

  /* ---------------- the table ---------------- */
  lines.push(
    report.columns
      .map((column) => csvCell(`${column.label}${columnUnit(column)}`))
      .join(",")
  );

  report.rows.forEach((row) => {
    lines.push(
      report.columns
        .map((column) => {
          const value = rawCellValue(row, column);

          if (value === null) {
            return csvCell("");
          }

          // an ISO date is the one date format every tool reads the same way
          if (value instanceof Date) {
            return csvCell(value.toISOString().split("T")[0]);
          }

          return csvCell(value);
        })
        .join(",")
    );
  });

  if (report.truncated) {
    lines.push("");
    lines.push(csvCell(`Only the first ${report.rows.length} rows are included.`));
  }

  /*
    THE THREE ODD BYTES IN FRONT.

    "﻿" is a byte order mark. Excel opens a plain UTF-8 CSV as if
    it were the local Windows encoding, which turns every accented name
    into mojibake. The BOM is the one hint it does listen to.
  */
  return `﻿${lines.join("\r\n")}`;
};

/* =====================================================================
   SECTION 3 - EXCEL
   ---------------------------------------------------------------------
   A real .xlsx: one sheet, a title block, the summary, then the table
   with a frozen, filterable header row.
   ===================================================================== */

// how a cell of each type is displayed, while still holding a number
const NUMBER_FORMATS = {
  number: "#,##0",
  money: "#,##0.00",
  percent: '0"%"',
  duration: "0.0",
  date: "dd mmm yyyy",
};

const HEADER_FILL = "FF1E293B"; // slate-800, the same ink the app's headings use
const BAND_FILL = "FFF8FAFC"; // slate-50, for the striping

export const toExcelBuffer = async (report) => {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "FlowDesk";
  workbook.created = new Date(report.generatedAt);

  /*
    Excel refuses a sheet name longer than 31 characters or containing
    any of : \ / ? * [ ]. Our titles are tame, but a name that comes
    from data one day would crash the download rather than the report,
    which is a horrible way to find out.
  */
  const sheetName = report.title.replace(/[:\\/?*[\]]/g, "").slice(0, 31);

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 0 }],
    pageSetup: {
      orientation: report.orientation === "landscape" ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const lastColumn = report.columns.length;

  /* ---------------- the title block ---------------- */
  const addBlockRow = (text, style = {}) => {
    const row = sheet.addRow([text]);

    if (lastColumn > 1) {
      sheet.mergeCells(row.number, 1, row.number, lastColumn);
    }

    Object.assign(row.getCell(1), style);

    return row;
  };

  addBlockRow(report.title, {
    font: { bold: true, size: 16, color: { argb: "FF0F172A" } },
  });

  addBlockRow(report.subtitle, {
    font: { italic: true, size: 11, color: { argb: "FF64748B" } },
  });

  addBlockRow(`Generated ${new Date(report.generatedAt).toUTCString()}`, {
    font: { size: 10, color: { argb: "FF94A3B8" } },
  });

  sheet.addRow([]);

  /* ---------------- what it was filtered by ---------------- */
  report.filters.forEach((filter) => {
    const row = sheet.addRow([filter.label, filter.value]);

    row.getCell(1).font = { bold: true, size: 10, color: { argb: "FF475569" } };
    row.getCell(2).font = { size: 10, color: { argb: "FF475569" } };
  });

  sheet.addRow([]);

  /* ---------------- the summary ---------------- */
  const summaryHeading = sheet.addRow(["Summary"]);
  summaryHeading.getCell(1).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0F172A" },
  };

  report.summary.forEach((item) => {
    const label = `${item.label}${
      item.type === "duration"
        ? " (hours)"
        : item.type === "money"
        ? ` (${CURRENCY_CODE})`
        : ""
    }`;

    const row = sheet.addRow([label, item.value ?? null]);

    row.getCell(1).font = { size: 10, color: { argb: "FF475569" } };

    const valueCell = row.getCell(2);
    valueCell.font = { bold: true, size: 10 };

    if (NUMBER_FORMATS[item.type]) {
      valueCell.numFmt = NUMBER_FORMATS[item.type];
    }
  });

  sheet.addRow([]);

  /* ---------------- the table header ---------------- */
  const headerRow = sheet.addRow(
    report.columns.map((column) => `${column.label}${columnUnit(column)}`)
  );

  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });

  headerRow.height = 22;

  /*
    FREEZE AND FILTER ON THE HEADER ROW.

    The header is not row 1 here - the title block sits above it - so
    both have to be told which row it really is. Without the freeze, a
    400 row report scrolls its own headings off the screen and becomes
    unreadable at exactly the point it gets interesting.
  */
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: lastColumn },
  };

  /* ---------------- the rows ---------------- */
  report.rows.forEach((row, index) => {
    const excelRow = sheet.addRow(
      report.columns.map((column) => rawCellValue(row, column))
    );

    report.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);

      if (NUMBER_FORMATS[column.type]) {
        cell.numFmt = NUMBER_FORMATS[column.type];
      }

      cell.alignment = {
        horizontal: column.align === "right" ? "right" : "left",
        vertical: "top",
      };

      cell.font = { size: 10 };

      // every other row gets a whisper of grey, so a wide table can be read across
      if (index % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BAND_FILL },
        };
      }
    });
  });

  if (report.truncated) {
    const note = sheet.addRow([
      `Only the first ${report.rows.length} rows are included. Narrow the date range or the filters to see the rest.`,
    ]);

    note.getCell(1).font = { italic: true, size: 10, color: { argb: "FFB45309" } };
  }

  /* ---------------- column widths ----------------
     The weight in REPORT_COLUMNS is a share of the page in the PDF; in
     a spreadsheet the natural unit is characters, so it is scaled into
     one. The floor of 10 stops a narrow column's heading from being
     three dots. */
  report.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.max(
      10,
      Math.round((column.width || 1) * 11)
    );
  });

  return await workbook.xlsx.writeBuffer();
};

/* =====================================================================
   SECTION 4 - PDF
   ---------------------------------------------------------------------
   A printable report: a header, the filters it was run with, the
   summary, and a table whose headings repeat on every page.

   IT IS WRITTEN STRAIGHT TO THE RESPONSE, so a 40 page report starts
   arriving immediately instead of being built in memory first.
   ===================================================================== */

const PDF_INK = {
  heading: "#0f172a", // slate-900
  body: "#334155", // slate-700
  muted: "#64748b", // slate-500
  faint: "#94a3b8", // slate-400
  rule: "#e2e8f0", // slate-200
  band: "#f8fafc", // slate-50
  headerFill: "#1e293b", // slate-800
};

const PDF_MARGIN = 36; // half an inch
const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 20;

/*
  PDFKit's built-in Helvetica can only draw the Latin-1 characters.
  A name in Devanagari or a curly quote pasted out of Word would come
  out as blanks scattered through a word, which looks like a corrupt
  file rather than a missing font.

  Replacing them with "?" is not pretty, but it is HONEST - the reader
  can see that something was there and go and look at it on screen.
  (Embedding a Unicode TTF would fix it properly and is the obvious
  next step if FlowDesk ever needs non-Latin reports.)
*/
const pdfSafe = (text) => String(text ?? "").replace(/[^\x00-\xFF]/g, "?");

/*
  One cell of a PDF table, as the words a person reads.
  This is the half of the "machines get numbers" rule that goes the
  other way - see the note at the top of the file.
*/
const pdfCellText = (row, column) => {
  const value = row[column.key];

  if (column.type === "text") {
    return pdfSafe(value === null || value === undefined || value === "" ? "-" : value);
  }

  return pdfSafe(formatReportValue(value, column.type));
};

export const streamPdf = (report, res) => {
  const doc = new PDFDocument({
    size: "A4",
    layout: report.orientation === "landscape" ? "landscape" : "portrait",
    margin: PDF_MARGIN,
    bufferPages: true, // needed to number the pages once we know how many there are
    info: {
      Title: report.title,
      Author: "FlowDesk",
      CreationDate: new Date(report.generatedAt),
    },
  });

  doc.pipe(res);

  const pageWidth = doc.page.width - PDF_MARGIN * 2;
  const bottomLimit = doc.page.height - PDF_MARGIN - 24; // 24pt kept for the footer

  /*
    THE COLUMN WIDTHS.

    The weights in REPORT_COLUMNS are shares, not points, so the same
    column list fits an A4 portrait page and an A4 landscape one
    without a second set of numbers to keep in step.
  */
  const totalWeight = report.columns.reduce(
    (sum, column) => sum + (column.width || 1),
    0
  );

  const columnWidths = report.columns.map(
    (column) => ((column.width || 1) / totalWeight) * pageWidth
  );

  /* ---------------- the title block ---------------- */
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(PDF_INK.heading)
    .text(pdfSafe(report.title), PDF_MARGIN, PDF_MARGIN);

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(PDF_INK.muted)
    .text(pdfSafe(report.subtitle), { width: pageWidth });

  doc.moveDown(0.4);

  /*
    THE FILTER LINE.

    The most important line on the page after the title. A printed
    report with no record of what it was filtered by is a page of
    numbers nobody can check, and somebody always asks "is this all
    departments or just ours?" three weeks later.
  */
  doc
    .fontSize(9)
    .fillColor(PDF_INK.faint)
    .text(
      pdfSafe(
        report.filters.map((filter) => `${filter.label}: ${filter.value}`).join("   |   ")
      ),
      { width: pageWidth }
    );

  doc.moveDown(0.8);

  /* ---------------- the summary ----------------
     Laid out as a row of small blocks rather than a list, so the
     numbers a reader wants first are the first thing on the page. */
  const summaryItems = report.summary.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== ""
  );

  if (summaryItems.length > 0) {
    const perRow = report.orientation === "landscape" ? 4 : 3;
    const blockWidth = pageWidth / perRow;

    let blockTop = doc.y;

    summaryItems.forEach((item, index) => {
      const columnIndex = index % perRow;

      if (columnIndex === 0 && index > 0) {
        blockTop += 30;
      }

      const left = PDF_MARGIN + columnIndex * blockWidth;

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(PDF_INK.faint)
        .text(pdfSafe(item.label.toUpperCase()), left, blockTop, {
          width: blockWidth - 8,
          lineBreak: false,
          ellipsis: true,
        });

      const text =
        item.type === "text"
          ? String(item.value)
          : formatReportValue(item.value, item.type);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(PDF_INK.heading)
        .text(pdfSafe(text), left, blockTop + 11, {
          width: blockWidth - 8,
          lineBreak: false,
          ellipsis: true,
        });
    });

    doc.y = blockTop + 34;
  }

  /* ---------------- the table ---------------- */

  // draws the heading strip, and is called again at the top of every page
  const drawTableHeader = () => {
    const top = doc.y;

    doc.rect(PDF_MARGIN, top, pageWidth, HEADER_HEIGHT).fill(PDF_INK.headerFill);

    let left = PDF_MARGIN;

    report.columns.forEach((column, index) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#ffffff")
        .text(pdfSafe(column.label), left + 4, top + 6, {
          width: columnWidths[index] - 8,
          align: column.align === "right" ? "right" : "left",
          lineBreak: false,
          ellipsis: true,
        });

      left += columnWidths[index];
    });

    doc.y = top + HEADER_HEIGHT;
  };

  drawTableHeader();

  if (report.rows.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor(PDF_INK.muted)
      .text("Nothing matched these filters.", PDF_MARGIN, doc.y + 12, {
        width: pageWidth,
        align: "center",
      });
  }

  report.rows.forEach((row, index) => {
    /*
      A NEW PAGE, AND THE HEADINGS AGAIN.

      A table that runs onto page 2 without its headings is a grid of
      unlabelled numbers. This is the whole reason the header is a
      function rather than a block of code above.
    */
    if (doc.y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      doc.y = PDF_MARGIN;
      drawTableHeader();
    }

    const top = doc.y;

    if (index % 2 === 1) {
      doc.rect(PDF_MARGIN, top, pageWidth, ROW_HEIGHT).fill(PDF_INK.band);
    }

    let left = PDF_MARGIN;

    report.columns.forEach((column, columnIndex) => {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(PDF_INK.body)
        /*
          lineBreak: false + ellipsis is what keeps every row exactly
          one line tall. A rejection reason can be 900 characters
          long; letting it wrap would push the rest of the table off
          the page. The full text is always in the CSV and the Excel
          file, which is the right place for it.
        */
        .text(pdfCellText(row, column), left + 4, top + 5, {
          width: columnWidths[columnIndex] - 8,
          align: column.align === "right" ? "right" : "left",
          lineBreak: false,
          ellipsis: true,
        });

      left += columnWidths[columnIndex];
    });

    doc
      .moveTo(PDF_MARGIN, top + ROW_HEIGHT)
      .lineTo(PDF_MARGIN + pageWidth, top + ROW_HEIGHT)
      .lineWidth(0.5)
      .strokeColor(PDF_INK.rule)
      .stroke();

    doc.y = top + ROW_HEIGHT;
  });

  if (report.truncated) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#b45309")
      .text(
        `Only the first ${report.rows.length} rows are shown. Narrow the date range or the filters to see the rest.`,
        PDF_MARGIN,
        doc.y + 8,
        { width: pageWidth }
      );
  }

  /* ---------------- the footer on every page ----------------
     bufferPages held the pages open so we can go back and write
     "Page 3 of 7" - a number impossible to know while page 3 was being
     drawn. */
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(PDF_INK.faint)
      .text(
        pdfSafe(
          `FlowDesk  -  ${report.title}  -  generated ${new Date(
            report.generatedAt
          ).toUTCString()}`
        ),
        PDF_MARGIN,
        doc.page.height - PDF_MARGIN - 10,
        { width: pageWidth - 60, lineBreak: false, ellipsis: true }
      );

    doc.text(
      `Page ${index + 1} of ${range.count}`,
      doc.page.width - PDF_MARGIN - 60,
      doc.page.height - PDF_MARGIN - 10,
      { width: 60, align: "right", lineBreak: false }
    );
  }

  doc.end();
};
