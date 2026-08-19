/*
=========================================================================
  MIDDLEWARE: isAuth        ->  "WHO are you?"
=========================================================================
  A MIDDLEWARE is a function that runs BETWEEN the request and the
  controller. It gets (req, res, next):
      next()   -> continue to the controller
      return   -> stop here and answer the client

  isAuth reads the access token from the cookie, checks that it is valid,
  loads the user from MongoDB and puts it on the request:

      req.userId -> the id of the logged in user
      req.user   -> the full user document (with role + permissions)

  Every protected route uses it.
=========================================================================
*/

import User from "../model/userModel.js";
import { verifyAccessToken } from "../config/token.js";

const isAuth = async (req, res, next) => {
  try {
    /* -------------------------------------------------------------
       STEP 1: read the token.
       Normally it comes from the httpOnly cookie "accessToken".
       We also accept an "Authorization: Bearer <token>" header, which
       is handy when testing with Postman.
       ------------------------------------------------------------- */
    let token = req.cookies?.accessToken;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res
        .status(401)
        .json({ message: "You are not logged in. Please login first." });
    }

    /* -------------------------------------------------------------
       STEP 2: verify the token.
       verifyAccessToken throws if the token is fake or expired, so we
       use a small inner try/catch to send a clearer message.
       ------------------------------------------------------------- */
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (tokenError) {
      /*
        "TokenExpiredError" means the 15 minutes are over.
        The React app watches for status 401 with this exact message and
        then calls /api/auth/refresh automatically.
      */
      if (tokenError.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Access token expired" });
      }
      return res.status(401).json({ message: "Invalid access token" });
    }

    /* -------------------------------------------------------------
       STEP 3: load the user together with the role and department.
       We read from the database on EVERY request (instead of trusting
       the token) so that changes like "deactivated" or "role changed"
       take effect immediately.
       ------------------------------------------------------------- */
    const user = await User.findById(decoded.userId)
      .select("+passwordChangedAt")
      .populate("role", "name permissions")
      .populate("department", "name code");

    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    /* -------------------------------------------------------------
       STEP 4: safety checks on the account
       ------------------------------------------------------------- */
    if (user.isDeleted) {
      return res.status(401).json({ message: "This account was deleted" });
    }

    if (!user.isActive) {
      return res.status(403).json({
        message: "Your account is deactivated. Please contact your admin.",
      });
    }

    // if the password changed after this token was made, the token is old
    if (user.isPasswordChangedAfter(decoded.iat)) {
      return res
        .status(401)
        .json({ message: "Password was changed recently. Please login again." });
    }

    /* -------------------------------------------------------------
       STEP 5: attach the user to the request and continue
       ------------------------------------------------------------- */
    req.userId = user._id;
    req.user = user;

    next();
  } catch (error) {
    return res.status(500).json({ message: `isAuth Error ${error}` });
  }
};

export default isAuth;
