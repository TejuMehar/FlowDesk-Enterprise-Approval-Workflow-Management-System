/*
=========================================================================
  COMPONENT: ConfirmDialog
=========================================================================
  The little "Are you sure?" box we show before deleting something.

  We use it instead of the browser's window.confirm(), because that one
  looks different in every browser and cannot be styled.
=========================================================================
*/

import { ClipLoader } from "react-spinners";
import { MdWarning } from "react-icons/md";

import useEscapeKey from "../CustomHooks/useEscapeKey.js";

function ConfirmDialog({
  isOpen,
  title = "Are you sure?",
  message,
  confirmText = "Yes, continue",
  cancelText = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}) {
  /*
    ESCAPE CANCELS, and only cancels.

    <Modal> also closes on a click outside; this one deliberately does
    not. Every ConfirmDialog in FlowDesk is guarding something that
    cannot be undone - a deleted draft, a removed employee, a hundred
    cleared notifications - and a stray click on the dark area is far
    too easy to make. Escape is a deliberate keypress; a misplaced
    click is not.

    It is also ignored while the action is running, so Escape cannot
    close the box out from under a delete that is already in flight and
    leave the user unsure whether it happened.
  */
  useEscapeKey(isOpen && !loading, onCancel);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      {/*
        max-h-full for the same reason Modal.jsx has it: a centred box
        taller than the screen loses its top edge, and no amount of
        scrolling brings it back. This box is small, but a long message
        on a phone held sideways is enough to push the buttons off.
      */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="bg-white w-full max-w-md max-h-full overflow-y-auto rounded-2xl shadow-xl p-6"
      >
        <div className="flex gap-4">
          <div className="w-11 h-11 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <MdWarning size={24} />
          </div>

          <div>
            <h3
              id="confirm-title"
              className="text-lg font-semibold text-slate-800"
            >
              {title}
            </h3>
            <p className="text-sm text-slate-600 mt-1">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {cancelText}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-60 flex items-center justify-center min-w-[120px]"
          >
            {loading ? <ClipLoader size={18} color="white" /> : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
