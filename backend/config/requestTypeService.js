/*
=========================================================================
  REQUEST TYPE SERVICE   (Module 9 - System Configuration)
=========================================================================
  THE ONE PLACE THAT ANSWERS "WHICH REQUEST TYPES EXIST?"

  Before Module 9 the answer was an array, imported by six different
  files. Now it is a collection, and every one of those files asks here
  instead - the same shape config/requestAccess.js has for "who is part
  of this request?" and config/reportScope.js has for "how far can this
  user see?".

  TWO QUESTIONS, NOT ONE
  ----------------------
  It matters which one a caller asks:

    isSelectableRequestType()  may somebody CHOOSE this for a new
                               request or a new workflow?
                               -> must exist AND be active

    isKnownRequestType()       does this type mean anything at all?
                               -> exists, active or not

  The filter dropdowns, the reports and the search ask the SECOND one.
  If they asked the first, switching "Laptop" off would make three years
  of laptop requests unfindable - the rows would still be in the
  database with nothing able to name them. Switching a type off has to
  stop new paperwork, not hide old paperwork.

  WHY THERE IS A CACHE
  --------------------
  These questions are asked on nearly every request list, every search
  and every chart, and the answer changes about twice a year. A tiny
  cache turns a database round-trip per page into one per minute.

  It is invalidated TWO ways, and both are needed:

    clearRequestTypeCache()  called by requestTypeController after every
                             create/update/delete, so the admin who just
                             added "Overtime" sees it immediately

    CACHE_TTL_MS             a 60 second ceiling, because the line above
                             only reaches THIS node process. The day
                             FlowDesk runs behind two servers, the
                             second one would otherwise serve a stale
                             list until it was restarted. The same
                             reasoning as the note about cron in
                             reminderEngine.js: single process today,
                             written so tomorrow is not a rewrite.
=========================================================================
*/

import RequestType from "../model/requestTypeModel.js";

const CACHE_TTL_MS = 60 * 1000;

let cachedTypes = null;
let cachedAt = 0;

/*
  Every request type, in dropdown order, as plain objects.

  .lean() because nobody here ever saves one - these are read to be
  compared and to be sent to React, and a lean object is a fraction of
  the weight of a mongoose document.
*/
export const getRequestTypes = async () => {
  const now = Date.now();

  if (cachedTypes && now - cachedAt < CACHE_TTL_MS) {
    return cachedTypes;
  }

  const types = await RequestType.find().sort({ order: 1, name: 1 }).lean();

  cachedTypes = types;
  cachedAt = now;

  return types;
};

/*
  Called by requestTypeController after every write.

  Setting cachedAt to 0 rather than deleting the array means a request
  arriving in the same millisecond still gets a correct answer - it
  simply refetches.
*/
export const clearRequestTypeCache = () => {
  cachedTypes = null;
  cachedAt = 0;
};

/*
  The names only: ["Leave", "Purchase", ...].

  This is the drop-in replacement for the old REQUEST_TYPES constant,
  which is why so many call sites only had to add an `await`.
*/
export const getRequestTypeNames = async () => {
  const types = await getRequestTypes();
  return types.map((type) => type.name);
};

// the names an employee may still choose from
export const getActiveRequestTypeNames = async () => {
  const types = await getRequestTypes();
  return types.filter((type) => type.isActive).map((type) => type.name);
};

/*
  Does this type mean anything at all? Used by FILTERS, search, reports
  and charts - see the note at the top about why they must not care
  whether it is still active.
*/
export const isKnownRequestType = async (name) => {
  if (!name) {
    return false;
  }

  const names = await getRequestTypeNames();
  return names.includes(name);
};

/*
  May somebody choose this for a NEW request or a NEW workflow? Used by
  the create/update controllers.
*/
export const isSelectableRequestType = async (name) => {
  if (!name) {
    return false;
  }

  const names = await getActiveRequestTypeNames();
  return names.includes(name);
};

/*
  One type by its exact name, or null. The controllers use it to tell
  "no such type" apart from "that type is switched off", because those
  two deserve different sentences on screen.
*/
export const findRequestTypeByName = async (name) => {
  if (!name) {
    return null;
  }

  const types = await getRequestTypes();

  return types.find((type) => type.name === String(name).trim()) || null;
};

/*
  The error message a controller shows when a type was rejected.

  It lists what the caller COULD have sent, which is the difference
  between "Invalid request type" and a message somebody can act on.
  Built here so all five controllers word it the same way.
*/
export const describeSelectableTypes = async () => {
  const names = await getActiveRequestTypeNames();

  if (names.length === 0) {
    return "No request types are active. An administrator has to add one in Settings first.";
  }

  return `Request type must be one of: ${names.join(", ")}`;
};
