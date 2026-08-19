/*
=========================================================================
  COMPONENT: AttachmentList     (Module 10 - File Management)
=========================================================================
  The list of files on a request, with what you can do to each one:

      Preview   images and PDFs, in a pop-up over the page
      Download  everything, saved to disk
      Delete    only your own, and only while the request is still
                yours to change

  IT IS ONE COMPONENT BECAUSE THERE ARE TWO PLACES, and they must not
  drift apart. The employee sees this list inside their own request
  (pages/Requests.jsx) and the approver sees the same files inside the
  decision pop-up (pages/Approvals.jsx). Before Module 10 those were
  two nearly-identical blocks of JSX, and only one of them was ever
  updated when anything changed.

  WHAT THIS COMPONENT DOES NOT DECIDE
  -----------------------------------
  Whether the Delete button appears is passed IN as `canDelete`, and
  the backend checks it again anyway. The approver's copy simply never
  passes it - not because approvers are less trusted, but because a
  document an approver could quietly remove is a document the next
  approver decides without ever knowing existed.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdImage,
  MdPictureAsPdf,
  MdDescription,
  MdTableChart,
  MdInsertDriveFile,
  MdVisibility,
  MdDownload,
  MdDeleteOutline,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { downloadFile } from "../utils/download.js";
import {
  describeFile,
  formatFileSize,
  attachmentDownloadUrl,
  FILE_KINDS,
} from "../utils/fileConstants.js";
import FilePreview from "./FilePreview.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

/*
  A different icon per kind of file, so a list of five attachments can
  be read at a glance instead of by reading five file names.
*/
const iconFor = (kind) => {
  if (kind === FILE_KINDS.IMAGE) return <MdImage size={17} />;
  if (kind === FILE_KINDS.PDF) return <MdPictureAsPdf size={17} />;
  if (kind === FILE_KINDS.SPREADSHEET) return <MdTableChart size={17} />;
  if (kind === FILE_KINDS.DOCUMENT) return <MdDescription size={17} />;
  return <MdInsertDriveFile size={17} />;
};

function AttachmentList({ requestId, attachments = [], canDelete = false, onChanged }) {
  const [previewTarget, setPreviewTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");

  /* =================================================================
     DOWNLOAD
     -----------------------------------------------------------------
     A download cannot be a plain <a href> for the same reason the
     preview cannot be a plain <img src>: the browser would not send
     our httpOnly cookie to another origin, and the file would come
     back 401.

     So the bytes are fetched through axios and handed to the browser
     as a blob. That whole dance lives in utils/download.js now, shared
     with the three export buttons - and moving it there fixed a real
     bug on the way: this used to call revokeObjectURL on the line
     immediately after link.click(), which is a race. The click only
     QUEUES the save, and Firefox can still be reading the blob when
     the URL is pulled out from under it, so the download quietly
     produced nothing at all.
     ================================================================= */
  const handleDownload = async (attachment) => {
    setDownloadingId(attachment._id);

    try {
      await downloadFile(
        attachmentDownloadUrl(requestId, attachment._id),
        attachment.fileName
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloadingId("");
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(
        `/api/file/request/${requestId}/${deleteTarget._id}`
      );

      toast.success(result.data.message);
      setDeleteTarget(null);

      /*
        The backend answers with the WHOLE updated request, so the page
        above can replace what it is showing instead of guessing what
        the list looks like now. Same pattern as the upload.
      */
      onChanged?.(result.data.request);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  if (attachments.length === 0) {
    return <p className="text-sm text-slate-400">No files attached yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {attachments.map((attachment) => {
          const { kind, isPreviewable } = describeFile(attachment.fileName);

          return (
            <li
              key={attachment._id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300 transition-colors"
            >
              <span className="text-slate-400 shrink-0">{iconFor(kind)}</span>

              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700 truncate">
                  {attachment.fileName}
                </p>
                <p className="text-xs text-slate-400">
                  {formatFileSize(attachment.fileSize)}
                </p>
              </div>

              {/* ---- preview: only for the files that really have one ---- */}
              {isPreviewable && (
                <button
                  type="button"
                  onClick={() => setPreviewTarget(attachment)}
                  title="Preview"
                  className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center transition-colors"
                >
                  <MdVisibility size={17} />
                </button>
              )}

              <button
                type="button"
                onClick={() => handleDownload(attachment)}
                disabled={downloadingId === attachment._id}
                title="Download"
                className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                {downloadingId === attachment._id ? (
                  <ClipLoader size={14} color="#4f46e5" />
                ) : (
                  <MdDownload size={17} />
                )}
              </button>

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(attachment)}
                  title="Remove"
                  className="h-8 w-8 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-colors"
                >
                  <MdDeleteOutline size={17} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {previewTarget && (
        <FilePreview
          requestId={requestId}
          attachment={previewTarget}
          onClose={() => setPreviewTarget(null)}
          onDownload={handleDownload}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Remove this file?"
        message={`"${deleteTarget?.fileName}" will be deleted from the request. This cannot be undone.`}
        confirmText="Remove"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default AttachmentList;
