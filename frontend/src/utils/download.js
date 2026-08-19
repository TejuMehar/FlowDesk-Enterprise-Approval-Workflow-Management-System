/*
=========================================================================
  SAVING A FILE THAT NEEDED A SESSION TO FETCH
=========================================================================
  Four places in FlowDesk hand the user a file: the audit log CSV, the
  six report exports, the four attendance exports, and an attachment on
  a request. All four were writing out the same eight lines, and one of
  them was doing it a completely different way.

  WHY A PLAIN <a href> OR window.open DOES NOT WORK HERE
  ------------------------------------------------------
  Two reasons, and the second one is the one that was actually biting.

  1. The cookie. The file lives on the API origin, not on the origin the
     app is served from, and a browser will not attach our httpOnly
     cookie to every kind of cross-origin request.

  2. THE ACCESS TOKEN EXPIRES AFTER FIFTEEN MINUTES. Everything else in
     the app rides through utils/api.js, whose interceptor quietly
     refreshes the token and repeats the request - the user never
     notices. A window.open goes around all of that. So the download
     worked perfectly for the first fifteen minutes of a session and
     then, with no warning and no error on the page, opened a blank tab
     containing the raw text {"message":"Access token expired"}.

     That is a bad failure: it looks like the export is broken rather
     than like the session needed a nudge, and pressing the button
     again does exactly the same thing, because nothing in that flow
     ever calls /refresh.

  So the bytes are fetched through the shared axios instance like any
  other call, and handed to the browser as a blob.

  WHY THE REVOKE IS DEFERRED
  --------------------------
  revokeObjectURL immediately after link.click() is a coin flip. The
  click only QUEUES the download; Firefox in particular can still be
  reading the blob when the URL is pulled out from under it, and the
  save fails silently. A tick later is enough, and the memory is still
  handed back.
=========================================================================
*/

import { api, getErrorMessage } from "./api.js";

/*
  Hands a blob to the browser as a saved file.

  @param {Blob}   blob     the bytes
  @param {string} fileName what to call it on disk
*/
export const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  /*
    `download` is what makes the browser SAVE the file rather than
    navigate to the blob and try to display it. The server says so in
    its Content-Disposition header as well - both, because either one
    alone can be defeated by a browser setting.
  */
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  link.remove();

  // see the note above: not on this tick
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/*
  Fetches a file from the API and saves it.

  Throws on failure, with the message the SERVER meant to send. That
  last part needs the small dance below: we asked axios for a blob, so
  an error arrives as a blob too, and getErrorMessage() would find no
  .message on it and fall back to something unhelpful like "Request
  failed with status code 403". Reading the body back as text is what
  turns it into the sentence a person can act on.

  @param {string} url      the API path, query string included
  @param {string} fileName what to call it on disk
*/
export const downloadFile = async (url, fileName) => {
  try {
    const result = await api.get(url, { responseType: "blob" });

    saveBlob(result.data, fileName);
  } catch (error) {
    let message = getErrorMessage(error);

    if (error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        message = JSON.parse(text).message || message;
      } catch {
        // it was not JSON after all - keep the generic message
      }
    }

    throw new Error(message);
  }
};

/*
  "flowdesk-audit-2026-08-02.csv"

  The date is the LOCAL one, for the same reason toInputDate() in
  config.js reads local: an export taken at 9am in Mumbai should not be
  filed under yesterday because UTC has not caught up yet.
*/
export const stampedFileName = (parts, extension) => {
  const now = new Date();

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  return `${["flowdesk", ...parts, stamp].join("-")}.${extension}`;
};
