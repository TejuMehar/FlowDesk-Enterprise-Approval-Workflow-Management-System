/*
=========================================================================
  TOKEN HELPERS  (JWT = JSON Web Token)
=========================================================================
  We use TWO different tokens in FlowDesk:

  1) ACCESS TOKEN   -> short life (15 minutes)
                       Proves who the user is on every request.

  2) REFRESH TOKEN  -> long life (7 days)
                       Used only to get a NEW access token when the old
                       one expires, so the user is not logged out every
                       15 minutes.

  Both are stored in httpOnly cookies, which means JavaScript in the
  browser CANNOT read them. That protects us from XSS attacks.

  We also have helpers for the RANDOM tokens used by
  "email verification" and "forgot password". Those are NOT JWTs,
  they are just long random strings that we email to the user.
=========================================================================
*/

import jwt from "jsonwebtoken";
import crypto from "crypto"; // built into Node, nothing to install

// How long each token stays valid
export const ACCESS_TOKEN_EXPIRY = "15m";
export const REFRESH_TOKEN_EXPIRY = "7d";

// The same values in milliseconds, needed for the cookie "maxAge"
export const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; //  15 minutes
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/*
  Creates the short-lived ACCESS token.
  We only put the userId inside - never the password.
*/
export const genAccessToken = (userId) => {
  try {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });
    return token;
  } catch (error) {
    console.log("genAccessToken Error", error);
    return null;
  }
};

/*
  Creates the long-lived REFRESH token.
  Notice it is signed with a DIFFERENT secret (JWT_REFRESH_SECRET),
  so an access token can never be used as a refresh token.
*/
export const genRefreshToken = (userId) => {
  try {
    const token = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });
    return token;
  } catch (error) {
    console.log("genRefreshToken Error", error);
    return null;
  }
};

/*
  Opens (verifies) an access token and returns the data inside it.
  Throws an error if the token is expired or was changed by someone.
*/
export const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

/*
  Opens (verifies) a refresh token.
*/
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

/*
  Creates a random token for "verify email" / "forgot password".

  It gives back TWO values:
    rawToken    -> the plain text we put inside the email link
    hashedToken -> the SHA-256 version we save in the database

  Why hash it? Same reason we hash passwords. If somebody steals the
  database they still cannot use the links.
*/
export const genRandomToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");

  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return { rawToken, hashedToken };
};

/*
  Hashes a raw token the same way, so we can compare the token coming
  from the URL with the one saved in the database.
*/
export const hashToken = (rawToken) => {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
};

/*
  The settings we use for BOTH cookies.

  httpOnly : browser JavaScript cannot read the cookie  (stops XSS)
  secure   : cookie is only sent over https             (production only)
  sameSite : "strict" in dev, "none" in production when the frontend
             and backend live on different domains.
*/
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
