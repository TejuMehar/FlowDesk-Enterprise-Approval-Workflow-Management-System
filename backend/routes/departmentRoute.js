/*
=========================================================================
  ROUTES: Department          ->  mounted at  /api/department
=========================================================================
*/

import express from "express";
import {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  assignManager,
} from "../controllers/departmentController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_CREATE),
  createDepartment
);

router.get(
  "/all",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_READ),
  getAllDepartments
);

router.get(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_READ),
  getDepartmentById
);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_UPDATE),
  updateDepartment
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_DELETE),
  deleteDepartment
);

router.patch(
  "/:id/manager",
  isAuth,
  checkPermission(PERMISSIONS.DEPARTMENT_ASSIGN_MANAGER),
  assignManager
);

export default router;
