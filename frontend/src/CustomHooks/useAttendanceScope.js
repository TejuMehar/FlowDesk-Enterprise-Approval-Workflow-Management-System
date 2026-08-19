/*
=========================================================================
  HOOK: useAttendanceScope       (Module 11 - Attendance Management)
=========================================================================
  "Does this person have anybody else's attendance to look at?"

  The Sidebar needs the answer to decide whether to draw the Team
  Attendance link, and it is the one question in FlowDesk's navigation
  that a permission cannot answer.

  WHY NOT JUST CHECK A PERMISSION, LIKE EVERY OTHER MENU ITEM
  -----------------------------------------------------------
  Because the person the team page was BUILT for does not hold one. A
  department manager sees their department because a Department
  document points at them - a fact about the data, not a grant (see
  backend/config/attendanceScope.js) - and the browser has no way to
  know which departments point at the logged in user.

  Guessing with a permission would get it wrong in both directions: it
  would hide the link from the manager who needs it, and show it to
  somebody whose board would have one row on it.

  So the backend is asked once, and it answers with the scope it
  resolved. GET /api/attendance/options is a tiny call - a few dropdown
  lists and four booleans - and this is the same endpoint the Team
  Attendance page itself opens with.

  THE ANSWER IS CACHED FOR THE SESSION
  ------------------------------------
  The Sidebar is mounted on every single page, so without a cache this
  would fire on every navigation. The cache is keyed by user id, which
  means logging out and back in as somebody else asks again - a stale
  "you manage a department" left over from the previous session is
  exactly the bug a plain module-level flag would cause.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../utils/api.js";

/*
  { userId, promise } - the request in flight or already finished.

  A PROMISE and not a value, so twenty components mounting at once
  share one request instead of starting twenty.
*/
let cache = null;

const fetchScope = (userId) => {
  if (cache && cache.userId === userId) {
    return cache.promise;
  }

  cache = {
    userId,
    promise: api
      .get("/api/attendance/options")
      .then((response) => response.data)
      /*
        A failure answers "own" rather than throwing. The worst case is
        a menu item that does not appear for somebody who could have
        used it - which is a great deal better than a sidebar that
        crashes because one endpoint was slow.
      */
      .catch(() => ({ scope: { level: "own", label: "" }, can: {} })),
  };

  return cache.promise;
};

function useAttendanceScope() {
  const { userData } = useSelector((state) => state.user);

  const [scope, setScope] = useState(null);

  useEffect(() => {
    if (!userData?._id) {
      setScope(null);
      return undefined;
    }

    let alive = true;

    fetchScope(userData._id).then((answer) => {
      if (alive) {
        setScope(answer);
      }
    });

    // a component that unmounts mid-flight must not set state afterwards
    return () => {
      alive = false;
    };
  }, [userData?._id]);

  return {
    scope,
    // the one question the Sidebar actually asks
    seesOtherPeople: scope ? scope.scope.level !== "own" : false,
  };
}

export default useAttendanceScope;
