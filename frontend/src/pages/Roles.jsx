/*
=========================================================================
  PAGE: Roles & Permissions   (RBAC)
=========================================================================
  Here an administrator builds the rules of the whole application:

    - create a role
    - tick the permissions that role should have
    - edit or delete a role

  The list of permissions is NOT written in this file. We download it
  from the backend (/api/role/permissions), so the frontend and the
  backend can never disagree about which permissions exist.

  TWO VIEWS OF THE SAME DATA   (Module 9 added the second)
  --------------------------------------------------------
    LIST    one card per role - "what can the Manager role do?"
    MATRIX  every role and every permission on one grid -
            "WHO can delete a user?"

  The second question is the one an administrator actually asks, and
  the card view could only answer it by opening four roles one after
  another. The matrix makes no extra request: it is drawn from the same
  two calls this page already makes.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdAdd,
  MdEdit,
  MdDelete,
  MdLock,
  MdOutlineViewList,
  MdOutlineGridOn,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";

import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import RoleMatrix from "../components/RoleMatrix.jsx";

function Roles() {
  const { userData } = useSelector((state) => state.user);

  const [roles, setRoles] = useState([]);
  const [permissionGroups, setPermissionGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  // "list" (one card per role) or "matrix" (the grid) - see the header
  const [view, setView] = useState("list");

  /* ---------------- the add / edit pop-up ---------------- */
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    permissions: [], // the ticked checkboxes
  });

  /* ---------------- the delete pop-up ---------------- */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = hasPermission(userData, PERMISSIONS.ROLE_CREATE);
  const canUpdate = hasPermission(userData, PERMISSIONS.ROLE_UPDATE);
  const canDelete = hasPermission(userData, PERMISSIONS.ROLE_DELETE);

  /* =================================================================
     LOAD THE ROLES
     ================================================================= */
  const fetchRoles = async () => {
    setLoading(true);

    try {
      const result = await api.get("/api/role/all");
      setRoles(result.data.roles);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  /* =================================================================
     LOAD THE ROLES AND THE PERMISSION LIST, once when the page opens
     ================================================================= */
  useEffect(() => {
    const fetchEverything = async () => {
      await fetchRoles();

      try {
        const result = await api.get("/api/role/permissions");
        setPermissionGroups(result.data.groups);
      } catch (error) {
        console.log("Permissions error", error);
      }
    };

    fetchEverything();
  }, []);

  /* =================================================================
     OPEN THE FORM
     ================================================================= */
  const openAddForm = () => {
    setEditingRole(null);
    setForm({ name: "", description: "", permissions: [] });
    setShowForm(true);
  };

  const openEditForm = (role) => {
    setEditingRole(role);
    setForm({
      name: role.name,
      description: role.description || "",
      // [...] makes a COPY of the array, so editing the form does not
      // change the row in the table behind the pop-up
      permissions: [...role.permissions],
    });
    setShowForm(true);
  };

  /* =================================================================
     TICK / UNTICK ONE PERMISSION
     ================================================================= */
  const togglePermission = (permissionKey) => {
    setForm((previous) => {
      const isAlreadyTicked = previous.permissions.includes(permissionKey);

      return {
        ...previous,
        permissions: isAlreadyTicked
          ? // remove it -> keep everything that is NOT this one
            previous.permissions.filter((item) => item !== permissionKey)
          : // add it -> old list + this one
            [...previous.permissions, permissionKey],
      };
    });
  };

  /*
    The "select all" checkbox of one module (e.g. all User permissions).
  */
  const toggleModule = (group) => {
    const keysOfThisModule = group.permissions.map((item) => item.key);

    const areAllTicked = keysOfThisModule.every((key) =>
      form.permissions.includes(key)
    );

    setForm((previous) => ({
      ...previous,
      permissions: areAllTicked
        ? previous.permissions.filter((key) => !keysOfThisModule.includes(key))
        : // Set removes duplicates automatically
          [...new Set([...previous.permissions, ...keysOfThisModule])],
    }));
  };

  /* =================================================================
     SAVE (create or update)
     ================================================================= */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("Role name is required");
      return;
    }

    setSaving(true);

    try {
      if (editingRole) {
        const result = await api.put(`/api/role/${editingRole._id}`, form);
        toast.success(result.data.message);
      } else {
        const result = await api.post("/api/role/create", form);
        toast.success(result.data.message);
      }

      setShowForm(false);
      fetchRoles();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/role/${deleteTarget._id}`);

      toast.success(result.data.message);
      setDeleteTarget(null);
      fetchRoles();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            Roles & Permissions
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            A role decides what a user can see and do.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* ---------- list / matrix switch ---------- */}
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {[
              {
                key: "list",
                label: "List",
                icon: <MdOutlineViewList size={17} />,
              },
              {
                key: "matrix",
                label: "Matrix",
                icon: <MdOutlineGridOn size={16} />,
              },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                className={`h-10 px-3.5 text-sm flex items-center gap-1.5 transition-colors ${
                  view === option.key
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>

          {canCreate && (
            <button
              onClick={openAddForm}
              className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
            >
              <MdAdd size={19} /> Add Role
            </button>
          )}
        </div>
      </div>

      {/* ==================== the list / the matrix ==================== */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 flex justify-center">
          <ClipLoader size={35} color="#4f46e5" />
        </div>
      ) : view === "matrix" ? (
        <RoleMatrix
          roles={roles}
          permissionGroups={permissionGroups}
          canUpdate={canUpdate}
          /*
            After the matrix saves, the roles are refetched so the
            "granted" counts and the card view are both right - and so
            the grid stops calling its own cells unsaved.
          */
          onSaved={fetchRoles}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {roles.map((role) => (
            <div
              key={role._id}
              className="bg-white rounded-2xl border border-slate-200 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">
                      {role.name}
                    </h3>

                    {/* the padlock marks a role that cannot be deleted */}
                    {role.isSystem && (
                      <span
                        title="System role - cannot be deleted"
                        className="text-slate-400"
                      >
                        <MdLock size={15} />
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-500 mt-1">
                    {role.description || "No description"}
                  </p>
                </div>

                <div className="flex gap-1 shrink-0">
                  {canUpdate && (
                    <button
                      title="Edit"
                      onClick={() => openEditForm(role)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                    >
                      <MdEdit size={18} />
                    </button>
                  )}

                  {/* a system role has no delete button at all */}
                  {canDelete && !role.isSystem && (
                    <button
                      title="Delete"
                      onClick={() => setDeleteTarget(role)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                    >
                      <MdDelete size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-100 text-sm">
                <div>
                  <span className="text-slate-500">Permissions: </span>
                  <span className="font-medium text-slate-800">
                    {role.permissions.length}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Users: </span>
                  <span className="font-medium text-slate-800">
                    {role.userCount}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ==================== add / edit pop-up ==================== */}
      <Modal
        isOpen={showForm}
        title={editingRole ? "Edit Role" : "Add Role"}
        onClose={() => setShowForm(false)}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Role name <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                // a system role keeps its name for ever
                disabled={editingRole?.isSystem}
                placeholder="e.g. Team Lead"
                className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
              {editingRole?.isSystem && (
                <p className="text-xs text-slate-400">
                  A system role cannot be renamed.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Description
              </label>
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="What is this role for?"
                className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* ---------- the permission checkboxes ---------- */}
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-700 mb-3">
              Permissions ({form.permissions.length} selected)
            </p>

            <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-1">
              {permissionGroups.map((group) => {
                const keysOfThisModule = group.permissions.map((i) => i.key);

                const areAllTicked = keysOfThisModule.every((key) =>
                  form.permissions.includes(key)
                );

                return (
                  <div
                    key={group.module}
                    className="border border-slate-200 rounded-xl p-4"
                  >
                    {/* the "select all" row of the module */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={areAllTicked}
                        onChange={() => toggleModule(group)}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      <span className="text-sm font-semibold text-slate-800">
                        {group.module}
                      </span>
                    </label>

                    {/* one checkbox per permission */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pl-6">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={form.permissions.includes(permission.key)}
                            onChange={() => togglePermission(permission.key)}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <span className="text-sm text-slate-600">
                            {permission.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---------- buttons ---------- */}
          <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={saving}
              className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[130px]"
            >
              {saving ? (
                <ClipLoader size={20} color="white" />
              ) : editingRole ? (
                "Save changes"
              ) : (
                "Create role"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this role?"
        message={`The role "${deleteTarget?.name}" will be removed. This only works when no user is using it.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Roles;
