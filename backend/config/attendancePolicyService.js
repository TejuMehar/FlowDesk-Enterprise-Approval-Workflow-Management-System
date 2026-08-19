/*
=========================================================================
  THE ATTENDANCE POLICY SERVICE   (Module 11 - Attendance Management)
=========================================================================
  "WHAT WORKING PATTERN APPLIES TO THIS PERSON?"

  Asked once, here, and answered the same way for the punch screen, the
  summary, the team board, the four reports and the performance score.
  That is the whole reason the file exists: a punch judged by one shift
  and a report judged by another is a system nobody can argue with,
  because the two halves disagree about what "late" means.

  THE THREE LAYERS
  ----------------
      1. the DEPARTMENT policy   the warehouse starts at 07:00
      2. the COMPANY policy      what a department with no policy gets
      3. DEFAULT_ATTENDANCE_POLICY   the values in the code

  Each layer only overrides the fields it really holds, so a manager who
  changes nothing but the break allowance keeps the company's shift -
  and keeps it even when somebody changes the company's shift later.
  That is the difference between LAYERING and COPYING, and copying is
  how a department policy quietly freezes in 2024.

  WHY THERE IS A CACHE
  --------------------
  The same reason config/requestTypeService.js and
  config/workingCalendar.js have one: a team board asks for the policy
  of every employee in a department, in a loop, and the answer changes
  about twice a year. Sixty identical queries per page view is a lot of
  database for a number nobody changed.

  The cache is cleared the moment a policy is saved (clearPolicyCache),
  so a manager who changes the break allowance sees it apply
  immediately rather than "within a minute" - which would look like the
  save had failed.
=========================================================================
*/

import AttendancePolicy from "../model/attendancePolicyModel.js";
import { DEFAULT_ATTENDANCE_POLICY } from "./attendanceConstants.js";

/* the same 60 seconds requestTypeService.js and workingCalendar.js use */
const CACHE_TTL_MS = 60 * 1000;

let cachedPolicies = null;
let cachedAt = 0;

export const clearPolicyCache = () => {
  cachedPolicies = null;
  cachedAt = 0;
};

/* =====================================================================
   1) EVERY POLICY, BY DEPARTMENT
   ---------------------------------------------------------------------
   There are as many of these as there are departments - a dozen, not a
   dozen thousand - so the whole collection is read at once and kept as
   a Map. One query answers every question until the cache expires.

   The company policy is stored under the key "company" rather than
   under `null`, so a lookup can never confuse "the company default"
   with "this department id is missing".
   ===================================================================== */
const loadPolicies = async () => {
  const now = Date.now();

  if (cachedPolicies && now - cachedAt < CACHE_TTL_MS) {
    return cachedPolicies;
  }

  try {
    const rows = await AttendancePolicy.find({}).lean();

    const byDepartment = new Map();

    rows.forEach((row) => {
      byDepartment.set(row.department ? String(row.department) : "company", row);
    });

    cachedPolicies = byDepartment;
    cachedAt = now;

    return cachedPolicies;
  } catch (error) {
    /*
      A policy that cannot be read must not stop somebody clocking in.

      The same decision getCalendar() makes: the built-in defaults are
      a far better answer than an exception, because the alternative is
      an employee standing at their desk unable to start their day
      because a collection was slow.
    */
    console.error(`Attendance Policy Error ${error}`);
    return new Map();
  }
};

/* =====================================================================
   2) LAYERING
   ---------------------------------------------------------------------
   Only the fields a layer really holds are taken. A stored `undefined`
   or `null` means "this layer has no opinion", and the layer below
   keeps its value.

   0 IS AN OPINION. A break allowance of zero minutes is a real policy
   ("no paid breaks here"), so the check is against null/undefined and
   never a falsy test - `value || fallback` would silently turn every
   zero back into 60.
   ===================================================================== */
const overlay = (base, layer) => {
  if (!layer) {
    return base;
  }

  const result = { ...base };

  Object.keys(DEFAULT_ATTENDANCE_POLICY).forEach((field) => {
    if (layer[field] !== undefined && layer[field] !== null) {
      result[field] = layer[field];
    }
  });

  return result;
};

/* =====================================================================
   3) THE POLICY FOR ONE DEPARTMENT
   ---------------------------------------------------------------------
   @param departmentId - may be null, for an employee with no department
   @returns the full policy, plus where each part came from

   `source` is not decoration. The policy screen has to be able to say
   "these are the company's numbers, you have not set your own" - a form
   pre-filled with inherited values and no word about it is a form that
   turns an inheritance into a copy the first time somebody presses Save.
   ===================================================================== */
export const getPolicyForDepartment = async (departmentId) => {
  const policies = await loadPolicies();

  const company = policies.get("company") || null;
  const department = departmentId ? policies.get(String(departmentId)) : null;

  const resolved = overlay(overlay({ ...DEFAULT_ATTENDANCE_POLICY }, company), department);

  return {
    ...resolved,
    source: department ? "department" : company ? "company" : "default",
    hasDepartmentPolicy: Boolean(department),
    updatedAt: department?.updatedAt || company?.updatedAt || null,
    updatedBy: department?.updatedBy || company?.updatedBy || null,
  };
};

/*
  The same thing for a USER, which is what almost every caller really
  wants. The user's department is the only part of them that matters,
  so this is a one line wrapper - written down so no controller has to
  remember which field to reach for.
*/
export const getPolicyForUser = async (user) => {
  const departmentId = user?.department?._id || user?.department || null;

  return await getPolicyForDepartment(departmentId);
};

/*
  Policies for a whole LIST of departments, resolved in one go.

  The team board needs this: fifteen employees across three
  departments, each judged by their own shift. Doing it per employee
  would be correct and would ask the same three questions five times
  each.

  @returns a Map keyed by department id as a string, plus "company"
           for the employees who have no department at all.
*/
export const getPolicyMap = async (departmentIds = []) => {
  const map = new Map();

  map.set("company", await getPolicyForDepartment(null));

  for (const departmentId of departmentIds) {
    if (!departmentId) {
      continue;
    }

    map.set(String(departmentId), await getPolicyForDepartment(departmentId));
  }

  return map;
};

/*
  The policy that applies to one attendance row, out of that map.

  Everything in this module that judges a day goes through here, so
  "the employee has no department" is handled in ONE place instead of
  being a `|| company` sprinkled through four aggregation loops.
*/
export const pickPolicy = (policyMap, departmentId) =>
  policyMap.get(String(departmentId || "")) || policyMap.get("company");

/* =====================================================================
   4) SAVING ONE
   ---------------------------------------------------------------------
   upsert, because a department that never had a policy is the normal
   case - it inherited the company's until the day somebody changed a
   number.

   The cache is cleared here rather than in the controller, so there is
   no way to write a policy and forget to.
   ===================================================================== */
export const savePolicy = async (departmentId, values, userId) => {
  const saved = await AttendancePolicy.findOneAndUpdate(
    { department: departmentId || null },
    { $set: { ...values, updatedBy: userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  clearPolicyCache();

  return saved;
};
