/*
=========================================================================
  ROUTES: Comment           ->  mounted at  /api/comment
=========================================================================
  Module 6 - the communication half.

  Like the request and approval permissions, the comment permissions are
  seeded onto EVERY role in config/permissions.js. A conversation needs
  both sides to be able to talk, and both sides can be any role at all.

  Having the permission only means "you may use comments"; the
  controller still checks that you are really part of THIS request
  before it shows you a single word (config/requestAccess.js).
=========================================================================
*/

import express from "express";
import {
  getComments,
  addComment,
  deleteComment,
} from "../controllers/commentController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.get(
  "/request/:requestId",
  isAuth,
  checkPermission(PERMISSIONS.COMMENT_READ),
  getComments
);

router.post(
  "/request/:requestId",
  isAuth,
  checkPermission(PERMISSIONS.COMMENT_CREATE),
  addComment
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.COMMENT_DELETE),
  deleteComment
);

export default router;
