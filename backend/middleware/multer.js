/*
=========================================================================
  MIDDLEWARE: multer   ->  handles FILE UPLOADS (profile photo + logo)
=========================================================================
  A normal form sends JSON, and express.json() can read it.
  But a form with a FILE sends "multipart/form-data", which express
  cannot read on its own. "multer" is the package that reads it for us.

  After multer runs we get:
      req.file  -> information about the uploaded file
      req.body  -> the normal text fields of the form

  MODULE 10 EMPTIED THIS FILE OUT, and that is the point of it.

  It used to hold forty lines of multer configuration: where to save,
  what to call the file, which types to accept, how big. Its twin,
  uploadRequestFile.js, held the same forty lines with three values
  changed - so "which file types do we accept?" had two answers, and
  the name pattern that turned out to be unsafe had to be fixed twice.

  Now the RULES live in config/fileConstants.js and the MACHINERY lives
  in config/fileService.js. Both middlewares are three lines, and the
  only difference between them is which rule set they hand over.
=========================================================================
*/

import { createUploader } from "../config/fileService.js";
import { PHOTO_RULES } from "../config/fileConstants.js";

/*
  Photos are saved straight in public/uploads with a random name, and
  that folder IS still served statically - see the note about why in
  config/fileConstants.js. A photo is shown on every page and the logo
  is on the login screen before anybody has logged in.
*/
const upload = createUploader(PHOTO_RULES);

export default upload;
