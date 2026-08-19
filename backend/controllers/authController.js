/*
=========================================================================
  CONTROLLER: Authentication                      ( the "C" of MVC )
=========================================================================
  A CONTROLLER receives the request, uses the MODEL to read/write data,
  and sends the response back. Every function here follows the same
  shape:

      export const something = async (req, res) => {
        try {
          ... do the work ...
          return res.status(200).json({ message: "..." });
        } catch (error) {
          return res.status(500).json({ message: `... Error ${error}` });
        }
      }

  FUNCTIONS IN THIS FILE
    login                    POST   /api/auth/login
    logOut                   POST   /api/auth/logout
    refreshAccessToken       POST   /api/auth/refresh
    getCurrentUser           GET    /api/auth/me
    verifyEmail              POST   /api/auth/verify-email/:token
    resendVerifyEmail        POST   /api/auth/resend-verify-email
    forgotPassword           POST   /api/auth/forgot-password
    resetPassword            POST   /api/auth/reset-password/:token
    changePassword           POST   /api/auth/change-password
=========================================================================
*/

import User from "../model/userModel.js";
import RefreshToken from "../model/refreshTokenModel.js";
import {
  genAccessToken,
  genRefreshToken,
  verifyRefreshToken,
  genRandomToken,
  hashToken,
  cookieOptions,
  ACCESS_COOKIE_MAX_AGE,
  REFRESH_COOKIE_MAX_AGE,
} from "../config/token.js";
import {
  isValidEmail,
  checkPasswordStrength,
} from "../config/validation.js";
import {
  sendVerificationEmail,
  sendResetPasswordEmail,
} from "../config/nodemailer.js";
import { recordAudit, describePerson } from "../config/auditService.js";

/* =====================================================================
   HELPER 1 - build the "safe" user object we send to the frontend.
   ---------------------------------------------------------------------
   We NEVER send the password or the security tokens, so we pick the
   fields by hand. This is safer than deleting fields one by one.
   ===================================================================== */
const publicUser = (user) => {
  return {
    _id: user._id,
    employeeId: user.employeeId,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    phone: user.phone,
    designation: user.designation,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    dateOfJoining: user.dateOfJoining,
    address: user.address,
    photoUrl: user.photoUrl,
    role: user.role, // populated -> { _id, name, permissions }
    department: user.department, // populated -> { _id, name, code }
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
};

/* =====================================================================
   HELPER 2 - create both tokens, save the refresh token in the database
   and put both of them into httpOnly cookies.
   ---------------------------------------------------------------------
   Used by login() and by refreshAccessToken().
   ===================================================================== */
const sendTokens = async (req, res, user) => {
  // 1) create the two JWTs
  const accessToken = genAccessToken(user._id);
  const refreshToken = genRefreshToken(user._id);

  // 2) save the HASH of the refresh token so we can revoke it later
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_COOKIE_MAX_AGE),
    userAgent: req.headers["user-agent"] || "",
    ipAddress: req.ip || "",
  });

  // 3) put both tokens into cookies the browser sends automatically
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });

  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });

  return { accessToken, refreshToken };
};

/* =====================================================================
   HELPER 3 - MODULE 7: write down a login that did not work
   ---------------------------------------------------------------------
   The one audit entry in FlowDesk that records something which did NOT
   happen, and the most useful one an admin ever reads: five of these
   in a minute is somebody guessing a password, and a log that only
   remembers successful logins could never show it.

   WHAT IS AND IS NOT STORED
     stored     the email that was typed, so the entries can be counted
                per account, plus the IP and the browser from the
                request itself
     NOT stored the password that was tried. Not the wrong one either -
                people mistype their password for ANOTHER system into
                this box, and an audit log must never become the place
                those end up in plain text.

   `actor: null` is passed on purpose: nobody is logged in, so there is
   no user to attach. See recordAudit() for why null and "not given"
   have to mean two different things.

   @param reason - why it failed, for the description only. The person
                   in front of the screen still gets the same vague
                   "Invalid email or password" - see the security note
                   inside login().
   ===================================================================== */
const recordFailedLogin = async (req, email, reason) => {
  const attemptedEmail = String(email || "").toLowerCase().trim();

  await recordAudit(req, {
    action: "LoginFailed",
    status: "Failure",
    targetType: "Auth",
    targetLabel: attemptedEmail,
    description: `Failed login attempt for ${attemptedEmail || "an empty email"} (${reason})`,
    actor: null,
    actorName: attemptedEmail || "Unknown",
  });
};

/* =====================================================================
   1) LOGIN
   ---------------------------------------------------------------------
   POST /api/auth/login
   body: { email, password }
   ===================================================================== */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ---- check the input ----
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    /*
      ---- find the user ----
      The password field is "select: false" in the model, so we must ask
      for it on purpose with .select("+password").
      We also populate the role, because we send its permissions back.
    */
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select("+password")
      .populate("role", "name permissions")
      .populate("department", "name code");

    /*
      SECURITY NOTE:
      When the email does not exist we answer with the SAME message as a
      wrong password. Otherwise an attacker could use the login form to
      find out which email addresses are registered.
    */
    if (!user) {
      await recordFailedLogin(req, email, "no such email");

      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (user.isDeleted) {
      await recordFailedLogin(req, email, "the account was deleted");

      return res.status(400).json({ message: "Invalid email or password" });
    }

    // ---- check the password ----
    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      await recordFailedLogin(req, email, "wrong password");

      return res.status(400).json({ message: "Invalid email or password" });
    }

    // ---- account must be active ----
    if (!user.isActive) {
      await recordFailedLogin(req, email, "the account is deactivated");

      return res.status(403).json({
        message: "Your account is deactivated. Please contact your admin.",
      });
    }

    // ---- remember the login time ----
    user.lastLoginAt = new Date();
    // validateBeforeSave: false -> we only touched one field, no need to
    // run the validation rules of the whole document again
    await user.save({ validateBeforeSave: false });

    // ---- create the tokens and set the cookies ----
    await sendTokens(req, res, user);

    /*
      MODULE 7 - the successful half of the pair above.

      `actor` is passed by hand because isAuth never ran on this route:
      there was no session a moment ago, so req.user does not exist.
      The user we just checked the password for IS the actor.
    */
    await recordAudit(req, {
      action: "Login",
      targetType: "Auth",
      targetId: user._id,
      targetLabel: user.email,
      description: `${describePerson(user)} logged in`,
      actor: user,
    });

    return res.status(200).json({
      message: "Login successful",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Login Error ${error}` });
  }
};

/* =====================================================================
   2) LOGOUT
   ---------------------------------------------------------------------
   POST /api/auth/logout
   We revoke the refresh token in the database and clear both cookies.
   ===================================================================== */
export const logOut = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;

    /*
      A JWT cannot be cancelled, so we mark our database row as revoked.
      From now on that refresh token cannot create new access tokens.

      findOneAndUpdate is used instead of updateOne so we get the row
      back: this route has no isAuth in front of it (see authRoute.js),
      so the revoked token is the ONLY thing that knows whose session
      just ended - and Module 7 has to name somebody.
    */
    if (refreshToken) {
      const revokedToken = await RefreshToken.findOneAndUpdate(
        { tokenHash: hashToken(refreshToken) },
        { isRevoked: true }
      );

      /*
        No row means the cookie was already dead - an expired session,
        or a second Logout click. Nothing was revoked, so there is
        nothing to record either.
      */
      if (revokedToken) {
        const user = await User.findById(revokedToken.user).populate(
          "role",
          "name"
        );

        await recordAudit(req, {
          action: "Logout",
          targetType: "Auth",
          targetId: revokedToken.user,
          targetLabel: user?.email || "",
          description: `${describePerson(user)} logged out`,
          actor: user,
        });
      }
    }

    // remove both cookies from the browser
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    return res.status(500).json({ message: `Logout Error ${error}` });
  }
};

/* =====================================================================
   3) REFRESH ACCESS TOKEN
   ---------------------------------------------------------------------
   POST /api/auth/refresh

   The access token only lives 15 minutes. When it expires the React app
   calls this route once, gets a fresh pair of tokens, and repeats the
   original request. The user never notices anything.

   We use "token rotation": the old refresh token is revoked and a brand
   new one is created every time.
   ===================================================================== */
export const refreshAccessToken = async (req, res) => {
  try {
    const oldRefreshToken = req.cookies?.refreshToken;

    if (!oldRefreshToken) {
      return res.status(401).json({ message: "Refresh token is missing" });
    }

    // ---- STEP 1: is the JWT itself valid? ----
    let decoded;
    try {
      decoded = verifyRefreshToken(oldRefreshToken);
    } catch (tokenError) {
      return res
        .status(401)
        .json({ message: "Refresh token is invalid or expired" });
    }

    // ---- STEP 2: do we still have this token in the database? ----
    const savedToken = await RefreshToken.findOne({
      tokenHash: hashToken(oldRefreshToken),
    });

    if (!savedToken) {
      return res.status(401).json({ message: "Refresh token not recognised" });
    }

    /*
      ---- STEP 3: reuse detection ----
      If a REVOKED token is used again, somebody probably stole it.
      To be safe we revoke every token of that user, which logs them out
      on all devices.
    */
    if (savedToken.isRevoked) {
      await RefreshToken.updateMany(
        { user: savedToken.user },
        { isRevoked: true }
      );

      res.clearCookie("accessToken", cookieOptions);
      res.clearCookie("refreshToken", cookieOptions);

      return res.status(401).json({
        message: "This session is no longer valid. Please login again.",
      });
    }

    if (savedToken.expiresAt < new Date()) {
      return res.status(401).json({ message: "Refresh token has expired" });
    }

    // ---- STEP 4: the user must still be allowed to log in ----
    const user = await User.findById(decoded.userId)
      .populate("role", "name permissions")
      .populate("department", "name code");

    if (!user || user.isDeleted) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "Your account is deactivated" });
    }

    // ---- STEP 5: rotate - kill the old token, create a new pair ----
    savedToken.isRevoked = true;
    await savedToken.save();

    await sendTokens(req, res, user);

    return res.status(200).json({
      message: "Token refreshed successfully",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Refresh Token Error ${error}` });
  }
};

/* =====================================================================
   4) GET CURRENT USER
   ---------------------------------------------------------------------
   GET /api/auth/me      (protected by isAuth)

   The React app calls this when it starts, to find out who is logged in
   and which menu items to show.
   ===================================================================== */
export const getCurrentUser = async (req, res) => {
  try {
    // isAuth already loaded the user with role + department
    if (!req.user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Current user fetched successfully",
      user: publicUser(req.user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Current User Error ${error}` });
  }
};

/* =====================================================================
   5) VERIFY EMAIL
   ---------------------------------------------------------------------
   POST /api/auth/verify-email/:token

   The user clicked the link in the email. The link contains the RAW
   token; we hash it and look for a matching user whose token has not
   expired yet.
   ===================================================================== */
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ message: "Verification token is missing" });
    }

    /*
      $gt means "greater than".
      So: find a user with this token AND whose expiry date is still in
      the future.
    */
    const user = await User.findOne({
      verifyEmailToken: hashToken(token),
      verifyEmailExpires: { $gt: new Date() },
      isDeleted: false, // a deleted account cannot be verified
    }).select("+verifyEmailToken +verifyEmailExpires");

    if (!user) {
      return res.status(400).json({
        message: "This verification link is invalid or has expired",
      });
    }

    // mark as verified and throw the used token away
    user.isEmailVerified = true;
    user.verifyEmailToken = undefined;
    user.verifyEmailExpires = undefined;

    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Email verified successfully. You can now login.",
    });
  } catch (error) {
    return res.status(500).json({ message: `Verify Email Error ${error}` });
  }
};

/* =====================================================================
   6) RESEND VERIFICATION EMAIL
   ---------------------------------------------------------------------
   POST /api/auth/resend-verify-email
   body: { email }
   ===================================================================== */
export const resendVerifyEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      isDeleted: false,
    });

    /*
      Again we do not tell the visitor whether the email exists.
      The answer is always the same friendly message.
    */
    if (!user || user.isEmailVerified) {
      return res.status(200).json({
        message:
          "If that email needs verification, a new link has been sent to it.",
      });
    }

    // create a fresh token
    const { rawToken, hashedToken } = genRandomToken();

    user.verifyEmailToken = hashedToken;
    // 24 hours from now
    user.verifyEmailExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await user.save({ validateBeforeSave: false });

    await sendVerificationEmail(user, rawToken);

    return res.status(200).json({
      message:
        "If that email needs verification, a new link has been sent to it.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Resend Verify Email Error ${error}` });
  }
};

/* =====================================================================
   7) FORGOT PASSWORD
   ---------------------------------------------------------------------
   POST /api/auth/forgot-password
   body: { email }

   We email a reset link that is valid for 15 minutes.
   ===================================================================== */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      isDeleted: false,
    });

    // same neutral answer whether or not the email exists
    const neutralMessage =
      "If an account exists for that email, a reset link has been sent.";

    if (!user) {
      return res.status(200).json({ message: neutralMessage });
    }

    // create the token and store only its hash
    const { rawToken, hashedToken } = genRandomToken();

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await user.save({ validateBeforeSave: false });

    await sendResetPasswordEmail(user, rawToken);

    return res.status(200).json({ message: neutralMessage });
  } catch (error) {
    return res.status(500).json({ message: `Forgot Password Error ${error}` });
  }
};

/* =====================================================================
   8) RESET PASSWORD
   ---------------------------------------------------------------------
   POST /api/auth/reset-password/:token
   body: { password, confirmPassword }
   ===================================================================== */
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Reset token is missing" });
    }

    if (!password || !confirmPassword) {
      return res
        .status(400)
        .json({ message: "Password and confirm password are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // our password rules (8 chars, upper, lower, number)
    const strength = checkPasswordStrength(password);
    if (!strength.valid) {
      return res.status(400).json({ message: strength.message });
    }

    const user = await User.findOne({
      resetPasswordToken: hashToken(token),
      resetPasswordExpires: { $gt: new Date() },
      isDeleted: false, // a deleted account cannot reset its password
    }).select("+resetPasswordToken +resetPasswordExpires +password");

    if (!user) {
      return res
        .status(400)
        .json({ message: "This reset link is invalid or has expired" });
    }

    /*
      Just assign the plain password.
      The pre("save") hook in the model hashes it for us automatically.
    */
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    /*
      The password changed, so every old session must die.
      We revoke all refresh tokens of this user.
    */
    await RefreshToken.updateMany({ user: user._id }, { isRevoked: true });

    // clear the cookies of the browser doing the reset, just in case
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    /*
      MODULE 7. A password reset arrives through an emailed link, so
      nobody is logged in - the account itself is the actor, the same
      way it is for a login.

      This is one of the entries an admin looks for first when an
      account starts behaving oddly: a reset that the owner did not
      ask for means somebody reached their inbox.
    */
    await recordAudit(req, {
      action: "PasswordReset",
      targetType: "Auth",
      targetId: user._id,
      targetLabel: user.email,
      description: `${describePerson(user)} reset their password with an emailed link`,
      actor: user,
    });

    return res.status(200).json({
      message: "Password reset successfully. Please login with your new password.",
    });
  } catch (error) {
    return res.status(500).json({ message: `Reset Password Error ${error}` });
  }
};

/* =====================================================================
   9) CHANGE PASSWORD  (user is logged in and knows the old password)
   ---------------------------------------------------------------------
   POST /api/auth/change-password      (protected by isAuth)
   body: { currentPassword, newPassword, confirmPassword }
   ===================================================================== */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message:
          "Current password, new password and confirm password are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "New password and confirm password do not match" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        message: "New password must be different from the current password",
      });
    }

    const strength = checkPasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ message: strength.message });
    }

    // we need the hashed password, so we ask for it with +password
    const user = await User.findById(req.userId)
      .select("+password")
      .populate("role", "name permissions")
      .populate("department", "name code");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // the old password must be correct
    const isPasswordCorrect = await user.comparePassword(currentPassword);

    if (!isPasswordCorrect) {
      return res
        .status(400)
        .json({ message: "Your current password is incorrect" });
    }

    user.password = newPassword; // the model hashes it in pre("save")
    await user.save();

    /*
      Log out every OTHER device: revoke all refresh tokens...
    */
    await RefreshToken.updateMany({ user: user._id }, { isRevoked: true });

    /*
      ...and then give THIS device a fresh pair, so the person who just
      changed the password is not thrown out of the app.
    */
    await sendTokens(req, res, user);

    /*
      MODULE 7. Unlike the reset above, this one HAS a session, so
      req.user is the actor and no override is needed.

      The new password is not stored, and neither is the old one -
      the entry says that a change happened, never what it changed to.
    */
    await recordAudit(req, {
      action: "PasswordChanged",
      targetType: "Auth",
      targetId: user._id,
      targetLabel: user.email,
      description: `${describePerson(user)} changed their own password`,
    });

    return res.status(200).json({
      message: "Password changed successfully",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Change Password Error ${error}` });
  }
};

// exported so userController can reuse the same "safe user" shape
export { publicUser };
