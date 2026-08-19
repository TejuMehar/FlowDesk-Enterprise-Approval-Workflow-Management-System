/*
=========================================================================
  ROUTES: Request Types   ->  mounted at  /api/request-type
=========================================================================
  Module 9 - System Configuration.

  Note the difference between the first route and the other three:

    GET /all   needs only a LOGIN. Every employee has to be able to
               read this list, because it fills the dropdown on the
               Requests page they are already allowed to open. Gating
               it behind a permission would mean an admin could take
               away somebody's ability to raise a request without ever
               touching the request permissions.

    the rest   need "request-type:manage", which reaches into three
               other modules - see config/permissions.js for why it is
               not simply part of settings:update.
=========================================================================
*/

import express from "express";
import {
  getAllRequestTypes,
  createRequestType,
  updateRequestType,
  deleteRequestType,
} from "../controllers/requestTypeController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.get("/all", isAuth, getAllRequestTypes);

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_TYPE_MANAGE),
  createRequestType
);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_TYPE_MANAGE),
  updateRequestType
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_TYPE_MANAGE),
  deleteRequestType
);

export default router;
