/*
=========================================================================
  CUSTOM HOOK: useRequestTypes    (Module 9 - System Configuration)
=========================================================================
  "Which kinds of request exist?" - asked by four pages: Requests,
  Approvals, Workflows and the Settings page that edits them.

  It used to be answered by an array in utils/requestConstants.js, which
  had to be kept in step by hand with a matching array in the backend.
  An administrator owns the list now, so the frontend DOWNLOADS it -
  the same decision the Roles page has always made about its permission
  list.

  WHAT THE HOOK GIVES BACK
  ------------------------
    types        every type, in the admin's chosen order
    activeTypes  only the ones a new request may be raised under
    typeNames    just the names, for a filter dropdown
    loading      still fetching
    refresh()    fetch again, ignoring the cache. The Settings page
                 calls this after adding or renaming a type, so the
                 rest of the app is right immediately.

  THE MODULE-LEVEL CACHE
  ----------------------
  `cachedTypes` and `inFlight` live OUTSIDE the hook, so they are
  shared by every component that calls it. Two things follow:

    - opening Requests, then Approvals, then Workflows makes ONE
      request, not three
    - two components mounting in the same tick share one request
      rather than racing (that is what `inFlight` is for - the second
      caller awaits the promise the first one started)

  It is a plain variable and not React state on purpose: it must
  survive a component unmounting, which state does not.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";

import { api } from "../utils/api.js";

// shared by every component using this hook, for the whole session
let cachedTypes = null;

// the request that is already running, if any
let inFlight = null;

/*
  Every mounted component currently using this hook.

  A cache alone is not enough: clearing a module-level variable throws
  away the ANSWER, but each component is holding its own useState copy
  of the old one and nothing tells it to look again. So the cache keeps
  a list of who is using it and calls them when the value changes -
  the same shape useCompanySettings uses, and for the same reason.
*/
let listeners = new Set();

const publish = (types) => {
  listeners.forEach((notify) => notify(types));
};

/*
  Fetches the list once and remembers it.

  @param force - true skips the cache (used by refresh())
*/
const loadRequestTypes = async (force = false) => {
  if (cachedTypes && !force) {
    return cachedTypes;
  }

  // somebody else already asked - wait for their answer instead of
  // starting a second identical request
  if (inFlight && !force) {
    return inFlight;
  }

  inFlight = api
    .get("/api/request-type/all")
    .then((result) => {
      cachedTypes = result.data.requestTypes || [];

      publish(cachedTypes);

      return cachedTypes;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

/*
  Both are exported separately from the hook because the Settings page
  calls them from inside a save handler, where a hook cannot be used.

  clearRequestTypeCache()   forget the list. Nothing is fetched.
                            Logout calls this - the session is over,
                            and /request-type/all needs one.

  refreshRequestTypes()     forget it, fetch it again, and tell every
                            component using the hook. This is what the
                            Settings page wants after adding or
                            renaming a type.
*/
export const clearRequestTypeCache = () => {
  cachedTypes = null;
};

export const refreshRequestTypes = () => {
  cachedTypes = null;

  return loadRequestTypes(true);
};

const useRequestTypes = () => {
  const [types, setTypes] = useState(cachedTypes || []);
  const [loading, setLoading] = useState(!cachedTypes);

  useEffect(() => {
    let alive = true;

    const notify = (next) => {
      if (alive) {
        setTypes(next);
        setLoading(false);
      }
    };

    listeners.add(notify);

    loadRequestTypes()
      .then(notify)
      .catch((error) => {
        /*
          Deliberately quiet. Every page that uses this hook has its own
          real job and its own error toast; a second toast saying the
          dropdown could not be filled would be noise on top of whatever
          already went wrong. The page simply shows an empty list.
        */
        console.log("Request types error", error);
        notify([]);
      });

    return () => {
      alive = false;
      listeners.delete(notify);
    };
  }, []);

  // fetch again from the server, ignoring whatever is cached
  const refresh = useCallback(() => refreshRequestTypes(), []);

  return {
    types,
    activeTypes: types.filter((type) => type.isActive),
    typeNames: types.map((type) => type.name),
    loading,
    refresh,
  };
};

/* =====================================================================
   SMALL HELPERS
   ---------------------------------------------------------------------
   These take the list the hook returned, so a component never has to
   go looking through it by hand.

   Each one answers a question the request FORM asks, and each replaces
   one of the hard-coded arrays Module 9 deleted.
   ===================================================================== */

// the whole row for one type name, or null
export const findType = (types, name) =>
  types.find((type) => type.name === name) || null;

// the "Category" suggestions of a type (was REQUEST_CATEGORY_SUGGESTIONS)
export const categoriesOf = (types, name) =>
  findType(types, name)?.categories || [];

// should the form show the Amount field? (was REQUEST_TYPES_WITH_AMOUNT)
export const typeNeedsAmount = (types, name) =>
  Boolean(findType(types, name)?.needsAmount);

// should the form show the date fields? (was REQUEST_TYPES_WITH_DATES)
export const typeNeedsDates = (types, name) =>
  Boolean(findType(types, name)?.needsDates);

export default useRequestTypes;
