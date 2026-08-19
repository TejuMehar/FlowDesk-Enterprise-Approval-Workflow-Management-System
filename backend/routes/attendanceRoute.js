/*
=========================================================================
  ROUTES: Attendance        ->  mounted at  /api/attendance
=========================================================================
  Module 11 - Attendance Management.

  READ THE PERMISSION COLUMN OF THIS FILE FROM THE TOP DOWN and the
  design of the whole module is visible in one screen:

    the four punches      isAuth only
    my own history        isAuth only
    my team's board       isAuth only
    one employee          isAuth only
    the whole company     attendance:read-all
    correcting a day      attendance:correct
    the working pattern   attendance:policy  (or manage the department)
    the files             attendance:export

  WHY SO MANY ROUTES ASK FOR NOTHING BUT A LOGIN
  ----------------------------------------------
  Because a permission is the wrong tool for the question they ask.

  THE PUNCHES are your own working day, the same way your notifications
  and your own requests are your own. The controller writes req.userId
  and nothing else, so there is no wider version of the route for an
  admin to grant. Requiring a permission would only create the
  possibility of an employee who cannot say they have arrived.

  THE TEAM BOARD is the interesting one. /team is open to every logged
  in user, and config/attendanceScope.js decides what it means for
  them: a department manager gets their department, somebody with
  attendance:read-all gets everybody, and an ordinary employee gets a
  board with exactly one row on it - their own. That is not a leak, it
  is the same page answering the same question honestly at a smaller
  size, and it is the pattern Module 8 established for search.

  /organisation IS DIFFERENT, and it is the line worth being clear
  about. It is only ever about OTHER departments - there is no honest
  one-row version of "compare the departments" - so it is the one read
  route in the module that really does need attendance:read-all.

  THE ORDER OF THE ROUTES MATTERS. Express matches from the top down,
  so every fixed word ("/me", "/team", "/policy") is written before
  anything with a :parameter in it - otherwise "me" would be read as an
  employee id.
=========================================================================
*/

import express from "express";

import {
  getMyAttendance,
  clockIn,
  startBreak,
  endBreak,
  clockOut,
  getMyHistory,
  getOptions,
  getTeamAttendance,
  getEmployeeAttendance,
  getOrganisation,
  getPolicy,
  updatePolicy,
  correctRecord,
  exportAttendance,
} from "../controllers/attendanceController.js";

import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";
/*
  MODULE 10's limiter, applied to the two expensive shapes: a board that
  expands a date range into one object per employee per day, and an
  export that can build a 5000 row spreadsheet in memory.

  It is deliberately NOT on the punches. Clocking in is four requests a
  day per person, it is the one action in the module somebody may be
  standing at a door waiting for, and a rate limited "Start work" is a
  support call.
*/
import { heavyLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/* =====================================================================
   MY OWN DAY
   ---------------------------------------------------------------------
   No permission on any of these five - see the note at the top.
   ===================================================================== */

router.get("/me", isAuth, getMyAttendance);
router.get("/me/history", isAuth, getMyHistory);

router.post("/clock-in", isAuth, clockIn);
router.post("/break/start", isAuth, startBreak);
router.post("/break/end", isAuth, endBreak);
router.post("/clock-out", isAuth, clockOut);

/* =====================================================================
   WHAT CAN I ASK FOR?
   ---------------------------------------------------------------------
   The dropdowns, the scope label and the "may I draw this button"
   answers. No permission, and no limiter: it is a tiny list the page
   asks for on every visit, exactly like /api/report/options.
   ===================================================================== */
router.get("/options", isAuth, getOptions);

/* =====================================================================
   THE WORKING PATTERN
   ---------------------------------------------------------------------
   READING one needs nothing at all, and that is a deliberate stance:
   an employee has an absolute right to know what shift they are being
   judged against and how much break time they are allowed. A system
   that measures somebody by a rule it will not show them is not a
   system anybody should trust.

   CHANGING one is checked INSIDE the controller rather than here,
   because it is not a single permission. A department manager may
   change their own department's pattern with no permission at all (the
   department pointing at them is what unlocks it); only
   attendance:policy unlocks the company-wide default. A
   checkPermission() on this line would take the first of those away.
   ===================================================================== */
router.get("/policy", isAuth, getPolicy);
router.put("/policy", isAuth, updatePolicy);

/* =====================================================================
   OTHER PEOPLE
   ===================================================================== */

// scoped, not gated - a board of one row for an ordinary employee
router.get("/team", isAuth, heavyLimiter, getTeamAttendance);

/*
  The company, department by department. The one read route that really
  is only ever about other people's departments.
*/
router.get(
  "/organisation",
  isAuth,
  checkPermission(PERMISSIONS.ATTENDANCE_READ_ALL),
  heavyLimiter,
  getOrganisation
);

/* =====================================================================
   THE FILES
   ---------------------------------------------------------------------
   Written ABOVE /employee/:userId only so the two permissions are easy
   to compare; the paths could never be confused.

   attendance:export is its own permission, exactly like report:export
   and audit:export. Reading a board on screen and walking out of the
   building with a spreadsheet of when every employee arrived and how
   long they were away from their desk are different levels of trust.
   ===================================================================== */
router.get(
  "/export/:reportType",
  isAuth,
  checkPermission(PERMISSIONS.ATTENDANCE_EXPORT),
  heavyLimiter,
  exportAttendance
);

/*
  ONE EMPLOYEE, IN FULL.

  No permission, because the check is not a permission: it is "is this
  person inside the slice of the company you may see", which needs the
  scope, the target and the database. The controller answers 404 for
  anybody outside it - see the note above getEmployeeAttendance().
*/
router.get("/employee/:userId", isAuth, getEmployeeAttendance);

/* =====================================================================
   CORRECTING A DAY
   ---------------------------------------------------------------------
   The only route in the module that writes to somebody else's record,
   and the only one that needs a permission to write at all.

   PATCH rather than PUT: a correction changes the two punch times and
   leaves the rest of the record alone. Everything derived is rebuilt
   from the corrected punches by the service, so there is nothing for a
   full replacement to replace.
   ===================================================================== */
router.patch(
  "/record/:recordId",
  isAuth,
  checkPermission(PERMISSIONS.ATTENDANCE_CORRECT),
  correctRecord
);

export default router;
