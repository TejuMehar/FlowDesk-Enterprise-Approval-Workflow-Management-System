/*
=========================================================================
  COMPONENT: FilePreview      (Module 10 - File Management)
=========================================================================
  Shows one attachment without leaving the page: an image in an <img>,
  a PDF in an <iframe>.

  WHY THIS IS NOT SIMPLY  <img src={fileUrl} />
  ---------------------------------------------
  That is what the old code did, and it worked only because the files
  were public. Since Module 10 an attachment is served by a route that
  checks who is asking, and a browser will NOT attach our httpOnly
  cookie to an <img> or an <iframe> pointing at a different origin
  (localhost:5173 asking localhost:8000). The picture would arrive as a
  401 and draw as a broken icon.

  So the file is FETCHED like any other API call - through the same
  axios instance, which carries the cookie and knows how to refresh an
  expired token - and the bytes that come back are turned into a
  temporary address the browser is happy to draw:

      responseType: "blob"  ->  URL.createObjectURL(blob)  ->  blob:...

  A blob URL belongs to this tab and this page. It cannot be shared,
  it dies when the tab is closed, and - importantly - it is revoked
  below the moment the pop-up closes.

  THE CLEANUP IS NOT OPTIONAL. Every createObjectURL holds its blob in
  memory until revokeObjectURL is called; a user flipping through
  fifteen scanned invoices without it is fifteen files the tab never
  lets go of.
=========================================================================
*/

import { useEffect, useState } from "react";
import { ClipLoader } from "react-spinners";
import { MdClose, MdDownload, MdErrorOutline } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import useEscapeKey from "../CustomHooks/useEscapeKey.js";
import {
  describeFile,
  formatFileSize,
  attachmentUrl,
  FILE_KINDS,
} from "../utils/fileConstants.js";

function FilePreview({ requestId, attachment, onClose, onDownload }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { kind } = describeFile(attachment?.fileName);

  /*
    Escape closes the preview, the same as <Modal>. It matters more
    here than anywhere else in the app: this thing covers the ENTIRE
    screen with a black sheet, so a user who cannot find the small X in
    the corner has nothing else to try.

    It is nearly always drawn OVER an open <Modal> - the request
    pop-up the attachment belongs to - so it goes on the same stack,
    or one press of Escape would shut both and take the request off
    the screen along with the picture.
  */
  useEscapeKey(true, onClose);

  useEffect(() => {
    /*
      "cancelled" is the guard against a race that is easy to miss: the
      user opens a 4 MB scan and closes the pop-up while it is still
      arriving. Without it, the fetch finishes afterwards and calls
      setState on a component that is gone - and creates a blob URL that
      nothing will ever revoke.
    */
    let cancelled = false;
    let createdUrl = "";

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const result = await api.get(
          attachmentUrl(requestId, attachment._id),
          { responseType: "blob" }
        );

        if (cancelled) {
          return;
        }

        createdUrl = URL.createObjectURL(result.data);
        setBlobUrl(createdUrl);
      } catch (fetchError) {
        if (!cancelled) {
          /*
            The backend answers a blob, so an ERROR also arrives as a
            blob - and getErrorMessage() would find no .message on it
            and fall back to something unhelpful. Reading it back as
            text is what turns it into the sentence the server meant to
            say, for example "This file is no longer on the server".
          */
          let message = getErrorMessage(fetchError);

          try {
            const body = await fetchError?.response?.data?.text?.();
            if (body) {
              message = JSON.parse(body).message || message;
            }
          } catch {
            // the body was not JSON - keep the fallback message
          }

          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    /*
      React runs this when the pop-up closes (or the file changes).
      Both halves matter: the flag stops a late answer from touching a
      dead component, and revokeObjectURL hands the memory back.
    */
    return () => {
      cancelled = true;

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [requestId, attachment?._id]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex flex-col p-4 sm:p-8">
      {/* ---------- header ---------- */}
      <div className="flex items-center justify-between gap-4 mb-3 text-white">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{attachment?.fileName}</p>
          <p className="text-xs text-white/60">
            {formatFileSize(attachment?.fileSize)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onDownload(attachment)}
            className="h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium flex items-center gap-1.5 transition-colors"
          >
            <MdDownload size={17} /> Download
          </button>

          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
          >
            <MdClose size={20} />
          </button>
        </div>
      </div>

      {/* ---------- the file itself ---------- */}
      <div className="flex-1 min-h-0 bg-white rounded-xl overflow-hidden flex items-center justify-center">
        {loading && <ClipLoader size={30} color="#4f46e5" />}

        {!loading && error && (
          <div className="text-center px-6">
            <MdErrorOutline size={34} className="text-rose-500 mx-auto mb-2" />
            <p className="text-sm text-slate-600">{error}</p>
          </div>
        )}

        {!loading && !error && blobUrl && kind === FILE_KINDS.IMAGE && (
          <img
            src={blobUrl}
            alt={attachment.fileName}
            className="max-h-full max-w-full object-contain"
          />
        )}

        {!loading && !error && blobUrl && kind === FILE_KINDS.PDF && (
          <iframe
            src={blobUrl}
            title={attachment.fileName}
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );
}

export default FilePreview;
