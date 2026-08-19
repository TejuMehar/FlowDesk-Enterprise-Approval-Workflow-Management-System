/*
=========================================================================
  WORKFLOW CONSTANTS   (Module 3 - Workflow Builder)
=========================================================================
  A frontend copy of backend/config/workflowConstants.js.
  Used to fill the dropdowns in the Workflow Builder and to show a
  readable sentence for each rule.
=========================================================================
*/

export const APPROVER_TYPES = [
  "RequesterManager",
  "Role",
  "Department",
  "User",
];

export const APPROVER_TYPE_LABELS = {
  RequesterManager: "Requester's Manager",
  Role: "Anyone with a Role",
  Department: "A Department's Manager",
  User: "A Specific Person",
};

export const APPROVAL_RULES = ["AnyOne", "Everyone", "Majority"];

export const APPROVAL_RULE_LABELS = {
  AnyOne: "Any one approver",
  Everyone: "Everyone must approve",
  Majority: "Majority must approve",
};

export const ESCALATION_ACTIONS = ["Notify", "AutoApprove", "Reassign"];

export const ESCALATION_ACTION_LABELS = {
  Notify: "Notify someone else",
  AutoApprove: "Approve automatically",
  Reassign: "Reassign to someone else",
};

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

export const NUMERIC_AUTO_APPROVAL_FIELDS = ["amount"];

/*
  A brand new stage, used when the admin presses "Add Stage".
  Every field the backend expects is already here, so the builder never
  has to worry about a missing key.
*/
export const EMPTY_STAGE = {
  name: "",
  approverType: "RequesterManager",
  approverRole: "",
  approverDepartment: "",
  approverUser: "",
  approvalRule: "AnyOne",
  escalation: {
    enabled: false,
    afterHours: 24,
    escalateTo: "RequesterManager",
    escalateToRole: "",
    escalateToDepartment: "",
    escalateToUser: "",
    action: "Notify",
  },
  autoApproval: {
    enabled: false,
    conditions: [],
  },
};

/*
  Turns a saved stage into the short line shown on the workflow card and
  on a collapsed stage, e.g. "Anyone with a Role: Director".

  A stage comes back from the backend with its approver POPULATED, so
  approverRole is the whole { _id, name } object and not just an id.
*/
export const describeApprover = (stage) => {
  if (!stage) {
    return "";
  }

  if (stage.approverType === "Role") {
    return stage.approverRole?.name || "Role";
  }

  if (stage.approverType === "Department") {
    return stage.approverDepartment?.name || "Department";
  }

  if (stage.approverType === "User") {
    const user = stage.approverUser;
    return user ? `${user.firstName} ${user.lastName}` : "Person";
  }

  return "Requester's Manager";
};
