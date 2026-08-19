/*
=========================================================================
  COMPONENT: Navbar
=========================================================================
  The bar at the top. It shows:
    - the hamburger button (only on small screens)
    - the date and the running time, in the COMPANY's timezone
      (see TopbarClock.jsx for why that is not the browser's)
    - the notification bell with its unread badge (Module 6)
    - the name of the logged in user with their photo
    - a small dropdown with "My Profile" and "Logout"
=========================================================================
*/

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { MdMenu, MdPerson, MdLogout, MdLock } from "react-icons/md";

import { getPhotoUrl } from "../utils/config.js";
// the same logout the Sidebar uses - it used to be written out twice
import useLogout from "../CustomHooks/useLogout.js";
import NotificationBell from "./NotificationBell.jsx";
import TopbarClock from "./TopbarClock.jsx";

function Navbar({ onMenuClick }) {
  const { userData } = useSelector((state) => state.user);
  const navigate = useNavigate();

  const { logout, loggingOut } = useLogout();

  // is the little dropdown open?
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  /*
    useRef gives us a direct link to the HTML element.
    We use it to find out whether a click happened INSIDE the dropdown.
  */
  const menuRef = useRef(null);

  /*
    Close the dropdown when the user clicks anywhere else on the page.
    The "return" function inside useEffect is the CLEANUP: React runs it
    when the component disappears, so we do not leave listeners behind.
  */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const photo = getPhotoUrl(userData?.photoUrl);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* ---------- left: hamburger (mobile only), then the clock ----------
          The clock fills what used to be an empty spacer div, so the
          user menu still sits on the right at every width. It hides
          itself on the narrowest screens rather than fighting the
          hamburger for the room - see TopbarClock.jsx. */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden text-slate-600 hover:text-slate-900"
        >
          <MdMenu size={24} />
        </button>

        <TopbarClock />
      </div>

      {/* ---------- right: the bell and the user menu ---------- */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/*
          The bell needs no permission - it only ever shows what was sent
          to THIS user, so it is drawn for everybody who is logged in.
        */}
        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((previous) => !previous)}
            className="flex items-center gap-3 hover:bg-slate-100 rounded-lg px-2 py-1.5 transition-colors"
          >
            {/* the photo, or the first letter when there is none */}
            {photo ? (
              <img
                src={photo}
                alt="profile"
                className="w-9 h-9 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-semibold border border-slate-200">
                {userData?.firstName?.charAt(0).toUpperCase() || "U"}
              </div>
            )}

            <div className="text-left hidden sm:block">
              <div className="text-sm font-medium text-slate-800 leading-tight">
                {userData?.fullName}
              </div>
              <div className="text-xs text-slate-500">
                {userData?.role?.name}
              </div>
            </div>
          </button>

          {/* the dropdown - only in the page when it is open */}
          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {userData?.fullName}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {userData?.email}
                </p>
              </div>

              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  navigate("/profile");
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <MdPerson size={18} /> My Profile
              </button>

              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  navigate("/change-password");
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <MdLock size={18} /> Change Password
              </button>

              <button
                onClick={logout}
                disabled={loggingOut}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                <MdLogout size={18} />
                {loggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
