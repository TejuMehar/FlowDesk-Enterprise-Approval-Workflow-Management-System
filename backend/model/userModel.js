/*
=========================================================================
  MODEL: User (Employee)                          ( the "M" of MVC )
=========================================================================
  This is the most important model of Module 1.
  One document = one employee account.

  It stores three kinds of information:
    1. LOGIN data       -> email, password, isActive, isEmailVerified
    2. EMPLOYEE profile -> name, phone, designation, address, photo ...
    3. RELATIONS        -> which Role and which Department the user has

  At the bottom there are helper METHODS, for example:
      const ok = await user.comparePassword("mypassword123");
=========================================================================
*/

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Settings from "./settingsModel.js";

const userSchema = new mongoose.Schema(
  {
    /* ================================================================
       1) LOGIN INFORMATION
       ================================================================ */

    // A readable id like "EMP-0001". Created automatically (see hook below)
    employeeId: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
    },

    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      minlength: [2, "First name must be at least 2 characters"],
      maxlength: [50, "First name cannot be more than 50 characters"],
    },

    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name cannot be more than 50 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true, // "John@Mail.com" is saved as "john@mail.com"
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please enter a valid email"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],

      /*
        select: false means the password is NOT included when we read
        users from the database. This protects us from accidentally
        sending the password hash to the frontend.
        To read it on purpose we must write .select("+password")
      */
      select: false,
    },

    /* ================================================================
       2) EMPLOYEE PROFILE
       ================================================================ */

    phone: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Phone number cannot be more than 20 characters"],
    },

    designation: {
      type: String,
      trim: true,
      default: "",
      maxlength: [80, "Designation cannot be more than 80 characters"],
    },

    gender: {
      type: String,
      // only these exact values are allowed
      enum: {
        values: ["male", "female", "other", ""],
        message: "{VALUE} is not a valid gender",
      },
      default: "",
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    dateOfJoining: {
      type: Date,
      default: Date.now, // by default: the day the account was created
    },

    address: {
      type: String,
      trim: true,
      default: "",
      maxlength: [250, "Address cannot be more than 250 characters"],
    },

    // Path of the uploaded photo, e.g. "/uploads/1712345-photo.png"
    photoUrl: {
      type: String,
      default: "",
    },

    /* ================================================================
       3) RELATIONS (links to other collections)
       ================================================================ */

    // Which role the user has -> decides what they are allowed to do
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: [true, "Role is required"],
    },

    // Which department the employee works in. Can be empty.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },

    /* ================================================================
       4) ACCOUNT STATUS
       ================================================================ */

    // Activate / Deactivate. A deactivated user cannot log in.
    isActive: {
      type: Boolean,
      default: true,
    },

    // Becomes true after the user clicks the link in the verify email
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    // Soft delete - the row stays but is hidden everywhere
    isDeleted: {
      type: Boolean,
      default: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    /* ================================================================
       5) SECURITY TOKENS (verify email + forgot password)
       ----------------------------------------------------------------
       We save only the HASHED token, never the one we emailed.
       All of them are select:false so they never reach the frontend.
       ================================================================ */

    verifyEmailToken: { type: String, select: false },
    verifyEmailExpires: { type: Date, select: false },

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },

    /*
      When the password was last changed.
      If a token was created BEFORE this moment we reject it, so old
      tokens die as soon as the password changes.
    */
    passwordChangedAt: { type: Date, select: false },
  },
  {
    timestamps: true,

    // these two lines make the "fullName" virtual field appear in JSON
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =====================================================================
   INDEXES - make searching faster.
   "email" and "employeeId" already get one from unique:true,
   so we only add the extra ones we need.
   ===================================================================== */
userSchema.index({ role: 1 });
userSchema.index({ department: 1 });
userSchema.index({ isDeleted: 1, isActive: 1 });

/* =====================================================================
   VIRTUAL FIELD
   ---------------------------------------------------------------------
   A "virtual" is a field that is NOT stored in the database. It is
   calculated every time we read the document.
   ===================================================================== */
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

/* =====================================================================
   HOOK 1 - hash the password before saving
   ---------------------------------------------------------------------
   pre("save") runs automatically just before a user is saved, so we
   never have to remember to hash the password inside a controller.
   ===================================================================== */
userSchema.pre("save", async function (next) {
  try {
    /*
      isModified("password") is FALSE when we save a user without
      touching the password (for example when updating the phone).
      In that case we must not hash again, or we would hash the hash.
    */
    if (!this.isModified("password")) {
      return next();
    }

    // A "salt" is random data mixed in before hashing, so two users with
    // the same password still get two different hashes.
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    /*
      Remember WHEN the password changed.
      We go 1 second back in time because saving takes a moment, and a
      token created in that same second should still be accepted.
    */
    if (!this.isNew) {
      this.passwordChangedAt = new Date(Date.now() - 1000);
    }

    return next();
  } catch (error) {
    // next(error) stops the save and sends the error to our try/catch
    return next(error);
  }
});

/* =====================================================================
   HOOK 2 - create a readable employeeId like EMP-0001 for new users
   ---------------------------------------------------------------------
   The prefix ("EMP-") and suffix are not hardcoded - an admin can change
   them from Settings ("start with" / "end with"). We always read the
   CURRENT settings, so changing the format only affects employees
   created from that point onward; older employeeIds are left as-is.

   IMPORTANT: we must NOT simply count the users and add 1.
   If a user is ever really removed from the database the count goes
   down, and the next new user would get an employeeId that somebody
   already has - which crashes, because employeeId is unique.

   So instead we look for the HIGHEST id (matching the current prefix
   and suffix) that exists and add 1 to it.
   ===================================================================== */
userSchema.pre("save", async function (next) {
  try {
    // only for brand new users that do not already have an id
    if (!this.isNew || this.employeeId) {
      return next();
    }

    const settings = await Settings.getSettings();
    const prefix = settings.employeeIdPrefix || "";
    const suffix = settings.employeeIdSuffix || "";

    // escape regex special characters so a prefix/suffix like "R&D." is safe
    const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // matches e.g. "EMP-0007" and captures the number part -> "0007"
    const pattern = new RegExp(
      `^${escapeForRegex(prefix)}(\\d+)${escapeForRegex(suffix)}$`
    );

    /*
      this.constructor is the User model itself.
      sort({ employeeId: -1 }) puts the biggest id first,
      and limit(1) / findOne gives us just that one document.
    */
    const lastUser = await this.constructor
      .findOne({ employeeId: pattern })
      .sort({ employeeId: -1 })
      .select("employeeId")
      .lean(); // lean() = give a plain object, it is faster

    const lastNumber = lastUser
      ? Number(lastUser.employeeId.match(pattern)[1])
      : 0;

    // padStart(4, "0") turns 8 into "0008"
    this.employeeId = `${prefix}${String(lastNumber + 1).padStart(4, "0")}${suffix}`;

    return next();
  } catch (error) {
    return next(error);
  }
});

/* =====================================================================
   METHOD 1 - check a typed password against the hashed one
   ---------------------------------------------------------------------
   A hash can NEVER be turned back into the original text, so bcrypt
   hashes the typed password the same way and compares the two hashes.
   ===================================================================== */
userSchema.methods.comparePassword = async function (plainPassword) {
  return await bcrypt.compare(plainPassword, this.password);
};

/* =====================================================================
   METHOD 2 - was the password changed after this token was created?
   ---------------------------------------------------------------------
   @param tokenIssuedAt - the "iat" value inside the JWT (in seconds)
   ===================================================================== */
userSchema.methods.isPasswordChangedAfter = function (tokenIssuedAt) {
  if (!this.passwordChangedAt) {
    return false; // password was never changed -> token is still valid
  }

  // getTime() gives milliseconds, JWT "iat" is seconds -> divide by 1000
  const changedAt = Math.floor(this.passwordChangedAt.getTime() / 1000);

  return tokenIssuedAt < changedAt;
};

const User = mongoose.model("User", userSchema);

export default User;
