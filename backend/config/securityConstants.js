/*
=========================================================================
  SECURITY CONSTANTS   (Module 10 - Enterprise Features & Deployment)
=========================================================================
  The numbers behind the rate limiter and the response headers, in one
  place, so "how many logins per quarter of an hour?" has a single
  answer that can be read without opening the middleware.

  WHY RATE LIMITING IS A MODULE 10 JOB
  ------------------------------------
  Every check FlowDesk has made so far answers "MAY this person do
  this?". None of them answer "how OFTEN?". Those are different
  questions, and the second one only starts to matter the moment the
  application is reachable from the internet:

    - a password is 8 characters with a digit and a capital, which is
      fine against a person and nothing at all against a script that
      can try it ten thousand times a minute
    - "forgot password" sends an email to an address the caller
      chooses, so an unlimited one is a free way to post mail to a
      colleague, from us, as often as it likes
    - a report is a full aggregation over every request in the company;
      twenty of those at once is a database on its knees, and no
      permission in Module 8 says "but not twenty times a second"

  A limiter does not decide who you are. It decides how fast anybody
  may be wrong.
=========================================================================
*/

/*
  Every window is in MILLISECONDS, because that is what setTimeout and
  Date.now() speak and converting in two places is how the two drift.
*/
const MINUTE = 60 * 1000;

/* =====================================================================
   THE FOUR TIERS
   ---------------------------------------------------------------------
   FOUR and not one, because the cost of a request is not the same
   everywhere and a single number would have to be set for the most
   expensive route - which would make the cheap ones unusable.

   Each entry is:
     windowMs  how long the window lasts
     max       how many requests one caller may make inside it
     message   what the caller is told when they run out
   ===================================================================== */
export const RATE_LIMITS = {
  /*
    GLOBAL - a safety net across the whole API, per IP.

    Deliberately generous. Opening the dashboard fires a handful of
    calls at once, and a manager clicking quickly through a table is
    not an attack. This tier exists to stop a runaway script, not to
    shape normal use: if a real person ever meets it, it is set wrong.
  */
  GLOBAL: {
    windowMs: MINUTE,
    max: 300,
    message: "Too many requests. Please slow down and try again in a minute.",
  },

  /*
    AUTH - login, forgot password, reset password, resend verification.

    This is the tier that actually matters, and it is strict: 10
    attempts per 15 minutes. A person who has forgotten their password
    tries three or four times and then uses the link; a script needs
    thousands of tries to be worth starting.

    It is keyed on the IP AND THE EMAIL BEING TRIED (see rateLimit.js),
    so one office behind one address cannot lock each other out, and
    trying one password against a thousand accounts - "password
    spraying", the attack a per-account limit misses completely - runs
    out just as fast as a thousand passwords against one account.
  */
  AUTH: {
    windowMs: 15 * MINUTE,
    max: 10,
    message:
      "Too many attempts. For your security this has been paused - please try again in 15 minutes.",
  },

  /*
    UPLOAD - anything that writes a file to our disk.

    The limit here is about STORAGE rather than CPU. Every accepted
    call can leave up to 25 MB behind (5 files x 5 MB), and unlike a
    query, a file does not go away when the request ends.
  */
  UPLOAD: {
    windowMs: 15 * MINUTE,
    max: 30,
    message:
      "Too many uploads in a short time. Please wait a few minutes before uploading again.",
  },

  /*
    HEAVY - reports, exports, the audit CSV, the analytics charts.

    One of these is an aggregation across every request in the company
    and can build a 5000 row spreadsheet in memory. They are the most
    expensive thing FlowDesk does, and the only ones where a handful of
    parallel calls can be felt by everybody else.
  */
  HEAVY: {
    windowMs: 5 * MINUTE,
    max: 40,
    message:
      "That report is still being prepared. Please wait a moment before running another one.",
  },
};

/*
  How often the limiter clears out windows that have expired.

  Without this the Map behind it would keep one entry per IP that has
  ever called us - a slow memory leak that only shows up in production,
  which is the worst kind. Same reasoning as the reminder engine's
  interval in Module 6: the work is small, so it can be frequent.
*/
export const RATE_LIMIT_SWEEP_MS = 5 * MINUTE;

/* =====================================================================
   RESPONSE HEADERS
   ---------------------------------------------------------------------
   The short list of headers that tell a browser what it may do with
   our answers. They are written out here rather than pulled in with
   helmet for the same reason Module 5 draws its own charts and Module 6
   runs its own scheduler: this is a dozen lines, it is worth being able
   to read them, and every one of them has a reason next to it.

   THIS IS AN API, WHICH CHANGES WHICH HEADERS MATTER. Nobody browses
   to it; the only HTML it ever returns is an error page. So the usual
   worry - "somebody embeds our page in an iframe and tricks a user
   into clicking a button" - mostly does not apply, and the headers
   that DO matter are the ones about the files we hand out and the
   addresses we leak.
   ===================================================================== */
export const SECURITY_HEADERS = {
  /*
    THE MOST IMPORTANT ONE IN THIS PROJECT, because of Module 10's file
    routes. It tells the browser: believe the Content-Type I sent, do
    not guess from the bytes. Without it, a browser that finds HTML
    inside a file we labelled text/plain may decide to RUN it - on our
    origin, with our cookies.
  */
  "X-Content-Type-Options": "nosniff",

  // no page of ours may be put inside a frame on somebody else's site
  "X-Frame-Options": "DENY",

  /*
    Send the full URL as a referrer only to ourselves. Our URLs contain
    ids, and a password RESET url contains the token itself - a link
    followed out of a page must never carry that to a third party.
  */
  "Referrer-Policy": "strict-origin-when-cross-origin",

  /*
    A browser has no business asking for the camera, the microphone or
    the location on behalf of an approval system, and neither has
    anything embedded in it.
  */
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",

  /*
    A locked-down CSP for the JSON API. It is this strict precisely
    because nothing here is a page: default-src 'none' means an error
    response, or a file rendered directly in a tab, can load nothing
    and run nothing at all.

    The REACT app is served by its own host (Vercel/Netlify) and has
    its own policy - this one never reaches it.
  */
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",

  /*
    Do not advertise that this is Express. It saves nobody, but there
    is no reason to answer the question "which version, and which
    vulnerabilities does it have?" before it is asked.
  */
  "X-Powered-By": null, // null means REMOVE the header
};

/*
  HSTS - "only ever talk to me over https, for the next two years".

  Added only when NODE_ENV is production, and that condition is not
  caution, it is necessary: a browser that is told this on localhost
  will refuse plain http://localhost for the whole max-age, and there
  is no button to undo it.
*/
export const HSTS_HEADER = {
  name: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};
