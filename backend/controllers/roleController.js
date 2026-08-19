/*
=========================================================================
  CONTROLLER: Role & Permissions                  ( the "C" of MVC )
=========================================================================
  FUNCTIONS IN THIS FILE
    getAllPermissions  GET     /api/role/permissions
    createRole         POST    /api/role/create
    getAllRoles        GET     /api/role/all
    getRoleById        GET     /api/role/:id
    updateRole         PUT     /api/role/:id
    deleteRole         DELETE  /api/role/:id
=========================================================================
*/

import Role from "../model/roleModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
} from "../config/permissions.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
} from "../config/auditService.js";

/* =====================================================================
   MODULE 7 - WHICH PERMISSIONS WERE GRANTED, AND WHICH TAKEN AWAY
   ---------------------------------------------------------------------
   The generic diff in auditService.js cannot help here. Given two
   arrays it can only say "12 item(s) -> 14 item(s)", and the whole
   question about a role change is WHICH TWO were added.

   So permissions get their own comparison, and it produces at most two
   entries - one for what was granted, one for what was taken away -
   naming the permissions themselves.

   This is the most security-relevant diff in FlowDesk: adding
   "user:delete" to a role hands that power to everybody holding it, in
   one click, and nothing else in the application would ever have
   written down that it happened.
   ===================================================================== */
const describePermissionChanges = (before = [], after = []) => {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const granted = after.filter((permission) => !beforeSet.has(permission));
  const removed = before.filter((permission) => !afterSet.has(permission));

  const changes = [];

  if (granted.length > 0) {
    changes.push({
      field: "Permissions granted",
      from: "",
      to: granted.join(", "),
    });
  }

  if (removed.length > 0) {
    changes.push({
      field: "Permissions removed",
      from: removed.join(", "),
      to: "",
    });
  }

  return changes;
};

// the plain fields of a role, handled by the generic diff
const ROLE_AUDIT_FIELDS = {
  name: "Name",
  description: "Description",
};

/* =====================================================================
   1) GET ALL PERMISSIONS
   ---------------------------------------------------------------------
   GET /api/role/permissions

   The React "Roles" page calls this to draw the checkbox list, so the
   list of permissions never has to be copied into the frontend code.
   ===================================================================== */
export const getAllPermissions = async (req, res) => {
  try {
    return res.status(200).json({
      message: "Permissions fetched successfully",
      groups: PERMISSION_GROUPS, // grouped by module, for the UI
      permissions: ALL_PERMISSIONS, // the flat list
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get All Permissions Error ${error}` });
  }
};

/* =====================================================================
   2) CREATE ROLE
   ---------------------------------------------------------------------
   POST /api/role/create
   body: { name, description, permissions: ["user:read", ...] }
   ===================================================================== */
export const createRole = async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Role name is required" });
    }

    // ---- the name must be free ----
    /*
      We compare without caring about upper/lower case, so "admin" and
      "Admin" are treated as the same name.
      "^...$" means the whole text must match, not just a part of it.
    */
    const existingRole = await Role.findOne({
      name: { $regex: `^${name.trim()}$`, $options: "i" },
    });

    if (existingRole) {
      return res
        .status(400)
        .json({ message: "A role with this name already exists" });
    }

    // ---- check every permission that was sent ----
    const permissionList = Array.isArray(permissions) ? permissions : [];

    // .filter() keeps only the items that are NOT in our master list
    const invalidPermissions = permissionList.filter(
      (permission) => !ALL_PERMISSIONS.includes(permission)
    );

    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        message: `Invalid permission: ${invalidPermissions.join(", ")}`,
      });
    }

    const role = await Role.create({
      name: name.trim(),
      description: description?.trim() || "",
      permissions: permissionList,
      isSystem: false, // roles made by an admin can always be deleted
    });

    await recordAudit(req, {
      action: "RoleCreated",
      targetType: "Role",
      targetId: role._id,
      targetLabel: role.name,
      // a brand new role starts from nothing, so everything is "granted"
      changes: describePermissionChanges([], role.permissions),
      description: `${describePerson(req.user)} created the role "${
        role.name
      }" with ${role.permissions.length} permission(s)`,
    });

    return res.status(201).json({
      message: "Role created successfully",
      role,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Create Role Error ${error}` });
  }
};

/* =====================================================================
   3) GET ALL ROLES
   ---------------------------------------------------------------------
   GET /api/role/all

   For every role we also count how many users have it, because the
   "Roles" table shows that number.
   ===================================================================== */
export const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.find()
      .sort({ createdAt: 1 })
      // MODULE 10 - read-only list, see the note in requestController.js
      .lean();

    /*
      Promise.all + map runs all the counting queries at the same time.
      If we used a normal for-loop each query would wait for the one
      before it, which is much slower.
    */
    const rolesWithUserCount = await Promise.all(
      roles.map(async (role) => {
        const userCount = await User.countDocuments({
          role: role._id,
          isDeleted: false,
        });

        // a lean row is already a plain object, so it can be spread
        // straight into a new one with the count added (Module 10)
        return { ...role, userCount };
      })
    );

    return res.status(200).json({
      message: "Roles fetched successfully",
      roles: rolesWithUserCount,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get All Roles Error ${error}` });
  }
};

/* =====================================================================
   4) GET ONE ROLE
   ---------------------------------------------------------------------
   GET /api/role/:id
   ===================================================================== */
export const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid role id" });
    }

    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.status(200).json({
      message: "Role fetched successfully",
      role,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Role Error ${error}` });
  }
};

/* =====================================================================
   5) UPDATE ROLE  (rename it or change its permissions)
   ---------------------------------------------------------------------
   PUT /api/role/:id
   ===================================================================== */
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid role id" });
    }

    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    // MODULE 7 - the role as it stands before anything below touches it
    const before = role.toObject();

    /*
      A system role (Super Admin, Admin, Manager, Employee) may have its
      permissions edited, but it must keep its name, because other parts
      of the app look it up by name.
    */
    if (name && name.trim() !== role.name) {
      if (role.isSystem) {
        return res
          .status(400)
          .json({ message: "A system role cannot be renamed" });
      }

      const nameTaken = await Role.findOne({
        name: { $regex: `^${name.trim()}$`, $options: "i" },
        _id: { $ne: id }, // ignore this same role
      });

      if (nameTaken) {
        return res
          .status(400)
          .json({ message: "A role with this name already exists" });
      }

      role.name = name.trim();
    }

    if (description !== undefined) {
      role.description = description?.trim() || "";
    }

    if (permissions !== undefined) {
      const permissionList = Array.isArray(permissions) ? permissions : [];

      const invalidPermissions = permissionList.filter(
        (permission) => !ALL_PERMISSIONS.includes(permission)
      );

      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          message: `Invalid permission: ${invalidPermissions.join(", ")}`,
        });
      }

      /*
        SAFETY RULE:
        "Super Admin" must always keep EVERY permission. Otherwise the
        last administrator could remove their own rights and nobody
        would be able to fix the system again.
        So we only allow the save when nothing is missing from the list.
      */
      if (role.name === "Super Admin") {
        const isMissingSomething = ALL_PERMISSIONS.some(
          (permission) => !permissionList.includes(permission)
        );

        if (isMissingSomething) {
          return res.status(400).json({
            message: "The Super Admin role must always keep all permissions",
          });
        }
      }

      role.permissions = permissionList;
    }

    await role.save();

    /*
      MODULE 7. Two comparisons, one entry: the plain fields go through
      the generic diff, the permissions through their own (see the top
      of this file for why they cannot share one).
    */
    const changes = [
      ...buildChanges(before, role.toObject(), ROLE_AUDIT_FIELDS),
      ...describePermissionChanges(before.permissions, role.permissions),
    ];

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "RoleUpdated",
        targetType: "Role",
        targetId: role._id,
        targetLabel: role.name,
        changes,
        description: `${describePerson(req.user)} updated the role "${
          role.name
        }"`,
      });
    }

    return res.status(200).json({
      message: "Role updated successfully",
      role,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update Role Error ${error}` });
  }
};

/* =====================================================================
   6) DELETE ROLE
   ---------------------------------------------------------------------
   DELETE /api/role/:id

   Two things stop us from deleting a role:
     1. it is a system role
     2. some users still have it
   ===================================================================== */
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid role id" });
    }

    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (role.isSystem) {
      return res
        .status(400)
        .json({ message: "A system role cannot be deleted" });
    }

    const usersWithThisRole = await User.countDocuments({
      role: id,
      isDeleted: false,
    });

    if (usersWithThisRole > 0) {
      return res.status(400).json({
        message: `This role is used by ${usersWithThisRole} user(s). Move them to another role first.`,
      });
    }

    await Role.findByIdAndDelete(id);

    /*
      MODULE 7. A role is really removed, so like a deleted draft this
      entry outlives its subject: the name and the permission list only
      survive because they were copied in here as text.
    */
    await recordAudit(req, {
      action: "RoleDeleted",
      targetType: "Role",
      targetId: role._id,
      targetLabel: role.name,
      changes: describePermissionChanges(role.permissions, []),
      description: `${describePerson(req.user)} deleted the role "${role.name}"`,
    });

    return res.status(200).json({ message: "Role deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Delete Role Error ${error}` });
  }
};
