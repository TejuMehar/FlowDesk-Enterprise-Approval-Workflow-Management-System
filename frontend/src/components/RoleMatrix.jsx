/*
=========================================================================
  COMPONENT: RoleMatrix   (Module 9 - System Configuration)
=========================================================================
  Every role and every permission on ONE grid, with a tick in each cell
  that has one.

  WHY THE PAGE NEEDED THIS
  ------------------------
  The Roles page could already do everything: create a role, tick its
  permissions, save. What it could not do is answer the question an
  administrator actually asks, which is never "what can the Manager
  role do?" but "WHO can delete a user?".

  Answering that on the old page meant opening four roles one after
  another and holding the answer in your head. The matrix answers it by
  reading across one row.

  IT MAKES NO NEW REQUEST
  -----------------------
  Same two calls the list view already makes: GET /api/role/all and
  GET /api/role/permissions. There is no new data here, only a second
  way of looking at the data that was always there - which is why this
  is a component and not an endpoint.

  EDITING
  -------
  A cell is clickable for anybody with role:update. Clicks are collected
  in `pending` and nothing is sent until Save is pressed, then ONE
  request goes out per role that really changed. A grid that saved on
  every click would fire a request per tick and leave an admin who
  mis-clicked with no way back.

  THE TWO LOCKED COLUMNS
  ----------------------
  Super Admin can never lose a permission (the backend refuses it, so
  the UI does not pretend otherwise), and a role nobody may edit is
  drawn read-only. Both are shown as locked rather than simply not
  responding, because a checkbox that ignores a click looks broken.
=========================================================================
*/

import { Fragment, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdCheck, MdLock, MdOutlineInfo } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";

function RoleMatrix({ roles, permissionGroups, canUpdate, onSaved }) {
  /*
    The unsaved clicks: { [roleId]: Set(permission) }.

    It holds the FULL permission list of any role that has been
    touched, not just the difference, so a row can be sent to the
    backend exactly as it stands.
  */
  const [pending, setPending] = useState({});
  const [saving, setSaving] = useState(false);

  // the permission list of a role, with any unsaved clicks applied
  const permissionsOf = (role) =>
    pending[role._id] || role.permissions || [];

  const hasChanges = Object.keys(pending).length > 0;

  /* =================================================================
     CLICK A CELL
     ================================================================= */
  const toggleCell = (role, permissionKey) => {
    if (!canUpdate || role.name === "Super Admin") {
      return;
    }

    const current = permissionsOf(role);

    const next = current.includes(permissionKey)
      ? current.filter((entry) => entry !== permissionKey)
      : [...current, permissionKey];

    setPending((previous) => ({ ...previous, [role._id]: next }));
  };

  /*
    Tick or untick a whole ROW - one permission across every role at
    once. The fastest way to answer "nobody should be able to do this
    any more".
  */
  const toggleRow = (permissionKey) => {
    if (!canUpdate) {
      return;
    }

    const editable = roles.filter((role) => role.name !== "Super Admin");

    const everyoneHasIt = editable.every((role) =>
      permissionsOf(role).includes(permissionKey)
    );

    setPending((previous) => {
      const next = { ...previous };

      editable.forEach((role) => {
        const current = permissionsOf(role);

        next[role._id] = everyoneHasIt
          ? current.filter((entry) => entry !== permissionKey)
          : [...new Set([...current, permissionKey])];
      });

      return next;
    });
  };

  /* =================================================================
     SAVE
     -----------------------------------------------------------------
     One PUT per role that really changed. Roles that were touched and
     then put back exactly as they were are dropped first, so a stray
     double-click does not write an audit entry about a change that
     did not happen.
     ================================================================= */
  const handleSave = async () => {
    const changedRoles = roles.filter((role) => {
      const next = pending[role._id];

      if (!next) {
        return false;
      }

      const before = [...(role.permissions || [])].sort().join("|");
      const after = [...next].sort().join("|");

      return before !== after;
    });

    if (changedRoles.length === 0) {
      setPending({});
      toast.info("Nothing changed");
      return;
    }

    setSaving(true);

    try {
      /*
        Sequential rather than Promise.all: each save writes an audit
        entry, and four requests landing in the same millisecond makes
        the audit log read as though somebody did four things at once
        in no particular order. Four roles is a small enough number
        that waiting for each is free.
      */
      for (const role of changedRoles) {
        await api.put(`/api/role/${role._id}`, {
          permissions: pending[role._id],
        });
      }

      toast.success(
        `${changedRoles.length} role(s) updated`
      );

      setPending({});
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setPending({});

  /*
    How many permissions each role ends up with, for the little count
    under each column heading. Recomputed only when something changes.
  */
  const counts = useMemo(() => {
    const result = {};

    roles.forEach((role) => {
      result[role._id] = permissionsOf(role).length;
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, pending]);

  if (roles.length === 0 || permissionGroups.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <p className="text-sm text-slate-500">
          The matrix needs at least one role and the permission list.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ==================== the toolbar ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-slate-500">
          <MdOutlineInfo size={16} className="text-slate-400" />
          {canUpdate
            ? "Click a cell to grant or remove a permission. Nothing is saved until you press Save."
            : "Read only - you do not have permission to change roles."}
        </p>

        {canUpdate && hasChanges && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Discard
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-10 px-5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[130px]"
            >
              {saving ? <ClipLoader size={18} color="white" /> : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {/* ==================== the grid ====================
          A wide table on a narrow screen has to scroll SIDEWAYS inside
          its own box, not push the whole page sideways - hence the
          overflow-x-auto wrapper.                                    */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {/*
                  sticky left keeps the permission name visible while
                  the role columns scroll under it - without it, half
                  the grid is unreadable on a laptop.
                */}
                <th className="text-left font-medium text-slate-500 px-4 py-3 sticky left-0 bg-slate-50 min-w-[240px] z-10">
                  Permission
                </th>

                {roles.map((role) => (
                  <th
                    key={role._id}
                    className="px-3 py-3 text-center font-medium text-slate-700 min-w-[110px]"
                  >
                    <div className="flex items-center justify-center gap-1">
                      {role.name}
                      {role.name === "Super Admin" && (
                        <MdLock
                          size={13}
                          className="text-slate-400"
                          title="Super Admin always keeps every permission"
                        />
                      )}
                    </div>
                    <div className="text-[11px] font-normal text-slate-400 mt-0.5">
                      {counts[role._id]} granted
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {permissionGroups.map((group) => (
                /*
                  A module contributes TWO kinds of row - one heading
                  and one per permission - so they are wrapped in a
                  Fragment. It has to be the long <Fragment> form and
                  not <>, because only the long form can carry the
                  `key` React needs on anything produced by a .map().
                */
                <Fragment key={group.module}>
                  <tr className="bg-slate-50/60">
                    <td
                      colSpan={roles.length + 1}
                      className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50/60"
                    >
                      {group.module}
                    </td>
                  </tr>

                  {group.permissions.map((permission) => (
                    <tr
                      key={permission.key}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                    >
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <button
                          type="button"
                          onClick={() => toggleRow(permission.key)}
                          disabled={!canUpdate}
                          className="text-left disabled:cursor-default group"
                          title={
                            canUpdate
                              ? "Grant or remove this for every role at once"
                              : permission.key
                          }
                        >
                          <span className="block text-slate-700 group-enabled:group-hover:text-indigo-700">
                            {permission.label}
                          </span>
                          <span className="block text-[11px] text-slate-400 font-mono">
                            {permission.key}
                          </span>
                        </button>
                      </td>

                      {roles.map((role) => {
                        const isGranted = permissionsOf(role).includes(
                          permission.key
                        );

                        const isLocked =
                          !canUpdate || role.name === "Super Admin";

                        // did this cell change since the page loaded?
                        const wasGranted = (role.permissions || []).includes(
                          permission.key
                        );
                        const isDirty = isGranted !== wasGranted;

                        return (
                          <td
                            key={role._id}
                            className="px-3 py-2.5 text-center"
                          >
                            <button
                              type="button"
                              onClick={() => toggleCell(role, permission.key)}
                              disabled={isLocked}
                              title={
                                role.name === "Super Admin"
                                  ? "Super Admin always keeps every permission"
                                  : `${role.name} - ${permission.label}`
                              }
                              className={`w-6 h-6 rounded-md border flex items-center justify-center mx-auto transition-colors ${
                                isGranted
                                  ? "bg-indigo-600 border-indigo-600 text-white"
                                  : "bg-white border-slate-300 text-transparent"
                              } ${
                                isLocked
                                  ? "opacity-70 cursor-default"
                                  : "hover:border-indigo-400 cursor-pointer"
                              } ${
                                /* an unsaved change gets a ring, so it is
                                   obvious what is about to be written */
                                isDirty ? "ring-2 ring-amber-400" : ""
                              }`}
                            >
                              <MdCheck size={15} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {hasChanges && (
        <p className="text-xs text-amber-600">
          The cells with an amber ring have not been saved yet.
        </p>
      )}
    </div>
  );
}

export default RoleMatrix;
