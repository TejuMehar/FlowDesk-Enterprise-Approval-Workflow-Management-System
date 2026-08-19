/*
=========================================================================
  PAGE: WorkflowBuilder   (Module 3 - Workflow Builder)
=========================================================================
  The screen where an admin DESIGNS the approval route, one stage at a
  time. It draws the chain from top to bottom, exactly like the diagram:

      Employee            <- always there, not editable
         |
      Manager             <- stage 1   \
         |                              |  the part
      Finance             <- stage 2    |  we edit here
         |                              |
      Director            <- stage 3   /
         |
      Completed           <- always there, not editable

  HOW THE SAVING WORKS
  --------------------
  Everything you do here (adding, editing, moving stages) only changes
  the `stages` array in this component. Nothing reaches the backend
  until "Save Workflow" is pressed, which sends the WHOLE list in one
  call to PUT /api/workflow/:id/stages.

  That is why moving a stage up or down needs no special code - the
  backend numbers the stages from their position in the array it
  receives.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdAdd,
  MdDelete,
  MdArrowUpward,
  MdArrowDownward,
  MdArrowBack,
  MdExpandMore,
  MdExpandLess,
  MdPerson,
  MdCheckCircle,
  MdSave,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import {
  APPROVER_TYPES,
  APPROVER_TYPE_LABELS,
  APPROVAL_RULES,
  APPROVAL_RULE_LABELS,
  ESCALATION_ACTIONS,
  ESCALATION_ACTION_LABELS,
  AUTO_APPROVAL_FIELDS,
  AUTO_APPROVAL_FIELD_LABELS,
  AUTO_APPROVAL_OPERATORS,
  AUTO_APPROVAL_OPERATOR_LABELS,
  NUMERIC_AUTO_APPROVAL_FIELDS,
  EMPTY_STAGE,
} from "../utils/workflowConstants.js";

/*
  A number that identifies one stage CARD for as long as this page is
  open. See the note on openStages: positions shuffle when a stage is
  added, removed or moved, so anything remembered per position ends up
  attached to the wrong card.

  It is stripped off again before saving - the server numbers the
  stages from their order in the array, and has no use for this.
*/
let nextStageUid = 1;

const takeStageUid = () => {
  nextStageUid += 1;
  return nextStageUid;
};

/*
  The backend sends the stages with their approver POPULATED, so
  approverRole is a whole { _id, name } object. A <select> needs a plain
  id string, so we flatten every reference back into an id before the
  form uses it.

  `?._id || ""` covers all three cases: an object, a plain id, or null.
*/
const toFormStage = (stage) => ({
  uid: takeStageUid(),
  name: stage.name || "",
  approverType: stage.approverType || "RequesterManager",
  approverRole: stage.approverRole?._id || stage.approverRole || "",
  approverDepartment:
    stage.approverDepartment?._id || stage.approverDepartment || "",
  approverUser: stage.approverUser?._id || stage.approverUser || "",
  approvalRule: stage.approvalRule || "AnyOne",
  escalation: {
    enabled: stage.escalation?.enabled || false,
    afterHours: stage.escalation?.afterHours ?? 24,
    escalateTo: stage.escalation?.escalateTo || "RequesterManager",
    escalateToRole:
      stage.escalation?.escalateToRole?._id ||
      stage.escalation?.escalateToRole ||
      "",
    escalateToDepartment:
      stage.escalation?.escalateToDepartment?._id ||
      stage.escalation?.escalateToDepartment ||
      "",
    escalateToUser:
      stage.escalation?.escalateToUser?._id ||
      stage.escalation?.escalateToUser ||
      "",
    action: stage.escalation?.action || "Notify",
  },
  autoApproval: {
    enabled: stage.autoApproval?.enabled || false,
    conditions: (stage.autoApproval?.conditions || []).map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: String(condition.value),
    })),
  },
});

function WorkflowBuilder() {
  // the ":id" part of the URL /workflows/:id
  const { id } = useParams();
  const navigate = useNavigate();
  const { userData } = useSelector((state) => state.user);

  const [workflow, setWorkflow] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // true as soon as the admin changes anything, false again after saving
  const [hasChanges, setHasChanges] = useState(false);

  /*
    WHICH STAGE CARDS ARE OPEN.

    This used to be a Set of POSITIONS, which quietly followed the
    wrong card around. Open stage 3, delete stage 1, and stage 4 slides
    into position 3 and springs open while the card the admin was
    working in closes. Moving a stage up or down did the same thing in
    reverse: the contents swapped, the open state did not follow.

    So each stage carries its own `uid` now - a number that belongs to
    that stage for as long as the page is open and is never sent to the
    server. Positions change; the uid does not.
  */
  const [openStages, setOpenStages] = useState(new Set());

  /* ---------------- the dropdown options ---------------- */
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);

  const canUpdate = hasPermission(userData, PERMISSIONS.WORKFLOW_UPDATE);

  /* =================================================================
     LOAD THE WORKFLOW
     ================================================================= */
  useEffect(() => {
    const fetchWorkflow = async () => {
      setLoading(true);

      try {
        const result = await api.get(`/api/workflow/${id}`);

        setWorkflow(result.data.workflow);
        setStages(result.data.workflow.stages.map(toFormStage));
      } catch (error) {
        toast.error(getErrorMessage(error));
        navigate("/workflows");
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflow();
  }, [id, navigate]);

  /* =================================================================
     LOAD THE DROPDOWN OPTIONS, once
     -----------------------------------------------------------------
     Promise.all fires all three at the same time instead of waiting for
     each one, so the page is ready faster.

     These lists only fill dropdowns, so a failure here is not worth a
     toast - the page still works, the dropdown is just empty.
     ================================================================= */
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [roleResult, departmentResult, userResult] = await Promise.all([
          api.get("/api/role/all"),
          api.get("/api/department/all"),
          api.get("/api/user/all?limit=100&status=active"),
        ]);

        setRoles(roleResult.data.roles);
        setDepartments(departmentResult.data.departments);
        setEmployees(userResult.data.users);
      } catch (error) {
        console.log("Workflow options error", error);
      }
    };

    fetchOptions();
  }, []);

  /* =================================================================
     CHANGING A STAGE
     -----------------------------------------------------------------
     React state must never be edited in place, so every helper below
     builds a NEW array with .map() / [...spread] instead of changing
     the old one.
     ================================================================= */
  const updateStage = (index, changes) => {
    setStages((previous) =>
      previous.map((stage, position) =>
        position === index ? { ...stage, ...changes } : stage
      )
    );
    setHasChanges(true);
  };

  // the escalation fields live one level deeper, so they get their own helper
  const updateEscalation = (index, changes) => {
    setStages((previous) =>
      previous.map((stage, position) =>
        position === index
          ? { ...stage, escalation: { ...stage.escalation, ...changes } }
          : stage
      )
    );
    setHasChanges(true);
  };

  const updateAutoApproval = (index, changes) => {
    setStages((previous) =>
      previous.map((stage, position) =>
        position === index
          ? { ...stage, autoApproval: { ...stage.autoApproval, ...changes } }
          : stage
      )
    );
    setHasChanges(true);
  };

  /* =================================================================
     ADD / REMOVE / MOVE A STAGE
     ================================================================= */
  const addStage = () => {
    /*
      structuredClone gives a DEEP copy of EMPTY_STAGE. Without it every
      new stage would share the same escalation object, and editing one
      stage would silently change all the others.
    */
    const fresh = { ...structuredClone(EMPTY_STAGE), uid: takeStageUid() };

    setStages((previous) => [...previous, fresh]);

    // open the new card straight away so the admin can start typing
    setOpenStages((previous) => new Set(previous).add(fresh.uid));
    setHasChanges(true);
  };

  const removeStage = (index) => {
    const removedUid = stages[index]?.uid;

    setStages((previous) =>
      previous.filter((_, position) => position !== index)
    );

    // forget the card we just deleted, so its uid cannot linger
    setOpenStages((previous) => {
      const copy = new Set(previous);
      copy.delete(removedUid);
      return copy;
    });

    setHasChanges(true);
  };

  /*
    Moves a stage one place up (direction -1) or down (direction +1) by
    swapping it with its neighbour.
  */
  const moveStage = (index, direction) => {
    const target = index + direction;

    if (target < 0 || target >= stages.length) {
      return;
    }

    setStages((previous) => {
      const copy = [...previous];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });

    setHasChanges(true);
  };

  const toggleOpen = (uid) => {
    setOpenStages((previous) => {
      const copy = new Set(previous);

      if (copy.has(uid)) {
        copy.delete(uid);
      } else {
        copy.add(uid);
      }

      return copy;
    });
  };

  /* =================================================================
     AUTO APPROVAL CONDITIONS
     ================================================================= */
  const addCondition = (index) => {
    const conditions = [
      ...stages[index].autoApproval.conditions,
      { field: "amount", operator: "<=", value: "" },
    ];

    updateAutoApproval(index, { conditions });
  };

  const updateCondition = (index, conditionIndex, changes) => {
    const conditions = stages[index].autoApproval.conditions.map(
      (condition, position) =>
        position === conditionIndex ? { ...condition, ...changes } : condition
    );

    updateAutoApproval(index, { conditions });
  };

  const removeCondition = (index, conditionIndex) => {
    const conditions = stages[index].autoApproval.conditions.filter(
      (_, position) => position !== conditionIndex
    );

    updateAutoApproval(index, { conditions });
  };

  /* =================================================================
     SAVE - sends the whole chain in one call
     ================================================================= */
  const handleSave = async () => {
    if (stages.length === 0) {
      toast.error("Add at least one stage before saving");
      return;
    }

    /*
      A stage with no name is a card the admin opened, meant to fill in
      and then scrolled past. The backend refuses it, but its message
      names a stage NUMBER, and on a five stage workflow that is a
      hunt. Saying which one here costs nothing.
    */
    const unnamed = stages.findIndex((stage) => !stage.name.trim());

    if (unnamed !== -1) {
      toast.error(`Stage ${unnamed + 1} needs a name`);
      setOpenStages((previous) =>
        new Set(previous).add(stages[unnamed].uid)
      );
      return;
    }

    setSaving(true);

    try {
      /*
        `uid` belongs to this page and to nothing else - it exists so a
        card can be told apart from its neighbours while positions move
        about. Sending it would push a field into the workflow document
        that means nothing on the server.
      */
      const payload = stages.map(({ uid, ...stage }) => ({
        ...stage,
        /*
          <input type="number"> hands back a STRING, and an empty one
          when the admin clears the box to retype it. Sending "" as the
          escalation delay stored a workflow that escalated after no
          time at all - so it is turned back into a number here, and
          falls back to the 24 hours the form started with.
        */
        escalation: {
          ...stage.escalation,
          afterHours: Number(stage.escalation.afterHours) || 24,
        },
      }));

      const result = await api.put(`/api/workflow/${id}/stages`, {
        stages: payload,
      });

      toast.success(result.data.message);

      setWorkflow(result.data.workflow);
      setStages(result.data.workflow.stages.map(toFormStage));
      setHasChanges(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     DO NOT THROW THE DESIGN AWAY WITHOUT ASKING
     -----------------------------------------------------------------
     Everything on this page lives in component state until Save is
     pressed, which is what makes reordering stages free - and also
     what makes leaving expensive. An admin who spent ten minutes
     building a four stage approval chain and then clicked Dashboard
     lost all four stages, silently, with a small amber line at the
     bottom of the page as the only warning they ever got.

     Two guards, because there are two ways to leave:

       the browser  closing the tab, reloading, typing a new address.
                    beforeunload is the only hook there is, and the
                    browser insists on wording the question itself.

       the app      clicking anything in the sidebar or the Back link.
                    react-router navigates without the browser ever
                    being involved, so beforeunload never fires - this
                    is the case that actually happens, and the one the
                    page had no answer for at all.
     ================================================================= */
  useEffect(() => {
    if (!hasChanges) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      // some browsers still want a truthy returnValue
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  /*
    The in-app half. `useBlocker` needs a data router, which this app
    does not use, so the honest way to catch a react-router navigation
    is to ask before performing one - which is what leaveTo() below is
    for. Every way OUT of this page goes through it.
  */
  const leaveTo = (path) => {
    if (
      hasChanges &&
      !window.confirm(
        "This workflow has unsaved changes. Leave without saving?"
      )
    ) {
      return;
    }

    navigate(path);
  };

  /* =================================================================
     A SMALL REUSABLE PIECE
     -----------------------------------------------------------------
     The approver dropdown is needed twice on every stage: once for
     "who approves" and once for "who it escalates to". Both need the
     exact same Role / Department / Person list, so we write it once.
     ================================================================= */
  const renderTargetSelect = (type, value, onChange) => {
    if (type === "Role") {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">Select a role</option>
          {roles.map((role) => (
            <option key={role._id} value={role._id}>
              {role.name}
            </option>
          ))}
        </select>
      );
    }

    if (type === "Department") {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">Select a department</option>
          {departments.map((department) => (
            <option key={department._id} value={department._id}>
              {department.name} ({department.code})
            </option>
          ))}
        </select>
      );
    }

    if (type === "User") {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">Select a person</option>
          {employees.map((employee) => (
            <option key={employee._id} value={employee._id}>
              {employee.fullName} ({employee.email})
            </option>
          ))}
        </select>
      );
    }

    // "RequesterManager" needs no extra choice
    return null;
  };

  /* =================================================================
     THE SCREEN
     ================================================================= */
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-16 flex justify-center">
        <ClipLoader size={35} color="#4f46e5" />
      </div>
    );
  }

  if (!workflow) {
    return null;
  }

  // the little grey "-> " arrow drawn between two cards
  const arrow = (
    <div className="flex justify-center py-1.5">
      <span className="text-slate-300 text-xl leading-none">&darr;</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => leaveTo("/workflows")}
            className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 mb-1"
          >
            <MdArrowBack size={17} /> Back to workflows
          </button>

          <h1 className="text-xl font-semibold text-slate-800">
            {workflow.name}
          </h1>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
              {workflow.requestType}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                workflow.isActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {workflow.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        {canUpdate && (
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="h-10 px-5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5 min-w-[150px]"
          >
            {saving ? (
              <ClipLoader size={19} color="white" />
            ) : (
              <>
                <MdSave size={18} />
                {hasChanges ? "Save Workflow" : "Saved"}
              </>
            )}
          </button>
        )}
      </div>

      {/* ==================== the chain ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {/* ---------- the fixed first step ---------- */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white text-slate-500 border border-slate-200 flex items-center justify-center">
            <MdPerson size={19} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Employee</p>
            <p className="text-xs text-slate-500">
              The person who raises the request
            </p>
          </div>
        </div>

        {arrow}

        {/* ---------- the editable stages ---------- */}
        {stages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No stages yet. Add the first approval step below.
          </div>
        ) : (
          stages.map((stage, index) => {
            const isOpen = openStages.has(stage.uid);

            return (
              /*
                `key` is the uid, not the position. With an index key
                React reuses the same DOM for whatever slides into that
                slot, so deleting stage 1 left stage 2's text sitting in
                a card that now belonged to stage 3 until the next
                keystroke.
              */
              <div key={stage.uid}>
                <div className="rounded-xl border border-slate-200">
                  {/* ---------- the card header ---------- */}
                  <div className="flex items-center gap-2 px-4 py-3">
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>

                    <button
                      onClick={() => toggleOpen(stage.uid)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {stage.name || "Untitled stage"}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {APPROVER_TYPE_LABELS[stage.approverType]}
                        {" · "}
                        {APPROVAL_RULE_LABELS[stage.approvalRule]}
                      </p>
                    </button>

                    {canUpdate && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          title="Move up"
                          onClick={() => moveStage(index, -1)}
                          disabled={index === 0}
                          className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                        >
                          <MdArrowUpward size={17} />
                        </button>

                        <button
                          title="Move down"
                          onClick={() => moveStage(index, 1)}
                          disabled={index === stages.length - 1}
                          className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                        >
                          <MdArrowDownward size={17} />
                        </button>

                        <button
                          title="Remove stage"
                          onClick={() => removeStage(index)}
                          className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                        >
                          <MdDelete size={17} />
                        </button>
                      </div>
                    )}

                    <button
                      onClick={() => toggleOpen(stage.uid)}
                      aria-label={isOpen ? "Collapse stage" : "Expand stage"}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0"
                    >
                      {isOpen ? (
                        <MdExpandLess size={20} />
                      ) : (
                        <MdExpandMore size={20} />
                      )}
                    </button>
                  </div>

                  {/* ---------- the opened card ---------- */}
                  {isOpen && (
                    <div className="border-t border-slate-100 p-4 flex flex-col gap-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">
                            Stage name <span className="text-red-500">*</span>
                          </label>
                          <input
                            value={stage.name}
                            onChange={(e) =>
                              updateStage(index, { name: e.target.value })
                            }
                            disabled={!canUpdate}
                            placeholder="e.g. Finance Review"
                            className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">
                            Approval rule
                          </label>
                          <select
                            value={stage.approvalRule}
                            onChange={(e) =>
                              updateStage(index, {
                                approvalRule: e.target.value,
                              })
                            }
                            disabled={!canUpdate}
                            className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                          >
                            {APPROVAL_RULES.map((rule) => (
                              <option key={rule} value={rule}>
                                {APPROVAL_RULE_LABELS[rule]}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-slate-400">
                            Only matters when the stage has more than one
                            approver.
                          </p>
                        </div>
                      </div>

                      {/* ---------- who approves ---------- */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">
                            Approved by <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={stage.approverType}
                            onChange={(e) =>
                              /*
                                Changing the type clears the three id
                                fields, so a leftover role id can never
                                be saved on a "Department" stage.
                              */
                              updateStage(index, {
                                approverType: e.target.value,
                                approverRole: "",
                                approverDepartment: "",
                                approverUser: "",
                              })
                            }
                            disabled={!canUpdate}
                            className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                          >
                            {APPROVER_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {APPROVER_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </select>
                        </div>

                        {stage.approverType !== "RequesterManager" && (
                          <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-slate-700">
                              Which one <span className="text-red-500">*</span>
                            </label>
                            {renderTargetSelect(
                              stage.approverType,
                              stage.approverType === "Role"
                                ? stage.approverRole
                                : stage.approverType === "Department"
                                ? stage.approverDepartment
                                : stage.approverUser,
                              (value) =>
                                updateStage(index, {
                                  [stage.approverType === "Role"
                                    ? "approverRole"
                                    : stage.approverType === "Department"
                                    ? "approverDepartment"
                                    : "approverUser"]: value,
                                })
                            )}
                          </div>
                        )}
                      </div>

                      {/* ---------- escalation rule ---------- */}
                      <div className="rounded-xl border border-slate-200 p-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stage.escalation.enabled}
                            onChange={(e) =>
                              updateEscalation(index, {
                                enabled: e.target.checked,
                              })
                            }
                            disabled={!canUpdate}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <span className="text-sm font-medium text-slate-700">
                            Escalate when nobody answers in time
                          </span>
                        </label>

                        {stage.escalation.enabled && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-medium text-slate-700">
                                Wait for (hours)
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={stage.escalation.afterHours}
                                onChange={(e) =>
                                  updateEscalation(index, {
                                    afterHours: e.target.value,
                                  })
                                }
                                disabled={!canUpdate}
                                className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50"
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-medium text-slate-700">
                                Then
                              </label>
                              <select
                                value={stage.escalation.action}
                                onChange={(e) =>
                                  updateEscalation(index, {
                                    action: e.target.value,
                                  })
                                }
                                disabled={!canUpdate}
                                className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                              >
                                {ESCALATION_ACTIONS.map((action) => (
                                  <option key={action} value={action}>
                                    {ESCALATION_ACTION_LABELS[action]}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-sm font-medium text-slate-700">
                                Escalate to
                              </label>
                              <select
                                value={stage.escalation.escalateTo}
                                onChange={(e) =>
                                  updateEscalation(index, {
                                    escalateTo: e.target.value,
                                    escalateToRole: "",
                                    escalateToDepartment: "",
                                    escalateToUser: "",
                                  })
                                }
                                disabled={!canUpdate}
                                className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                              >
                                {APPROVER_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {APPROVER_TYPE_LABELS[type]}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {stage.escalation.escalateTo !==
                              "RequesterManager" && (
                              <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-medium text-slate-700">
                                  Which one
                                </label>
                                {renderTargetSelect(
                                  stage.escalation.escalateTo,
                                  stage.escalation.escalateTo === "Role"
                                    ? stage.escalation.escalateToRole
                                    : stage.escalation.escalateTo ===
                                      "Department"
                                    ? stage.escalation.escalateToDepartment
                                    : stage.escalation.escalateToUser,
                                  (value) =>
                                    updateEscalation(index, {
                                      [stage.escalation.escalateTo === "Role"
                                        ? "escalateToRole"
                                        : stage.escalation.escalateTo ===
                                          "Department"
                                        ? "escalateToDepartment"
                                        : "escalateToUser"]: value,
                                    })
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ---------- auto approval rule ---------- */}
                      <div className="rounded-xl border border-slate-200 p-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stage.autoApproval.enabled}
                            onChange={(e) =>
                              updateAutoApproval(index, {
                                enabled: e.target.checked,
                              })
                            }
                            disabled={!canUpdate}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <span className="text-sm font-medium text-slate-700">
                            Skip this stage automatically
                          </span>
                        </label>

                        {stage.autoApproval.enabled && (
                          <div className="mt-4 flex flex-col gap-3">
                            <p className="text-xs text-slate-400">
                              The stage is approved without a human when ALL of
                              these are true.
                            </p>

                            {stage.autoApproval.conditions.map(
                              (condition, conditionIndex) => (
                                <div
                                  key={conditionIndex}
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <select
                                    value={condition.field}
                                    onChange={(e) =>
                                      updateCondition(index, conditionIndex, {
                                        field: e.target.value,
                                        value: "",
                                      })
                                    }
                                    disabled={!canUpdate}
                                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                                  >
                                    {AUTO_APPROVAL_FIELDS.map((field) => (
                                      <option key={field} value={field}>
                                        {AUTO_APPROVAL_FIELD_LABELS[field]}
                                      </option>
                                    ))}
                                  </select>

                                  <select
                                    value={condition.operator}
                                    onChange={(e) =>
                                      updateCondition(index, conditionIndex, {
                                        operator: e.target.value,
                                      })
                                    }
                                    disabled={!canUpdate}
                                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50"
                                  >
                                    {AUTO_APPROVAL_OPERATORS.map((operator) => (
                                      <option key={operator} value={operator}>
                                        {
                                          AUTO_APPROVAL_OPERATOR_LABELS[
                                            operator
                                          ]
                                        }
                                      </option>
                                    ))}
                                  </select>

                                  <input
                                    /*
                                      "amount" is money so we ask for a
                                      number keypad; priority and
                                      category are plain text.
                                    */
                                    type={
                                      NUMERIC_AUTO_APPROVAL_FIELDS.includes(
                                        condition.field
                                      )
                                        ? "number"
                                        : "text"
                                    }
                                    value={condition.value}
                                    onChange={(e) =>
                                      updateCondition(index, conditionIndex, {
                                        value: e.target.value,
                                      })
                                    }
                                    disabled={!canUpdate}
                                    placeholder="Value"
                                    className="h-10 px-3 flex-1 min-w-[120px] rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50"
                                  />

                                  {canUpdate && (
                                    <button
                                      title="Remove condition"
                                      onClick={() =>
                                        removeCondition(index, conditionIndex)
                                      }
                                      className="w-9 h-9 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center shrink-0"
                                    >
                                      <MdDelete size={17} />
                                    </button>
                                  )}
                                </div>
                              )
                            )}

                            {canUpdate && (
                              <button
                                onClick={() => addCondition(index)}
                                className="text-sm text-indigo-600 hover:underline flex items-center gap-1 self-start"
                              >
                                <MdAdd size={16} /> Add condition
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {arrow}
              </div>
            );
          })
        )}

        {/* ---------- add a stage ---------- */}
        {canUpdate && (
          <>
            <button
              onClick={addStage}
              className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600 flex items-center justify-center gap-1.5"
            >
              <MdAdd size={18} /> Add Stage
            </button>

            {arrow}
          </>
        )}

        {/* ---------- the fixed last step ---------- */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white text-emerald-600 border border-emerald-200 flex items-center justify-center">
            <MdCheckCircle size={19} />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-800">Completed</p>
            <p className="text-xs text-emerald-700">
              The request is fully approved
            </p>
          </div>
        </div>
      </div>

      {hasChanges && (
        <p className="text-sm text-amber-600 text-center">
          You have unsaved changes.
        </p>
      )}
    </div>
  );
}

export default WorkflowBuilder;
