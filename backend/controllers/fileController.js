/*
=========================================================================
  CONTROLLER: File                                ( the "C" of MVC )
=========================================================================
  Module 10 - File Management.

  FUNCTIONS IN THIS FILE
    getAttachment      GET     /api/file/request/:requestId/:attachmentId
    downloadAttachment GET     /api/file/request/:requestId/:attachmentId/download
    deleteAttachment   DELETE  /api/file/request/:requestId/:attachmentId

  WHY THIS FILE EXISTS AT ALL
  ---------------------------
  Uploading was built in Module 2 and worked. READING was never really
  built: the file was dropped into public/uploads/requests, and

      app.use("/uploads", express.static("public/uploads"))

  handed it to anybody who asked for the URL. No login. No permission.
  No check that the person had anything to do with the request. The path
  was a timestamp and the original file name, which is guessable, and
  the files behind it are medical certificates, salary letters and
  invoices.

  So Module 10 takes the request attachments back out of express.static
  and serves them from here, where the SAME question the comments and
  the activity timeline already ask can be asked again:

      canViewRequest(request, approval, user)   <- config/requestAccess.js

  That is deliberately the same function and not a new rule. If reading
  a document needed its own idea of "who is involved in this request",
  the two ideas would eventually disagree, and the disagreement would
  show up as an approver who can read the conversation ABOUT an invoice
  but not the invoice.

  NO NEW PERMISSION EITHER, for the reason Module 7 gave about the
  activity timeline and Module 8 gave about search: an attachment
  belongs to a request, so the right to see it is the right to see the
  request. A "file:read" permission would be a switch an admin could
  turn off to stop an employee opening their own paperwork.

  THE THREE ROUTES ARE ONE PIECE OF LOGIC IN TWO SHAPES
  -----------------------------------------------------
  Preview and download differ by ONE header (Content-Disposition:
  inline vs attachment), so they share sendAttachment() below rather
  than being written twice.
=========================================================================
*/

import fs from "fs";

import Request from "../model/requestModel.js";
import { isValidObjectId } from "../config/validation.js";
import { EDITABLE_REQUEST_STATUSES } from "../config/requestConstants.js";
import {
  loadRequestWithApproval,
  canViewRequest,
} from "../config/requestAccess.js";
import {
  resolveStoredFile,
  deleteStoredFile,
  describeFile,
  toHeaderSafeName,
} from "../config/fileService.js";
import {
  recordAudit,
  describePerson,
  describeRequest,
} from "../config/auditService.js";

/* =====================================================================
   THE SHARED PART: FIND THE FILE AND CHECK WHO IS ASKING
   ---------------------------------------------------------------------
   Every route below starts the same way, so it is written once.

   @returns { ok: true, request, attachment, absolutePath }
        or  { ok: false, status, message }

   It answers 404 for BOTH "no such request" and "you are not part of
   this request", which is the same decision the login route makes about
   a wrong email: a different answer for the two cases would tell a
   stranger which request ids are real.
   ===================================================================== */
const findAttachmentForViewer = async (req) => {
  const { requestId, attachmentId } = req.params;

  if (!isValidObjectId(requestId) || !isValidObjectId(attachmentId)) {
    return { ok: false, status: 400, message: "Invalid file address" };
  }

  const { request, approval } = await loadRequestWithApproval(requestId);

  if (!request) {
    return { ok: false, status: 404, message: "File not found" };
  }

  if (!canViewRequest(request, approval, req.user)) {
    return { ok: false, status: 404, message: "File not found" };
  }

  const attachment = (request.attachments || []).find(
    (item) => String(item._id) === String(attachmentId)
  );

  if (!attachment) {
    return { ok: false, status: 404, message: "File not found" };
  }

  /*
    The file is in the database but not on the disk. That is a real
    possibility rather than a bug: the host may have been redeployed
    with an ephemeral filesystem, or a backup restored the database
    without the uploads folder. It deserves a message an admin can act
    on instead of a stream that ends immediately.

    resolveStoredFile() also refuses any path that points outside the
    upload folder - see config/fileService.js.
  */
  const absolutePath = resolveStoredFile(attachment.filePath);

  if (!absolutePath) {
    return {
      ok: false,
      status: 410,
      message:
        "This file is no longer on the server. It may have been removed during a deployment.",
    };
  }

  return { ok: true, request, attachment, absolutePath };
};

/* =====================================================================
   THE OTHER SHARED PART: ACTUALLY SEND IT
   ---------------------------------------------------------------------
   @param disposition "inline" (show it in the page) or "attachment"
                      (save it to the Downloads folder)
   ===================================================================== */
const sendAttachment = (res, attachment, absolutePath, disposition) => {
  const { mimeType } = describeFile(attachment.fileName);
  const safeName = toHeaderSafeName(attachment.fileName);

  /*
    THE CONTENT TYPE COMES FROM OUR OWN MAP, never from the uploader.

    This is the header that decides whether a browser DISPLAYS a file or
    RUNS it. Everything in SAFE_MIME_TYPES is an image, a PDF, an Office
    document or plain text, so there is no accepted extension that can
    talk the browser into executing anything. See fileConstants.js.
  */
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", attachment.fileSize);

  /*
    filename= is the plain ASCII fallback; filename*= carries the real
    name with its accents and non-Latin characters (RFC 5987). Browsers
    that understand the second ignore the first, so "Rechnung März.pdf"
    keeps its umlaut instead of arriving as "Rechnung M_rz.pdf".
  */
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(
      attachment.fileName
    )}`
  );

  /*
    private = a shared cache (a company proxy, a CDN) must never keep a
    copy; only the one browser that asked may. no-store would be
    stricter still, but it also breaks the PDF viewer's own paging, and
    the response already needed a valid session to obtain.
  */
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  /*
    Streaming instead of fs.readFile: a 5 MB file never sits in the
    server's memory in one piece, and ten people downloading at once
    costs ten buffers of a few kilobytes rather than 50 MB.
  */
  const stream = fs.createReadStream(absolutePath);

  stream.on("error", (error) => {
    console.error(`Send File Error ${error}`);
    // the headers are already on their way, so all we can do is stop
    if (!res.headersSent) {
      res.status(500).json({ message: "The file could not be read" });
    } else {
      res.end();
    }
  });

  stream.pipe(res);
};

/* =====================================================================
   1) PREVIEW AN ATTACHMENT
   ---------------------------------------------------------------------
   GET /api/file/request/:requestId/:attachmentId

   Used by the Preview pop-up on the React side. The browser is told to
   show the file rather than save it.
   ===================================================================== */
export const getAttachment = async (req, res) => {
  try {
    const found = await findAttachmentForViewer(req);

    if (!found.ok) {
      return res.status(found.status).json({ message: found.message });
    }

    return sendAttachment(res, found.attachment, found.absolutePath, "inline");
  } catch (error) {
    return res.status(500).json({ message: `Get Attachment Error ${error}` });
  }
};

/* =====================================================================
   2) DOWNLOAD AN ATTACHMENT
   ---------------------------------------------------------------------
   GET /api/file/request/:requestId/:attachmentId/download

   The same file, the same check, one different header.

   NOT AUDITED, and that is a decision rather than an omission. Module 7
   records what people CHANGE, and an audit log that also recorded every
   file anybody looked at would grow faster than everything else in it
   put together - four approvers opening the same invoice twice is eight
   rows saying nothing happened. The upload IS recorded, the delete
   below IS recorded, because those change what the request contains.
   ===================================================================== */
export const downloadAttachment = async (req, res) => {
  try {
    const found = await findAttachmentForViewer(req);

    if (!found.ok) {
      return res.status(found.status).json({ message: found.message });
    }

    return sendAttachment(
      res,
      found.attachment,
      found.absolutePath,
      "attachment"
    );
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Download Attachment Error ${error}` });
  }
};

/* =====================================================================
   3) DELETE AN ATTACHMENT
   ---------------------------------------------------------------------
   DELETE /api/file/request/:requestId/:attachmentId

   The missing quarter of Module 2's file handling: an employee could
   attach the wrong file and had no way to take it back except deleting
   the whole draft.

   THE RULE IS STRICTER THAN READING, AND ON PURPOSE.
   Reading is open to everybody on the request. Deleting is open to the
   REQUESTER ONLY, and only while the request is still theirs - a Draft,
   or one an approver returned for correction. That is exactly the rule
   uploadAttachments() already applies, and it is the same sentence
   Module 2 wrote about editing a request:

     once it is travelling down the workflow, the paperwork is frozen,
     so an approver always sees exactly the same documents as the
     person who approved before them.

   An approver who could delete a document could change what the next
   approver is deciding on - quietly, after the fact.
   ===================================================================== */
export const deleteAttachment = async (req, res) => {
  try {
    const { requestId, attachmentId } = req.params;

    if (!isValidObjectId(requestId) || !isValidObjectId(attachmentId)) {
      return res.status(400).json({ message: "Invalid file address" });
    }

    /*
      A real document this time, not the .lean() copy the read routes
      use - we are about to change it.

      "requester: req.userId" is the same filter every function in
      requestController.js uses: somebody else's request answers 404
      rather than 403, so guessing an id tells you nothing.
    */
    const request = await Request.findOne({
      _id: requestId,
      requester: req.userId,
      isDeleted: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      return res.status(400).json({
        message:
          "Files can only be removed while the request is a draft or has been returned for correction",
      });
    }

    const attachment = request.attachments.id(attachmentId);

    if (!attachment) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileName = attachment.fileName;
    const filePath = attachment.filePath;

    /*
      THE DATABASE FIRST, THE DISK SECOND.

      If the unlink fails we are left with a file nobody can reach,
      which is untidy. If the order were reversed and the save failed we
      would be left with a row in the request pointing at nothing, which
      is a broken attachment in everybody's pop-up. Given the choice,
      leave the litter.
    */
    request.attachments.pull(attachmentId);
    await request.save({ validateBeforeSave: false });

    deleteStoredFile(filePath); // never throws, see fileService.js

    /*
      MODULE 7. Removing a document from a request is exactly the kind
      of quiet change the audit log was built for: nothing on screen
      afterwards shows that the file was ever there, so without this row
      the only record would be somebody's memory.

      The file NAME is frozen into the description for the same reason
      auditService.js freezes actorName - a moment from now nothing else
      in FlowDesk remembers what that attachment was called.
    */
    await recordAudit(req, {
      action: "AttachmentDeleted",
      targetType: "Request",
      targetId: request._id,
      targetLabel: describeRequest(request),
      request: request._id,
      description: `${describePerson(req.user)} removed the attachment "${fileName}" from ${describeRequest(
        request
      )}`,
    });

    return res.status(200).json({
      message: "Attachment removed successfully",
      request,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete Attachment Error ${error}` });
  }
};
