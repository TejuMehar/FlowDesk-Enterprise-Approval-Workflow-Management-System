/*
=========================================================================
  ROUTES: Search            ->  mounted at  /api/search
=========================================================================
  Module 8 - Reports & Search (the search half).

  TWO GET ROUTES, AND NEITHER ASKS FOR A PERMISSION.

  That is not an oversight, it is the same decision notifications and
  the request activity timeline already made in Modules 6 and 7: some
  things do not need to be GRANTED, because the controller can only
  ever show you what you already had a right to.

  Search is one of them. config/reportScope.js decides how far each
  caller can see - and it is the SAME file the six reports use, so the
  two halves of Module 8 can never disagree about who may see what:

      analytics:read        -> every request in the company
      manages a department  -> that department, and their own
      neither               -> only the requests they raised themselves

  For an ordinary employee this route is a fast way through their own
  thirty requests. Nobody should have to be given permission for that,
  and adding one would mean an admin could accidentally take away an
  employee's ability to find their own paperwork.

  Drafts stay private even at organisation scope - see the note in
  searchRequests().
=========================================================================
*/

import express from "express";
import {
  getSearchFilters,
  searchRequests,
} from "../controllers/searchController.js";
import isAuth from "../middleware/isAuth.js";

const router = express.Router();

/* ---------------- what can I search by? ---------------- */
router.get("/filters", isAuth, getSearchFilters);

/* ---------------- the search itself ---------------- */
router.get("/requests", isAuth, searchRequests);

export default router;
