/*
=========================================================================
  CONTROLLER: Request Types                       ( the "C" of MVC )
=========================================================================
  Module 9 - System Configuration.

  FUNCTIONS IN THIS FILE
    getAllRequestTypes  GET     /api/request-type/all
    createRequestType   POST    /api/request-type/create
    updateRequestType   PUT     /api/request-type/:id
    deleteRequestType   DELETE  /api/request-type/:id

  THE HARD PART OF THIS FILE IS NOT THE CRUD
  ------------------------------------------
  Creating a row is five lines. What takes the rest of the file is that
  a request type is a word THREE other modules have already written
  down and cannot take back:

    Module 2  every Request stores the type as text
    Module 3  every Workflow stores the type it routes
    Module 8  every report groups by it

  So both of the destructive operations are guarded:

    DELETE  refused while anything still points at the type. An admin
            is told how many, and offered the alternative below.
    RENAME  allowed, but it rewrites the requests and workflows that
            carry the old name IN THE SAME BREATH - otherwise a rename
            would quietly orphan every one of them.

  `isActive` is the alternative to deleting: switched off, a type
  disappears from the "raise a request" dropdown while everything that
  already carries it keeps working. It is what an admin almost always
  actually wants when they reach for Delete.
=========================================================================
*/

import RequestType from "../model/requestTypeModel.js";
import Request from "../model/requestModel.js";
import Workflow from "../model/workflowModel.js";
import { isValidObjectId } from "../config/validation.js";
import { clearRequestTypeCache } from "../config/requestTypeService.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
} from "../config/auditService.js";

/*
  The fields worth a line in the audit log, and how they are written in
  English. Same shape as ROLE_AUDIT_FIELDS and the others.
*/
const REQUEST_TYPE_AUDIT_FIELDS = {
  name: "Name",
  description: "Description",
  needsAmount: "Shows an amount field",
  needsDates: "Shows date fields",
  isActive: "Active",
  order: "Order",
};

/*
  Cleans the list of category suggestions coming from the form.

  The React page sends one textarea, one category per line, so this
  arrives full of empty lines and stray spaces. Duplicates are dropped
  because two identical entries in a dropdown is simply a bug on
  screen.
*/
const cleanCategories = (categories) => {
  if (!Array.isArray(categories)) {
    return [];
  }

  const cleaned = categories
    .map((category) => String(category || "").trim())
    .filter(Boolean)
    .slice(0, 30); // a dropdown nobody can read is not a feature

  return [...new Set(cleaned)];
};

/*
  How many things already point at this type. Asked before a delete and
  before a rename, because both need the same answer.
*/
const countUsage = async (name) => {
  const [requests, workflows] = await Promise.all([
    Request.countDocuments({ type: name, isDeleted: false }),
    Workflow.countDocuments({ requestType: name, isDeleted: false }),
  ]);

  return { requests, workflows, total: requests + workflows };
};

/* =====================================================================
   1) GET ALL REQUEST TYPES
   ---------------------------------------------------------------------
   GET /api/request-type/all

   NO PERMISSION, only a login - the same decision notifications and
   search made. Every employee needs this list to fill in the form on
   the Requests page they are already allowed to open, so gating it
   would mean an admin could accidentally take away somebody's ability
   to raise a request at all.

   ?activeOnly=true is what the "raise a request" dropdown asks for.
   The FILTER dropdowns ask for everything, so an old Laptop request
   stays findable after Laptop is switched off.
   ===================================================================== */
export const getAllRequestTypes = async (req, res) => {
  try {
    const { activeOnly } = req.query;

    const filter = activeOnly === "true" ? { isActive: true } : {};

    const requestTypes = await RequestType.find(filter)
      .sort({ order: 1, name: 1 })
      // MODULE 10 - read-only list, see the note in requestController.js
      .lean();

    return res.status(200).json({
      message: "Request types fetched successfully",
      requestTypes,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Request Types Error ${error}` });
  }
};

/* =====================================================================
   2) CREATE REQUEST TYPE
   ---------------------------------------------------------------------
   POST /api/request-type/create
   body: { name, description, categories, needsAmount, needsDates, order }
   ===================================================================== */
export const createRequestType = async (req, res) => {
  try {
    const { name, description, categories, needsAmount, needsDates, order } =
      req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Request type name is required" });
    }

    /*
      The name must be free, ignoring upper/lower case: "leave" and
      "Leave" would be two rows in the database and one word to every
      human being looking at the dropdown.
    */
    const existing = await RequestType.findOne({
      name: { $regex: `^${name.trim()}$`, $options: "i" },
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "A request type with this name already exists" });
    }

    /*
      A new type goes to the END of the dropdown unless the admin said
      otherwise, so adding one never reshuffles the list everybody has
      learned the shape of.
    */
    const lastType = await RequestType.findOne().sort({ order: -1 }).lean();

    const requestType = await RequestType.create({
      name: name.trim(),
      description: description?.trim() || "",
      categories: cleanCategories(categories),
      needsAmount: Boolean(needsAmount),
      needsDates: Boolean(needsDates),
      isActive: true,
      order: order === undefined ? (lastType?.order || 0) + 1 : Number(order),
    });

    clearRequestTypeCache();

    await recordAudit(req, {
      action: "RequestTypeCreated",
      targetType: "RequestType",
      targetId: requestType._id,
      targetLabel: requestType.name,
      description: `${describePerson(req.user)} created the request type "${
        requestType.name
      }"`,
    });

    return res.status(201).json({
      message: "Request type created successfully",
      requestType,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res
      .status(500)
      .json({ message: `Create Request Type Error ${error}` });
  }
};

/* =====================================================================
   3) UPDATE REQUEST TYPE
   ---------------------------------------------------------------------
   PUT /api/request-type/:id

   THE RENAME IS THE WHOLE STORY OF THIS FUNCTION.

   Requests and workflows store the type as TEXT, not as a reference
   (see the long note in requestTypeModel.js about why history has to
   stay true). The price of that choice is paid right here: renaming
   "Laptop" to "Hardware" without touching them would leave every
   laptop request pointing at a word that no longer exists - findable
   by nobody, counted by no report, and routed by no workflow.

   So a rename updates all three collections together, and the audit
   entry says how many rows moved.
   ===================================================================== */
export const updateRequestType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, categories, needsAmount, needsDates, isActive, order } =
      req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request type id" });
    }

    const requestType = await RequestType.findById(id);

    if (!requestType) {
      return res.status(404).json({ message: "Request type not found" });
    }

    // a copy taken BEFORE anything below overwrites it, for the diff
    const before = requestType.toObject();

    const oldName = requestType.name;
    let renamedRequests = 0;
    let renamedWorkflows = 0;

    /* ---------------- the rename ---------------- */
    if (name && name.trim() !== oldName) {
      const newName = name.trim();

      const nameTaken = await RequestType.findOne({
        name: { $regex: `^${newName}$`, $options: "i" },
        _id: { $ne: id }, // ignore this same type
      });

      if (nameTaken) {
        return res
          .status(400)
          .json({ message: "A request type with this name already exists" });
      }

      requestType.name = newName;
    }

    /* ---------------- the plain fields ---------------- */
    if (description !== undefined) {
      requestType.description = description?.trim() || "";
    }

    if (categories !== undefined) {
      requestType.categories = cleanCategories(categories);
    }

    if (needsAmount !== undefined) {
      requestType.needsAmount = Boolean(needsAmount);
    }

    if (needsDates !== undefined) {
      requestType.needsDates = Boolean(needsDates);
    }

    if (isActive !== undefined) {
      requestType.isActive = Boolean(isActive);
    }

    if (order !== undefined) {
      requestType.order = Number(order);
    }

    await requestType.save();

    /*
      The rename of everything else happens AFTER the type itself has
      been saved, so a duplicate-name error cannot leave the requests
      renamed and the type not.

      There is no transaction around the pair. A replica set could give
      us one, and the honest reason not to reach for it here is that
      the failure it protects against - the process dying between these
      two lines - leaves a state an admin can fix by pressing Save
      again, which is not true of most of the things transactions are
      for.
    */
    if (requestType.name !== oldName) {
      const [requestResult, workflowResult] = await Promise.all([
        Request.updateMany({ type: oldName }, { $set: { type: requestType.name } }),
        Workflow.updateMany(
          { requestType: oldName },
          { $set: { requestType: requestType.name } }
        ),
      ]);

      renamedRequests = requestResult.modifiedCount || 0;
      renamedWorkflows = workflowResult.modifiedCount || 0;
    }

    clearRequestTypeCache();

    const changes = buildChanges(
      before,
      requestType.toObject(),
      REQUEST_TYPE_AUDIT_FIELDS
    );

    /*
      The rename gets its OWN line in the diff, because "Name: Laptop ->
      Hardware" does not tell an investigator that 340 requests were
      rewritten in the same second.
    */
    if (renamedRequests || renamedWorkflows) {
      changes.push({
        field: "Renamed on existing records",
        from: oldName,
        to: `${requestType.name} (${renamedRequests} request(s), ${renamedWorkflows} workflow(s))`,
      });
    }

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "RequestTypeUpdated",
        targetType: "RequestType",
        targetId: requestType._id,
        targetLabel: requestType.name,
        changes,
        description: `${describePerson(req.user)} updated the request type "${
          requestType.name
        }"`,
      });
    }

    return res.status(200).json({
      message:
        renamedRequests || renamedWorkflows
          ? `Request type updated. ${renamedRequests} request(s) and ${renamedWorkflows} workflow(s) were renamed with it.`
          : "Request type updated successfully",
      requestType,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res
      .status(500)
      .json({ message: `Update Request Type Error ${error}` });
  }
};

/* =====================================================================
   4) DELETE REQUEST TYPE
   ---------------------------------------------------------------------
   DELETE /api/request-type/:id

   Two things stop us, and they are the same two that stop a role being
   deleted in roleController.js:

     1. something still uses it
     2. it is the last one standing

   The second is the "do not lock everybody out" rule that also keeps
   the Super Admin role holding every permission: an application with
   zero request types has a Requests page nobody can raise anything on,
   and no way back except a developer with a database client.

   This is a REAL delete, not the soft delete Request and Workflow use.
   That is safe precisely because of guard 1 - by the time we get here,
   nothing in the database mentions this word, so there is no history
   to protect.
   ===================================================================== */
export const deleteRequestType = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request type id" });
    }

    const requestType = await RequestType.findById(id);

    if (!requestType) {
      return res.status(404).json({ message: "Request type not found" });
    }

    /* ---- 1) is anything still using it? ---- */
    const usage = await countUsage(requestType.name);

    if (usage.total > 0) {
      const parts = [];

      if (usage.requests > 0) {
        parts.push(`${usage.requests} request(s)`);
      }

      if (usage.workflows > 0) {
        parts.push(`${usage.workflows} workflow(s)`);
      }

      return res.status(400).json({
        message: `"${requestType.name}" is used by ${parts.join(
          " and "
        )}. Switch it off instead - it will disappear from the new request form while the existing ones keep working.`,
      });
    }

    /* ---- 2) is it the last one? ---- */
    const totalTypes = await RequestType.countDocuments();

    if (totalTypes <= 1) {
      return res.status(400).json({
        message:
          "This is the only request type left. Add another one before deleting it, or nobody will be able to raise a request.",
      });
    }

    await RequestType.findByIdAndDelete(id);

    clearRequestTypeCache();

    /*
      Like a deleted role, this entry outlives its subject: the name
      and the settings only survive because they were copied in here as
      text.
    */
    await recordAudit(req, {
      action: "RequestTypeDeleted",
      targetType: "RequestType",
      targetId: requestType._id,
      targetLabel: requestType.name,
      description: `${describePerson(req.user)} deleted the request type "${
        requestType.name
      }"`,
    });

    return res
      .status(200)
      .json({ message: "Request type deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete Request Type Error ${error}` });
  }
};
