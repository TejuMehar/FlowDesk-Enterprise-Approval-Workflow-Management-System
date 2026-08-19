/*
=========================================================================
  SMALL VALIDATION HELPERS
=========================================================================
  The same checks (valid email? strong password?) are needed in several
  controllers. Instead of copy-pasting them we write them once here.
=========================================================================
*/

import validator from "validator";

/*
  Checks that a string looks like a real email address.
  We use the "validator" package because writing a perfect email
  regular expression by hand is very hard.
*/
export const isValidEmail = (email) => {
  if (!email || typeof email !== "string") {
    return false;
  }
  return validator.isEmail(email.trim());
};

/*
  Our password rules:
    - at least 8 characters
    - at least 1 uppercase letter
    - at least 1 lowercase letter
    - at least 1 number

  Returns an object so the controller can show the exact reason:
      { valid: false, message: "Password must contain a number" }
*/
export const checkPasswordStrength = (password) => {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required" };
  }

  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters" };
  }

  // /[A-Z]/ means "any character from A to Z". .test() returns true/false
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one number",
    };
  }

  return { valid: true, message: "Password is strong" };
};

/*
  Checks that a value is a real MongoDB id.
  Without this check a wrong id like "abc" makes mongoose throw an ugly
  CastError, and the user sees a confusing 500 error.
*/
export const isValidObjectId = (id) => {
  return validator.isMongoId(String(id || ""));
};

/*
  Creates a random temporary password for a new employee, e.g. "Flow4821xz".
  Used when an admin creates a user without typing a password.
*/
export const generateTempPassword = () => {
  const numbers = Math.floor(1000 + Math.random() * 9000); // 4 digits
  const letters = Math.random().toString(36).slice(2, 4); // 2 letters
  return `Flow${numbers}${letters}A`;
};

/*
  Checks that an employeeId prefix/suffix only contains safe, simple
  characters. Kept strict on purpose - it becomes part of a regular
  expression later (see userModel.js), so no ".", "*", "(" etc allowed.
*/
export const isValidEmployeeIdPart = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  // letters, numbers, "-" and "_" only. Empty string is allowed (optional).
  return /^[A-Za-z0-9_-]*$/.test(value);
};
