/*
=========================================================================
  ROUTES: Dashboard          ->  mounted at  /api/dashboard
=========================================================================
  Module 5 - Dashboard & Analytics.

  Notice how few permissions there are here compared with the other
  route files. That is on purpose:

    /employee  every logged in user may look at their OWN requests, so
               isAuth is the only gate. The controller filters by
               "requester: me", which is a much stronger guarantee than
               a permission would be.

    /manager   guarded by the DATA, not by a permission: the controller
               first asks "which departments point at this user as their
               manager?" and answers with an empty dashboard when the
               answer is none.

    /admin     the only one that really shows other people's numbers, so
               it is the only one that needs "analytics:read".

    /charts    both, depending on ?scope= . The permission for the
               company wide scope is checked inside the controller,
               because middleware cannot see the query string cleanly.
=========================================================================
*/

import express from "express";
import {
  getEmployeeDashboard,
  getManagerDashboard,
  getApproverDashboard,
  getAdminDashboard,
  getDashboardCharts,
} from "../controllers/dashboardController.js";
import isAuth from "../middleware/isAuth.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.get("/employee", isAuth, getEmployeeDashboard);

router.get("/manager", isAuth, getManagerDashboard);

/*
  /approver  needs no permission for the same reason /employee does not:
             it only ever reports the caller's OWN decisions. A Finance
             Manager approves requests from departments they do not
             manage, so /manager could never show them their own work.
*/
router.get("/approver", isAuth, getApproverDashboard);

router.get(
  "/admin",
  isAuth,
  checkPermission(PERMISSIONS.ANALYTICS_READ),
  getAdminDashboard
);

router.get("/charts", isAuth, getDashboardCharts);

export default router;
