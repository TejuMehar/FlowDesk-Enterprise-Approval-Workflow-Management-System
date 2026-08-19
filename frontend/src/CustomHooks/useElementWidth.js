/*
=========================================================================
  HOOK: useElementWidth
=========================================================================
  Tells a component how wide it actually is on screen, right now.

  WHY A CHART NEEDS THIS
  ----------------------
  An SVG can be stretched to fit its box, but stretching also stretches
  the TEXT: on a phone the month names would be squashed to 8px and on a
  wide screen they would balloon. So instead of stretching, we measure
  the box and draw the chart at exactly that many pixels - the bars move,
  the labels stay 11px.

  HOW IT IS USED

      const [boxRef, width] = useElementWidth();

      <div ref={boxRef}>
        {width > 0 && <svg width={width} ... />}
      </div>

  The "width > 0" is important: on the very first render nothing has been
  measured yet, and drawing a chart 0 pixels wide would divide by zero.

  ResizeObserver is a browser feature that calls us back whenever the
  element changes size - which covers window resizing, the sidebar
  opening, and the card growing because a legend wrapped onto two lines.
  A window "resize" listener would miss the last two.
=========================================================================
*/

import { useState, useEffect, useRef } from "react";

const useElementWidth = () => {
  const elementRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      // contentRect is the size INSIDE the padding, which is what we draw in
      const nextWidth = Math.round(entries[0].contentRect.width);

      /*
        Rounding to whole pixels also stops an endless loop: a fractional
        width could make the SVG a hair wider, which resizes the box,
        which calls us again.
      */
      setWidth(nextWidth);
    });

    observer.observe(element);

    // stop watching when the component leaves the screen
    return () => observer.disconnect();
  }, []);

  return [elementRef, width];
};

export default useElementWidth;
