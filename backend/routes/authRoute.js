/*
=========================================================================
  ROUTES: Authentication      ->  mounted at  /api/auth
=========================================================================
  A ROUTE file only says:
      "when this URL is called with this method, run this controller".

  It contains NO logic at all - that is the controller's job.

  MIDDLEWARE ORDER MATTERS. In a line like:

      router.post("/change-password", isAuth, changePassword)

  express runs isAuth first. If isAuth answers the request, the
  controller is never reached.
=========================================================================
*/

import express from "express";
import {
  login,
  logOut,
  refreshAccessToken,
  getCurrentUser,
  verifyEmail,
  resendVerifyEmail,
  forgotPassword,
  resetPassword,
  changePassword,
} from "../controllers/authController.js";
import isAuth from "../middleware/isAuth.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* ---------------- PUBLIC ROUTES (no login needed) ----------------

   MODULE 10 put authLimiter in front of five of these seven, and which
   five is the interesting part.

   IT GOES ON THE ROUTES WHERE BEING WRONG IS FREE AND USEFUL:

     login                 guessing a password
     forgot-password       posting mail to a colleague as us
     resend-verify-email   the same, with a different subject line
     reset-password/:token guessing a 64 character token
     verify-email/:token   the same

   IT IS DELIBERATELY NOT ON THE OTHER TWO:

     logout    refusing to let somebody log out is a security feature
               that makes things less secure
     refresh   the React app calls this by itself whenever an access
               token expires, and a user with several tabs open can
               honestly fire a handful at once. It is also useless to
               an attacker: it needs a valid refresh cookie, and using
               a revoked one already revokes that user's whole family
               of tokens (Module 1).

   Ten attempts per fifteen minutes, counted per IP AND per email
   address - see config/securityConstants.js for why both.
   ---------------------------------------------------------------- */

router.post("/login", authLimiter, login);
router.post("/logout", logOut);
router.post("/refresh", refreshAccessToken);

router.post("/verify-email/:token", authLimiter, verifyEmail);
router.post("/resend-verify-email", authLimiter, resendVerifyEmail);

router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password/:token", authLimiter, resetPassword);

/* ---------------- PRIVATE ROUTES (must be logged in) ---------------- */

router.get("/me", isAuth, getCurrentUser);

/*
  change-password takes the OLD password, so it is a password guess
  like any other - the fact that the caller is already logged in only
  narrows who can make it, not how often.
*/
router.post("/change-password", isAuth, authLimiter, changePassword);

export default router;
