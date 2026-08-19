/*
=========================================================================
  MIDDLEWARE: checkPermission   ->  "Are you ALLOWED to do this?"
=========================================================================
  isAuth answered "who are you".
  This file answers "are you allowed".

  It must always run AFTER isAuth, because it needs req.user.

  HOW WE USE IT IN A ROUTE FILE:

      router.post(
        "/create",
        isAuth,                                 // 1. must be logged in
        checkPermission(PERMISSIONS.USER_CREATE), // 2. must be allowed
        createUser                              // 3. run the controller
      );
=========================================================================
*/

/*
  Allows the request only if the user's role has ALL the listed
  permissions.

  Notice this is a function that RETURNS a middleware. That little trick
  is what lets us "configure" it when we write the route.
*/
export const checkPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    try {
      // isAuth must run before this
      if (!req.user) {
        return res.status(401).json({ message: "You are not logged in" });
      }

      /*
        req.user.role was populated inside isAuth, so it is the full role
        object: { _id, name, permissions: [ ... ] }
      */
      const userPermissions = req.user.role?.permissions || [];

      // .every() is true only when EVERY required permission is present
      const isAllowed = requiredPermissions.every((permission) =>
        userPermissions.includes(permission)
      );

      if (!isAllowed) {
        return res.status(403).json({
          message: "You do not have permission to perform this action",
        });
      }

      next();
    } catch (error) {
      return res
        .status(500)
        .json({ message: `checkPermission Error ${error}` });
    }
  };
};

/*
  A looser version: allows the request when the user has AT LEAST ONE of
  the listed permissions.
*/
export const checkAnyPermission = (...allowedPermissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "You are not logged in" });
      }

      const userPermissions = req.user.role?.permissions || [];

      // .some() is true when at least one matches
      const isAllowed = allowedPermissions.some((permission) =>
        userPermissions.includes(permission)
      );

      if (!isAllowed) {
        return res.status(403).json({
          message: "You do not have permission to perform this action",
        });
      }

      next();
    } catch (error) {
      return res
        .status(500)
        .json({ message: `checkAnyPermission Error ${error}` });
    }
  };
};

/*
  Checks by ROLE NAME instead of by permission.
  Used for very sensitive actions, e.g. only a "Super Admin" may delete
  a role.
*/
export const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "You are not logged in" });
      }

      const currentRole = req.user.role?.name;

      if (!allowedRoles.includes(currentRole)) {
        return res.status(403).json({
          message: `This action is only for: ${allowedRoles.join(", ")}`,
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: `checkRole Error ${error}` });
    }
  };
};

export default checkPermission;
