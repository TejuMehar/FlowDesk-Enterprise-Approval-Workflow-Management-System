/*
=========================================================================
  CUSTOM HOOK: useEscapeKey
=========================================================================
  "When Escape is pressed, close the TOP layer - and only the top one."

  WHY THIS IS NOT THREE LINES IN EACH COMPONENT
  ---------------------------------------------
  Because FlowDesk stacks its pop-ups, and it does so in the normal
  course of using the app:

      the request pop-up      <Modal>
        the file preview      <FilePreview>   over the top of it
        "remove this file?"   <ConfirmDialog> over the top of that

  If each of those simply added its own keydown listener to `document`,
  one press of Escape would reach all three and close all three at
  once. The user meant to shut the confirmation and would find
  themselves back at the requests table, with the request they were
  working on gone from the screen. Worse, the order is not even the one
  you would want: listeners fire in the order they were ADDED, so the
  outermost pop-up - the one that has been open longest - closes first.

  So the handlers go on a stack instead. One listener at the bottom of
  this file, and only the last thing to open is asked to close.

  Anything that draws itself over the page should use this rather than
  its own listener, for the same reason there is only one <Modal>.
=========================================================================
*/

import { useEffect, useRef } from "react";

// the open layers, oldest first. The last one is the one on top.
const stack = [];

const handleKeyDown = (event) => {
  if (event.key !== "Escape" || stack.length === 0) {
    return;
  }

  // the layer on top is the last one that opened
  stack[stack.length - 1].current?.();
};

/*
  @param {boolean}  isActive  false while the layer is closed, so a
                              <Modal isOpen={false}> is not on the stack
  @param {function} onEscape  what to do - usually the close handler
*/
const useEscapeKey = (isActive, onEscape) => {
  /*
    WHAT GOES ON THE STACK IS A REF, NOT THE FUNCTION.

    Callers pass inline arrows - <Modal onClose={() => setTarget(null)}>
    is the shape used almost everywhere - and an inline arrow is a
    brand new function on every single render.

    If the effect depended on it, every re-render of the page behind
    the pop-up would pop that pop-up off the stack and push it back on
    the END. Which is to say: an ordinary keystroke in a form would
    quietly promote the OUTER modal above the preview sitting on top of
    it, and the next Escape would close the wrong one. The bug would
    only appear when something below happened to re-render, which is
    the worst kind to go looking for.

    A ref is one stable object for the life of the component, so the
    position in the stack is decided by when the layer OPENED - which
    is the thing we actually mean - while the function it points at
    stays up to date.
  */
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    /*
      The listener is attached when the FIRST layer opens and removed
      when the LAST one closes, so an app with nothing open is not
      listening to the keyboard at all.
    */
    if (stack.length === 0) {
      document.addEventListener("keydown", handleKeyDown);
    }

    stack.push(handlerRef);

    return () => {
      const position = stack.lastIndexOf(handlerRef);

      if (position !== -1) {
        stack.splice(position, 1);
      }

      if (stack.length === 0) {
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [isActive]);
};

export default useEscapeKey;
