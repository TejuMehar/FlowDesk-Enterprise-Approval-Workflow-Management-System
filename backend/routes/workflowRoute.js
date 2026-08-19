/*
=========================================================================
  ROUTES: Workflow            ->  mounted at  /api/workflow
=========================================================================
  Module 3 - Workflow Builder.

  Every route runs isAuth first ("who are you?") and then
  checkPermission ("are you allowed?").

  Note that saving the stages and switching a workflow on/off both count
  as UPDATING the workflow, so they share workflow:update.
=========================================================================
*/

import express from "express";
import {
  createWorkflow,
  getAllWorkflows,
  getWorkflowById,
  updateWorkflow,
  deleteWorkflow,
  saveStages,
  toggleActive,
} from "../controllers/workflowController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_CREATE),
  createWorkflow
);

router.get(
  "/all",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_READ),
  getAllWorkflows
);

router.get(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_READ),
  getWorkflowById
);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_UPDATE),
  updateWorkflow
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_DELETE),
  deleteWorkflow
);

// the builder's Save button - replaces the whole stage list in one call
router.put(
  "/:id/stages",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_UPDATE),
  saveStages
);

router.patch(
  "/:id/active",
  isAuth,
  checkPermission(PERMISSIONS.WORKFLOW_UPDATE),
  toggleActive
);

export default router;
