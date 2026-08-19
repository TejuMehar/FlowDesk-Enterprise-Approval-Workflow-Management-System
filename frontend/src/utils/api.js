/*
=========================================================================
  AXIOS INSTANCE  +  AUTOMATIC TOKEN REFRESH
=========================================================================
  Instead of writing

      axios.get(serverUrl + "/api/user/all", { withCredentials: true })

  in fifty places, we build ONE ready-made axios object here:

      api.get("/api/user/all")

  It already knows the server address and always sends our cookies.

  ---------------------------------------------------------------------
  THE INTERESTING PART: THE RESPONSE INTERCEPTOR
  ---------------------------------------------------------------------
  Our access token dies after 15 minutes. When that happens the backend
  answers 401 "Access token expired".

  Instead of throwing the user back to the login page, the interceptor:
     1. quietly calls  POST /api/auth/refresh
     2. gets a fresh pair of tokens
     3. repeats the request that had failed

  The user never notices anything.

  If two requests fail at the same moment we must NOT call /refresh
  twice, so the second one waits in a small queue.
=========================================================================
*/

import axios from "axios";
import { serverUrl } from "./config.js";

// our ready-made axios object
export const api = axios.create({
  baseURL: serverUrl,
  withCredentials: true, // ALWAYS send the httpOnly cookies
});

// a separate plain axios for the refresh call itself, so the
// interceptor below can never call itself in a loop
const refreshApi = axios.create({
  baseURL: serverUrl,
  withCredentials: true,
});

// true while a refresh is already running
let isRefreshing = false;

// the requests that are waiting for that refresh to finish
let waitingRequests = [];

/*
  Wakes up every waiting request once the refresh has finished.
  @param {boolean} success - did the refresh work?
*/
const releaseWaitingRequests = (success) => {
  waitingRequests.forEach((callback) => callback(success));
  waitingRequests = [];
};

/*
  These routes must NEVER trigger a refresh:
    login   -> a 401 here simply means "wrong password"
    refresh -> that would be an endless loop
    logout  -> we are leaving anyway
*/
const noRefreshRoutes = [
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
];

/*
  "WHO IS LOGGED IN?" IS ALLOWED TO ANSWER "NOBODY".

  /api/auth/me is the one call whose 401 is a real answer rather than an
  expired session, because it is the question the app asks before it
  knows whether there is a session at all. It still gets a refresh
  attempt - a returning user with a dead access token and a live refresh
  token should be let straight back in - but it must never be followed
  by the hard redirect below.

  Without this exception every logged-out visitor to any URL paid for
  two full page loads (the app booted, asked, was thrown at /login by
  window.location, and booted again), and ProtectedRoute never got the
  chance to remember where they had been trying to go - so "log in and
  carry on where you were" silently did not work for an expired session,
  which is the exact case it was written for.
*/
const noRedirectRoutes = ["/api/auth/me"];

api.interceptors.response.use(
  // 1st function: everything went fine, just pass the response on
  (response) => response,

  // 2nd function: something went wrong
  async (error) => {
    const originalRequest = error.config;

    const status = error.response?.status;
    const url = originalRequest?.url || "";

    const isRefreshable =
      status === 401 &&
      !originalRequest?._retry && // we have not tried already
      !noRefreshRoutes.some((route) => url.includes(route));

    // not a token problem -> give the error back to the page
    if (!isRefreshable) {
      return Promise.reject(error);
    }

    // remember that we already tried, so we never loop
    originalRequest._retry = true;

    /* ---- CASE A: a refresh is already running -> wait for it ---- */
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        waitingRequests.push((success) => {
          if (success) {
            resolve(api(originalRequest)); // try again
          } else {
            reject(error);
          }
        });
      });
    }

    /* ---- CASE B: we are the first one -> do the refresh ---- */
    isRefreshing = true;

    try {
      await refreshApi.post("/api/auth/refresh");

      isRefreshing = false;
      releaseWaitingRequests(true);

      // repeat the original request, now with a fresh cookie
      return api(originalRequest);
    } catch (refreshError) {
      isRefreshing = false;
      releaseWaitingRequests(false);

      /*
        The refresh token is dead too, so the session is really over.
        We send the user to the login page - unless they are already
        on a public page like /login or /reset-password.
      */
      const publicPaths = [
        "/login",
        "/forget-password",
        "/reset-password",
        "/verify-email",
      ];

      const isOnPublicPage = publicPaths.some((path) =>
        window.location.pathname.startsWith(path)
      );

      const isAskingWhoIsLoggedIn = noRedirectRoutes.some((route) =>
        url.includes(route)
      );

      if (!isOnPublicPage && !isAskingWhoIsLoggedIn) {
        /*
          Carry the page they were on into the login URL, so a session
          that expired half way through a piece of work returns them to
          it instead of dumping them on the dashboard. Login reads it
          back out of the query string.
        */
        const wanted = window.location.pathname + window.location.search;

        window.location.href = `/login?next=${encodeURIComponent(wanted)}`;
      }

      return Promise.reject(refreshError);
    }
  }
);

/*
=========================================================================
  WAS THIS REQUEST CANCELLED ON PURPOSE?
=========================================================================
  Every list page in FlowDesk types into a search box and asks the
  backend 400 ms later. The debounce cuts the number of requests down,
  but it does NOT put the answers in order, and that is a different
  problem that debouncing is often mistaken for solving.

  Type "Rav", pause, then finish "Ravi". Two requests are now in the
  air. If the first one is answered by a busy database a moment after
  the second, the table ends up showing the results for "Rav" while the
  box says "Ravi" - and the user's only clue is that the page looks
  wrong.

  So every debounced fetch now carries an AbortController, and the
  cleanup cancels the previous request before starting the next. An
  aborted request comes back here as an error, which must NOT become a
  red toast: nothing went wrong, we simply stopped caring about the
  answer.
=========================================================================
*/
export const isCancelledError = (error) => {
  return axios.isCancel(error) || error?.code === "ERR_CANCELED";
};

/*
  A small helper that pulls the message out of an axios error.

  The backend always answers with { message: "..." }, but if the server
  is completely offline there is no response at all - then we show a
  friendly fallback instead of "undefined".
*/
export const getErrorMessage = (error) => {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Something went wrong. Please try again."
  );
};

export default api;
