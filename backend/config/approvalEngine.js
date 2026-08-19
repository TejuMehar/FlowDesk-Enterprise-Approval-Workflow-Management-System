/*
=========================================================================
  THE APPROVAL ENGINE   (Module 4 - Approval Engine)
=========================================================================
  This file is the BRAIN of the approval module. It knows the rules, but
  it does not know anything about express - no req, no res, no routes.

  Two controllers use it:

    requestController.js  -> when an employee presses "Submit", to START
                             the workflow
    approvalController.js -> when an approver presses Approve / Reject /
                             Return, to MOVE the request along

  Keeping the rules here (instead of inside one of those controllers)
  means both of them behave exactly the same way, and the rules can be
  read on their own without wading through HTTP code.

  THE STORY THIS FILE TELLS
  -------------------------
      employee submits              -> startApprovalWorkflow()
      workflow starts at stage 1    -> runApprovalFrom()
      manager approves              -> stage 1 done
      automatically move to Finance -> runApprovalFrom() again
      finance approves              -> stage 2 done
      automatically move to Director-> runApprovalFrom() again
      director approves             -> no stages left = FINAL APPROVAL

  IMPORTANT: nothing in this file SAVES anything. Every function only
  changes the documents in memory and lets the controller do the saving,
  so a controller can still bail out with a 400 without having written
  half an approval to the database.
=========================================================================
*/

import Workflow from "../model/workflowModel.js";
import Approval from "../model/approvalModel.js";
import Department from "../model/departmentModel.js";
import User from "../model/userModel.js";
import { REQUEST_PRIORITIES } from "./requestConstants.js";

/* =====================================================================
   1) WHO APPROVES THIS STAGE, REALLY?
   ---------------------------------------------------------------------
   A workflow stage only says something like "anyone with the Director
   role". This turns that description into the real list of employees.

   @param stage          - one stage (from a workflow or from an approval)
   @param requesterId    - who raised the request, needed by RequesterManager
   @param chosenApprover - the manager the EMPLOYEE asked for, or null.
                           Only ever honoured by a RequesterManager stage.
   @returns an array of user ids (possibly empty)
   ===================================================================== */
export const resolveApprovers = async (stage, requesterId, chosenApprover = null) => {
  /* ---- the manager of the department the requester works in ---- */
  if (stage.approverType === "RequesterManager") {
    /*
      THE EMPLOYEE'S OWN CHOICE WINS, when they made one.

      This is the ONLY approver type that looks at chosenApprover, and
      the limit is the point rather than an oversight. A Role or
      Department stage exists so that somebody outside the requester's
      own chain looks at the request; an employee who could redirect
      those could pick their most agreeable Finance reviewer, which is
      the one thing an approval system exists to stop.

      The choice is re-checked HERE, on every resolve, rather than
      trusted from submit day: a manager who has since left the company
      or been deactivated must not be able to strand a request nobody
      can answer. When the check fails we fall through to the org chart
      below, so the request keeps moving.
    */
    if (chosenApprover) {
      const chosen = await User.findOne({
        _id: chosenApprover,
        isActive: true,
        isDeleted: false,
      })
        .select("_id")
        .lean();

      if (chosen) {
        return [chosen._id];
      }
    }

    const requester = await User.findOne({
      _id: requesterId,
      isDeleted: false,
    })
      .select("department")
      .lean();

    if (!requester?.department) {
      return []; // the employee is not in any department
    }

    const department = await Department.findOne({
      _id: requester.department,
      isDeleted: false,
    })
      .select("manager")
      .lean();

    return department?.manager ? [department.manager] : [];
  }

  /* ---- everybody who holds a certain role ---- */
  if (stage.approverType === "Role") {
    const users = await User.find({
      role: stage.approverRole,
      isActive: true,
      isDeleted: false,
    })
      .select("_id")
      .lean();

    return users.map((user) => user._id);
  }

  /* ---- the manager of one named department ---- */
  if (stage.approverType === "Department") {
    const department = await Department.findOne({
      _id: stage.approverDepartment,
      isDeleted: false,
    })
      .select("manager")
      .lean();

    return department?.manager ? [department.manager] : [];
  }

  /* ---- one exact person ---- */
  if (stage.approverType === "User") {
    const user = await User.findOne({
      _id: stage.approverUser,
      isActive: true,
      isDeleted: false,
    })
      .select("_id")
      .lean();

    return user ? [user._id] : [];
  }

  return [];
};

/* =====================================================================
   2) AUTO APPROVAL - does this request skip the stage on its own?
   ===================================================================== */

/*
  Compares two numbers with one of our six operators.
  Every kind of condition is turned into numbers first (see below), so
  this one little function covers them all.
*/
const compareNumbers = (left, operator, right) => {
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      return false;
  }
};

/*
  Checks ONE condition, e.g. "amount <= 5000", against a request.

  Each of the three allowed fields is compared in the way that makes
  sense for it:

    amount   -> plain numbers
    priority -> its POSITION in the list Low, Medium, High, Urgent, so
                "priority <= Medium" really does mean "Low or Medium"
    category -> text
*/
const matchesCondition = (condition, request) => {
  const { field, operator, value } = condition;

  /* ---------- amount: a number ---------- */
  if (field === "amount") {
    // a request without an amount can never satisfy an amount rule
    if (request.amount === null || request.amount === undefined) {
      return false;
    }

    const target = Number(value);

    if (!Number.isFinite(target)) {
      return false;
    }

    return compareNumbers(Number(request.amount), operator, target);
  }

  /* ---------- priority: compared by its position in the list ---------- */
  if (field === "priority") {
    const left = REQUEST_PRIORITIES.indexOf(request.priority);
    const right = REQUEST_PRIORITIES.indexOf(String(value).trim());

    // -1 means the value is not a real priority, so the rule cannot match
    if (left === -1 || right === -1) {
      return false;
    }

    return compareNumbers(left, operator, right);
  }

  /* ---------- category: plain text, upper/lower case ignored ---------- */
  const left = String(request.category || "")
    .trim()
    .toLowerCase();
  const right = String(value).trim().toLowerCase();

  if (operator === "==") {
    return left === right;
  }

  if (operator === "!=") {
    return left !== right;
  }

  /*
    "<" and ">" on words is unusual but the builder allows it, so we
    answer alphabetically. localeCompare gives -1, 0 or 1, which we can
    feed straight into the number comparison above.
  */
  return compareNumbers(left.localeCompare(right), operator, 0);
};

/*
  ALL the conditions must be true before a stage is skipped, so one
  false answer is enough to stop.
*/
export const matchesAutoApproval = (stage, request) => {
  if (!stage.autoApproval?.enabled) {
    return false;
  }

  const conditions = stage.autoApproval.conditions || [];

  if (conditions.length === 0) {
    return false;
  }

  return conditions.every((condition) => matchesCondition(condition, request));
};

/*
  Turns the conditions back into a sentence for the timeline, e.g.
  "amount <= 5000 and priority == Low".
*/
const describeAutoApproval = (stage) => {
  return (stage.autoApproval?.conditions || [])
    .map((condition) => `${condition.field} ${condition.operator} ${condition.value}`)
    .join(" and ");
};

/* =====================================================================
   3) HAS A STAGE COLLECTED ENOUGH YESES?
   ---------------------------------------------------------------------
   Only matters when a stage has several approvers:

     AnyOne   -> one yes is enough
     Everyone -> every approver must say yes
     Majority -> more than half must say yes

   A NO (Reject or Return) never waits for the others - the controller
   ends the stage immediately, exactly like a real veto.
   ===================================================================== */
export const isStageSatisfied = (stage) => {
  const yesCount = stage.decisions.filter(
    (decision) => decision.action === "Approve"
  ).length;

  const approverCount = stage.approvers.length;

  if (stage.approvalRule === "Everyone") {
    return yesCount >= approverCount;
  }

  if (stage.approvalRule === "Majority") {
    return yesCount > approverCount / 2;
  }

  // "AnyOne" - the first person to answer decides
  return yesCount >= 1;
};

/* =====================================================================
   4) WRITE A LINE IN THE TIMELINE
   ---------------------------------------------------------------------
   Every change to an approval goes through here, so no part of the
   engine can quietly change something without leaving a trace.
   ===================================================================== */
export const addHistory = (approval, entry) => {
  approval.history.push({
    stageOrder: entry.stageOrder ?? null,
    stageName: entry.stageName || "",
    action: entry.action,
    actor: entry.actor || null,
    comment: entry.comment || "",
    createdAt: new Date(),
  });
};

/* =====================================================================
   5) NEXT STAGE ROUTING   <- the heart of the engine
   ---------------------------------------------------------------------
   Walks forward through the stages starting at `startOrder` and stops at
   the first stage that really needs a human being.

   On the way it deals with the two cases where nobody has to look:

     a) the stage's AUTO APPROVAL rule matches the request
     b) the only approver the stage resolves to is the employee who
        raised the request - nobody may approve their own request, so
        waiting there forever would be a dead end

   When it walks past the LAST stage, the request is finally approved.

   Both documents are changed in memory only; the caller saves them.
   ===================================================================== */
export const runApprovalFrom = async (approval, request, startOrder) => {
  let order = startOrder;

  while (order <= approval.stages.length) {
    const stage = approval.stages.find((item) => item.order === order);

    // should never happen, but a missing stage must not loop forever
    if (!stage) {
      break;
    }

    stage.startedAt = new Date();

    /* ---- a) the auto approval rule decides for us ---- */
    if (matchesAutoApproval(stage, request)) {
      stage.status = "Skipped";
      stage.completedAt = new Date();

      addHistory(approval, {
        stageOrder: stage.order,
        stageName: stage.name,
        action: "AutoApproved",
        comment: `Rule matched: ${describeAutoApproval(stage)}`,
      });

      order += 1;
      continue;
    }

    /* ---- b) work out WHO has to decide, right now ---- */
    const resolved = await resolveApprovers(
      stage,
      approval.requester,
      // the choice frozen onto the approval on submit day
      approval.chosenApprover
    );

    if (resolved.length > 0) {
      /*
        The workflow still points at real people, so we use the FRESH
        list - somebody who joined the Finance team yesterday should be
        able to approve today.
      */
      stage.approvers = resolved;
    }

    /*
      Nobody may approve their own request, so the requester is taken out
      of the list. If `resolved` came back empty (the role was emptied, a
      manager left the company) we keep the list worked out on submit day
      instead, so the request never gets stuck with nobody to ask.
    */
    stage.approvers = stage.approvers.filter(
      (approverId) => String(approverId) !== String(approval.requester)
    );

    if (stage.approvers.length === 0) {
      stage.status = "Skipped";
      stage.completedAt = new Date();

      addHistory(approval, {
        stageOrder: stage.order,
        stageName: stage.name,
        action: "SkippedSelfApproval",
        comment:
          "There was nobody else to ask at this stage, so it was skipped",
      });

      order += 1;
      continue;
    }

    /* ---- a real person must answer here: stop and wait ---- */
    stage.status = "Pending";
    stage.decisions = [];

    /*
      The stage starts its waiting time NOW, so the Module 6 reminder
      engine measures from this moment. A corrected request that comes
      down the route a second time deserves a fresh clock, not the
      reminders it had collected before it was returned.
    */
    stage.lastReminderAt = null;
    stage.reminderCount = 0;
    stage.escalatedAt = null;

    approval.currentStage = stage.order;
    approval.status = "InProgress";
    request.status = "InProgress";

    return;
  }

  /* ---- we walked past the last stage: FINAL APPROVAL ---- */
  approval.currentStage = 0;
  approval.status = "Approved";
  approval.completedAt = new Date();
  request.status = "Approved";

  addHistory(approval, {
    action: "Completed",
    comment: "Every stage approved the request",
  });
};

/* =====================================================================
   6) START THE WORKFLOW   <- called the moment an employee submits
   ---------------------------------------------------------------------
   Returns { ok: true, approval } when the request is on its way, or
   { ok: false, message } with a sentence the employee can act on.

   THE VALIDATION HERE IS THE POINT OF THE WHOLE FUNCTION.
   It is far better to refuse the submit with "the Finance stage has no
   approver" than to accept it and have it sit in a queue nobody can
   ever answer.
   ===================================================================== */
export const startApprovalWorkflow = async (request) => {
  /* ---- 1) is there a live route for this kind of request? ---- */
  const workflow = await Workflow.findOne({
    requestType: request.type,
    isActive: true,
    isDeleted: false,
  });

  if (!workflow) {
    return {
      ok: false,
      message: `There is no active approval workflow for ${request.type} requests yet. Please ask an administrator to set one up.`,
    };
  }

  if (workflow.stages.length === 0) {
    return {
      ok: false,
      message: `The workflow "${workflow.name}" has no stages, so there is nobody to approve this request.`,
    };
  }

  /* ---- 2) freeze a copy of the route (see the model for why) ---- */
  const stages = workflow.stages.map((stage) => ({
    order: stage.order,
    name: stage.name,
    approverType: stage.approverType,
    approverRole: stage.approverRole || null,
    approverDepartment: stage.approverDepartment || null,
    approverUser: stage.approverUser || null,
    approvalRule: stage.approvalRule,
    autoApproval: {
      enabled: stage.autoApproval?.enabled || false,
      conditions: (stage.autoApproval?.conditions || []).map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
      })),
    },
    approvers: [],
    status: "Waiting",
    decisions: [],
    startedAt: null,
    completedAt: null,
  }));

  /* ---- 3) every stage must point at somebody real ---- */
  for (const stage of stages) {
    const resolved = await resolveApprovers(
      stage,
      request.requester,
      request.chosenApprover
    );

    /*
      A stage that resolves to NOBODY AT ALL is a broken workflow, unless
      this particular request would skip it anyway because the auto
      approval rule matches.
    */
    if (resolved.length === 0 && !matchesAutoApproval(stage, request)) {
      return {
        ok: false,
        message: `The "${stage.name}" stage of workflow "${workflow.name}" has no approver at the moment. Please ask an administrator to check it.`,
      };
    }

    // the requester is dropped here too, for the same reason as above
    stage.approvers = resolved.filter(
      (approverId) => String(approverId) !== String(request.requester)
    );
  }

  /* ---- 4) create the approval, or re-use it after a correction ---- */
  let approval = await Approval.findOne({ request: request._id });

  const isResubmission = Boolean(approval);

  if (!approval) {
    approval = new Approval({
      request: request._id,
      requester: request.requester,
    });
  } else {
    approval.submissionCount += 1;
  }

  approval.workflow = workflow._id;
  approval.workflowName = workflow.name;
  approval.status = "InProgress";
  approval.completedAt = null;
  approval.startedAt = new Date();

  /*
    Freeze the employee's chosen approver, re-read on every submit.

    A RETURNED request goes back to Draft, where the employee may edit
    it - including who they are sending it to. Reading the field again
    here rather than only on the first submit is what lets somebody
    correct a request AND redirect it to the right manager in one go,
    which is usually exactly why it came back.
  */
  approval.chosenApprover = request.chosenApprover || null;

  /*
    A corrected request starts the route again from stage 1. The content
    changed, so an earlier "yes" was given to a different document and
    cannot be reused. The TIMELINE is deliberately NOT cleared, so the
    old decisions stay visible above the new ones.
  */
  approval.stages = stages;
  approval.currentStage = 1;

  addHistory(approval, {
    action: isResubmission ? "Resubmitted" : "Submitted",
    actor: request.requester,
    comment: isResubmission
      ? `Corrected and sent through "${workflow.name}" again`
      : `Sent through the "${workflow.name}" workflow`,
  });

  /* ---- 5) walk to the first stage that needs a human ---- */
  await runApprovalFrom(approval, request, 1);

  return { ok: true, approval };
};
