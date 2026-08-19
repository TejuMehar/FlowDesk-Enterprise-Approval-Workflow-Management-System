/*
=========================================================================
  MIDDLEWARE: rateLimit    ->  "how OFTEN may you do this?"
=========================================================================
  Module 10 - Security.

  isAuth asks WHO you are.
  checkPermission asks WHETHER you may.
  This asks HOW OFTEN, and it is the only one of the three that also
  applies to people who are not logged in - which is the whole point,
  because the login route is the one worth attacking.

  HOW TO USE IT IN A ROUTE FILE

      import { authLimiter } from "../middleware/rateLimit.js";

      router.post("/login", authLimiter, login);

  ---------------------------------------------------------------------
  HOW IT WORKS: A FIXED WINDOW COUNTER
  ---------------------------------------------------------------------
  For each caller we keep two numbers: how many requests they have made,
  and when the current window ends.

      first request        -> count = 1, window ends in 15 minutes
      requests 2 to 10     -> count goes up
      request 11           -> refused, 429
      after 15 minutes     -> the window is thrown away and starts again

  BE HONEST ABOUT THE TWO LIMITS OF THIS
  --------------------------------------
  1. THE COUNTERS LIVE IN THIS PROCESS'S MEMORY. Restart the server and
     every window resets; run TWO copies of the backend behind a load
     balancer and each keeps its own count, so the real limit doubles.
     For one FlowDesk instance - which is what the deployment in
     DEPLOYMENT.md describes - that is exactly right, and it costs no
     dependency and no Redis. The day this app runs on several
     instances, the counters have to move to a shared store; the SHAPE
     of the code below does not change, only where `buckets` lives.

  2. A FIXED WINDOW ALLOWS A BURST AT THE SEAM: ten attempts in the last
     second of one window and ten in the first second of the next is
     twenty in two seconds. A sliding window fixes that and costs a list
     of timestamps per caller instead of two numbers. For "make guessing
     passwords far too slow to be worth it" the fixed window is enough -
     twenty tries per half hour is not a way in.
=========================================================================
*/

import { RATE_LIMITS, RATE_LIMIT_SWEEP_MS } from "../config/securityConstants.js";

/*
  Every window currently being counted.

      "auth:203.0.113.5:ravi@flowdesk.com" -> { count: 3, resetAt: 1712... }

  A Map rather than a plain object because the keys come from the
  outside world, and a plain object would happily accept a caller who
  decides to be called "__proto__".
*/
const buckets = new Map();

/* =====================================================================
   THE SWEEPER
   ---------------------------------------------------------------------
   Deletes windows that have already expired.

   Without it the Map grows by one entry per IP that has ever called the
   API and never shrinks - a leak that is invisible in development,
   where there is one IP, and obvious in production three weeks in.

   .unref() tells node this timer must NOT keep the process alive. It is
   the difference between "npm start" exiting when it is asked to and
   hanging forever - the same reason the reminder engine's interval in
   Module 6 is allowed to be stopped.
   ===================================================================== */
const sweeper = setInterval(() => {
  const now = Date.now();

  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
}, RATE_LIMIT_SWEEP_MS);

sweeper.unref();

/* =====================================================================
   WHO IS THIS CALLER?
   ---------------------------------------------------------------------
   The IP address, and that needs one piece of care in production.

   Behind a host like Render, Railway or a Nginx proxy, req.ip is the
   PROXY's address - the same one for every user on earth, which would
   turn a per-user limit into a global one and lock the whole company
   out after ten failed logins by anybody. The fix is not here: it is
   app.set("trust proxy", 1) in index.js, which makes express read the
   real address out of X-Forwarded-For.

   That setting is also why this file does not read the header itself:
   X-Forwarded-For is written by whoever calls us and can say anything.
   Only express, told exactly how many proxies to trust, can tell the
   part a proxy added from the part the caller invented.
   ===================================================================== */
const getClientKey = (req) => {
  return req.ip || req.socket?.remoteAddress || "unknown";
};

/* =====================================================================
   THE LIMITER FACTORY
   ---------------------------------------------------------------------
   Like checkPermission(), this is a function that RETURNS a middleware,
   which is what lets each route be configured where it is declared.

   @param name       a prefix for the key, so the auth window and the
                     upload window of the same person are separate
   @param rule       one of the tiers from config/securityConstants.js
   @param extraKey   optional: a second thing to count per, e.g. the
                     email address being tried
   ===================================================================== */
export const createRateLimiter = (name, rule, extraKey) => {
  return (req, res, next) => {
    try {
      const parts = [name, getClientKey(req)];

      if (typeof extraKey === "function") {
        const extra = extraKey(req);
        if (extra) {
          parts.push(String(extra).toLowerCase());
        }
      }

      const key = parts.join(":");
      const now = Date.now();

      let bucket = buckets.get(key);

      // no window, or the old one has run out -> start a fresh one
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowMs };
        buckets.set(key, bucket);
      }

      bucket.count += 1;

      /*
        The three standard headers, so a caller can see where it stands
        instead of having to be refused to find out. A well behaved
        client (or a developer with the network tab open) can slow
        itself down before it is stopped.
      */
      const remaining = Math.max(rule.max - bucket.count, 0);
      const secondsLeft = Math.ceil((bucket.resetAt - now) / 1000);

      res.setHeader("X-RateLimit-Limit", rule.max);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", secondsLeft);

      if (bucket.count > rule.max) {
        /*
          Retry-After is part of the HTTP standard for 429, and it is
          what turns "no" into "not yet": axios, a mobile app or a
          monitoring tool can read it and wait exactly long enough.
        */
        res.setHeader("Retry-After", secondsLeft);

        return res.status(429).json({
          message: rule.message,
          retryAfterSeconds: secondsLeft,
        });
      }

      return next();
    } catch (error) {
      /*
        A broken limiter must NEVER take the application down with it.
        This middleware sits in front of every route in FlowDesk, so if
        anything in it throws, the right answer is to let the request
        through and complain in the log - the alternative is a bug in a
        safety net becoming a total outage.
      */
      console.error(`Rate Limit Error ${error}`);
      return next();
    }
  };
};

/* =====================================================================
   THE READY-MADE LIMITERS
   ---------------------------------------------------------------------
   Built once here so a route file never has to remember which tier
   belongs to which kind of route.
   ===================================================================== */

// every /api call, per IP - the safety net
export const globalLimiter = createRateLimiter("global", RATE_LIMITS.GLOBAL);

/*
  Login, forgot password, reset password, resend verification.

  The second key is the EMAIL BEING TRIED, which is what makes this
  useful against password spraying: one password against a thousand
  accounts shares an IP, so it burns the same window as a thousand
  passwords against one account. Falling back to "" when there is no
  email in the body simply means the window is counted per IP alone.
*/
export const authLimiter = createRateLimiter(
  "auth",
  RATE_LIMITS.AUTH,
  (req) => req.body?.email || ""
);

// anything that writes a file to our disk
export const uploadLimiter = createRateLimiter("upload", RATE_LIMITS.UPLOAD);

// reports, exports, the audit CSV, the analytics aggregations
export const heavyLimiter = createRateLimiter("heavy", RATE_LIMITS.HEAVY);

/*
  Only used by the tests and by the /api/health endpoint, which reports
  how many windows are currently being tracked - a number that quietly
  tells an admin whether the sweeper is doing its job.
*/
export const getRateLimitSize = () => buckets.size;
