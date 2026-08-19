/*
=========================================================================
  MIDDLEWARE: uploadRequestFile  ->  handles FILE UPLOADS (attachments)
=========================================================================
  The files an employee attaches to a request: a medical certificate, a
  purchase quotation, a receipt.

  Differences from multer.js (which handles profile photos and the
  company logo) are now ALL in the rule object, not in this file:

    - a different folder            public/uploads/requests
    - documents as well as images   pdf, doc, xls, csv, txt
    - several files at once         up to 5 per click

  AND ONE DIFFERENCE THAT IS NOT IN THE RULES AT ALL: what happens
  afterwards. A profile photo is public; a request attachment is not.
  The folder this uploader writes into is deliberately NOT served by
  express.static - every read goes through controllers/fileController.js
  so the same canViewRequest() check that guards the comments and the
  activity timeline also guards the documents. See index.js.
=========================================================================
*/

import { createUploader } from "../config/fileService.js";
import { ATTACHMENT_RULES } from "../config/fileConstants.js";

const uploadRequestFile = createUploader(ATTACHMENT_RULES);

export default uploadRequestFile;
