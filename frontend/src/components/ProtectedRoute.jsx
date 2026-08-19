/*
=========================================================================
  COMPONENT: ProtectedRoute
=========================================================================
  A small "guard" we wrap around private pages.

      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>

  If nobody is logged in it sends the visitor to /login.
  If somebody IS logged in it simply shows the children.
=========================================================================
*/

import { Navigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

function ProtectedRoute({ children }) {
  const { userData } = useSelector((state) => state.user);

  // where the user wanted to go
  const location = useLocation();

  if (!userData) {
    /*
      "replace" swaps the current entry in the browser history, so the
      back button does not bounce the user between the two pages.

      In "state" we remember the page they wanted, so after a successful
      login we can send them straight there.
    */
    /*
      The SEARCH is part of where they were going. A link to
      /search?q=INV-2043 that dropped its query string on the way
      through the login page would land them on an empty search box,
      which looks like the link was broken.
    */
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return children;
}

export default ProtectedRoute;
