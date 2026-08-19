/*
=========================================================================
  FILE CONSTANTS  (frontend mirror of backend/config/fileConstants.js)
=========================================================================
  Module 10 - File Management.

  Same idea as utils/requestConstants.js and utils/auditConstants.js:
  the React side keeps its own copy of the fixed lists, because a
  dropdown cannot wait for the network to know what it should offer.

  WHAT IS COPIED AND WHAT IS NOT
  ------------------------------
  The numbers here are for TELLING THE USER, never for deciding. The
  size limit below draws the "up to 5 MB" hint and catches a 40 MB
  holiday video before it is uploaded over somebody's phone connection -
  a courtesy, not a check. The real refusal happens in the multer file
  filter, which the browser cannot reach or edit.

  That is the same rule the whole application follows: hiding a button
  in React is not security. This file makes the app pleasant; the
  backend makes it safe.
=========================================================================
*/

export const FILE_KINDS = {
  IMAGE: "image",
  PDF: "pdf",
  DOCUMENT: "document",
  SPREADSHEET: "spreadsheet",
  TEXT: "text",
  OTHER: "other",
};

const KIND_BY_EXTENSION = {
  png: FILE_KINDS.IMAGE,
  jpg: FILE_KINDS.IMAGE,
  jpeg: FILE_KINDS.IMAGE,
  webp: FILE_KINDS.IMAGE,
  pdf: FILE_KINDS.PDF,
  doc: FILE_KINDS.DOCUMENT,
  docx: FILE_KINDS.DOCUMENT,
  xls: FILE_KINDS.SPREADSHEET,
  xlsx: FILE_KINDS.SPREADSHEET,
  csv: FILE_KINDS.SPREADSHEET,
  txt: FILE_KINDS.TEXT,
};

/*
  Only these can honestly be shown inside the page: an image in an
  <img>, a PDF in an <iframe>. A Word file has no browser preview, so
  for those the UI offers Download instead of opening an empty box and
  hoping.
*/
export const PREVIEWABLE_KINDS = [FILE_KINDS.IMAGE, FILE_KINDS.PDF];

// the limits, for the hint text and the friendly pre-check
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_ATTACHMENTS_PER_REQUEST = 10;

export const ATTACHMENT_HINT =
  "Images, PDF, Word, Excel, CSV or text files - up to 5 MB each, 5 at a time.";

/*
  Everything the UI wants to know about one attachment, from its name.

  It matches describeFile() in backend/config/fileService.js, and the
  two agreeing is what makes the Preview button appear exactly when the
  preview route can really return something a browser will draw.
*/
export const describeFile = (fileName) => {
  const extension = String(fileName || "").split(".").pop().toLowerCase();
  const kind = KIND_BY_EXTENSION[extension] || FILE_KINDS.OTHER;

  return {
    extension,
    kind,
    isPreviewable: PREVIEWABLE_KINDS.includes(kind),
  };
};

/*
  A size a person can read: "812 KB", "1.4 MB".

  The old UI printed Math.ceil(bytes / 1024) + " KB", which is fine for
  a photo and unreadable for a scan ("4096 KB"). Same function as
  formatFileSize() on the backend, so a size never looks different
  depending on which half of the app is showing it.
*/
export const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/* =====================================================================
   THE ADDRESSES OF THE TWO FILE ROUTES
   ---------------------------------------------------------------------
   Written once here so no page has to remember the shape of the URL.
   Note they are API paths and NOT the file's own /uploads path: since
   Module 10 an attachment is served by a route that checks who is
   asking, not by a static folder.
   ===================================================================== */
export const attachmentUrl = (requestId, attachmentId) =>
  `/api/file/request/${requestId}/${attachmentId}`;

export const attachmentDownloadUrl = (requestId, attachmentId) =>
  `/api/file/request/${requestId}/${attachmentId}/download`;
