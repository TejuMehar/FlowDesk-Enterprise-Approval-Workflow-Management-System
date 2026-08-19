/*
=========================================================================
  CONTROLLER: Workflow                            ( the "C" of MVC )
=========================================================================
  Module 3 - Workflow Builder.

  FUNCTIONS IN THIS FILE
    createWorkflow    POST    /api/workflow/create
    getAllWorkflows   GET     /api/workflow/all
    getWorkflowById   GET     /api/workflow/:id
    updateWorkflow    PUT     /api/workflow/:id
    deleteWorkflow    DELETE  /api/workflow/:id
    saveStages        PUT     /api/workflow/:id/stages
    toggleActive      PATCH   /api/workflow/:id/active

  TWO RULES THAT SHOW UP EVERYWHERE IN THIS FILE:

  1. Only ONE workflow per request type can be active at a time.
     Switching one on switches every other one of that type off.

  2. The builder saves ALL the stages in one go (saveStages), instead of
     having separate add / edit / delete / reorder endpoints. The admin
     rearranges the whole chain on screen and then presses Save once, so
     replacing the array is both simpler and keeps the stage numbering
     (1, 2, 3 ...) correct without any extra work.
=========================================================================
*/

import Workflow from "../model/workflowModel.js";
import Role from "../model/roleModel.js";
import Department from "../model/departmentModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
/*
  MODULE 9. The request types are a collection now, not a constant, so
  the list is asked for instead of imported - see
  config/requestTypeService.js. A workflow may only be built for a type
  that is ACTIVE (isSelectable); the filter dropdown asks the looser
  question, so a workflow for a retired type stays findable.
*/
import {
  isSelectableRequestType,
  isKnownRequestType,
  describeSelectableTypes,
} from "../config/requestTypeService.js";
import {
  APPROVER_TYPES,
  APPROVAL_RULES,
  ESCALATION_ACTIONS,
  AUTO_APPROVAL_FIELDS,
  AUTO_APPROVAL_OPERATORS,
  NUMERIC_AUTO_APPROVAL_FIELDS,
} from "../config/workflowConstants.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
} from "../config/auditService.js";

/*
  MODULE 7 - the workflow fields worth a diff when they change.

  The STAGES are not in this list on purpose. A stage is a whole
  object - approvers, rules, escalation, auto approval conditions - and
  squeezing that into a "from -> to" line would produce something
  nobody can read. saveStages() records what happened to the chain in
  its own words instead; see the note down there.
*/
const WORKFLOW_AUDIT_FIELDS = {
  name: "Name",
  description: "Description",
  requestType: "Request type",
};

/* =====================================================================
   HELPER - which id field belongs to which approver type
   ---------------------------------------------------------------------
   "Role" needs approverRole, "Department" needs approverDepartment and
   so on. "RequesterManager" needs nothing, because we only work out WHO
   the manager is at the moment a real request is approved.

   Writing it as a little table means the checks below (and the
   escalation checks, which use the same four options) never fall out of
   sync with each other.
   ===================================================================== */
const APPROVER_TARGETS = {
  Role: { field: "approverRole", model: Role, label: "role" },
  Department: {
    field: "approverDepartment",
    model: Department,
    label: "department",
  },
  User: { field: "approverUser", model: User, label: "user" },
};

// the same table, but for the escalation fields
const ESCALATION_TARGETS = {
  Role: { field: "escalateToRole", model: Role, label: "role" },
  Department: {
    field: "escalateToDepartment",
    model: Department,
    label: "department",
  },
  User: { field: "escalateToUser", model: User, label: "user" },
};

/* =====================================================================
   HELPER - does this id point at something that really exists?
   ---------------------------------------------------------------------
   Roles have no isDeleted flag, users and departments do, so we only add
   that filter when the model actually has the field.
   ===================================================================== */
const targetExists = async (model, id) => {
  const filter = { _id: id };

  if (model !== Role) {
    filter.isDeleted = false;
  }

  const found = await model.findOne(filter).select("_id").lean();
  return Boolean(found);
};

/* =====================================================================
   HELPER - check the whole list of stages before we save it
   ---------------------------------------------------------------------
   Returns a CLEANED copy of the stages when everything is fine:
       { valid: true, stages: [ ... ] }
   or the first problem we found:
       { valid: false, message: "Stage 2: pick a role" }

   Building a clean copy (instead of trusting req.body) means a caller
   cannot sneak in extra fields, and the `order` is always 1, 2, 3 ...
   no matter what the frontend sent.
   ===================================================================== */
const validateStages = async (stages) => {
  if (!Array.isArray(stages)) {
    return { valid: false, message: "Stages must be a list" };
  }

  if (stages.length === 0) {
    return { valid: false, message: "A workflow needs at least one stage" };
  }

  if (stages.length > 20) {
    return { valid: false, message: "A workflow cannot have more than 20 stages" };
  }

  const cleanStages = [];

  // a normal for loop (not .map) because we need `await` inside
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index] || {};
    const position = index + 1; // used in the error messages: "Stage 2: ..."

    /* ---- name ---- */
    if (!stage.name || !String(stage.name).trim()) {
      return { valid: false, message: `Stage ${position}: name is required` };
    }

    /* ---- approver type ---- */
    if (!APPROVER_TYPES.includes(stage.approverType)) {
      return {
        valid: false,
        message: `Stage ${position}: approver type must be one of: ${APPROVER_TYPES.join(
          ", "
        )}`,
      };
    }

    /* ---- approval rule ---- */
    if (stage.approvalRule && !APPROVAL_RULES.includes(stage.approvalRule)) {
      return {
        valid: false,
        message: `Stage ${position}: approval rule must be one of: ${APPROVAL_RULES.join(
          ", "
        )}`,
      };
    }

    const cleanStage = {
      order: position,
      name: String(stage.name).trim(),
      approverType: stage.approverType,
      approverRole: null,
      approverDepartment: null,
      approverUser: null,
      approvalRule: stage.approvalRule || "AnyOne",
    };

    /* ---- the approver id that goes with the chosen type ---- */
    const target = APPROVER_TARGETS[stage.approverType];

    // target is undefined for "RequesterManager", which needs no id
    if (target) {
      const value = stage[target.field];

      if (!value || !isValidObjectId(value)) {
        return {
          valid: false,
          message: `Stage ${position}: please select a ${target.label}`,
        };
      }

      if (!(await targetExists(target.model, value))) {
        return {
          valid: false,
          message: `Stage ${position}: the selected ${target.label} was not found`,
        };
      }

      cleanStage[target.field] = value;
    }

    /* ---- escalation rule ---- */
    const escalation = stage.escalation || {};

    cleanStage.escalation = {
      enabled: false,
      afterHours: 24,
      escalateTo: "RequesterManager",
      escalateToRole: null,
      escalateToDepartment: null,
      escalateToUser: null,
      action: "Notify",
    };

    if (escalation.enabled) {
      const afterHours = Number(escalation.afterHours);

      if (!Number.isFinite(afterHours) || afterHours < 1) {
        return {
          valid: false,
          message: `Stage ${position}: escalation time must be at least 1 hour`,
        };
      }

      if (!APPROVER_TYPES.includes(escalation.escalateTo)) {
        return {
          valid: false,
          message: `Stage ${position}: pick who the stage escalates to`,
        };
      }

      if (!ESCALATION_ACTIONS.includes(escalation.action)) {
        return {
          valid: false,
          message: `Stage ${position}: escalation action must be one of: ${ESCALATION_ACTIONS.join(
            ", "
          )}`,
        };
      }

      cleanStage.escalation.enabled = true;
      cleanStage.escalation.afterHours = afterHours;
      cleanStage.escalation.escalateTo = escalation.escalateTo;
      cleanStage.escalation.action = escalation.action;

      const escalationTarget = ESCALATION_TARGETS[escalation.escalateTo];

      if (escalationTarget) {
        const value = escalation[escalationTarget.field];

        if (!value || !isValidObjectId(value)) {
          return {
            valid: false,
            message: `Stage ${position}: please select a ${escalationTarget.label} to escalate to`,
          };
        }

        if (!(await targetExists(escalationTarget.model, value))) {
          return {
            valid: false,
            message: `Stage ${position}: the ${escalationTarget.label} to escalate to was not found`,
          };
        }

        cleanStage.escalation[escalationTarget.field] = value;
      }
    }

    /* ---- auto approval rule ---- */
    const autoApproval = stage.autoApproval || {};

    cleanStage.autoApproval = { enabled: false, conditions: [] };

    if (autoApproval.enabled) {
      const conditions = Array.isArray(autoApproval.conditions)
        ? autoApproval.conditions
        : [];

      if (conditions.length === 0) {
        return {
          valid: false,
          message: `Stage ${position}: auto approval needs at least one condition`,
        };
      }

      for (const condition of conditions) {
        if (!AUTO_APPROVAL_FIELDS.includes(condition.field)) {
          return {
            valid: false,
            message: `Stage ${position}: auto approval field must be one of: ${AUTO_APPROVAL_FIELDS.join(
              ", "
            )}`,
          };
        }

        if (!AUTO_APPROVAL_OPERATORS.includes(condition.operator)) {
          return {
            valid: false,
            message: `Stage ${position}: "${condition.operator}" is not a valid operator`,
          };
        }

        if (
          condition.value === undefined ||
          condition.value === null ||
          String(condition.value).trim() === ""
        ) {
          return {
            valid: false,
            message: `Stage ${position}: auto approval condition needs a value`,
          };
        }

        /*
          "amount" is money, so its value must be a number. The other
          fields (priority, category) are plain text.
        */
        let value = String(condition.value).trim();

        if (NUMERIC_AUTO_APPROVAL_FIELDS.includes(condition.field)) {
          const numericValue = Number(value);

          if (!Number.isFinite(numericValue)) {
            return {
              valid: false,
              message: `Stage ${position}: the ${condition.field} condition needs a number`,
            };
          }

          value = numericValue;
        }

        cleanStage.autoApproval.conditions.push({
          field: condition.field,
          operator: condition.operator,
          value,
        });
      }

      cleanStage.autoApproval.enabled = true;
    }

    cleanStages.push(cleanStage);
  }

  return { valid: true, stages: cleanStages };
};

/*
  Every place that sends a workflow back to the frontend wants the
  approver names, not just their ids, so the builder can show
  "Finance" instead of "68b1f0...". One list, used by them all.
*/
const STAGE_POPULATE = [
  { path: "stages.approverRole", select: "name" },
  { path: "stages.approverDepartment", select: "name code" },
  { path: "stages.approverUser", select: "firstName lastName employeeId" },
  { path: "stages.escalation.escalateToRole", select: "name" },
  { path: "stages.escalation.escalateToDepartment", select: "name code" },
  {
    path: "stages.escalation.escalateToUser",
    select: "firstName lastName employeeId",
  },
];

/* =====================================================================
   1) CREATE WORKFLOW
   ---------------------------------------------------------------------
   POST /api/workflow/create
   body: { name, description, requestType }

   A new workflow starts EMPTY and inactive. The admin then opens the
   builder and adds the stages, exactly like a request starts as a draft.
   ===================================================================== */
export const createWorkflow = async (req, res) => {
  try {
    const { name, description, requestType } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Workflow name is required" });
    }

    if (!(await isSelectableRequestType(requestType))) {
      return res
        .status(400)
        .json({ message: await describeSelectableTypes() });
    }

    // the name must be free (ignoring upper/lower case)
    const existingWorkflow = await Workflow.findOne({
      isDeleted: false,
      name: { $regex: `^${name.trim()}$`, $options: "i" },
    });

    if (existingWorkflow) {
      return res
        .status(400)
        .json({ message: "A workflow with this name already exists" });
    }

    const workflow = await Workflow.create({
      name: name.trim(),
      description: description?.trim() || "",
      requestType,
    });

    await recordAudit(req, {
      action: "WorkflowCreated",
      targetType: "Workflow",
      targetId: workflow._id,
      targetLabel: workflow.name,
      description: `${describePerson(req.user)} created the workflow "${
        workflow.name
      }" for ${workflow.requestType} requests`,
    });

    return res.status(201).json({
      message: "Workflow created successfully",
      workflow,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Create Workflow Error ${error}` });
  }
};

/* =====================================================================
   2) GET ALL WORKFLOWS  (with search and filters)
   ---------------------------------------------------------------------
   GET /api/workflow/all?search=purchase&requestType=Purchase&isActive=true
   ===================================================================== */
export const getAllWorkflows = async (req, res) => {
  try {
    const { search, requestType, isActive } = req.query;

    const filter = { isDeleted: false };

    if (search && search.trim()) {
      filter.name = { $regex: search.trim(), $options: "i" };
    }

    // isKnown, not isSelectable - a retired type must stay filterable
    if (requestType && (await isKnownRequestType(requestType))) {
      filter.requestType = requestType;
    }

    // query values are always text, so we compare against the strings
    if (isActive === "true" || isActive === "false") {
      filter.isActive = isActive === "true";
    }

    const workflows = await Workflow.find(filter)
      .populate(STAGE_POPULATE)
      .sort({ createdAt: -1 }) // newest first
      // MODULE 10 - read-only list, see the note in requestController.js
      .lean();

    return res.status(200).json({
      message: "Workflows fetched successfully",
      workflows,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get All Workflows Error ${error}` });
  }
};

/* =====================================================================
   3) GET ONE WORKFLOW  (used by the builder page)
   ---------------------------------------------------------------------
   GET /api/workflow/:id
   ===================================================================== */
export const getWorkflowById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid workflow id" });
    }

    const workflow = await Workflow.findOne({
      _id: id,
      isDeleted: false,
    }).populate(STAGE_POPULATE);

    if (!workflow) {
      return res.status(404).json({ message: "Workflow not found" });
    }

    return res.status(200).json({
      message: "Workflow fetched successfully",
      workflow,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Workflow Error ${error}` });
  }
};

/* =====================================================================
   4) UPDATE WORKFLOW  (name / description / request type only)
   ---------------------------------------------------------------------
   PUT /api/workflow/:id

   The STAGES are not touched here - they have their own endpoint below,
   because they are edited on a completely different screen.
   ===================================================================== */
export const updateWorkflow = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, requestType } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid workflow id" });
    }

    const workflow = await Workflow.findOne({ _id: id, isDeleted: false });

    if (!workflow) {
      return res.status(404).json({ message: "Workflow not found" });
    }

    // MODULE 7 - a copy of the values before the lines below change them
    const before = workflow.toObject();

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: "Workflow name is required" });
      }

      /*
        Somebody else must not already own this name.
        $ne means "not equal", so we skip the workflow we are editing -
        otherwise it would always clash with itself.
      */
      const nameTaken = await Workflow.findOne({
        _id: { $ne: id },
        isDeleted: false,
        name: { $regex: `^${name.trim()}$`, $options: "i" },
      });

      if (nameTaken) {
        return res
          .status(400)
          .json({ message: "A workflow with this name already exists" });
      }

      workflow.name = name.trim();
    }

    if (description !== undefined) {
      workflow.description = description?.trim() || "";
    }

    if (requestType !== undefined) {
      if (!(await isSelectableRequestType(requestType))) {
        return res
          .status(400)
          .json({ message: await describeSelectableTypes() });
      }

      /*
        Moving a LIVE workflow to another request type would quietly
        leave that type with two active workflows, so we make the admin
        switch it off first.
      */
      if (workflow.isActive && workflow.requestType !== requestType) {
        return res.status(400).json({
          message:
            "Deactivate the workflow before moving it to another request type",
        });
      }

      workflow.requestType = requestType;
    }

    await workflow.save();

    const changes = buildChanges(
      before,
      workflow.toObject(),
      WORKFLOW_AUDIT_FIELDS
    );

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "WorkflowUpdated",
        targetType: "Workflow",
        targetId: workflow._id,
        targetLabel: workflow.name,
        changes,
        description: `${describePerson(req.user)} updated the workflow "${
          workflow.name
        }"`,
      });
    }

    return res.status(200).json({
      message: "Workflow updated successfully",
      workflow,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update Workflow Error ${error}` });
  }
};

/* =====================================================================
   5) DELETE WORKFLOW  (soft delete)
   ---------------------------------------------------------------------
   DELETE /api/workflow/:id

   An ACTIVE workflow cannot be deleted - requests may be travelling
   down it right now. The admin must switch it off first, which is a
   deliberate second step.
   ===================================================================== */
export const deleteWorkflow = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid workflow id" });
    }

    const workflow = await Workflow.findOne({ _id: id, isDeleted: false });

    if (!workflow) {
      return res.status(404).json({ message: "Workflow not found" });
    }

    if (workflow.isActive) {
      return res.status(400).json({
        message: "Deactivate the workflow before deleting it",
      });
    }

    workflow.isDeleted = true;
    await workflow.save({ validateBeforeSave: false });

    await recordAudit(req, {
      action: "WorkflowDeleted",
      targetType: "Workflow",
      targetId: workflow._id,
      targetLabel: workflow.name,
      description: `${describePerson(req.user)} deleted the workflow "${
        workflow.name
      }" (${workflow.requestType})`,
    });

    return res.status(200).json({ message: "Workflow deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Delete Workflow Error ${error}` });
  }
};

/* =====================================================================
   6) SAVE STAGES   <- this is the Workflow Builder's "Save" button
   ---------------------------------------------------------------------
   PUT /api/workflow/:id/stages
   body: { stages: [ { name, approverType, ... }, ... ] }

   The whole chain arrives in ONE call, in the order the admin sees on
   screen. We check every stage, then replace the old array completely.
   Because we rebuild `order` from the array position, moving a stage up
   or down on screen needs no special handling at all.
   ===================================================================== */
export const saveStages = async (req, res) => {
  try {
    const { id } = req.params;
    const { stages } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid workflow id" });
    }

    const workflow = await Workflow.findOne({ _id: id, isDeleted: false });

    if (!workflow) {
      return res.status(404).json({ message: "Workflow not found" });
    }

    const result = await validateStages(stages);

    if (!result.valid) {
      return res.status(400).json({ message: result.message });
    }

    /*
      MODULE 7. The old chain, read BEFORE it is thrown away on the
      next line - the Save button replaces the whole array, so this is
      the last moment anything knows what the route used to look like.
    */
    const routeBefore = workflow.stages.map((stage) => stage.name).join(" -> ");

    workflow.stages = result.stages;
    await workflow.save();

    const savedWorkflow = await Workflow.findById(id).populate(STAGE_POPULATE);

    /*
      A stage is far too big to diff field by field (approvers, rules,
      escalation, auto approval conditions), so the entry records the
      ROUTE as one readable line instead:

        Approval route: "Manager -> Finance" -> "Manager -> Finance -> Director"

      That is what an admin actually wants to see when they ask why a
      request suddenly needed one more signature last month.
    */
    const routeAfter = workflow.stages.map((stage) => stage.name).join(" -> ");

    await recordAudit(req, {
      action: "WorkflowStagesSaved",
      targetType: "Workflow",
      targetId: workflow._id,
      targetLabel: workflow.name,
      changes: [
        {
          field: "Approval route",
          from: routeBefore || "(empty)",
          to: routeAfter || "(empty)",
        },
      ],
      description: `${describePerson(req.user)} saved the stages of "${
        workflow.name
      }" (${workflow.stages.length} stage(s))`,
    });

    return res.status(200).json({
      message: "Workflow stages saved successfully",
      workflow: savedWorkflow,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Save Stages Error ${error}` });
  }
};

/* =====================================================================
   7) ACTIVATE / DEACTIVATE
   ---------------------------------------------------------------------
   PATCH /api/workflow/:id/active
   body: { isActive: true }

   Only ONE workflow per request type may be live, so switching this one
   on switches every other workflow of the same type off in a single
   updateMany() call.
   ===================================================================== */
export const toggleActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid workflow id" });
    }

    if (typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ message: "isActive must be true or false" });
    }

    const workflow = await Workflow.findOne({ _id: id, isDeleted: false });

    if (!workflow) {
      return res.status(404).json({ message: "Workflow not found" });
    }

    // an empty route would catch requests and then have nowhere to send them
    if (isActive && workflow.stages.length === 0) {
      return res.status(400).json({
        message: "Add at least one stage before activating this workflow",
      });
    }

    if (isActive) {
      /*
        Switch off every OTHER workflow of the same request type.
        $ne = "not equal", so we leave this one alone.
      */
      await Workflow.updateMany(
        {
          _id: { $ne: id },
          requestType: workflow.requestType,
          isDeleted: false,
          isActive: true,
        },
        { isActive: false }
      );
    }

    workflow.isActive = isActive;
    await workflow.save({ validateBeforeSave: false });

    /*
      MODULE 7. Switching a workflow on is the single most consequential
      click in the admin area - from this second every new request of
      that type travels down this route and not the old one - so it
      gets its own action rather than hiding inside WorkflowUpdated.
    */
    await recordAudit(req, {
      action: isActive ? "WorkflowActivated" : "WorkflowDeactivated",
      targetType: "Workflow",
      targetId: workflow._id,
      targetLabel: workflow.name,
      description: isActive
        ? `${describePerson(req.user)} made "${
            workflow.name
          }" the active workflow for ${workflow.requestType} requests`
        : `${describePerson(req.user)} deactivated the workflow "${
            workflow.name
          }"`,
    });

    return res.status(200).json({
      message: isActive
        ? `This is now the active workflow for ${workflow.requestType} requests`
        : "Workflow deactivated successfully",
      workflow,
    });
  } catch (error) {
    return res.status(500).json({ message: `Toggle Active Error ${error}` });
  }
};
