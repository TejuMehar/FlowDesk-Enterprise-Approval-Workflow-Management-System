/*
=========================================================================
  CONTROLLER: Department                          ( the "C" of MVC )
=========================================================================
  FUNCTIONS IN THIS FILE
    createDepartment    POST    /api/department/create
    getAllDepartments   GET     /api/department/all
    getDepartmentById   GET     /api/department/:id
    updateDepartment    PUT     /api/department/:id
    deleteDepartment    DELETE  /api/department/:id
    assignManager       PATCH   /api/department/:id/manager
=========================================================================
*/

import Department from "../model/departmentModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
} from "../config/auditService.js";

/*
  MODULE 7 - the department fields worth a diff.

  `manager` is not here: it is an ObjectId, and it has its own route
  and its own action (assignManager, further down) because changing
  who runs a department also changes who approves for everybody in it.
*/
const DEPARTMENT_AUDIT_FIELDS = {
  name: "Name",
  code: "Code",
  description: "Description",
};

/* =====================================================================
   1) CREATE DEPARTMENT
   ---------------------------------------------------------------------
   POST /api/department/create
   body: { name, code, description, manager? }
   ===================================================================== */
export const createDepartment = async (req, res) => {
  try {
    const { name, code, description, manager } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Department name is required" });
    }

    if (!code || !code.trim()) {
      return res.status(400).json({ message: "Department code is required" });
    }

    /*
      ---- the name and the code must both be free ----
      $or lets us check both in ONE query instead of two.
      The $regex with "i" ignores upper/lower case.
    */
    const existingDepartment = await Department.findOne({
      isDeleted: false,
      $or: [
        { name: { $regex: `^${name.trim()}$`, $options: "i" } },
        { code: code.trim().toUpperCase() },
      ],
    });

    if (existingDepartment) {
      return res.status(400).json({
        message: "A department with this name or code already exists",
      });
    }

    // ---- the manager is optional, but must be a real active user ----
    if (manager) {
      if (!isValidObjectId(manager)) {
        return res.status(400).json({ message: "Invalid manager id" });
      }

      const managerExists = await User.findOne({
        _id: manager,
        isDeleted: false,
        isActive: true,
      });

      if (!managerExists) {
        return res
          .status(404)
          .json({ message: "The selected manager was not found" });
      }
    }

    const department = await Department.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description?.trim() || "",
      manager: manager || null,
    });

    const createdDepartment = await Department.findById(department._id).populate(
      "manager",
      "firstName lastName email employeeId photoUrl"
    );

    await recordAudit(req, {
      action: "DepartmentCreated",
      targetType: "Department",
      targetId: createdDepartment._id,
      targetLabel: createdDepartment.name,
      description: `${describePerson(req.user)} created the department ${
        createdDepartment.name
      } (${createdDepartment.code})`,
    });

    return res.status(201).json({
      message: "Department created successfully",
      department: createdDepartment,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res
      .status(500)
      .json({ message: `Create Department Error ${error}` });
  }
};

/* =====================================================================
   2) GET ALL DEPARTMENTS
   ---------------------------------------------------------------------
   GET /api/department/all?search=hr

   For every department we also count how many employees work in it.
   ===================================================================== */
export const getAllDepartments = async (req, res) => {
  try {
    const { search } = req.query;

    const filter = { isDeleted: false };

    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
        { code: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const departments = await Department.find(filter)
      .populate("manager", "firstName lastName email employeeId photoUrl")
      .sort({ name: 1 }) // A -> Z
      /*
        MODULE 10 - read-only list, see the note in requestController.js.

        It also removed the .toObject() call below: a lean row already
        IS a plain object, so it can be spread straight into a new one
        with the count added.
      */
      .lean();

    // count the employees of each department at the same time
    const departmentsWithCount = await Promise.all(
      departments.map(async (department) => {
        const employeeCount = await User.countDocuments({
          department: department._id,
          isDeleted: false,
        });

        return { ...department, employeeCount };
      })
    );

    return res.status(200).json({
      message: "Departments fetched successfully",
      departments: departmentsWithCount,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get All Departments Error ${error}` });
  }
};

/* =====================================================================
   3) GET ONE DEPARTMENT  (with the list of its employees)
   ---------------------------------------------------------------------
   GET /api/department/:id
   ===================================================================== */
export const getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid department id" });
    }

    const department = await Department.findOne({
      _id: id,
      isDeleted: false,
    }).populate("manager", "firstName lastName email employeeId photoUrl");

    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    const employees = await User.find({ department: id, isDeleted: false })
      .select("firstName lastName email employeeId designation photoUrl isActive")
      .sort({ firstName: 1 })
      // MODULE 10 - read-only list, see the note in requestController.js
      .lean();

    return res.status(200).json({
      message: "Department fetched successfully",
      department,
      employees,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Department Error ${error}` });
  }
};

/* =====================================================================
   4) UPDATE DEPARTMENT
   ---------------------------------------------------------------------
   PUT /api/department/:id
   ===================================================================== */
export const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid department id" });
    }

    const department = await Department.findOne({ _id: id, isDeleted: false });

    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    // MODULE 7 - the values before the lines below change them
    const before = department.toObject();

    // ---- new name must not belong to another department ----
    if (name && name.trim() !== department.name) {
      const nameTaken = await Department.findOne({
        name: { $regex: `^${name.trim()}$`, $options: "i" },
        _id: { $ne: id }, // $ne = not equal -> skip this same department
        isDeleted: false,
      });

      if (nameTaken) {
        return res
          .status(400)
          .json({ message: "A department with this name already exists" });
      }

      department.name = name.trim();
    }

    // ---- same check for the code ----
    if (code && code.trim().toUpperCase() !== department.code) {
      const codeTaken = await Department.findOne({
        code: code.trim().toUpperCase(),
        _id: { $ne: id },
        isDeleted: false,
      });

      if (codeTaken) {
        return res
          .status(400)
          .json({ message: "A department with this code already exists" });
      }

      department.code = code.trim().toUpperCase();
    }

    if (description !== undefined) {
      department.description = description?.trim() || "";
    }

    await department.save();

    const updatedDepartment = await Department.findById(id).populate(
      "manager",
      "firstName lastName email employeeId photoUrl"
    );

    const changes = buildChanges(
      before,
      department.toObject(),
      DEPARTMENT_AUDIT_FIELDS
    );

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "DepartmentUpdated",
        targetType: "Department",
        targetId: department._id,
        targetLabel: department.name,
        changes,
        description: `${describePerson(req.user)} updated the department ${
          department.name
        }`,
      });
    }

    return res.status(200).json({
      message: "Department updated successfully",
      department: updatedDepartment,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res
      .status(500)
      .json({ message: `Update Department Error ${error}` });
  }
};

/* =====================================================================
   5) DELETE DEPARTMENT   (soft delete)
   ---------------------------------------------------------------------
   DELETE /api/department/:id

   We refuse to delete a department that still has employees, so that no
   employee is left pointing at a department that does not exist.
   ===================================================================== */
export const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid department id" });
    }

    const department = await Department.findOne({ _id: id, isDeleted: false });

    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    const employeeCount = await User.countDocuments({
      department: id,
      isDeleted: false,
    });

    if (employeeCount > 0) {
      return res.status(400).json({
        message: `This department still has ${employeeCount} employee(s). Move them somewhere else first.`,
      });
    }

    department.isDeleted = true;
    department.manager = null;
    await department.save({ validateBeforeSave: false });

    await recordAudit(req, {
      action: "DepartmentDeleted",
      targetType: "Department",
      targetId: department._id,
      targetLabel: department.name,
      description: `${describePerson(req.user)} deleted the department ${
        department.name
      } (${department.code})`,
    });

    return res.status(200).json({ message: "Department deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete Department Error ${error}` });
  }
};

/* =====================================================================
   6) ASSIGN MANAGER
   ---------------------------------------------------------------------
   PATCH /api/department/:id/manager
   body: { manager: "<userId>" }   or   { manager: null } to remove
   ===================================================================== */
export const assignManager = async (req, res) => {
  try {
    const { id } = req.params;
    const { manager } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid department id" });
    }

    const department = await Department.findOne({ _id: id, isDeleted: false });

    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    /*
      MODULE 7. Who runs the department RIGHT NOW, looked up before it
      is overwritten - both branches below need it, because the entry
      is only useful as a pair ("Anita Rao -> Vikram Shah").

      A department with no manager yet leaves this null, and
      describePerson() turns that into "Nobody" further down.
    */
    const previousManager = department.manager
      ? await User.findById(department.manager)
          .select("firstName lastName")
          .lean()
      : null;

    // ---- sending null / "" removes the current manager ----
    if (!manager) {
      department.manager = null;
      await department.save({ validateBeforeSave: false });

      await recordAudit(req, {
        action: "DepartmentManagerAssigned",
        targetType: "Department",
        targetId: department._id,
        targetLabel: department.name,
        changes: [
          {
            field: "Manager",
            from: describePerson(previousManager, "Nobody"),
            to: "Nobody",
          },
        ],
        description: `${describePerson(req.user)} removed ${describePerson(
          previousManager,
          "the manager"
        )} as the manager of ${department.name}`,
      });

      return res
        .status(200)
        .json({ message: "Manager removed successfully", department });
    }

    if (!isValidObjectId(manager)) {
      return res.status(400).json({ message: "Invalid manager id" });
    }

    const managerUser = await User.findOne({
      _id: manager,
      isDeleted: false,
      isActive: true,
    });

    if (!managerUser) {
      return res
        .status(404)
        .json({ message: "The selected user was not found or is inactive" });
    }

    department.manager = manager;
    await department.save({ validateBeforeSave: false });

    /*
      A manager should belong to the department they manage, so if the
      user is not in it yet we move them in automatically.
    */
    if (String(managerUser.department) !== String(department._id)) {
      managerUser.department = department._id;
      await managerUser.save({ validateBeforeSave: false });
    }

    const updatedDepartment = await Department.findById(id).populate(
      "manager",
      "firstName lastName email employeeId photoUrl"
    );

    /*
      MODULE 7. This is a bigger change than it looks, which is why it
      is worth its own action rather than a line in DepartmentUpdated:
      every workflow stage of the type "the requester's manager" points
      at whoever this field names, so one click here quietly redirects
      the approvals of everybody in the department.
    */
    await recordAudit(req, {
      action: "DepartmentManagerAssigned",
      targetType: "Department",
      targetId: department._id,
      targetLabel: department.name,
      changes: [
        {
          field: "Manager",
          from: describePerson(previousManager, "Nobody"),
          to: describePerson(managerUser),
        },
      ],
      description: `${describePerson(req.user)} made ${describePerson(
        managerUser
      )} the manager of ${department.name}`,
    });

    return res.status(200).json({
      message: `${managerUser.firstName} ${managerUser.lastName} is now the manager of ${department.name}`,
      department: updatedDepartment,
    });
  } catch (error) {
    return res.status(500).json({ message: `Assign Manager Error ${error}` });
  }
};
