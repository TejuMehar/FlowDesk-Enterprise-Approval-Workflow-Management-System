/*
=========================================================================
  ROUTES: Audit             ->  mounted at  /api/audit
=========================================================================
  Module 7 - Audit Logs & Activity Tracking.

  FOUR GET ROUTES AND NOTHING ELSE.

  There is no POST, no PUT and no DELETE here, and that is the point of
  the whole module. Entries are written by config/auditService.js when
  something really happened; nothing that reaches the outside world can
  add one, change one or remove one. A log that could be edited by the
  person it is about would prove nothing at all.

  THE TWO LEVELS OF ACCESS
  ------------------------
  audit:read     the company wide log. An admin thing.
  audit:export   the same rows as a spreadsheet. A SEPARATE permission,
                 because downloading every action in the company is a
                 bigger step than looking at the screen.

  /request/:requestId has NO permission at all, on purpose. It is one
  request's own history, and the controller guards it with
  canViewRequest() - the same function the comments and the approval
  timeline already use. An employee can follow their own paperwork
  without being given the right to read everybody else's.

  NOTE the order of the routes. Express matches from the top down, so
  the fixed words ("/actors", "/export") are written before anything
  with a :parameter in it.
=========================================================================
*/

import express from "express";
import {
  getAuditLogs,
  getAuditActors,
  getRequestActivity,
  exportAuditLogs,
} from "../controllers/auditController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
import { heavyLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* ---------------- the company wide log ---------------- */

router.get("/all", isAuth, checkPermission(PERMISSIONS.AUDIT_READ), getAuditLogs);

router.get(
  "/actors",
  isAuth,
  checkPermission(PERMISSIONS.AUDIT_READ),
  getAuditActors
);

/* ---------------- the spreadsheet ---------------- */

router.get(
  "/export",
  isAuth,
  checkPermission(PERMISSIONS.AUDIT_EXPORT),
  // MODULE 10 - up to 5000 rows built in memory, see securityConstants.js
  heavyLimiter,
  exportAuditLogs
);

/* ---------------- one request's own story ---------------- */

router.get("/request/:requestId", isAuth, getRequestActivity);

export default router;
