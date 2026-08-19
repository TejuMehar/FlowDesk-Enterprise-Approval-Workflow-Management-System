/*
=========================================================================
  CONTROLLER: Request                             ( the "C" of MVC )
=========================================================================
  Module 2 - Request Management.

  FUNCTIONS IN THIS FILE
    createRequest        POST    /api/request/create
    getAllRequests       GET     /api/request/all
    getRequestById       GET     /api/request/:id
    updateDraftRequest   PUT     /api/request/:id
    deleteDraftRequest   DELETE  /api/request/:id
    submitRequest        PATCH   /api/request/:id/submit
    uploadAttachments    POST    /api/request/:id/attachments

  READING an attachment back, and removing one, live in
  controllers/fileController.js (Module 10) - a file is served by a
  route that checks who is asking, not by express.static.

  IMPORTANT RULE used everywhere in this file:
  an employee may only see / edit / delete / submit their OWN requests.
  We enforce that by always filtering with "requester: req.userId", so
  even a logged in user who guesses another request's id gets a 404
  instead of somebody else's data.
=========================================================================
*/

import Request from "../model/requestModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import { isValidObjectId } from "../config/validation.js";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  EDITABLE_REQUEST_STATUSES,
} from "../config/requestConstants.js";
/*
  MODULE 9. The request types used to be a constant in the file above.
  They are a collection now, so the list is ASKED FOR rather than
  imported - see config/requestTypeService.js.

  Two different questions, and this file uses both:
    isSelectableRequestType  may somebody choose this for a NEW request?
                             (must exist AND be active)
    isKnownRequestType       does this type mean anything at all?
                             (used by the FILTER below, so switching a
                             type off never hides the requests that
                             already carry it)
*/
import {
  isSelectableRequestType,
  isKnownRequestType,
  describeSelectableTypes,
} from "../config/requestTypeService.js";
/*
  MODULE 10. Files are no longer handled with fs directly in this file:
  deleting one is a path that has to be checked before it is trusted,
  and that check now lives in one place.
*/
import { deleteStoredFiles } from "../config/fileService.js";
import {
  MAX_ATTACHMENTS_PER_REQUEST,
  ATTACHMENT_RULES,
} from "../config/fileConstants.js";
import { startApprovalWorkflow } from "../config/approvalEngine.js";
import {
  notifyApproversOfPendingRequest,
  notifyRequesterApproved,
} from "../config/notificationService.js";
import {
  recordAudit,
  buildChanges,
  describePerson,
  describeRequest,
} from "../config/auditService.js";

/*
  MODULE 7 - the fields of a request that are worth an audit entry when
  they change, and how they are written on screen.

  Only these are compared. An update also touches updatedAt and a
  handful of mongoose internals, and none of them are what a person
  means by "what changed" - see buildChanges() in config/auditService.js.
*/
const REQUEST_AUDIT_FIELDS = {
  type: "Type",
  category: "Category",
  title: "Title",
  description: "Description",
  priority: "Priority",
  amount: "Amount",
  startDate: "Start date",
  endDate: "End date",
};

/* =====================================================================
   WHO MAY AN EMPLOYEE SEND A REQUEST TO?
   ---------------------------------------------------------------------
   The answer comes from the DATA, not from a role name: a manager is
   somebody a department currently points at. That is the same definition
   dashboardStats.getManagedDepartments() and config/reportScope.js
   already use, and reusing it is the whole point - a second definition
   ("anyone holding the Manager role") would drift the first time an
   admin renamed a role or made a Finance Manager head a department.

   It also self-maintains: the moment somebody stops managing a
   department they leave this list, and nobody has to remember to
   remove them.

   @returns an array of user ids that may legally be chosen
   ===================================================================== */
const getSelectableApproverIds = async () => {
  const departments = await Department.find({
    isDeleted: false,
    manager: { $ne: null },
  })
    .select("manager")
    .lean();

  // a person managing two departments would otherwise appear twice
  return [
    ...new Set(departments.map((department) => String(department.manager))),
  ];
};

/*
  Checks a chosenApprover coming from the browser.

  @returns { ok: true, value } with the id to save (or null), or
           { ok: false, message } with a sentence for the employee.
*/
const validateChosenApprover = async (rawValue, requesterId) => {
  // not sent at all, or deliberately cleared -> use the org chart
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: null };
  }

  if (!isValidObjectId(rawValue)) {
    return { ok: false, message: "The chosen approver is not a valid user" };
  }

  /*
    NOBODY MAY SEND A REQUEST TO THEMSELVES. The engine would drop them
    from their own stage anyway (see approvalEngine.js) and silently
    skip it, so refusing here is the honest answer rather than letting
    somebody think they had routed it somewhere.
  */
  if (String(rawValue) === String(requesterId)) {
    return {
      ok: false,
      message: "You cannot send a request to yourself",
    };
  }

  const allowedIds = await getSelectableApproverIds();

  if (!allowedIds.includes(String(rawValue))) {
    return {
      ok: false,
      message:
        "You can only send a request to somebody who manages a department",
    };
  }

  const approver = await User.findOne({
    _id: rawValue,
    isActive: true,
    isDeleted: false,
  })
    .select("_id")
    .lean();

  if (!approver) {
    return {
      ok: false,
      message: "That approver is no longer active",
    };
  }

  return { ok: true, value: approver._id };
};

/* =====================================================================
   0) WHO CAN I SEND THIS TO?
   ---------------------------------------------------------------------
   GET /api/request/approvers

   Fills the "Send to" dropdown on the request form. Needs no permission
   beyond being logged in: it returns nothing but the names of the people
   who manage a department, which every employee can already read off the
   Departments page.

   The caller is left OUT of their own list, matching the rule
   validateChosenApprover() enforces above.
   ===================================================================== */
export const listSelectableApprovers = async (req, res) => {
  try {
    const departments = await Department.find({
      isDeleted: false,
      manager: { $ne: null },
    })
      .select("name code manager")
      .populate({
        path: "manager",
        select: "firstName lastName employeeId designation photoUrl isActive isDeleted",
      })
      .sort({ name: 1 })
      .lean();

    /*
      One row per PERSON, not per department. Somebody who manages two
      departments would otherwise appear twice in the dropdown, so the
      departments they run are collected onto the single entry instead.
    */
    const byId = new Map();

    for (const department of departments) {
      const manager = department.manager;

      // populate gives null for a manager who has since been hard-deleted
      if (!manager || !manager.isActive || manager.isDeleted) {
        continue;
      }

      if (String(manager._id) === String(req.userId)) {
        continue; // you cannot send a request to yourself
      }

      const key = String(manager._id);

      if (!byId.has(key)) {
        byId.set(key, {
          _id: manager._id,
          firstName: manager.firstName,
          lastName: manager.lastName,
          employeeId: manager.employeeId,
          designation: manager.designation,
          photoUrl: manager.photoUrl,
          departments: [],
        });
      }

      byId.get(key).departments.push({
        _id: department._id,
        name: department.name,
        code: department.code,
      });
    }

    /*
      WHICH ONE THE FORM SHOULD PRE-SELECT: the manager of the caller's
      own department. Sending the id rather than making the browser work
      it out keeps the "who is my manager" rule in one place, and means
      the default is right even for somebody in a department whose
      manager changed this morning.
    */
    const me = await User.findById(req.userId).select("department").lean();

    const myDepartment = me?.department
      ? await Department.findOne({ _id: me.department, isDeleted: false })
          .select("manager")
          .lean()
      : null;

    const defaultApprover =
      myDepartment?.manager && String(myDepartment.manager) !== String(req.userId)
        ? myDepartment.manager
        : null;

    return res.status(200).json({
      message: "Approvers fetched successfully",
      approvers: [...byId.values()],
      defaultApprover,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `List Approvers Error ${error}` });
  }
};

/* =====================================================================
   1) CREATE REQUEST
   ---------------------------------------------------------------------
   POST /api/request/create
   body: { type, category, title, description, priority, amount, startDate, endDate }

   Every new request starts its life as a "Draft". The employee can keep
   editing it and only calls submitRequest() below when it is ready.
   ===================================================================== */
export const createRequest = async (req, res) => {
  try {
    const {
      type,
      category,
      title,
      description,
      priority,
      amount,
      startDate,
      endDate,
      chosenApprover,
    } = req.body;

    if (!(await isSelectableRequestType(type))) {
      return res
        .status(400)
        .json({ message: await describeSelectableTypes() });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Title is required" });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ message: "Description is required" });
    }

    if (priority && !REQUEST_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        message: `Priority must be one of: ${REQUEST_PRIORITIES.join(", ")}`,
      });
    }

    // ---- start date cannot be after end date, when both are given ----
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return res
        .status(400)
        .json({ message: "Start date cannot be after end date" });
    }

    // ---- the manager the employee asked for, when they named one ----
    const approverCheck = await validateChosenApprover(
      chosenApprover,
      req.userId
    );

    if (!approverCheck.ok) {
      return res.status(400).json({ message: approverCheck.message });
    }

    const request = await Request.create({
      requester: req.userId,
      type,
      category: category?.trim() || "",
      title: title.trim(),
      description: description.trim(),
      priority: priority || "Medium",
      amount: amount === "" || amount === undefined ? null : amount,
      startDate: startDate || null,
      endDate: endDate || null,
      chosenApprover: approverCheck.value,
    });

    /*
      MODULE 7. `request: request._id` is what puts this entry into the
      Activity Timeline of the request later - the audit log is the
      only place that remembers a request was ever created, because the
      approval that records everything else does not exist until the
      employee presses Submit.
    */
    await recordAudit(req, {
      action: "RequestCreated",
      targetType: "Request",
      targetId: request._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: `${describePerson(req.user)} created ${describeRequest(
        request
      )} as a draft`,
    });

    return res.status(201).json({
      message: "Request saved as draft",
      request,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Create Request Error ${error}` });
  }
};

/* =====================================================================
   2) GET ALL MY REQUESTS  (with search, filters and pagination)
   ---------------------------------------------------------------------
   GET /api/request/all?page=1&limit=10&search=laptop&type=Laptop&status=Draft&priority=High
   ===================================================================== */
export const getAllRequests = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const { search, type, status, priority } = req.query;

    // an employee only ever sees their OWN requests in this module
    const filter = { requester: req.userId, isDeleted: false };

    if (search && search.trim()) {
      const searchText = search.trim();
      filter.$or = [
        { title: { $regex: searchText, $options: "i" } },
        { requestId: { $regex: searchText, $options: "i" } },
        { category: { $regex: searchText, $options: "i" } },
      ];
    }

    // isKnown, not isSelectable - see the import note at the top
    if (type && (await isKnownRequestType(type))) {
      filter.type = type;
    }

    if (status && REQUEST_STATUSES.includes(status)) {
      filter.status = status;
    }

    if (priority && REQUEST_PRIORITIES.includes(priority)) {
      filter.priority = priority;
    }

    const skip = (page - 1) * limit;

    const [requests, totalRequests] = await Promise.all([
      Request.find(filter)
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit)
        /*
          MODULE 10 - .lean() on every list that is only ever READ.

          Without it mongoose wraps each row in a full document: change
          tracking, validators, virtuals, getters, a save() method - all
          of it built, and none of it used, because the next thing that
          happens to these rows is JSON.stringify.

          On a page of ten it is not worth measuring. It is here because
          it is a HABIT worth having: the same line is on the user list,
          the approval queue, the notification list and the search, and
          together those are most of what a busy morning asks the
          database for.

          THE RULE FOR WHEN NOT TO USE IT: the moment anything is going
          to be changed and saved, or a document method is called, the
          plain object is the wrong thing - see deleteAttachment() in
          fileController.js, which deliberately does not use it.
        */
        .lean(),
      Request.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Requests fetched successfully",
      requests,
      pagination: {
        page,
        limit,
        totalRequests,
        totalPages: Math.ceil(totalRequests / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: `Get All Requests Error ${error}` });
  }
};

/* =====================================================================
   3) GET ONE REQUEST  (full details, used by the "View" pop-up)
   ---------------------------------------------------------------------
   GET /api/request/:id
   ===================================================================== */
export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await Request.findOne({
      _id: id,
      requester: req.userId,
      isDeleted: false,
    })
      /*
        The pop-up shows "Sending to: Rajesh Kulkarni", so the name has
        to come with the request - the field itself only holds an id.
      */
      .populate("chosenApprover", "firstName lastName employeeId designation");

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    return res.status(200).json({
      message: "Request fetched successfully",
      request,
    });
  } catch (error) {
    return res.status(500).json({ message: `Get Request Error ${error}` });
  }
};

/* =====================================================================
   4) UPDATE A DRAFT REQUEST
   ---------------------------------------------------------------------
   PUT /api/request/:id

   A request can be edited in exactly two situations:

     Draft    -> it has never been sent anywhere
     Returned -> an approver handed it back for a correction (Module 4)

   In every other state it is locked, so nobody can quietly change a
   request while people are approving it, or after it was decided.
   ===================================================================== */
export const updateDraftRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      type,
      category,
      title,
      description,
      priority,
      amount,
      startDate,
      endDate,
      chosenApprover,
    } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await Request.findOne({
      _id: id,
      requester: req.userId,
      isDeleted: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      return res.status(400).json({
        message:
          "This request can no longer be edited. Only a draft, or a request that was returned for correction, can be changed.",
      });
    }

    /*
      MODULE 7. A copy of the request BEFORE anything below touches it.

      toObject() is what makes it a copy. Without it we would be
      holding the same live document the lines below are about to
      change, and by the time we compared the two they would be the
      same object - every diff would come out empty.
    */
    const before = request.toObject();

    if (type) {
      /*
        Editing a draft is choosing a type all over again, so this asks
        the strict question: a type an admin retired yesterday must not
        be re-selectable today, even on a request that already had it.
      */
      if (!(await isSelectableRequestType(type))) {
        return res
          .status(400)
          .json({ message: await describeSelectableTypes() });
      }
      request.type = type;
    }

    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ message: "Title is required" });
      }
      request.title = title.trim();
    }

    if (description !== undefined) {
      if (!description.trim()) {
        return res.status(400).json({ message: "Description is required" });
      }
      request.description = description.trim();
    }

    if (priority) {
      if (!REQUEST_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          message: `Priority must be one of: ${REQUEST_PRIORITIES.join(", ")}`,
        });
      }
      request.priority = priority;
    }

    if (category !== undefined) {
      request.category = category?.trim() || "";
    }

    if (amount !== undefined) {
      request.amount = amount === "" ? null : amount;
    }

    if (startDate !== undefined) {
      request.startDate = startDate || null;
    }

    if (endDate !== undefined) {
      request.endDate = endDate || null;
    }

    /*
      Re-checked on every edit rather than only on create, because the
      list can go stale while a draft sits around: the manager the
      employee picked last week may have left the company or handed
      their department over since. This is also the path that matters
      most for a RETURNED request - "send it to the right manager this
      time" is a common reason one comes back.
    */
    if (chosenApprover !== undefined) {
      const approverCheck = await validateChosenApprover(
        chosenApprover,
        req.userId
      );

      if (!approverCheck.ok) {
        return res.status(400).json({ message: approverCheck.message });
      }

      request.chosenApprover = approverCheck.value;
    }

    if (
      request.startDate &&
      request.endDate &&
      request.startDate > request.endDate
    ) {
      return res
        .status(400)
        .json({ message: "Start date cannot be after end date" });
    }

    await request.save();

    /*
      MODULE 7. A save that changed nothing (the employee opened the
      form and pressed Save) writes no entry: an audit log full of
      "updated, nothing different" rows is harder to read, not more
      complete.
    */
    const changes = buildChanges(
      before,
      request.toObject(),
      REQUEST_AUDIT_FIELDS
    );

    if (changes.length > 0) {
      await recordAudit(req, {
        action: "RequestUpdated",
        targetType: "Request",
        targetId: request._id,
        targetLabel: describeRequest(request),
        request: request._id,
        changes,
        description: `${describePerson(req.user)} edited ${describeRequest(
          request
        )}`,
      });
    }

    return res.status(200).json({
      message: "Request updated successfully",
      request,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Update Request Error ${error}` });
  }
};

/* =====================================================================
   5) DELETE A DRAFT REQUEST
   ---------------------------------------------------------------------
   DELETE /api/request/:id

   A draft was never seen by anybody else, so instead of a soft delete
   (like Users/Departments use) we remove it for real, together with any
   files it had attached.
   ===================================================================== */
export const deleteDraftRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await Request.findOne({
      _id: id,
      requester: req.userId,
      isDeleted: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "Draft") {
      return res.status(400).json({
        message: "Only a draft request can be deleted",
      });
    }

    /*
      Remove every attached file from disk before removing the request.

      MODULE 10 moved the two lines that used to be here into
      config/fileService.js. They built the path by gluing "public" onto
      the front of the stored one, which worked but was the third place
      in the project doing that by hand - and none of the three checked
      that the result was really inside the uploads folder.
    */
    deleteStoredFiles(request.attachments.map((item) => item.filePath));

    await Request.findByIdAndDelete(id);

    /*
      MODULE 7. This is the one entry that OUTLIVES the thing it is
      about: a draft is really removed from the database (see the note
      above this function), so a moment from now nothing else in
      FlowDesk will remember that REQ-0012 ever existed.

      That is exactly why the audit log copies the label in as text
      instead of trusting the reference - `request` still points at an
      id that no longer resolves, and the entry still reads properly.
    */
    await recordAudit(req, {
      action: "RequestDeleted",
      targetType: "Request",
      targetId: request._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: `${describePerson(req.user)} deleted the draft ${describeRequest(
        request
      )}`,
    });

    return res.status(200).json({ message: "Draft request deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Delete Request Error ${error}` });
  }
};

/* =====================================================================
   6) SUBMIT REQUEST   <- this is where the APPROVAL WORKFLOW STARTS
   ---------------------------------------------------------------------
   PATCH /api/request/:id/submit

   Up to Module 3 this only flipped the status to "Submitted" and the
   request sat there, because there was nothing to approve it. Since
   Module 4 pressing Submit hands the request to the approval engine,
   which finds the live workflow for this request type and parks the
   request at its first stage.

   The same call is used a second time when a returned request has been
   corrected - the engine notices the request already has an approval and
   sends it down the route again, keeping the old timeline.

   NOTE: the engine only changes things in memory, so if it refuses (no
   workflow set up, a stage with no approver) we answer 400 and NOTHING
   was written - the request quietly stays a draft.
   ===================================================================== */
export const submitRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await Request.findOne({
      _id: id,
      requester: req.userId,
      isDeleted: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      return res.status(400).json({
        message:
          "Only a draft, or a request that was returned for correction, can be submitted",
      });
    }

    // remember whether this is the first time, for the message below
    const isResubmission = request.status === "Returned";

    const result = await startApprovalWorkflow(request);

    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    request.submittedAt = new Date();

    /*
      The approval is saved FIRST on purpose. If the second save were to
      fail we would rather end up with an approval whose request is still
      a draft (the employee simply presses Submit again) than with a
      request marked "InProgress" that has no approval behind it - that
      one could neither be edited nor decided on by anybody.

      The engine has already set request.status to InProgress, or
      straight to Approved when every stage matched an auto approval rule.
    */
    await result.approval.save();
    await request.save({ validateBeforeSave: false });

    /* =================================================================
       MODULE 6 - TELL SOMEBODY ABOUT IT
       -----------------------------------------------------------------
       Until now a submitted request simply appeared in a queue and
       waited to be noticed. From here on the people it is waiting for
       get a bell entry and an email straight away.

       Two different things can have happened above:

         the request is standing at a stage  -> tell those approvers
         every stage auto approved it        -> tell the EMPLOYEE that
                                                it is already done

       Both calls swallow their own errors (see notificationService.js),
       so a mail server that is down can never turn a successful submit
       into a 500.
       ================================================================= */
    if (request.status === "Approved") {
      await notifyRequesterApproved(request);
    } else {
      await notifyApproversOfPendingRequest(request, result.approval, req.user);
    }

    /*
      MODULE 7. Submitting is the moment a request stops being private
      paperwork and starts costing other people their time, so it gets
      its own action rather than being another RequestUpdated.

      The wording says whether this was the first submission or a
      corrected one coming back, because "submitted three times" is a
      story about the request that neither status nor timestamp tells.
    */
    await recordAudit(req, {
      action: "RequestSubmitted",
      targetType: "Request",
      targetId: request._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: isResubmission
        ? `${describePerson(req.user)} corrected and submitted ${describeRequest(
            request
          )} again`
        : `${describePerson(req.user)} submitted ${describeRequest(
            request
          )} for approval`,
    });

    return res.status(200).json({
      message:
        request.status === "Approved"
          ? "Request approved automatically - every stage matched an auto approval rule"
          : isResubmission
          ? "Request submitted again and sent back through the approval workflow"
          : "Request submitted and sent into the approval workflow",
      request,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const firstMessage = Object.values(error.errors)[0].message;
      return res.status(400).json({ message: firstMessage });
    }

    return res.status(500).json({ message: `Submit Request Error ${error}` });
  }
};

/* =====================================================================
   7) UPLOAD ATTACHMENTS
   ---------------------------------------------------------------------
   POST /api/request/:id/attachments
   multipart/form-data, field name "attachments", up to 5 files

   req.files (plural) is filled in by multer's upload.array(), see
   middleware/uploadRequestFile.js and routes/requestRoute.js.
   ===================================================================== */
export const uploadAttachments = async (req, res) => {
  /*
    MODULE 10 - THE FILES ARE ALREADY ON THE DISK WHEN THIS RUNS.

    Multer is middleware: by the time the controller is reached it has
    finished writing every file. So each of the four refusals below
    would leave orphans behind - files nobody can reach, filling up the
    disk, one per failed attempt. This little helper is called on the
    way out of each of them.
  */
  const discardUploadedFiles = () => {
    deleteStoredFiles(
      (req.files || []).map(
        (file) => `${ATTACHMENT_RULES.publicPath}/${file.filename}`
      )
    );
  };

  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      discardUploadedFiles();
      return res.status(400).json({ message: "Invalid request id" });
    }

    const request = await Request.findOne({
      _id: id,
      requester: req.userId,
      isDeleted: false,
    });

    if (!request) {
      discardUploadedFiles();
      return res.status(404).json({ message: "Request not found" });
    }

    /*
      Files may only be added while the employee still owns the request.
      Once it is travelling down the workflow (or was decided) the
      paperwork is frozen, so an approver always sees exactly the same
      documents as the person who approved before them.
    */
    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      discardUploadedFiles();
      return res.status(400).json({
        message:
          "Files can only be attached while the request is a draft or has been returned for correction",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No file was uploaded" });
    }

    /*
      MODULE 10 - the ceiling on the REQUEST, not on the click.

      The uploader already refuses more than 5 files at a time, but
      five clicks of five files were a way to put twenty five documents
      on one leave request. This is the same kind of limit as
      MAX_EXPORT_ROWS in Module 8: not a rule about what is sensible,
      a rule about what one user can make the server hold.
    */
    const totalAfterUpload = request.attachments.length + req.files.length;

    if (totalAfterUpload > MAX_ATTACHMENTS_PER_REQUEST) {
      discardUploadedFiles();
      return res.status(400).json({
        message: `A request can hold at most ${MAX_ATTACHMENTS_PER_REQUEST} files. This one already has ${request.attachments.length}.`,
      });
    }

    /*
      Turn what multer gives us into the shape our schema expects.

      fileName is the name the PERSON gave the file and is only ever
      displayed; file.filename is the random name we chose for the disk
      (see config/fileService.js). Keeping the two apart is what stops
      an uploader from having any say in a path on our server.
    */
    const newAttachments = req.files.map((file) => ({
      fileName: file.originalname,
      filePath: `${ATTACHMENT_RULES.publicPath}/${file.filename}`,
      fileSize: file.size,
    }));

    request.attachments.push(...newAttachments);
    await request.save({ validateBeforeSave: false });

    /*
      MODULE 7. ONE entry for the whole upload, listing the files by
      name - because one click by the employee is one thing that
      happened, whether it carried one file or five.

      The request's Activity Timeline splits them back into a line per
      file, and it can, because request.attachments stamps each one
      with its own uploadedAt.
    */
    await recordAudit(req, {
      action: "AttachmentUploaded",
      targetType: "Request",
      targetId: request._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: `${describePerson(req.user)} attached ${
        newAttachments.length
      } file(s) to ${describeRequest(request)}: ${newAttachments
        .map((attachment) => attachment.fileName)
        .join(", ")}`,
    });

    return res.status(200).json({
      message: "Attachment(s) uploaded successfully",
      request,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Upload Attachments Error ${error}` });
  }
};
