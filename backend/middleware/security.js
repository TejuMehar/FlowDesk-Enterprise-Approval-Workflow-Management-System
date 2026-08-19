/*
=========================================================================
  MIDDLEWARE: security     ->  headers + cleaning what comes in
=========================================================================
  Module 10 - Security.

  Two small middlewares that run before every route in FlowDesk:

    securityHeaders   what a browser may do with our answers
    sanitizeRequest   what mongoose is allowed to be handed

  Neither of them knows anything about FlowDesk. That is deliberate:
  they are the outer wall, and a wall that has to understand the
  building has already lost.
=========================================================================
*/

import {
  SECURITY_HEADERS,
  HSTS_HEADER,
} from "../config/securityConstants.js";

/* =====================================================================
   1) SECURITY HEADERS
   ---------------------------------------------------------------------
   Sets the short list from config/securityConstants.js, where each one
   is written out with the reason it is there.

   A value of null means REMOVE the header instead of setting it, which
   is how X-Powered-By stops announcing that this is Express.
   ===================================================================== */
export const securityHeaders = (req, res, next) => {
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (value === null) {
      res.removeHeader(name);
    } else {
      res.setHeader(name, value);
    }
  });

  /*
    HSTS only in production - see the warning in securityConstants.js.
    A browser told this on localhost will refuse plain http there for
    two years, and there is no way to take it back.
  */
  if (process.env.NODE_ENV === "production") {
    res.setHeader(HSTS_HEADER.name, HSTS_HEADER.value);
  }

  next();
};

/* =====================================================================
   2) SANITISE WHAT COMES IN     (NoSQL injection)
   ---------------------------------------------------------------------
   THE ATTACK THIS STOPS, IN ONE EXAMPLE.

   authController does:

       const user = await User.findOne({ email });

   and `email` comes from req.body. Everybody reads that as "find the
   user with this email address", because everybody pictures a STRING
   arriving. But the body is JSON, and JSON can carry an object:

       { "email": { "$ne": null }, "password": "anything" }

   Now the query mongoose builds is  { email: { $ne: null } }  - "find
   any user whose email is not null" - and it happily returns the first
   account in the collection. The password check that follows is the
   only thing between that and a login as somebody else.

   Every $-prefixed key is a mongodb OPERATOR, so the fix is to refuse
   them where they cannot possibly be meant: in user input. A key
   containing a dot goes too, because "role.permissions" is how a write
   reaches INTO a document it was not given.

   This is the standard job of the express-mongo-sanitize package,
   written out here for the same reason the rate limiter is - it is
   thirty lines, and thirty lines that are read are worth more than a
   dependency that is trusted.

   WHAT IT IS NOT
   --------------
   It is not a replacement for validating input. A string is still
   checked for being a real email, a real ObjectId, a real amount - by
   config/validation.js and by the mongoose schemas. This only
   guarantees that what arrives IS a string rather than an instruction.
   ===================================================================== */

/*
  Walks an object (or array) and deletes every dangerous key.

  Recursive because a body can be nested - a workflow's stages arrive
  as an array of objects, each with its own arrays - and an operator
  smuggled three levels down is just as effective as one at the top.

  `depth` stops a hand-written body with a thousand levels of nesting
  from being a way to blow the call stack.
*/
const stripOperators = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 10) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => stripOperators(item, depth + 1));
    return;
  }

  Object.keys(value).forEach((key) => {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
      return;
    }

    stripOperators(value[key], depth + 1);
  });
};

export const sanitizeRequest = (req, res, next) => {
  try {
    /*
      The three places user input arrives. req.params is included even
      though express builds it from the URL, because a route pattern
      like /:id can still hand us anything between two slashes.

      Each is cleaned IN PLACE rather than replaced. Assigning a new
      object to req.query works in express 4 and throws in express 5,
      where it became a getter - deleting keys works in both, and this
      is exactly the kind of line nobody wants to debug during an
      upgrade.
    */
    stripOperators(req.body);
    stripOperators(req.query);
    stripOperators(req.params);

    next();
  } catch (error) {
    /*
      Same reasoning as the rate limiter: this sits in front of the
      whole application, so a bug in it must not become an outage. A
      body that could not be cleaned is refused rather than passed on,
      though - the opposite choice from the limiter, because here
      letting it through is the dangerous direction.
    */
    console.error(`Sanitize Request Error ${error}`);
    return res.status(400).json({ message: "That request could not be read" });
  }
};
