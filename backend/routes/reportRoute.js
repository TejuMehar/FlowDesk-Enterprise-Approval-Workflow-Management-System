/*
=========================================================================
  ROUTES: Report            ->  mounted at  /api/report
=========================================================================
  Module 8 - Reports & Search (the reports half).

  THREE GET ROUTES AND NOTHING ELSE, for the same reason the audit
  routes are all GETs: a report only ever READS data that already
  exists. There is nothing here to create, edit or delete.

  THE TWO PERMISSIONS
  -------------------
  report:read    open the Reports page and run any of the six.
  report:export  download one as a PDF, an Excel file or a CSV.

  They are two and not one, exactly like audit:read and audit:export.
  Looking at last quarter's numbers on screen and walking out of the
  building with a spreadsheet of every request in the company are
  different levels of trust, and an admin should be able to grant the
  first without the second.

  WHAT report:read DOES *NOT* DECIDE
  ----------------------------------
  It is the door to the page, not the size of the room. HOW MUCH of the
  company a report covers is worked out per user by
  config/reportScope.js:

      analytics:read        -> the whole organisation
      manages a department  -> that department only
      neither               -> their own requests only

  So a Manager with report:read gets a real Reports page about their own
  team without ever being able to see another department's numbers, and
  nobody had to invent a second permission to say so.

  NOTE the order of the routes. Express matches from the top down, so
  the fixed word ("/options") is written before anything with a
  :parameter in it - otherwise "options" would be read as the name of a
  report.
=========================================================================
*/

import express from "express";
import {
  getReportOptions,
  getReport,
  exportReport,
} from "../controllers/reportController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
/*
  MODULE 10. A report is the most expensive thing FlowDesk does: one
  call aggregates every request in the company and an export can build
  a 5000 row spreadsheet in memory. report:read says WHO may run one;
  heavyLimiter says HOW OFTEN - see config/securityConstants.js.

  Not on "/options", which is a tiny list of dropdown values the page
  asks for on every visit.
*/
import { heavyLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* ---------------- what can I ask for? ---------------- */

router.get(
  "/options",
  isAuth,
  checkPermission(PERMISSIONS.REPORT_READ),
  getReportOptions
);

/* ---------------- the file ----------------
   Written before "/:reportType" would have been enough, but it is a
   deeper path so express could never confuse the two. It is here, above
   the report itself, only so the two permissions are easy to compare. */

router.get(
  "/:reportType/export",
  isAuth,
  checkPermission(PERMISSIONS.REPORT_READ, PERMISSIONS.REPORT_EXPORT),
  heavyLimiter,
  exportReport
);

/* ---------------- the report on screen ---------------- */

router.get(
  "/:reportType",
  isAuth,
  checkPermission(PERMISSIONS.REPORT_READ),
  heavyLimiter,
  getReport
);

export default router;
