/*
=========================================================================
  CONTROLLER: Report                              ( the "C" of MVC )
=========================================================================
  Module 8 - Reports & Search (the REPORTS half).

  FUNCTIONS IN THIS FILE
    getReportOptions  GET  /api/report/options
    getReport         GET  /api/report/:reportType
    exportReport      GET  /api/report/:reportType/export?format=pdf

  THERE IS NO POST, NO PUT AND NO DELETE, the same way there is none in
  auditController.js. A report is a QUESTION asked of data that already
  exists; nothing in this module writes anything, so running one can
  never change a request, an approval or a number somebody else is
  looking at.

  THIS FILE IS DELIBERATELY THIN.
    which slice of the company may I see  -> config/reportScope.js
    what are the six reports              -> config/reportConstants.js
    how is each one counted               -> config/reportBuilders.js
    how does it become a file             -> config/reportExport.js

  All that is left here is the HTTP work: read the query string, throw
  away anything that is not in a fixed list, hand over, answer.

  THE ONE PROMISE THE WHOLE MODULE RESTS ON
  -----------------------------------------
  THE FILE HOLDS WHAT THE SCREEN HELD. getReport and exportReport run
  the SAME builder with the SAME arguments through the same
  buildReportArguments() below - the only difference is that the screen
  gets one page of rows and the file gets all of them. An admin who
  filters a report and presses Export has every right to expect that,
  and the only way to keep the promise is to have one place that
  decides.
=========================================================================
*/

import Department from "../model/departmentModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  REQUEST_STATUSES,
  REQUEST_PRIORITIES,
} from "../config/requestConstants.js";
/*
  MODULE 9 - the types come from the database now. Reports ask the
  LOOSE question (every type that ever existed, active or not): a
  report about last quarter has to be able to count a type the company
  retired last month, or the totals stop adding up.
*/
import { getRequestTypeNames } from "../config/requestTypeService.js";
import {
  REPORT_TYPES,
  REPORT_META,
  EXPORT_FORMATS,
  EXPORT_FILE_META,
  APPROVAL_TIME_DIMENSIONS,
  APPROVAL_TIME_DIMENSION_LABELS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DEFAULT_REPORT_MONTHS,
  CURRENCY_CODE,
} from "../config/reportConstants.js";
import {
  resolveReportScope,
  resolveDepartmentMembers,
  intersectMembers,
  getSelectableDepartments,
} from "../config/reportScope.js";
import {
  buildReport,
  buildReportRange,
  buildRequestMatch,
  describeFilters,
} from "../config/reportBuilders.js";
import {
  toCsv,
  toExcelBuffer,
  streamPdf,
  buildFileName,
} from "../config/reportExport.js";

/* =====================================================================
   HELPER 1 - keep only the values we recognise
   ---------------------------------------------------------------------
   Every dropdown value is checked against its fixed list before it is
   used, so a made up type in the URL is quietly ignored instead of
   becoming part of a query. The same guard buildAuditFilter() uses.
   ===================================================================== */
const pickFromList = (value, list) => (list.includes(value) ? value : "");

/* =====================================================================
   HELPER 2 - everything a builder needs, worked out once
   ---------------------------------------------------------------------
   Called by BOTH getReport and exportReport. See the promise at the top
   of the file - this function IS that promise.
   ===================================================================== */
const buildReportArguments = async (req) => {
  const scope = await resolveReportScope(req);

  const type = pickFromList(req.query.type, await getRequestTypeNames());
  const status = pickFromList(req.query.status, REQUEST_STATUSES);
  const priority = pickFromList(req.query.priority, REQUEST_PRIORITIES);

  const dimension = APPROVAL_TIME_DIMENSIONS.includes(req.query.by)
    ? req.query.by
    : "type";

  const { from, to } = buildReportRange(req.query);

  /* ---------------- the department filter ----------------
     Turned into a list of employees rather than used as a join - see
     the note on resolveDepartmentMembers() in config/reportScope.js.  */
  const departmentId =
    req.query.department && isValidObjectId(req.query.department)
      ? req.query.department
      : "";

  const departmentMembers = await resolveDepartmentMembers(departmentId);

  /*
    THE INTERSECTION IS THE SECURITY CHECK.

    A manager who edits the URL to ?department=<somebody else's> gets
    the people who are in BOTH their own scope and that department -
    which is nobody. An empty report, not somebody else's numbers.
  */
  const memberIds = intersectMembers(scope.memberIds, departmentMembers);

  const department = departmentId
    ? await Department.findById(departmentId).select("name").lean()
    : null;

  const filters = describeFilters({
    from,
    to,
    scope,
    departmentName: department?.name,
    type,
    status,
    priority,
  });

  /*
    Two filters for two collections. The request-shaped one carries the
    dates and the statuses; the approval-shaped one carries only the
    people, because an Approval has a `requester` but no `status` or
    `priority` of the request kind and its own dates mean something
    different (see the header of config/reportBuilders.js).
  */
  return {
    scope,
    dimension,
    from,
    to,
    type,
    status,
    priority,
    filters,
    match: buildRequestMatch({ memberIds, from, to, type, status, priority }),
    scopeFilter: memberIds ? { requester: { $in: memberIds } } : {},
  };
};

/* =====================================================================
   1) WHAT CAN I ASK FOR?
   ---------------------------------------------------------------------
   GET /api/report/options

   Fills every dropdown on the Reports page in ONE call, and tells the
   page which slice of the company this user is looking at so the header
   can say "Whole organisation" or "Engineering" honestly.

   The department list is narrowed to what the caller may actually pick
   (see getSelectableDepartments) - a dropdown that offers a filter
   which can only ever return an empty report is a dropdown that makes
   the app look broken.
   ===================================================================== */
export const getReportOptions = async (req, res) => {
  try {
    const scope = await resolveReportScope(req);
    const departments = await getSelectableDepartments(scope);

    return res.status(200).json({
      message: "Report options fetched successfully",
      scope: { level: scope.level, label: scope.label },
      reports: REPORT_TYPES.map((key) => ({
        key,
        title: REPORT_META[key].title,
        subtitle: REPORT_META[key].subtitle,
      })),
      approvalTimeDimensions: APPROVAL_TIME_DIMENSIONS.map((key) => ({
        key,
        label: APPROVAL_TIME_DIMENSION_LABELS[key],
      })),
      departments,
      requestTypes: await getRequestTypeNames(),
      requestStatuses: REQUEST_STATUSES,
      requestPriorities: REQUEST_PRIORITIES,
      exportFormats: EXPORT_FORMATS,
      defaultMonths: DEFAULT_REPORT_MONTHS,
      currency: CURRENCY_CODE,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Report Options Error ${error}` });
  }
};

/* =====================================================================
   2) RUN A REPORT
   ---------------------------------------------------------------------
   GET /api/report/:reportType?from=&to=&department=&type=&status=
       &priority=&by=&page=&limit=

   WHY THE ROWS ARE PAGINATED HERE AND NOT IN MONGODB
   --------------------------------------------------
   Because the SUMMARY has to describe the whole report, not the page
   you happen to be looking at. "Total requested: 4,20,000" must not
   change when you click to page 2.

   So the builder produces the complete result (capped at
   MAX_REPORT_ROWS, which is what makes holding it safe) and only the
   final slice is per-page. The export then takes exactly the same
   object with no slicing at all, which is how the file and the screen
   stay in step.
   ===================================================================== */
export const getReport = async (req, res) => {
  try {
    const { reportType } = req.params;

    if (!REPORT_TYPES.includes(reportType)) {
      return res.status(404).json({ message: `Unknown report: ${reportType}` });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    const options = await buildReportArguments(req);
    const report = await buildReport(reportType, options);

    const skip = (page - 1) * limit;

    return res.status(200).json({
      message: "Report generated successfully",
      report: {
        ...report,
        rows: report.rows.slice(skip, skip + limit),
      },
      scope: { level: options.scope.level, label: options.scope.label },
      dimension: options.dimension,
      pagination: {
        page,
        limit,
        totalRows: report.rows.length,
        totalPages: Math.max(Math.ceil(report.rows.length / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Report Error ${error}` });
  }
};

/* =====================================================================
   3) DOWNLOAD IT
   ---------------------------------------------------------------------
   GET /api/report/:reportType/export?format=pdf|excel|csv&<same filters>

   IT IS ITS OWN PERMISSION (report:export), NOT report:read - exactly
   like the audit log. Reading numbers on screen and walking out of the
   building with a spreadsheet of every salary-shaped request in the
   company are different levels of trust, and an admin should be able to
   grant the first without the second.

   THE THREE FORMATS ARE SENT TWO DIFFERENT WAYS
   ---------------------------------------------
   CSV and Excel are finished before anything leaves: a string and a
   zip archive, both of which have to be complete to have a length.

   The PDF is STREAMED - PDFKit pipes straight into the response, so a
   40 page report starts arriving while its last pages are still being
   drawn. The catch is that once the first byte is out we can no longer
   change our mind and send a 500, which is why every check happens
   before the pipe is opened.
   ===================================================================== */
export const exportReport = async (req, res) => {
  try {
    const { reportType } = req.params;

    if (!REPORT_TYPES.includes(reportType)) {
      return res.status(404).json({ message: `Unknown report: ${reportType}` });
    }

    const format = EXPORT_FORMATS.includes(req.query.format)
      ? req.query.format
      : "csv";

    const options = await buildReportArguments(req);

    // the same call getReport makes, with the same arguments, unsliced
    const report = await buildReport(reportType, options);

    const { extension, contentType } = EXPORT_FILE_META[format];
    const fileName = buildFileName(report, extension);

    /*
      These two headers are what turns a response into a download.
      Without Content-Disposition the browser would try to display the
      file; "attachment" tells it to save one instead.
    */
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    if (format === "pdf") {
      // from here on the response belongs to PDFKit
      return streamPdf(report, res);
    }

    if (format === "excel") {
      const buffer = await toExcelBuffer(report);

      return res.status(200).end(Buffer.from(buffer));
    }

    return res.status(200).send(toCsv(report));
  } catch (error) {
    /*
      If the stream had already started there is nothing left to say -
      the headers are gone and half a PDF is on its way. Checking
      headersSent is what stops express from throwing a second,
      confusing error on top of the real one.
    */
    if (res.headersSent) {
      return res.end();
    }

    return res.status(500).json({ message: `Export Report Error ${error}` });
  }
};
