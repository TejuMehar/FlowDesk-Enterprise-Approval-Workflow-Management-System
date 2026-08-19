/*
=========================================================================
  CONTROLLER: User / Employee                     ( the "C" of MVC )
=========================================================================
  FUNCTIONS IN THIS FILE

  ---- Admin side (needs permissions) ----
    createUser         POST    /api/user/create
    getAllUsers        GET     /api/user/all
    getUserById        GET     /api/user/:id
    updateUser         PUT     /api/user/:id
    deleteUser         DELETE  /api/user/:id
    toggleUserStatus   PATCH   /api/user/:id/status
    assignRole         PATCH   /api/user/:id/role

  ---- Own profile (every logged in user) ----
    getMyProfile       GET     /api/user/profile/me
    updateMyProfile    PUT     /api/user/profile/me
    uploadProfilePhoto POST    /api/user/profile/photo
=========================================================================
*/

import User from "../model/userModel.js";
// MODULE 10 - one shared, path-checked, never-throwing file delete
import { deleteStoredFile } from "../config/fileService.js";
import Role from "../model/roleModel.js";
import Department from "../model/departmentModel.js";
import RefreshToken from "../model/refreshTokenModel.js";
import { publicUser } from "./authController.js";
import {
  isValidEmail,
  isValidObjectId,
  checkPasswordStrength,
  generateTempPassword,
} from "../config/validation.js";
import { genRandomToken } from "../config/token.js";
import {
  sendWelcomeEmail,
  sendNewEmployeeNotificationEmail,
  sendRoleChangeNotificationEmail,
} from "../config/nodemailer.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
} from "../config/auditService.js";

/*
  MODULE 7 - the employee details worth a diff when an admin edits
  them.

  NOTE WHAT IS NOT HERE: password, verifyEmailToken, resetPasswordToken.
  An audit entry is read by people, and a diff of a password field
  would put a secret (or at least its length and shape) in front of
  every pair of eyes that can open the log. Password events get their
  own action in authController.js and record only that they happened.
*/
const USER_AUDIT_FIELDS = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  designation: "Designation",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  dateOfJoining: "Date of joining",
  address: "Address",
  department: "Department",
};

/* =====================================================================
   NOTIFY MANAGER + ADMINS
   ---------------------------------------------------------------------
   Used whenever an employee is created or their role changes.
   Finds the employee's department manager plus every Admin / Super
   Admin, removes duplicates and whoever triggered the action, then
   emails everyone left. Never throws - a mail problem must not break
   the request that triggered it.
   ===================================================================== */
const getNotifyRecipients = async (user, excludeUserId) => {
  const [department, admins] = await Promise.all([
    user.department
      ? Department.findOne({ _id: user.department, isDeleted: false }).populate(
          {
            path: "manager",
            select: "firstName lastName email",
            match: { isDeleted: false, isActive: true },
          }
        )
      : null,
    User.find({ isDeleted: false, isActive: true })
      .populate("role", "name")
      .select("firstName lastName email role")
      // MODULE 10 - read-only list, see the note in requestController.js
      .lean(),
  ]);

  const recipients = [];

  if (department?.manager) {
    recipients.push(department.manager);
  }

  admins
    .filter((admin) => ["Admin", "Super Admin"].includes(admin.role?.name))
    .forEach((admin) => recipients.push(admin));

  // drop duplicates (e.g. a manager who is also an Admin) and the actor
  const seen = new Set();
  return recipients.filter((recipient) => {
    const id = String(recipient._id);
    if (id === String(excludeUserId) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const notifyManagerAndAdmins = async (sendFn, user, excludeUserId, ...args) => {
  try {
    const recipients = await getNotifyRecipients(user, excludeUserId);
    await Promise.all(recipients.map((recipient) => sendFn(recipient, ...args)));
  } catch (error) {
    console.error(`Notify Manager/Admins Error ${error}`);
  }
};

/* =====================================================================
   1) CREATE USER   (an admin creates an account for an employee)
   ---------------------------------------------------------------------
   POST /api/user/create
   body: { firstName, lastName, email, password?, role, department?, ... }

   If no password is sent we generate a temporary one and email it.
   ===================================================================== */
export const createUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      department,
      phone,
      designation,
      gender,
      dateOfBirth,
      dateOfJoining,
      address,
    } = req.body;

    // ---- required fields ----
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({
        message: "First name, last name, email and role are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    // ---- email must not be taken already ----
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });

    if (existingUser) {
      return res
        .status(400)
        .json({ message: "A user with this email already exists" });
    }

    // ---- the role must really exist ----
    if (!isValidObjectId(role)) {
      return res.status(400).json({ message: "Invalid role id" });
    }

    const roleExists = await Role.findById(role);

    if (!roleExists) {
      return res.status(404).json({ message: "Selected role was not found" });
    }

    // ---- the department is optional, but if sent it must exist ----
    if (department) {
      if (!isValidObjectId(department)) {
        return res.status(400).json({ message: "Invalid department id" });
      }

      const departmentExists = await Department.findOne({
        _id: department,
        isDeleted: false,
      });

      if (!departmentExists) {
        return res
          .status(404)
          .json({ message: "Selected department was not found" });
      }
    }

    /*
      ---- the password ----
      If the admin typed one we check it is strong enough.
      If not, we build a temporary password and email it to the employee.
    */
    let finalPassword = password;
    let isTemporaryPassword = false;

    if (password) {
      const strength = checkPasswordStrength(password);
      if (!strength.valid) {
        return res.status(400).json({ message: strength.message });
      }
    } else {
      finalPassword = generateTempPassword();
      isTemporaryPassword = true;
    }

    // ---- the email verification token ----
    const { rawToken, hashedToken } = genRandomToken();

    // ---- finally create the user ----
    const newUser = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase().trim(),
      password: finalPassword, // hashed automatically by the model hook
      role,
      department: department || null,
      phone: phone || "",
      designation: designation || "",
      gender: gender || "",
      dateOfBirth: dateOfBirth || null,
      dateOfJoining: dateOfJoining || Date.now(),
      address: address || "",
      verifyEmailToken: hashedToken,
      verifyEmailExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    });

    // ---- send the welcome email (never blocks the response) ----
    await sendWelcomeEmail(
      newUser,
      isTemporaryPassword ? finalPassword : "(the password your admin gave you)",
      rawToken
    );

    // read the user back with role + department filled in
    const createdUser = await User.findById(newUser._id)
      .populate("role", "name permissions")
      .populate("department", "name code");

    // ---- tell the department manager + every Admin about the new hire ----
    await notifyManagerAndAdmins(
      sendNewEmployeeNotificationEmail,
      newUser,
      req.userId,
      createdUser
    );

    /*
      MODULE 7. The new account's role and department are named in the
      description, because "an account was created" is not the
      interesting part - "an account was created WITH ADMIN RIGHTS" is.
    */
    await recordAudit(req, {
      action: "UserCreated",
      targetType: "User",
      targetId: createdUser._id,
      targetLabel: describePerson(createdUser),
      description: `${describePerson(req.user)} created the account ${describePerson(
        createdUser
      )} (${createdUser.email}) with the role ${
        createdUser.role?.name || "none"
      }`,
    });

    return res.status(201).json({
      message: "User created successfully",
      user: publicUser(createdUser),
    });
  } catch (error) {
    /*
      Mongoose throws a ValidationError when a field breaks a rule from
      the model (for example a name that is too short). Showing that
      exact message is much friendlier than a generic 500.
    */
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Create User Error ${error}` });
  }
};

/* =====================================================================
   2) GET ALL USERS  (with search, filters and pagination)
   ---------------------------------------------------------------------
   GET /api/user/all?page=1&limit=10&search=john&role=<id>&department=<id>&status=active
   ===================================================================== */
export const getAllUsers = async (req, res) => {
  try {
    // ---- read the query values, with safe defaults ----
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const { search, role, department, status } = req.query;

    /*
      ---- build the MongoDB filter step by step ----
      We always hide soft-deleted users.
    */
    const filter = { isDeleted: false };

    // search in first name, last name, email or employee id
    if (search && search.trim()) {
      /*
        $or means "any of these can match".
        $regex is a text search, and "i" makes it case-insensitive.
      */
      const searchText = search.trim();
      filter.$or = [
        { firstName: { $regex: searchText, $options: "i" } },
        { lastName: { $regex: searchText, $options: "i" } },
        { email: { $regex: searchText, $options: "i" } },
        { employeeId: { $regex: searchText, $options: "i" } },
      ];
    }

    if (role && isValidObjectId(role)) {
      filter.role = role;
    }

    if (department && isValidObjectId(department)) {
      filter.department = department;
    }

    if (status === "active") {
      filter.isActive = true;
    } else if (status === "inactive") {
      filter.isActive = false;
    }

    /*
      ---- pagination maths ----
      page 1 -> skip 0,  page 2 -> skip 10,  page 3 -> skip 20 ...
    */
    const skip = (page - 1) * limit;

    /*
      Promise.all runs both database calls at the SAME time instead of
      one after the other, so the request is faster.
    */
    const [users, totalUsers] = await Promise.all([
      User.find(filter)
        .populate("role", "name permissions")
        .populate("department", "name code")
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit)
        // MODULE 10 - read-only list, see the note in requestController.js
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Users fetched successfully",
      users: users.map((user) => publicUser(user)),
      pagination: {
        page,
        limit,
        totalUsers,
        // Math.ceil rounds up: 25 users / 10 per page = 3 pages
        totalPages: Math.ceil(totalUsers / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Get All Users Error ${error}` });
  }
};

/* =====================================================================
   3) GET ONE USER BY ID
   ---------------------------------------------------------------------
   GET /api/user/:id
   ===================================================================== */
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false })
      .populate("role", "name permissions")
      .populate("department", "name code");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "User fetched successfully",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Get User Error ${error}` });
  }
};

/* =====================================================================
   4) UPDATE USER  (admin edits somebody else's details)
   ---------------------------------------------------------------------
   PUT /api/user/:id
   ===================================================================== */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // MODULE 7 - the values before any of the lines below change them
    const before = user.toObject();

    const {
      firstName,
      lastName,
      email,
      phone,
      designation,
      gender,
      dateOfBirth,
      dateOfJoining,
      address,
      department,
    } = req.body;

    /*
      ---- changing the email needs an extra check ----
      Nobody else is allowed to already own that email.
    */
    if (email && email.toLowerCase().trim() !== user.email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "Please enter a valid email" });
      }

      const emailTaken = await User.findOne({
        email: email.toLowerCase().trim(),
        _id: { $ne: id }, // $ne = "not equal", so we skip this same user
      });

      if (emailTaken) {
        return res
          .status(400)
          .json({ message: "This email is already used by another user" });
      }

      user.email = email.toLowerCase().trim();

      // the email is new, so it must be verified again
      user.isEmailVerified = false;
    }

    // ---- department ----
    if (department !== undefined) {
      if (department === null || department === "") {
        user.department = null;
      } else {
        if (!isValidObjectId(department)) {
          return res.status(400).json({ message: "Invalid department id" });
        }

        const departmentExists = await Department.findOne({
          _id: department,
          isDeleted: false,
        });

        if (!departmentExists) {
          return res.status(404).json({ message: "Department not found" });
        }

        user.department = department;
      }
    }

    /*
      ---- the simple text fields ----
      "!== undefined" lets the frontend clear a field by sending "",
      while fields that are not sent at all stay unchanged.
    */
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
    if (designation !== undefined) user.designation = designation;
    if (gender !== undefined) user.gender = gender;
    if (dateOfBirth !== undefined) user.dateOfBirth = dateOfBirth || null;
    if (dateOfJoining !== undefined) user.dateOfJoining = dateOfJoining || null;
    if (address !== undefined) user.address = address;

    await user.save();

    const updatedUser = await User.findById(user._id)
      .populate("role", "name permissions")
      .populate("department", "name code");

    /* =================================================================
       MODULE 7 - WHAT THE ADMIN ACTUALLY CHANGED
       -----------------------------------------------------------------
       `department` is the one field that cannot be diffed as it is
       stored. It holds an ObjectId, and a log entry reading

           Department: 66f1a2... -> 66f1b7...

       tells nobody anything. So both sides are swapped for the
       department NAME before the comparison, which is the only version
       a reader can use.

       The old name needs its own lookup because by this point the
       document has already moved on - `updatedUser` is populated with
       the NEW department, and nothing else still remembers the old one.
       ================================================================= */
    const beforeDepartment = before.department
      ? await Department.findById(before.department).select("name").lean()
      : null;

    const changes = buildChanges(
      { ...before, department: beforeDepartment?.name || "" },
      { ...updatedUser.toObject(), department: updatedUser.department?.name || "" },
      USER_AUDIT_FIELDS
    );

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "UserUpdated",
        targetType: "User",
        targetId: updatedUser._id,
        targetLabel: describePerson(updatedUser),
        changes,
        description: `${describePerson(req.user)} updated the account ${describePerson(
          updatedUser
        )}`,
      });
    }

    return res.status(200).json({
      message: "User updated successfully",
      user: publicUser(updatedUser),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update User Error ${error}` });
  }
};

/* =====================================================================
   5) DELETE USER   (soft delete)
   ---------------------------------------------------------------------
   DELETE /api/user/:id

   We do NOT really remove the row. We only set isDeleted = true, so the
   history (who managed which department, etc.) is not broken.
   ===================================================================== */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    // an admin must not delete their own account by accident
    if (String(req.userId) === String(id)) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isDeleted = true;
    user.isActive = false;
    await user.save({ validateBeforeSave: false });

    // a deleted user must not be able to keep using an old session
    await RefreshToken.updateMany({ user: user._id }, { isRevoked: true });

    /*
      If this person was the manager of a department, that department now
      has no manager. We clear the link so it does not point at a deleted
      user.
    */
    await Department.updateMany({ manager: user._id }, { manager: null });

    /*
      MODULE 7. From here on this person is invisible everywhere else
      in FlowDesk - isAuth turns them away, the employee list skips
      them, and populate() gives back null for them.

      Their audit entries keep working anyway, because every one of
      them copied the name in as text at the time. This entry is the
      last one that will ever name them, so it says who removed them.
    */
    await recordAudit(req, {
      action: "UserDeleted",
      targetType: "User",
      targetId: user._id,
      targetLabel: describePerson(user),
      description: `${describePerson(req.user)} deleted the account ${describePerson(
        user
      )} (${user.email})`,
    });

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Delete User Error ${error}` });
  }
};

/* =====================================================================
   6) ACTIVATE / DEACTIVATE USER
   ---------------------------------------------------------------------
   PATCH /api/user/:id/status
   body: { isActive: true }  or  { isActive: false }
   ===================================================================== */
export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    // typeof checks the TYPE, so "true" (text) is rejected
    if (typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ message: "isActive must be true or false" });
    }

    // an admin must not lock themselves out
    if (String(req.userId) === String(id)) {
      return res
        .status(400)
        .json({ message: "You cannot change your own account status" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = isActive;
    await user.save({ validateBeforeSave: false });

    // a deactivated user must be logged out everywhere at once
    if (!isActive) {
      await RefreshToken.updateMany({ user: user._id }, { isRevoked: true });
    }

    /*
      MODULE 7. Two separate actions rather than one "UserStatusChanged"
      with a diff, so an admin can filter the log down to "who has been
      locked out lately" in one click.
    */
    await recordAudit(req, {
      action: isActive ? "UserActivated" : "UserDeactivated",
      targetType: "User",
      targetId: user._id,
      targetLabel: describePerson(user),
      description: `${describePerson(req.user)} ${
        isActive ? "activated" : "deactivated"
      } the account ${describePerson(user)}`,
    });

    return res.status(200).json({
      message: isActive
        ? "User activated successfully"
        : "User deactivated successfully",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Toggle User Status Error ${error}` });
  }
};

/* =====================================================================
   7) ASSIGN ROLE
   ---------------------------------------------------------------------
   PATCH /api/user/:id/role
   body: { role: "<roleId>" }
   ===================================================================== */
export const assignRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (!isValidObjectId(role)) {
      return res.status(400).json({ message: "Invalid role id" });
    }

    // changing your own role could remove your own admin rights
    if (String(req.userId) === String(id)) {
      return res
        .status(400)
        .json({ message: "You cannot change your own role" });
    }

    const roleExists = await Role.findById(role);

    if (!roleExists) {
      return res.status(404).json({ message: "Role not found" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // the role name BEFORE the change, so the notification email can show it
    const oldRole = await Role.findById(user.role).select("name");
    const oldRoleName = oldRole?.name || "Unknown";

    user.role = role;
    await user.save({ validateBeforeSave: false });

    const updatedUser = await User.findById(user._id)
      .populate("role", "name permissions")
      .populate("department", "name code");

    // ---- tell the department manager + every Admin about the role change ----
    await notifyManagerAndAdmins(
      sendRoleChangeNotificationEmail,
      updatedUser,
      req.userId,
      updatedUser,
      oldRoleName,
      roleExists.name
    );

    /*
      MODULE 7. THE entry this whole module exists for.

      A role change is the only action in FlowDesk that changes what
      somebody is ALLOWED to do, and it is the one that gets asked
      about months later ("why could they approve that?"). The old and
      the new role are both written down, because the answer is
      useless without the pair.
    */
    await recordAudit(req, {
      action: "UserRoleAssigned",
      targetType: "User",
      targetId: updatedUser._id,
      targetLabel: describePerson(updatedUser),
      changes: [{ field: "Role", from: oldRoleName, to: roleExists.name }],
      description: `${describePerson(req.user)} changed the role of ${describePerson(
        updatedUser
      )} from ${oldRoleName} to ${roleExists.name}`,
    });

    return res.status(200).json({
      message: `Role changed to ${roleExists.name} successfully`,
      user: publicUser(updatedUser),
    });
  } catch (error) {
    return res.status(500).json({ message: `Assign Role Error ${error}` });
  }
};

/* =====================================================================
   8) GET MY PROFILE   (any logged in user)
   ---------------------------------------------------------------------
   GET /api/user/profile/me
   ===================================================================== */
export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate("role", "name permissions")
      .populate("department", "name code");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Profile fetched successfully",
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: `Get My Profile Error ${error}` });
  }
};

/* =====================================================================
   9) UPDATE MY PROFILE
   ---------------------------------------------------------------------
   PUT /api/user/profile/me

   NOTE: the employee can only change their own personal details.
   They CANNOT change their role, department, email or status - those
   belong to the admin.
   ===================================================================== */
export const updateMyProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, gender, dateOfBirth, address } =
      req.body;

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
    if (gender !== undefined) user.gender = gender;
    if (dateOfBirth !== undefined) user.dateOfBirth = dateOfBirth || null;
    if (address !== undefined) user.address = address;

    await user.save();

    const updatedUser = await User.findById(user._id)
      .populate("role", "name permissions")
      .populate("department", "name code");

    return res.status(200).json({
      message: "Profile updated successfully",
      user: publicUser(updatedUser),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res
      .status(500)
      .json({ message: `Update My Profile Error ${error}` });
  }
};

/* =====================================================================
   10) UPLOAD PROFILE PHOTO
   ---------------------------------------------------------------------
   POST /api/user/profile/photo
   The form must be "multipart/form-data" with a field named "photo".
   The multer middleware saves the file and gives us req.file.
   ===================================================================== */
export const uploadProfilePhoto = async (req, res) => {
  try {
    // multer puts the file here. If it is missing, nothing was uploaded.
    if (!req.file) {
      return res.status(400).json({ message: "Please select a photo to upload" });
    }

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    /*
      ---- delete the OLD photo from the disk ----
      Without this the server would slowly fill up with unused images.
      We wrap it in its own try/catch because failing to delete an old
      file must not stop the new upload from working.
    */
    if (user.photoUrl) {
      /*
        MODULE 10. The try/catch that used to be here is inside
        deleteStoredFile() now - it never throws, so the caller does not
        have to remember to guard it. The path check came with it: the
        old code glued "public" onto whatever the field held and trusted
        the result.
      */
      deleteStoredFile(user.photoUrl);
    }

    // the public URL the browser will use
    user.photoUrl = `/uploads/${req.file.filename}`;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      message: "Profile photo updated successfully",
      photoUrl: user.photoUrl,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Upload Profile Photo Error ${error}` });
  }
};
