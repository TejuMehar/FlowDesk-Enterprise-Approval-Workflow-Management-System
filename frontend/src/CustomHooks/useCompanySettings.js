/*
=========================================================================
  CUSTOM HOOK: useCompanySettings  (Module 9 - System Configuration)
=========================================================================
  The company's own name and logo, for the parts of the UI that wear
  them: the sidebar, the navbar and the login page.

  IT CALLS THE ONE ROUTE IN FLOWDESK THAT NEEDS NO LOGIN.

  That is the whole reason this hook exists separately from the Settings
  page. The login screen has to show the company name and logo, and that
  is exactly the moment nobody is logged in - branding fetched from
  behind a login could never brand the login. So the backend has a
  small GET /api/settings/public that answers with four harmless
  fields and nothing else.

  ---------------------------------------------------------------------
  A CACHE IS NOT ENOUGH: THE COPIES HAVE TO BE TOLD
  ---------------------------------------------------------------------
  The Settings page saves a new company name and calls
  clearCompanyCache(), and the comment on that function used to promise
  the sidebar would "pick it up without a page reload".

  It did not, and could not. Clearing a module-level variable throws
  away the ANSWER, but the Sidebar and the Navbar are each holding
  their own useState copy of the old one, and nothing tells them to
  look again - a React component only re-renders when its own state
  changes. So an admin uploaded a new logo, saw the Settings page
  update, and sat looking at the old logo in the sidebar beside it
  until they happened to refresh the browser. Which reads as the upload
  having silently failed.

  So the cache keeps a list of the components using it and calls them
  when the value changes. That is all a "subscription" is: an array of
  functions, and a loop.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";

import { api } from "../utils/api.js";

/*
  What the UI shows before the answer arrives, and if it never does.

  A login page that will not draw because the branding could not be
  loaded is a far worse outcome than one that says "FlowDesk", so this
  is a real fallback rather than a loading state - the backend takes
  the same view and answers with these values instead of an error.
*/
const DEFAULTS = {
  companyName: "FlowDesk",
  companyLogo: "",
  timezone: "UTC",
  workingDays: [1, 2, 3, 4, 5],
};

let cachedCompany = null;
let inFlight = null;

/*
  Every mounted component currently using this hook. They are added on
  mount and removed on unmount, so the list never grows.
*/
let listeners = new Set();

const publish = (company) => {
  listeners.forEach((notify) => notify(company));
};

const loadCompany = async (force = false) => {
  if (cachedCompany && !force) {
    return cachedCompany;
  }

  if (inFlight && !force) {
    return inFlight;
  }

  inFlight = api
    .get("/api/settings/public")
    .then((result) => {
      cachedCompany = { ...DEFAULTS, ...(result.data.settings || {}) };

      // tell the sidebar, the navbar and the login page at once
      publish(cachedCompany);

      return cachedCompany;
    })
    .catch(() => DEFAULTS)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

/*
  THE TWO OF THESE ARE NOT THE SAME THING, and telling them apart
  matters more than it looks.

  clearCompanyCache()    forget what we know. Nothing is fetched.
                         Logout calls this: the session is over, and
                         asking the server anything on the way out
                         would only produce a 401 for a page that is
                         already leaving.

  refreshCompanySettings()  forget it AND fetch it again AND tell every
                         component. The Settings page calls this after
                         saving a new name or logo, which is the case
                         the whole subscription above exists for.
*/
export const clearCompanyCache = () => {
  cachedCompany = null;
};

export const refreshCompanySettings = () => {
  cachedCompany = null;

  return loadCompany(true);
};

const useCompanySettings = () => {
  const [company, setCompany] = useState(cachedCompany || DEFAULTS);

  useEffect(() => {
    /*
      `alive` guards the first fetch. A component that unmounts while
      the request is in the air must not set state afterwards - and
      unsubscribing alone would not cover it, because the promise below
      captured setCompany directly.
    */
    let alive = true;

    const notify = (next) => {
      if (alive) {
        setCompany(next);
      }
    };

    listeners.add(notify);

    loadCompany().then(notify);

    return () => {
      alive = false;
      listeners.delete(notify);
    };
  }, []);

  const refresh = useCallback(() => refreshCompanySettings(), []);

  return { company, refresh };
};

export default useCompanySettings;
