/*
=========================================================================
  REQUEST CONSTANTS   (Module 2 - Request Management)
=========================================================================
  Small fixed lists used by the Request model, the controller and (as a
  matching copy) the React frontend.

  Keeping them in ONE file means the model's `enum` check, the
  controller's validation and the dropdown menus in the UI can never
  drift apart.

  WHERE THE REQUEST TYPES WENT   (Module 9)
  -----------------------------------------
  REQUEST_TYPES, REQUEST_CATEGORY_SUGGESTIONS, REQUEST_TYPES_WITH_AMOUNT
  and REQUEST_TYPES_WITH_DATES used to be four arrays in this file, and
  every one of them had to be kept in step with the other three by
  hand: adding "Overtime" meant editing all four, in two languages, and
  redeploying.

  They are now ONE COLLECTION - see model/requestTypeModel.js. Each row
  carries its own name, its own category suggestions and its own
  needsAmount / needsDates flags, so a type is described in one place
  and an administrator owns it instead of a developer.

  Ask config/requestTypeService.js for the list. Nothing imports it
  from here any more.

  WHAT STAYED
  -----------
  Priorities and statuses are still here, and the difference is the
  point: they are not preferences. "Approved" is a word the approval
  engine BRANCHES ON - config/approvalEngine.js, the reminder engine
  and half of Module 8 all contain logic that only makes sense for
  these exact values. A setting an administrator can change has to be
  one the code does not depend on the value of.
=========================================================================
*/

// how urgent the request is
export const REQUEST_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

/*
  The life of a request, from the first draft to the final decision:

    Draft      -> only the owner can see/edit/delete it, nobody else yet
    Submitted  -> sent, but no workflow was running (older requests only,
                  see the note below)
    InProgress -> travelling down the approval workflow right now
    Returned   -> an approver sent it back for correction. The owner can
                  edit it again and submit it a second time.
    Approved   -> it passed every stage. Final.
    Rejected   -> an approver said no. Final.
    Cancelled  -> the employee changed their mind before it was handled

  ABOUT "Submitted"
  -----------------
  Before Module 4 a submitted request simply sat at "Submitted" because
  there was nothing to approve it. Since Module 4 submitting STARTS the
  workflow, so a request goes straight from Draft to InProgress. The old
  value stays in this list so requests created before Module 4 still
  load without a validation error.
*/
export const REQUEST_STATUSES = [
  "Draft",
  "Submitted",
  "InProgress",
  "Returned",
  "Approved",
  "Rejected",
  "Cancelled",
];

/*
  The statuses that mean "this request is finished, nothing more will
  happen to it". Used to block actions like cancelling or re-submitting.
*/
export const FINAL_REQUEST_STATUSES = ["Approved", "Rejected", "Cancelled"];

/*
  The statuses in which the OWNER is allowed to edit and submit their
  request: a brand new draft, or one an approver handed back.
*/
export const EDITABLE_REQUEST_STATUSES = ["Draft", "Returned"];

/*
  The category suggestions, the "needs an amount" list and the "needs
  dates" list all moved into model/requestTypeModel.js in Module 9 -
  see the note at the top of this file. Each request type now carries
  its own, which is what lets an administrator add a type that behaves
  differently from the eight the project shipped with.
*/
