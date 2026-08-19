/*
=========================================================================
  ROUTES: Role & Permissions   ->  mounted at  /api/role
=========================================================================
  NOTE: "/permissions" is written BEFORE "/:id", otherwise express would
  read the word "permissions" as a role id.
=========================================================================
*/

import express from "express";
import {
  getAllPermissions,
  createRole,
  getAllRoles,
  getRoleById,
  updateRole,
  deleteRole,
} from "../controllers/roleController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

// the master list of permissions, used to draw the checkbox list
router.get(
  "/permissions",
  isAuth,
  checkPermission(PERMISSIONS.ROLE_READ),
  getAllPermissions
);

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.ROLE_CREATE),
  createRole
);

router.get("/all", isAuth, checkPermission(PERMISSIONS.ROLE_READ), getAllRoles);

router.get("/:id", isAuth, checkPermission(PERMISSIONS.ROLE_READ), getRoleById);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.ROLE_UPDATE),
  updateRole
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.ROLE_DELETE),
  deleteRole
);

export default router;
