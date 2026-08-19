/*
=========================================================================
  ROUTES: Request           ->  mounted at  /api/request
=========================================================================
  Every route needs a login (isAuth) and the matching permission
  (checkPermission). By default every role gets the request permissions
  seeded in config/permissions.js, because every employee is allowed to
  manage their own requests - the controller itself makes sure a user
  can only ever touch a request THEY created.
=========================================================================
*/

import express from "express";
import {
  createRequest,
  getAllRequests,
  getRequestById,
  updateDraftRequest,
  deleteDraftRequest,
  submitRequest,
  uploadAttachments,
  listSelectableApprovers,
} from "../controllers/requestController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
import uploadRequestFile from "../middleware/uploadRequestFile.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { ATTACHMENT_RULES } from "../config/fileConstants.js";

const router = express.Router();

router.post(
  "/create",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_CREATE),
  createRequest
);

router.get(
  "/all",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_READ),
  getAllRequests
);

/*
  ABOVE "/:id" ON PURPOSE. Express matches routes in the order they are
  declared, so a "/approvers" written below would never be reached -
  "/:id" would match first and hand the controller the literal string
  "approvers" as a request id.

  It asks for REQUEST_CREATE rather than USER_READ: this is part of
  filling in the request form, and an employee who may raise a request
  must be able to see who they can send it to. It returns nothing but
  the names of department managers, which the Departments page already
  shows.
*/
router.get(
  "/approvers",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_CREATE),
  listSelectableApprovers
);

router.get(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_READ),
  getRequestById
);

router.put(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_UPDATE),
  updateDraftRequest
);

router.delete(
  "/:id",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_DELETE),
  deleteDraftRequest
);

router.patch(
  "/:id/submit",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_SUBMIT),
  submitRequest
);

/*
  upload.array("attachments", 5) tells multer to expect up to 5 files,
  all sent under the same field name "attachments".

  MODULE 10 - THE ORDER OF THE LAST THREE MIDDLEWARES IS THE POINT.

  uploadLimiter runs BEFORE multer, so a caller who has run out of
  window is refused while their files are still on their own machine.
  Putting the limiter after the uploader would let every refused
  attempt write 25 MB to our disk first, which is the exact thing the
  limit exists to prevent.

  Reading an attachment back and deleting one are not here at all -
  they live at /api/file (routes/fileRoute.js), because an attachment
  is readable by everybody on the request, not only by the person who
  may edit it.
*/
router.post(
  "/:id/attachments",
  isAuth,
  checkPermission(PERMISSIONS.REQUEST_UPDATE),
  uploadLimiter,
  uploadRequestFile.array("attachments", ATTACHMENT_RULES.maxFiles),
  uploadAttachments
);

export default router;
