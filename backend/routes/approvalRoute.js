/*
=========================================================================
  ROUTES: Approval          ->  mounted at  /api/approval
=========================================================================
  Every route needs a login (isAuth) and the matching permission
  (checkPermission).

  Like the request permissions, the approval permissions are seeded onto
  EVERY role in config/permissions.js - a workflow stage may point at any
  employee, so anybody can end up being an approver. Having the
  permission only means "you may use the approvals screen"; the
  controller still checks that this particular request really is waiting
  for THIS user before it accepts a decision.
=========================================================================
*/

import express from "express";
import {
  getPendingApprovals,
  getMyApprovalHistory,
  getApprovalByRequest,
  approveRequest,
  rejectRequest,
  returnRequest,
} from "../controllers/approvalController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

/* ---------------- reading ---------------- */

router.get(
  "/pending",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_READ),
  getPendingApprovals
);

router.get(
  "/history",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_READ),
  getMyApprovalHistory
);

router.get(
  "/request/:requestId",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_READ),
  getApprovalByRequest
);

/* ---------------- deciding ---------------- */

router.post(
  "/:requestId/approve",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_APPROVE),
  approveRequest
);

router.post(
  "/:requestId/reject",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_REJECT),
  rejectRequest
);

router.post(
  "/:requestId/return",
  isAuth,
  checkPermission(PERMISSIONS.APPROVAL_RETURN),
  returnRequest
);

export default router;
