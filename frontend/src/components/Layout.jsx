/*
=========================================================================
  COMPONENT: Layout
=========================================================================
  The frame that every private page sits inside:

      +----------+---------------------------+
      |          |          Navbar           |
      | Sidebar  +---------------------------+
      |          |    <Outlet />  = the page  |
      +----------+---------------------------+

  <Outlet /> is a react-router component. It is the hole where the
  current child route (Dashboard, Users, Roles ...) is drawn.
=========================================================================
*/

import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import Sidebar from "./Sidebar.jsx";
import Navbar from "./Navbar.jsx";

function Layout() {
  // is the mobile menu open? (ignored on big screens)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const location = useLocation();

  /*
    WHY THE SCROLL HAS TO BE RESET BY HAND HERE.

    In an ordinary page the browser does this for you, because the
    thing that scrolls is the window. In this layout it is not: the
    window never scrolls at all (h-screen + overflow-hidden), and the
    scrollbar the user is dragging belongs to the <main> below.

    react-router knows nothing about that element, so it had no way to
    reset it - and it did not. Scrolling to the bottom of a hundred
    audit entries and then clicking Dashboard in the sidebar drew the
    dashboard already scrolled past its own welcome card, with the page
    apparently starting half way down. It looked like a rendering bug
    and it was really just a scroll position nobody had moved.
  */
  const mainRef = useRef(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar onMenuClick={() => setIsSidebarOpen(true)} />

        {/* the page itself. overflow-y-auto lets long pages scroll */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
