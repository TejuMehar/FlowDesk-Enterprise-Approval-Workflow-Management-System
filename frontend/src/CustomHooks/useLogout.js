/*
=========================================================================
  CUSTOM HOOK: useLogout
=========================================================================
  Logging out was written out twice - once in the Navbar and once in the
  Sidebar - and the two copies had already started to differ. Neither of
  them did the two things below.

  IT CANNOT BE PRESSED TWICE. Nothing disabled the button while the
  request was running, so an impatient second click posted a second
  /logout with cookies the first one had already cleared, and the user
  was shown a red "Not authorized" toast on their way out - which reads
  as the logout having failed, when in fact it had just succeeded.

  IT EMPTIES THE CACHES. Two module-level caches outlive a logout,
  because they are plain variables and not React state - that is the
  whole point of them. But the next person to log in on the same
  computer would then be handed the previous person's answers: the
  company branding (harmless) and the request types (mostly harmless),
  and, before it was keyed by user id, the previous employee's
  attendance scope, which decided whether "Team Attendance" appeared in
  their menu.

  A shared browser is the normal case in an office. The session ends
  here, so the caches end here.
=========================================================================
*/

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";

import { api, getErrorMessage } from "../utils/api.js";
import { setUserData } from "../redux/userSlice.js";
import { clearCompanyCache } from "./useCompanySettings.js";
import { clearRequestTypeCache } from "./useRequestTypes.js";

const useLogout = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [loggingOut, setLoggingOut] = useState(false);

  // a ref, not the state above: see the note in useMyAttendance
  const inFlight = useRef(false);

  const logout = useCallback(async () => {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setLoggingOut(true);

    try {
      // the backend revokes the refresh token and clears the cookies
      await api.post("/api/auth/logout");

      toast.success("Logged out successfully");
    } catch (error) {
      /*
        Even if the request fails we still log out on THIS device -
        otherwise a user whose network dropped is stuck inside an app
        they have asked to leave.
      */
      toast.error(getErrorMessage(error));
    } finally {
      dispatch(setUserData(null));

      clearCompanyCache();
      clearRequestTypeCache();

      navigate("/login", { replace: true });

      inFlight.current = false;
      setLoggingOut(false);
    }
  }, [dispatch, navigate]);

  return { logout, loggingOut };
};

export default useLogout;
