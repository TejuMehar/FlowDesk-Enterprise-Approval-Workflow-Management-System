/*
=========================================================================
  ROUTES: File              ->  mounted at  /api/file
=========================================================================
  Module 10 - File Management.

  Every route needs a LOGIN and nothing else. There is no
  checkPermission() anywhere in this file, and that is the point:

    reading   a request's file is allowed to whoever is allowed to see
              the request, which controllers/fileController.js works out
              with canViewRequest()
    deleting  one is allowed to the person who raised it, while it is
              still theirs, which the controller also checks

  Both of those are questions about THIS request and THIS user, so they
  cannot be answered by a role. A permission here would be the wrong
  shape - see the long note at the top of the controller.
=========================================================================
*/

import express from "express";

import {
  getAttachment,
  downloadAttachment,
  deleteAttachment,
} from "../controllers/fileController.js";
import isAuth from "../middleware/isAuth.js";

const router = express.Router();

/*
  PREVIEW - shown inside the page (Content-Disposition: inline).

  The React side fetches this through axios and turns the answer into a
  blob URL rather than putting the address straight in an <img src>.
  That is not a style choice: the browser will not attach our httpOnly
  cookie to an <img> or <iframe> pointing at a different origin, so a
  plain src would arrive here with no session and be answered 401.
  See components/FilePreview.jsx.
*/
router.get("/request/:requestId/:attachmentId", isAuth, getAttachment);

/*
  DOWNLOAD - saved to disk (Content-Disposition: attachment).
  Listed AFTER the route above would still work, because "/download" is
  a fourth segment and cannot be mistaken for an attachment id.
*/
router.get(
  "/request/:requestId/:attachmentId/download",
  isAuth,
  downloadAttachment
);

// DELETE - requester only, and only while the request is still editable
router.delete("/request/:requestId/:attachmentId", isAuth, deleteAttachment);

export default router;
