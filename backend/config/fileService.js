/*
=========================================================================
  FILE SERVICE   (Module 10 - Enterprise Features & Deployment)
=========================================================================
  The one place that knows how a file gets onto the disk, how it is
  found again, and how it leaves.

  Before this module the same forty lines of multer setup were written
  twice (middleware/multer.js and middleware/uploadRequestFile.js) with
  small differences, and "delete this file" was written by hand in three
  controllers with three slightly different guesses at the path. This
  file replaces all of it, the same way reportExport.js replaced six
  copies of a CSV writer in Module 8.

  WHAT IT DOES
    createUploader(rules)     build a configured multer, from fileConstants
    resolveStoredFile(path)   turn a stored path into a real, SAFE path
    deleteStoredFile(path)    remove a file, never throwing
    describeFile(name)        extension / mime type / kind / previewable
    formatFileSize(bytes)     "1.4 MB"

  THE TWO SECURITY DECISIONS LIVE HERE
  ------------------------------------
  1. THE NAME ON DISK IS OURS, NOT THE UPLOADER'S.
     The old code saved "<timestamp>-<original name>". That means a
     stranger chooses part of a path on our server, and a name can
     contain "../", a null byte, a leading dot, 300 characters, or the
     name of a file we already have. We now save a random name with a
     checked extension and keep the original name in the DATABASE, where
     it is only ever DISPLAYED. The user still sees "March invoice.pdf";
     the disk sees "a91f3c7d0b2e5148.pdf".

  2. NOTHING IS READ FROM OUTSIDE THE UPLOAD FOLDER.
     Every read and delete goes through resolveStoredFile(), which
     resolves the path and then checks it really is inside
     UPLOAD_ROOT. Even if a bad path ever reached the database, it
     cannot be used to read /etc/passwd or the .env file.
=========================================================================
*/

import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

import {
  UPLOAD_ROOT,
  SAFE_MIME_TYPES,
  DEFAULT_MIME_TYPE,
  PREVIEWABLE_EXTENSIONS,
  KIND_BY_EXTENSION,
  FILE_KINDS,
} from "./fileConstants.js";

/*
  The absolute path of the upload folder, worked out ONCE.

  process.cwd() is the folder node was started from, which for this
  project is always backend/ (npm start / npm run dev run there). Making
  it absolute is what lets the "is this inside the folder?" check below
  be a simple string comparison.
*/
const UPLOAD_ROOT_ABSOLUTE = path.resolve(process.cwd(), UPLOAD_ROOT);

/* =====================================================================
   1) BUILD AN UPLOADER
   ---------------------------------------------------------------------
   Give it one of the rule objects from fileConstants.js and it returns a
   ready multer instance:

       const upload = createUploader(PHOTO_RULES);
       router.post("/photo", upload.single("photo"), controller);
   ===================================================================== */
export const createUploader = (rules) => {
  // create the folder the first time the server starts
  if (!fs.existsSync(rules.folder)) {
    fs.mkdirSync(rules.folder, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, rules.folder);
    },

    /*
      A RANDOM name plus the extension we validated - see decision 1 at
      the top of this file.

      16 hex characters is 8 random bytes: far too many combinations to
      guess, and short enough to read in a terminal. Two uploads in the
      same millisecond can no longer collide either, which the old
      Date.now() name could.
    */
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomBytes(8).toString("hex")}${extension}`);
    },
  });

  const fileFilter = (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!rules.extensions.includes(extension)) {
      return cb(new Error(`That file type is not allowed - ${rules.description}`));
    }

    /*
      The second opinion. file.mimetype is what the browser says the
      bytes are; a mismatch with the extension is the everyday sign of
      a file pretending to be something else.
    */
    if (!rules.mimeTypes.includes(file.mimetype)) {
      return cb(
        new Error(
          `"${file.originalname}" does not look like the type its name claims - ${rules.description}`
        )
      );
    }

    return cb(null, true);
  };

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: rules.maxBytes,
      files: rules.maxFiles,
    },
  });
};

/* =====================================================================
   2) FIND A STORED FILE, SAFELY
   ---------------------------------------------------------------------
   The database stores a WEB path: "/uploads/requests/a91f3c7d.pdf".
   The disk needs an absolute path. This turns one into the other and
   REFUSES anything that escapes the upload folder.

   @returns the absolute path, or null when the path is not acceptable
            or the file is simply not there any more
   ===================================================================== */
export const resolveStoredFile = (storedPath) => {
  if (!storedPath || typeof storedPath !== "string") {
    return null;
  }

  /*
    "/uploads/requests/x.pdf" -> "requests/x.pdf"

    We drop the leading "/uploads" because UPLOAD_ROOT_ABSOLUTE already
    points at that folder. path.join with a leading "/" would otherwise
    be read as an absolute path and throw the folder away.
  */
  const relative = storedPath.replace(/^\/?uploads\/?/, "");

  const absolute = path.resolve(UPLOAD_ROOT_ABSOLUTE, relative);

  /*
    THE TRAVERSAL CHECK. path.resolve has already collapsed every
    "..", so a path built from "../../.env" now points somewhere real
    and obviously outside. Comparing the resolved result against the
    root is the only reliable way to test this - looking for the text
    ".." in the input is not, because there are a dozen ways to write
    it (url-encoded, doubled up, mixed slashes).

    path.sep is added so that a sibling folder called "public/uploads-old"
    cannot pass the check by sharing a prefix.
  */
  if (
    absolute !== UPLOAD_ROOT_ABSOLUTE &&
    !absolute.startsWith(UPLOAD_ROOT_ABSOLUTE + path.sep)
  ) {
    console.warn(`Refused a file path outside the upload folder: ${storedPath}`);
    return null;
  }

  if (!fs.existsSync(absolute)) {
    return null;
  }

  return absolute;
};

/* =====================================================================
   3) DELETE A STORED FILE
   ---------------------------------------------------------------------
   NEVER THROWS - the same contract notificationService.js and
   auditService.js follow, and for the same reason. Removing the file is
   the tidying up that FOLLOWS the real work; a disk that refuses must
   not turn a successful delete into a 500 the user cannot act on.

   @returns true when a file was really removed
   ===================================================================== */
export const deleteStoredFile = (storedPath) => {
  try {
    const absolute = resolveStoredFile(storedPath);

    if (!absolute) {
      return false;
    }

    fs.unlinkSync(absolute);
    return true;
  } catch (error) {
    console.error(`Delete File Error ${error}`);
    return false;
  }
};

/*
  The same thing for a whole list, used when a draft request is deleted
  with its attachments still on it.
*/
export const deleteStoredFiles = (storedPaths = []) => {
  let removed = 0;

  storedPaths.forEach((storedPath) => {
    if (deleteStoredFile(storedPath)) {
      removed += 1;
    }
  });

  return removed;
};

/* =====================================================================
   4) WHAT KIND OF FILE IS THIS?
   ---------------------------------------------------------------------
   Worked out from the file NAME, and used for two different things:

     the Content-Type header of the download route (server)
     the icon and the preview mode (browser)

   The two must agree, so they read the same maps in fileConstants.js.
   ===================================================================== */
export const describeFile = (fileName) => {
  const extension = path.extname(String(fileName || "")).toLowerCase();

  return {
    extension,
    mimeType: SAFE_MIME_TYPES[extension] || DEFAULT_MIME_TYPE,
    kind: KIND_BY_EXTENSION[extension] || FILE_KINDS.OTHER,
    isPreviewable: PREVIEWABLE_EXTENSIONS.includes(extension),
  };
};

/* =====================================================================
   5) A SIZE A PERSON CAN READ
   ---------------------------------------------------------------------
   The old UI showed "Math.ceil(size / 1024) KB", which reads fine for a
   photo and badly for a 4 MB scan ("4096 KB").
   ===================================================================== */
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

/*
  Strips anything from a file name that has no business in an HTTP
  header, used by the Content-Disposition of the download route.

  The name comes from the database, but it originally came from a
  person, and a quote or a newline inside a header value is how header
  injection starts. Non-ASCII characters are handled separately by the
  controller (filename* / RFC 5987), so this only has to be safe.
*/
export const toHeaderSafeName = (fileName) => {
  return String(fileName || "file")
    .replace(/[\r\n"\\]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 150)
    .trim() || "file";
};
