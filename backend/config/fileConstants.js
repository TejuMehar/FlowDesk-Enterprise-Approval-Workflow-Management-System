/*
=========================================================================
  FILE CONSTANTS   (Module 10 - Enterprise Features & Deployment)
=========================================================================
  Everything FlowDesk believes about an uploaded file, in one place:
  where it is stored, how big it may be, which kinds are allowed, and
  what the browser should be told it is.

  Same idea as requestConstants.js and auditConstants.js - the multer
  middleware, the file controller and the React preview all read from
  THIS file, so "is a .pdf allowed?" can only ever have one answer.

  WHAT MODULE 10 CHANGED ABOUT FILES
  ----------------------------------
  Until now an attachment was a link. The file lived in
  public/uploads/requests and express.static handed it to ANYBODY who
  asked for the URL - no login, no permission, no check that the person
  had anything to do with the request. The paths were guessable
  (a timestamp and the original name), and a medical certificate is not
  a thing to protect with a guess.

  From this module on, a request attachment is never served statically.
  It is served by controllers/fileController.js, which asks the same
  question the comments and the activity timeline already ask:
  canViewRequest(). See the long note at the top of that file.

  PROFILE PHOTOS AND THE COMPANY LOGO ARE DELIBERATELY LEFT PUBLIC.
  A photo is shown in the navbar of every page and in every user table;
  the logo is on the login screen, BEFORE anybody is logged in. Putting
  those behind a token would buy nothing - they are the kind of thing an
  employee directory prints on a wall - and would cost every avatar an
  authenticated round trip.
=========================================================================
*/

/*
  The one folder every upload lives under. Everything else in this file
  is a folder INSIDE it, and config/fileService.js refuses to touch a
  path that resolves outside it (see resolveStoredFile()).
*/
export const UPLOAD_ROOT = "public/uploads";

/* =====================================================================
   1) WHAT MAY BE UPLOADED, PER KIND OF UPLOAD
   ---------------------------------------------------------------------
   Two rule sets, because the two uploads are not the same job:

     PHOTO_RULES       one small image, replacing the previous one
     ATTACHMENT_RULES  up to five documents, kept forever next to a
                       request that people make decisions about

   BOTH the extension and the MIME type are listed, and both are checked
   on upload. An extension is only the end of a file NAME - it is chosen
   by whoever uploads, so on its own it proves nothing. The MIME type is
   what the BROWSER says the bytes are, which is a second opinion rather
   than a guarantee, but requiring the two to AGREE stops the everyday
   case of "report.pdf" that is really an executable.

   (The honest limit: neither check reads the bytes themselves. Real
   content sniffing needs a library and a magic-number table. What saves
   us is further down - nothing uploaded is ever executed, and the
   download route forces a safe Content-Type, see SAFE_MIME_TYPES.)
   ===================================================================== */

export const PHOTO_RULES = {
  folder: `${UPLOAD_ROOT}`,
  publicPath: "/uploads",
  maxBytes: 2 * 1024 * 1024, // 2 MB
  maxFiles: 1,
  extensions: [".png", ".jpg", ".jpeg", ".webp"],
  mimeTypes: ["image/png", "image/jpeg", "image/webp"],
  // shown to the user when their file is refused
  description: "images only (png, jpg, jpeg, webp), up to 2 MB",
};

export const ATTACHMENT_RULES = {
  folder: `${UPLOAD_ROOT}/requests`,
  publicPath: "/uploads/requests",
  maxBytes: 5 * 1024 * 1024, // 5 MB per file
  maxFiles: 5,
  extensions: [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".txt",
  ],
  mimeTypes: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    /*
      Windows sends this for .csv when Excel is installed, and some
      browsers send it for .xls. Without it a perfectly ordinary
      spreadsheet is refused on one machine and accepted on the next.
    */
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
  ],
  description:
    "images, PDF, Word, Excel, CSV or text files, up to 5 MB each and 5 files at a time",
};

/* =====================================================================
   2) THE CONTENT-TYPE WE SEND BACK
   ---------------------------------------------------------------------
   Worked out from the EXTENSION OF THE STORED FILE, never from what the
   uploader claimed, and never from the original file name.

   This is the line that makes serving user files safe. If a browser is
   told a file is "text/html" it will RUN the script inside it, on our
   origin, with our cookies - the classic stored-XSS-through-uploads
   hole. Because every path out of this map is an image, a PDF, an
   Office document or plain text, there is no extension we accept that
   can talk the browser into executing anything.

   Anything not in the map falls back to application/octet-stream, which
   means "unknown bytes, just download it".
   ===================================================================== */
export const SAFE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

/* =====================================================================
   3) WHAT CAN BE SHOWN WITHOUT DOWNLOADING IT
   ---------------------------------------------------------------------
   The Preview pop-up draws an <img> for a picture and an <iframe> for a
   PDF. A Word file has no honest preview in a browser, so for those the
   UI offers Download instead of pretending.
   ===================================================================== */
export const PREVIEWABLE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
];

/*
  The rough KIND of a file, used by the React side to pick an icon and
  to decide between <img>, <iframe> and "no preview".
*/
export const FILE_KINDS = {
  IMAGE: "image",
  PDF: "pdf",
  DOCUMENT: "document",
  SPREADSHEET: "spreadsheet",
  TEXT: "text",
  OTHER: "other",
};

export const KIND_BY_EXTENSION = {
  ".png": FILE_KINDS.IMAGE,
  ".jpg": FILE_KINDS.IMAGE,
  ".jpeg": FILE_KINDS.IMAGE,
  ".webp": FILE_KINDS.IMAGE,
  ".pdf": FILE_KINDS.PDF,
  ".doc": FILE_KINDS.DOCUMENT,
  ".docx": FILE_KINDS.DOCUMENT,
  ".xls": FILE_KINDS.SPREADSHEET,
  ".xlsx": FILE_KINDS.SPREADSHEET,
  ".csv": FILE_KINDS.SPREADSHEET,
  ".txt": FILE_KINDS.TEXT,
};

/*
  How many attachments one request may carry in total.

  maxFiles above is "per click"; this is the ceiling on the request
  itself, so five clicks of five files cannot turn one leave request
  into a document library.
*/
export const MAX_ATTACHMENTS_PER_REQUEST = 10;
