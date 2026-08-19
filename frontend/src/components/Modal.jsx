/*
=========================================================================
  COMPONENT: Modal
=========================================================================
  A reusable pop-up window. We use it for every "Add" and "Edit" form,
  so we do not repeat the same grey background and white box everywhere.

  HOW TO USE IT:

      <Modal isOpen={showForm} title="Add User" onClose={close}>
         ...your form...
      </Modal>

  Everything you put between <Modal> and </Modal> arrives here as the
  special prop called "children".

  ---------------------------------------------------------------------
  THE THREE THINGS A POP-UP HAS TO DO THAT THIS ONE DID NOT
  ---------------------------------------------------------------------
  There is one Modal and fifteen places that open it, so anything
  missing here was missing fifteen times over.

  ESCAPE CLOSES IT. Every dialog a person has ever used closes on
  Escape, so they press it, nothing happens, and they hunt for the X.
  Twelve of these pop-ups are forms somebody opened by mistake.

  CLICKING THE DARK BACKGROUND CLOSES IT, for the same reason: the grey
  area around a dialog reads as "outside", and clicking outside is the
  other thing everybody tries. The click is checked against the target
  rather than trusted from a wrapper, so a click that STARTED inside
  the white box and drifted out - which is what selecting a line of
  text does - is not mistaken for wanting out.

  THE PAGE BEHIND IT STOPS SCROLLING. Without this, a scroll gesture
  over the dark area scrolls the table underneath, so a user closing a
  request pop-up finds the list has moved and their row is gone. The
  scrollbar it removes is replaced by padding of the same width, or
  the whole page jumps sideways as the modal opens.

  It also announces itself properly to a screen reader now
  (role="dialog", aria-modal, and a title the dialog is labelled by),
  and the close button has a name - it used to be an icon with no text
  in it at all, which is read aloud as just "button".

  ---------------------------------------------------------------------
  WHY THE TALL POP-UPS HAD NO CLOSE BUTTON
  ---------------------------------------------------------------------
  The dark backdrop used to be the thing that scrolled: a flex box that
  CENTRED the white card and carried overflow-y-auto for when the card
  did not fit.

  Those two do not work together. A flex item that is taller than a
  centred container overflows it by the same amount at the TOP and the
  bottom, and a scroll region only ever extends downwards - the browser
  gives you no way to reach what is above the start of the box. So the
  first few hundred pixels of a tall pop-up were simply gone, and the
  header lives there. On /team-attendance, where opening an employee
  draws summary cards, a calendar and a month of rows, that meant a
  dialog with its title and its X cut off the top of the screen and no
  amount of scrolling would bring them back. Escape still closed it,
  but nothing on the screen said so.

  So the card is now capped at the height of the screen and split in
  two: a header that does not move and a body that scrolls inside it.
  The X is on screen for every pop-up in the app no matter how long its
  contents are, and the scrollbar belongs to the part that is actually
  too long. overscroll-contain keeps a flick at the end of that body
  from carrying on into the page behind it.
=========================================================================
*/

import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";

import useEscapeKey from "../CustomHooks/useEscapeKey.js";

function Modal({ isOpen, title, onClose, children, maxWidth = "max-w-2xl" }) {
  /*
    Where the mouse went DOWN. See the note above: a backdrop click is
    only a backdrop click when it both started and ended there.
  */
  const pressedOnBackdrop = useRef(false);

  /*
    ESCAPE CLOSES IT - but only when this is the pop-up on top.

    A file preview and a delete confirmation both open OVER this one,
    and all three would otherwise hear the same keypress and close
    together. useEscapeKey keeps them in a stack; see the note there.
  */
  useEscapeKey(isOpen, onClose);

  /* ---------------- the page behind it stops scrolling ---------------- */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const { body } = document;

    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    /*
      Hiding the scrollbar makes the page wider by exactly its width,
      and everything shifts right as the modal opens. Padding the body
      by the same amount holds it still.
    */
    const scrollbarWidth = window.innerWidth - body.clientWidth;

    body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [isOpen]);

  // when it is closed we return null, which means "draw nothing"
  if (!isOpen) {
    return null;
  }

  return (
    // the dark background that covers the page
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onMouseUp={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) {
          onClose?.();
        }

        pressedOnBackdrop.current = false;
      }}
    >
      {/* the white box */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`bg-white w-full ${maxWidth} max-h-full rounded-2xl shadow-xl flex flex-col`}
      >
        {/* ---------- header - never scrolls away ---------- */}
        <div className="flex items-center justify-between gap-4 shrink-0 px-6 py-4 border-b border-slate-200">
          <h2
            id="modal-title"
            className="text-lg font-semibold text-slate-800"
          >
            {title}
          </h2>

          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
            type="button"
          >
            <MdClose size={22} />
          </button>
        </div>

        {/*
          ---------- body - the part that scrolls ----------
          min-h-0 is what lets it: a flex item refuses to shrink below
          its own contents without it, which would push the card past
          the bottom of the screen again.
        */}
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
