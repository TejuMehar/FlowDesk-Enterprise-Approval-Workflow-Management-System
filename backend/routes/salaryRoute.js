/*
=========================================================================
  ROUTES: Salary            ->  mounted at  /api/salary
=========================================================================
  Module 12 - Payroll & Salary.

  READ THE PERMISSION COLUMN FROM THE TOP DOWN and the whole module is
  visible in one screen:

    my own salary            isAuth only
    my payslip history       isAuth only
    one payslip              isAuth only  (scoped in the controller)
    the PDF receipt          isAuth only  (scoped in the controller)
    the payroll screen       salary:read-all
    the salary structures    salary:read-all
    setting somebody's pay   salary:structure
    running / publishing     salary:process
    the files                salary:export

  THE FOUR OPEN ROUTES ARE THE MODULE, FOR ALMOST EVERYBODY
  ---------------------------------------------------------
  Three hundred employees will only ever call the first four, and not
  one of them needs a permission. Your own pay is your own paperwork -
  the fifth time FlowDesk has made that call, after notifications,
  search, the request activity timeline and clocking in - and the two
  that could name somebody else (a payslip, a receipt) resolve the
  SCOPE inside the controller instead, because the question is "is this
  yours, or may you see everybody's?", which a permission cannot ask.

  WHY THE ANSWER TO A PAYSLIP OUTSIDE YOUR SCOPE IS 404 AND NOT 403
  -----------------------------------------------------------------
  403 confirms that a payslip with that id exists, which is already
  more than somebody typing ids into the URL bar should learn about
  another employee's pay. The controller says "not found", because from
  where the caller is standing, it is not.

  WHY THERE IS NO TEAM ROUTE
  --------------------------
  Module 11 has /attendance/team, open to everybody and shrunk to one
  row for an ordinary employee, because a department manager should see
  their team's attendance. There is deliberately no equivalent here: a
  manager has no claim on what their team EARNS. See the long note at
  the top of config/salaryScope.js - it is the one place FlowDesk's
  usual "the data unlocks it" rule is switched off on purpose.

  THE ORDER OF THE ROUTES MATTERS. Express matches from the top down, so
  every fixed word ("/me", "/options", "/payroll") is written before
  anything with a :parameter in it.
=========================================================================
*/

import express from "express";

import {
  getMySalary,
  getMyPayslips,
  getPayslip,
  downloadPayslip,
  getOptions,
  getPayrollMonth,
  getStructures,
  getStructure,
  saveStructure,
  generateMonth,
  publishMonth,
  adjustPayslip,
  payPayslip,
  cancelPayslip,
  exportSalary,
} from "../controllers/salaryController.js";

import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
/*
  Module 10's limiter, on the three expensive shapes: a payroll run
  that writes one document per employee, an export that can build a
  5000 row spreadsheet in memory, and the payroll screen that joins
  every employee against every payslip of a month.

  It is deliberately NOT on the employee's own four routes. Somebody
  checking their own payslip on payday is the busiest minute this
  module will ever have, and a rate limited "download my payslip" is a
  support call from three hundred people at once.
*/
import { heavyLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* =====================================================================
   MY OWN PAY
   ---------------------------------------------------------------------
   No permission on any of these four - see the note at the top.
   ===================================================================== */

router.get("/me", isAuth, getMySalary);
router.get("/me/payslips", isAuth, getMyPayslips);

/* =====================================================================
   WHAT CAN I ASK FOR?
   ---------------------------------------------------------------------
   The dropdowns and the "may I draw this button" answers. No
   permission and no limiter: it is a tiny list the page asks for on
   every visit, exactly like /api/report/options.
   ===================================================================== */
router.get("/options", isAuth, getOptions);

/* =====================================================================
   THE PAYROLL SCREEN
   ---------------------------------------------------------------------
   The one read route that is only ever about OTHER people, so it is
   the one that really does need salary:read-all - the same line
   /attendance/organisation draws in Module 11.
   ===================================================================== */
router.get(
  "/payroll",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_READ_ALL),
  heavyLimiter,
  getPayrollMonth
);

/* =====================================================================
   THE FILES
   ---------------------------------------------------------------------
   salary:export is its own permission, exactly like report:export,
   audit:export and attendance:export. Reading the payroll on screen and
   walking out of the building with a spreadsheet of what every
   employee earns are different levels of trust.
   ===================================================================== */
router.get(
  "/export/:reportType",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_EXPORT),
  heavyLimiter,
  exportSalary
);

/* =====================================================================
   RUNNING PAYROLL
   ---------------------------------------------------------------------
   Two verbs, deliberately separate: GENERATE builds the drafts that
   only finance can see, PUBLISH is what tells three hundred people.
   One button that did both would remove the only chance anybody has to
   check the numbers before they are somebody's payslip.
   ===================================================================== */
router.post(
  "/payroll/:monthKey/generate",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_PROCESS),
  heavyLimiter,
  generateMonth
);

router.post(
  "/payroll/:monthKey/publish",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_PROCESS),
  publishMonth
);

/* =====================================================================
   WHAT PEOPLE EARN
   ---------------------------------------------------------------------
   READING a structure is scoped rather than gated on the second route,
   so an employee asking for their own is answered - it is the same
   document their own Salary page already shows them.

   WRITING one needs salary:structure, which is NOT part of
   salary:process on purpose: deciding what somebody is paid and
   pressing the button that pays them are different jobs, and in any
   company of size they are different people.
   ===================================================================== */
router.get(
  "/structure",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_READ_ALL),
  getStructures
);

router.get("/structure/:userId", isAuth, getStructure);

router.put(
  "/structure/:userId",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_STRUCTURE),
  saveStructure
);

/* =====================================================================
   ONE PAYSLIP
   ---------------------------------------------------------------------
   The two reads are scoped in the controller (see the top of the file);
   the three writes are payroll actions and need salary:process.

   PATCH for the adjustment, because it changes three fields and leaves
   the rest of the document alone - everything derived is rebuilt from
   them by the service. The other two are POSTs because they are events
   ("this was paid", "this was cancelled") rather than edits.
   ===================================================================== */
router.get("/payslip/:id", isAuth, getPayslip);
router.get("/payslip/:id/receipt", isAuth, downloadPayslip);

router.patch(
  "/payslip/:id",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_PROCESS),
  adjustPayslip
);

router.post(
  "/payslip/:id/pay",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_PROCESS),
  payPayslip
);

router.post(
  "/payslip/:id/cancel",
  isAuth,
  checkPermission(PERMISSIONS.SALARY_PROCESS),
  cancelPayslip
);

export default router;
