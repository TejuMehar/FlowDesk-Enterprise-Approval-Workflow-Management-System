/*
=========================================================================
  COMPONENT: PermissionRoute   (Role Based Navigation)
=========================================================================
  The second guard. ProtectedRoute asked "are you logged in?",
  this one asks "are you allowed to see this page?".

      <PermissionRoute permission="user:read">
        <Users />
      </PermissionRoute>

  Somebody without the permission is sent to /unauthorized instead of
  seeing an empty page full of errors.

  REMEMBER: this is only for a nicer experience. The real protection is
  in the backend (middleware/checkPermission.js).
=========================================================================
*/

import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

import { hasPermission } from "../utils/permissions.js";

function PermissionRoute({ permission, children }) {
  const { userData } = useSelector((state) => state.user);

  if (!hasPermission(userData, permission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}

export default PermissionRoute;
