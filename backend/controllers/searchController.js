/*
=========================================================================
  CONTROLLER: Search                              ( the "C" of MVC )
=========================================================================
  Module 8 - Reports & Search (the SEARCH half).

  FUNCTIONS IN THIS FILE
    getSearchFilters  GET  /api/search/filters
    searchRequests    GET  /api/search/requests

  WHY SEARCH IS ITS OWN CONTROLLER AND NOT PART OF requestController
  ------------------------------------------------------------------
  /api/request/all answers "MY requests" - it is the Requests page, and
  it is filtered by requester on purpose so an employee can never see
  anybody else's paperwork through it.

  This is the opposite question: "find that request, wherever it is".
  It reaches across the whole company for the people allowed to look
  that far, and it is the only place in FlowDesk where an approver can
  find a request that was never theirs. Bolting a second, wider mode
  onto the Requests endpoint would have meant one route with two
  completely different security rules inside it, and that is exactly
  how a leak gets written.

  WHY IT NEEDS NO PERMISSION
  --------------------------
  Because it does not decide who may see what - config/reportScope.js
  does, the same file the six reports use, and it never returns more
  than the caller already has a right to:

      analytics:read         -> the whole company
      manages a department   -> that department, and themselves
      everybody else         -> their own requests

  So the search box is safe to give to every logged in user: for an
  ordinary employee it is a fast way through their own thirty requests,
  which is a feature they should not have to be granted.

  THE ONE EXTRA RULE: DRAFTS
  --------------------------
  A draft has never been sent to anybody. It stays private to the person
  writing it even at organisation scope - see the note further down.
=========================================================================
*/

import Request from "../model/requestModel.js";
import Approval from "../model/approvalModel.js";
import User from "../model/userModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  REQUEST_PRIORITIES,
} from "../config/requestConstants.js";
/*
  MODULE 9 - the types come from the database now. Search asks the
  LOOSE question everywhere: hiding a retired type from the filters
  would make three years of paperwork unfindable, which is the
  opposite of what a search page is for.
*/
import {
  getRequestTypeNames,
  isKnownRequestType,
} from "../config/requestTypeService.js";
import {
  SEARCH_STATUS_FILTERS,
  SEARCH_SORTS,
  SEARCH_SORT_LABELS,
  MAX_SEARCH_PEOPLE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../config/reportConstants.js";
import {
  resolveReportScope,
  resolveDepartmentMembers,
  intersectMembers,
  getSelectableDepartments,
} from "../config/reportScope.js";

/* =====================================================================
   HELPER 1 - make the search box safe to put inside a regular expression
   ---------------------------------------------------------------------
   Everything typed goes into a $regex, and characters like ( [ * + ?
   mean something there. Without escaping them a search for "REQ-0007
   (old)" is not merely wrong - it is an invalid expression, and MongoDB
   answers with an error instead of a result.

   The same guard auditController.js puts in front of its search box.
   ===================================================================== */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const regexFor = (text) => ({ $regex: escapeRegex(text), $options: "i" });

/* =====================================================================
   HELPER 2 - a name, however it was typed
   ---------------------------------------------------------------------
   "ravi", "sharma" and "ravi sharma" all have to find Ravi Sharma, and
   the name is stored in two separate fields - so a single regex over
   firstName can never match the full name a person actually types.

   Splitting the words and letting ANY of them match EITHER field is the
   cheap, index-friendly answer. It is deliberately generous: a search
   is a way of narrowing a list a human then reads, so an extra row
   costs nothing and a missing one costs the whole feature.
   ===================================================================== */
const buildPersonConditions = (text) => {
  const words = text.trim().split(/\s+/).slice(0, 4);

  const conditions = words.flatMap((word) => [
    { firstName: regexFor(word) },
    { lastName: regexFor(word) },
  ]);

  // the id and the email are only ever typed whole
  conditions.push({ employeeId: regexFor(text.trim()) });
  conditions.push({ email: regexFor(text.trim()) });

  return conditions;
};

/* =====================================================================
   HELPER 3 - the date range, only if one was asked for
   ---------------------------------------------------------------------
   Reports default to the last twelve months. A SEARCH must not: the
   request somebody is hunting for is very often the old one, and a
   hidden default range would answer "no results" for a request that is
   sitting right there.

   `to` is pushed to the end of its day, for the same reason it is in
   the audit log: 14 Aug to 14 Aug means that whole day.
   ===================================================================== */
const buildDateRange = (from, to) => {
  const range = {};

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate && !isNaN(fromDate.getTime())) {
    fromDate.setHours(0, 0, 0, 0);
    range.$gte = fromDate;
  }

  if (toDate && !isNaN(toDate.getTime())) {
    toDate.setHours(23, 59, 59, 999);
    range.$lte = toDate;
  }

  return Object.keys(range).length > 0 ? range : null;
};

/* =====================================================================
   1) WHAT CAN I SEARCH BY?
   ---------------------------------------------------------------------
   GET /api/search/filters

   Every dropdown on the Search page in one call: the departments, the
   employees, the approvers, and the fixed lists.

   THE EMPLOYEE AND APPROVER LISTS ARE NOT THE SAME LIST, on purpose.

   "Employee" is who RAISED a request, and it is drawn from the people
   in scope. "Approver" is who a request is or was WAITING ON, and that
   is drawn from the approvals themselves - because a workflow stage can
   name any employee at all (see config/permissions.js), so there is no
   role or department you could infer the list from. Somebody who has
   never been asked to approve anything would only ever filter to zero
   rows, and does not belong in the menu.
   ===================================================================== */
export const getSearchFilters = async (req, res) => {
  try {
    const scope = await resolveReportScope(req);

    /* ---------------- the people who raise requests ---------------- */
    const peopleFilter = { isDeleted: false };

    if (scope.memberIds) {
      peopleFilter._id = { $in: scope.memberIds };
    }

    const [departments, employees, approverIds] = await Promise.all([
      getSelectableDepartments(scope),

      User.find(peopleFilter)
        .select("firstName lastName employeeId")
        .sort({ firstName: 1, lastName: 1 })
        .limit(MAX_SEARCH_PEOPLE)
        .lean(),

      /*
        Everybody who appears as an approver on an approval this caller
        can see. distinct() hands back bare ids, which is all we need to
        look the names up in one go below.
      */
      Approval.distinct(
        "stages.approvers",
        scope.memberIds ? { requester: { $in: scope.memberIds } } : {}
      ),
    ]);

    const approvers = await User.find({ _id: { $in: approverIds } })
      .select("firstName lastName employeeId")
      .sort({ firstName: 1, lastName: 1 })
      .limit(MAX_SEARCH_PEOPLE)
      .lean();

    return res.status(200).json({
      message: "Search filters fetched successfully",
      scope: { level: scope.level, label: scope.label },
      departments,
      employees,
      approvers,
      requestTypes: await getRequestTypeNames(),
      priorities: REQUEST_PRIORITIES,
      statuses: Object.keys(SEARCH_STATUS_FILTERS),
      sorts: Object.keys(SEARCH_SORTS).map((key) => ({
        key,
        label: SEARCH_SORT_LABELS[key],
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get Search Filters Error ${error}` });
  }
};

/* =====================================================================
   2) THE SEARCH ITSELF
   ---------------------------------------------------------------------
   GET /api/search/requests
        ?q=&employee=&department=&type=&approver=
        &status=&priority=&from=&to=&sort=&page=&limit=

   q searches the REQUEST ID, the title, the category, the description
   and the name of the person who raised it - the five things somebody
   has in their head when they go looking for a request.

   HOW THE CONDITIONS ARE COMBINED
   -------------------------------
   Several filters each need their own "one of these" test (the free
   text, the draft rule), and a mongoose query object can only hold ONE
   top level $or. So every such block is pushed into an $and array
   instead. Read the query out loud and it is:

       inside my scope
       AND matching the dropdowns
       AND (the text matched somewhere)
       AND (it is not somebody else's draft)
   ===================================================================== */
export const searchRequests = async (req, res) => {
  try {
    const {
      q = "",
      employee = "",
      department = "",
      type = "",
      approver = "",
      status = "",
      priority = "",
      from = "",
      to = "",
      sort = "newest",
    } = req.query;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    const scope = await resolveReportScope(req);

    /* ================================================================
       WHO THE REQUESTS MAY BELONG TO
       ----------------------------------------------------------------
       Three narrowings, applied in order, each one only ever able to
       make the list SMALLER:

         the caller's scope   -> what they are allowed to see at all
         the department       -> what they asked for
         the employee         -> what they asked for

       intersectMembers() is what makes that true, and it is why
       ?employee=<somebody outside my team> answers with an empty
       result rather than with that person's requests.
       ================================================================ */
    let memberIds = scope.memberIds;

    if (department && isValidObjectId(department)) {
      memberIds = intersectMembers(
        memberIds,
        await resolveDepartmentMembers(department)
      );
    }

    if (employee && isValidObjectId(employee)) {
      memberIds = intersectMembers(memberIds, [employee]);
    }

    const filter = { isDeleted: false };
    const and = [];

    if (memberIds) {
      filter.requester = { $in: memberIds };
    }

    /* ---------------- the plain dropdowns ---------------- */
    if (await isKnownRequestType(type)) {
      filter.type = type;
    }

    if (REQUEST_PRIORITIES.includes(priority)) {
      filter.priority = priority;
    }

    if (SEARCH_STATUS_FILTERS[status]) {
      filter.status = { $in: SEARCH_STATUS_FILTERS[status] };
    }

    const createdRange = buildDateRange(from, to);

    if (createdRange) {
      filter.createdAt = createdRange;
    }

    /* ================================================================
       THE APPROVER FILTER
       ----------------------------------------------------------------
       "Which requests have ever been in front of this person?"

       That fact lives on the Approval, not on the Request, so it is
       resolved into a list of request ids first. Both halves are asked
       for:

         stages.approvers  it is waiting on them right now, or was
         history.actor     they already answered it

       Without the second half, searching for an approver would lose
       every request they have already dealt with - which is usually
       the one being looked for.
       ================================================================ */
    if (approver && isValidObjectId(approver)) {
      const requestIds = await Approval.distinct("request", {
        $or: [{ "stages.approvers": approver }, { "history.actor": approver }],
      });

      filter._id = { $in: requestIds };
    }

    /* ---------------- the free text ---------------- */
    if (q.trim()) {
      const text = q.trim();

      /*
        The name is looked up in the users collection FIRST and turned
        into ids, so the request query stays a plain indexed find().
        Searching a joined field would have meant an aggregation with a
        $lookup on every request in the company.
      */
      const people = await User.find({ $or: buildPersonConditions(text) })
        .select("_id")
        .limit(MAX_SEARCH_PEOPLE)
        .lean();

      const textConditions = [
        { requestId: regexFor(text) },
        { title: regexFor(text) },
        { category: regexFor(text) },
        { description: regexFor(text) },
      ];

      if (people.length > 0) {
        textConditions.push({ requester: { $in: people.map((one) => one._id) } });
      }

      and.push({ $or: textConditions });
    }

    /* ================================================================
       DRAFTS STAY PRIVATE
       ----------------------------------------------------------------
       A draft has never been submitted to anybody - it is a half
       written note, and the Requests page already shows it only to its
       owner. Search must not be the back door that undoes that, even
       for an admin with analytics:read: seeing every FINISHED piece of
       paperwork in the company is a different thing from reading over
       somebody's shoulder while they write it.

       At "own" scope the rule is skipped, because then every row is
       already the caller's own.
       ================================================================ */
    if (scope.level !== "own") {
      and.push({
        $or: [{ status: { $ne: "Draft" } }, { requester: req.userId }],
      });
    }

    if (and.length > 0) {
      filter.$and = and;
    }

    /* ---------------- fetch the page ---------------- */
    const sortSpec = SEARCH_SORTS[sort] || SEARCH_SORTS.newest;

    const [requests, totalRequests] = await Promise.all([
      Request.find(filter)
        .select(
          "requestId title type category status priority amount startDate endDate createdAt submittedAt attachments"
        )
        .populate({
          path: "requester",
          select: "firstName lastName employeeId photoUrl designation",
          populate: { path: "department", select: "name code" },
        })
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Request.countDocuments(filter),
    ]);

    /* ================================================================
       WHO IS IT WAITING ON?
       ----------------------------------------------------------------
       The single most useful thing to show next to a search result, and
       the answer is on the Approval rather than the Request.

       It is fetched for the PAGE, not for the whole result set - two
       extra queries for twenty five rows, however many thousand rows
       the search matched. Adding it to the aggregation instead would
       have made every filter above pay for it.
       ================================================================ */
    const requestIds = requests.map((request) => request._id);

    const approvals = await Approval.find({ request: { $in: requestIds } })
      .select("request status currentStage stages")
      .lean();

    // every approver still standing in the way, across the whole page
    const waitingApproverIds = new Set();

    const approvalByRequest = new Map();

    approvals.forEach((approval) => {
      const stage = (approval.stages || []).find(
        (one) => one.order === approval.currentStage
      );

      if (stage && stage.status === "Pending") {
        (stage.approvers || []).forEach((id) =>
          waitingApproverIds.add(String(id))
        );
      }

      approvalByRequest.set(String(approval.request), {
        approvalStatus: approval.status,
        stageName: stage?.name || "",
        stageOrder: approval.currentStage,
        totalStages: (approval.stages || []).length,
        approverIds: stage && stage.status === "Pending" ? stage.approvers : [],
      });
    });

    // one query for every name on the page, rather than one per row
    const approverDocs = await User.find({
      _id: { $in: [...waitingApproverIds] },
    })
      .select("firstName lastName photoUrl")
      .lean();

    const approverById = new Map(
      approverDocs.map((one) => [String(one._id), one])
    );

    const results = requests.map((request) => {
      const approval = approvalByRequest.get(String(request._id));

      return {
        ...request,
        attachmentCount: (request.attachments || []).length,
        attachments: undefined,
        approval: approval
          ? {
              status: approval.approvalStatus,
              stageName: approval.stageName,
              stageOrder: approval.stageOrder,
              totalStages: approval.totalStages,
              waitingOn: (approval.approverIds || [])
                .map((id) => approverById.get(String(id)))
                .filter(Boolean)
                .map((one) => ({
                  _id: one._id,
                  name: `${one.firstName} ${one.lastName}`.trim(),
                  photoUrl: one.photoUrl || "",
                })),
            }
          : null,
      };
    });

    return res.status(200).json({
      message: "Search completed successfully",
      scope: { level: scope.level, label: scope.label },
      results,
      pagination: {
        page,
        limit,
        totalRequests,
        totalPages: Math.max(Math.ceil(totalRequests / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Search Requests Error ${error}` });
  }
};
