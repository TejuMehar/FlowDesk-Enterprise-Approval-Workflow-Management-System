/*
=========================================================================
  ROUTES: Settings     ->  mounted at  /api/settings
=========================================================================
  Module 9 - System Configuration.

  THE FIRST ROUTE HAS NO isAuth, AND THAT IS ON PURPOSE.

  Every other route in FlowDesk is behind a login. /public cannot be,
  because the page that needs it is the LOGIN PAGE - it has to know the
  company name and logo before anybody has signed in, which is exactly
  the moment there is no token to check.

  What makes that safe is not the route but the controller: it answers
  with four branding fields and nothing else, hard-coded in one visible
  place (getPublicSettings), so a field added to the model tomorrow
  cannot leak through it.

  THE THREE PERMISSIONS BELOW IT
  ------------------------------
    settings:read    open the page
    settings:update  the company, calendar and employee ID cards
    settings:smtp    the mail server card only - a live mailbox
                     credential is a different level of trust from a
                     company name (see config/permissions.js)
=========================================================================
*/

import express from "express";
import {
  getPublicSettings,
  getSettings,
  updateSettings,
  uploadLogo,
  removeLogo,
  updateSmtp,
  testSmtp,
} from "../controllers/settingsController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
import upload from "../middleware/multer.js";
import { uploadLimiter, authLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* ---------------- branding, for the login page ---------------- */
router.get("/public", getPublicSettings);

/* ---------------- the settings page itself ---------------- */
router.get("/", isAuth, checkPermission(PERMISSIONS.SETTINGS_READ), getSettings);

router.put(
  "/",
  isAuth,
  checkPermission(PERMISSIONS.SETTINGS_UPDATE),
  updateSettings
);

/* ---------------- the company logo ---------------- */
/*
  upload.single("logo") is the Module 1 uploader, unchanged: 2 MB,
  images only. It runs BEFORE the controller, which is why a file that
  is too large is answered by the error handler in index.js rather than
  by anything in settingsController.
*/
router.post(
  "/logo",
  isAuth,
  checkPermission(PERMISSIONS.SETTINGS_UPDATE),
  // MODULE 10 - before multer, so a refused call never writes to our disk
  uploadLimiter,
  upload.single("logo"),
  uploadLogo
);

router.delete(
  "/logo",
  isAuth,
  checkPermission(PERMISSIONS.SETTINGS_UPDATE),
  removeLogo
);

/* ---------------- the mail server ---------------- */
router.put("/smtp", isAuth, checkPermission(PERMISSIONS.SETTINGS_SMTP), updateSmtp);

router.post(
  "/smtp/test",
  isAuth,
  checkPermission(PERMISSIONS.SETTINGS_SMTP),
  /*
    MODULE 10 - the strict tier, on a route only a Super Admin can
    reach. Not because they are suspected of anything: this button
    sends a real email to an address typed into the box next to it, so
    a stuck retry loop in a browser tab would post mail to somebody
    once a second, as the company, from an address employees trust.
  */
  authLimiter,
  testSmtp
);

export default router;
