/*
=========================================================================
  ROUTES: User / Employee     ->  mounted at  /api/user
=========================================================================
  Every route here needs a login (isAuth).
  The admin routes also need a permission (checkPermission).

  VERY IMPORTANT - THE ORDER OF THE ROUTES:
  "/profile/me" must be written BEFORE "/:id".
  Express reads the file from top to bottom, so if "/:id" came first it
  would match the word "profile" and treat it as an id.
=========================================================================
*/

import express from "express";
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserStatus,
  assignRole,
  getMyProfile,
  updateMyProfile,
  uploadProfilePhoto,
} from "../controllers/userController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
import upload from "../middleware/multer.js";
import { uploadLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* =====================================================================
   MY OWN PROFILE - every logged in user can use these
   ===================================================================== */

router.get("/profile/me", isAuth, getMyProfile);
router.put("/profile/me", isAuth, updateMyProfile);

/*
  upload.single("photo") tells multer to expect ONE file in a field
  called "photo". It must run before the controller so that req.file
  is ready.
*/
router.post(
  "/profile/photo",
  isAuth,
  // MODULE 10 - before multer, so a refused call never writes to our disk
  uploadLimiter,
  upload.single("photo"),
  uploadProfilePhoto
);

/* =====================================================================
   ADMIN ROUTES - a permission is required
   ===================================================================== */

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.USER_CREATE),
  createUser
);

router.get("/all", isAuth, checkPermission(PERMISSIONS.USER_READ), getAllUsers);

router.get("/:id", isAuth, checkPermission(PERMISSIONS.USER_READ), getUserById);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.USER_UPDATE),
  updateUser
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.USER_DELETE),
  deleteUser
);

router.patch(
  "/:id/status",
  isAuth,
  checkPermission(PERMISSIONS.USER_STATUS),
  toggleUserStatus
);

router.patch(
  "/:id/role",
  isAuth,
  checkPermission(PERMISSIONS.USER_ASSIGN_ROLE),
  assignRole
);

export default router;
