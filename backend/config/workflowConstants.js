/*
=========================================================================
  WORKFLOW CONSTANTS   (Module 3 - Workflow Builder)
=========================================================================
  Small fixed lists used by the Workflow model, the controller and (as a
  matching copy) the React frontend.

  Same idea as requestConstants.js: keeping them in ONE file means the
  model's `enum` check, the controller's validation and the dropdown
  menus in the UI can never drift apart.

  WHAT IS A WORKFLOW?
  -------------------
  A workflow is the ROUTE a request travels before it is finished:

      Employee  ->  Manager  ->  Finance  ->  Director  ->  Completed

  The "Employee" at the start and "Completed" at the end are always
  there, so we only store the middle part - the STAGES.
=========================================================================
*/

/*
  WHO approves a stage.

  RequesterManager -> whoever manages the department of the person that
                      raised the request. Works for any employee, so we
                      never have to name a person.
  Role             -> anybody holding this role, e.g. "Director"
  Department       -> the manager of this department, e.g. "Finance"
  User             -> one exact named employee
*/
export const APPROVER_TYPES = [
  "RequesterManager",
  "Role",
  "Department",
  "User",
];

// friendly text for the dropdown in the builder
export const APPROVER_TYPE_LABELS = {
  RequesterManager: "Requester's Manager",
  Role: "Anyone with a Role",
  Department: "A Department's Manager",
  User: "A Specific Person",
};

/*
  APPROVAL RULES - only matters when a stage can have MORE than one
  approver (for example "anyone with the Director role").

  AnyOne   -> the first approver to answer decides
  Everyone -> every approver must approve
  Majority -> more than half must approve
*/
export const APPROVAL_RULES = ["AnyOne", "Everyone", "Majority"];

export const APPROVAL_RULE_LABELS = {
  AnyOne: "Any one approver",
  Everyone: "Everyone must approve",
  Majority: "Majority must approve",
};

/*
  ESCALATION - what to do when a stage has been waiting too long.

  Notify     -> just send a reminder to somebody else
  AutoApprove-> approve the stage automatically and move on
  Reassign   -> hand the stage over to somebody else
*/
export const ESCALATION_ACTIONS = ["Notify", "AutoApprove", "Reassign"];

export const ESCALATION_ACTION_LABELS = {
  Notify: "Notify someone else",
  AutoApprove: "Approve automatically",
  Reassign: "Reassign to someone else",
};

/*
  AUTO APPROVAL - skip a stage completely when the request is small
  enough to not need a human, e.g. "amount <= 5000".

  The fields below are fields that already exist on a Request
  (see model/requestModel.js), so a future module can read them directly.
*/
export const AUTO_APPROVAL_FIELDS = ["amount", "priority", "category"];

export const AUTO_APPROVAL_FIELD_LABELS = {
  amount: "Amount",
  priority: "Priority",
  category: "Category",
};

export const AUTO_APPROVAL_OPERATORS = ["<", "<=", ">", ">=", "==", "!="];

export const AUTO_APPROVAL_OPERATOR_LABELS = {
  "<": "is less than",
  "<=": "is less than or equal to",
  ">": "is greater than",
  ">=": "is greater than or equal to",
  "==": "is equal to",
  "!=": "is not equal to",
};

/*
  "amount" is a number, so its value must be numeric and only the
  maths operators make sense for it. The other two fields are text.
*/
export const NUMERIC_AUTO_APPROVAL_FIELDS = ["amount"];
