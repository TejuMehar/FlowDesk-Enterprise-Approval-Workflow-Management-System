/*
=========================================================================
  PAGE: Employees (User Management)
=========================================================================
  Everything an administrator can do with employees:

    - see them in a table with search, filters and pagination
    - create a new employee
    - edit an employee
    - activate / deactivate an employee
    - change the role of an employee
    - delete an employee (soft delete on the backend)

  Every button is wrapped in a permission check, so a Manager who may
  only READ users never sees the Add / Delete buttons.
=========================================================================
*/

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdAdd,
  MdSearch,
  MdEdit,
  MdDelete,
  MdToggleOn,
  MdToggleOff,
  MdSecurity,
  MdChevronLeft,
  MdChevronRight,
} from "react-icons/md";

import { api, getErrorMessage, isCancelledError } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import { getPhotoUrl } from "../utils/config.js";

import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import UserFormModal from "../components/UserFormModal.jsx";

function Users() {
  const { userData } = useSelector((state) => state.user);

  /* ---------------- the data ---------------- */
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ---------------- search + filters + pages ---------------- */
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);

  /* ---------------- the pop-ups ---------------- */
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const [roleModalUser, setRoleModalUser] = useState(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* ---------------- what may this user do? ---------------- */
  const canCreate = hasPermission(userData, PERMISSIONS.USER_CREATE);
  const canUpdate = hasPermission(userData, PERMISSIONS.USER_UPDATE);
  const canDelete = hasPermission(userData, PERMISSIONS.USER_DELETE);
  const canChangeStatus = hasPermission(userData, PERMISSIONS.USER_STATUS);
  const canAssignRole = hasPermission(userData, PERMISSIONS.USER_ASSIGN_ROLE);
  const canReadRoles = hasPermission(userData, PERMISSIONS.ROLE_READ);
  const canReadDepartments = hasPermission(
    userData,
    PERMISSIONS.DEPARTMENT_READ
  );

  /* =================================================================
     LOAD THE USERS
     -----------------------------------------------------------------
     useCallback keeps the SAME function between renders as long as the
     filters do not change. That stops the useEffect below from running
     again and again in an endless loop.
     ================================================================= */
  const fetchUsers = useCallback(
    async (signal) => {
      setLoading(true);

      try {
        /*
          URLSearchParams builds the query text for us and escapes
          special characters, e.g. "?page=1&limit=10&search=john%20doe"
        */
        const query = new URLSearchParams({
          page: String(page),
          limit: "10",
        });

        if (search.trim()) query.append("search", search.trim());
        if (roleFilter) query.append("role", roleFilter);
        if (departmentFilter) query.append("department", departmentFilter);
        if (statusFilter) query.append("status", statusFilter);

        const result = await api.get(`/api/user/all?${query.toString()}`, {
          signal,
        });

        setUsers(result.data.users);
        setTotalPages(result.data.pagination.totalPages);
        setTotalUsers(result.data.pagination.totalUsers);
      } catch (error) {
        // a newer search replaced this one - see isCancelledError
        if (isCancelledError(error)) {
          return;
        }

        toast.error(getErrorMessage(error));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [page, search, roleFilter, departmentFilter, statusFilter]
  );

  /*
    Runs whenever fetchUsers changes, which means whenever a filter or
    the page number changes.

    The little timer ("debounce") waits 400 ms before calling the
    backend. Without it we would send one request per typed letter.

    The AbortController does the OTHER half of the job. The timer stops
    us asking too often; the controller stops a slow answer to an old
    question from landing after a fast answer to the new one and
    quietly repainting the table with the wrong rows.
  */
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetchUsers(controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchUsers]);

  /*
    DELETING THE LAST ROW OF THE LAST PAGE.

    Removing the only employee on page 4 leaves the page number pointing
    past the end of a list that now has three pages, and the table goes
    blank under a footer that says "Page 4 of 3" - which reads as the
    delete having broken something. Stepping back is the answer the user
    would have chosen anyway.
  */
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  /* =================================================================
     LOAD THE ROLES AND DEPARTMENTS (for the dropdowns)
     Runs only once, when the page opens.
     ================================================================= */
  useEffect(() => {
    const fetchDropdownData = async () => {
      try {
        if (canReadRoles) {
          const roleResult = await api.get("/api/role/all");
          setRoles(roleResult.data.roles);
        }

        if (canReadDepartments) {
          const departmentResult = await api.get("/api/department/all");
          setDepartments(departmentResult.data.departments);
        }
      } catch (error) {
        console.log("Dropdown data error", error);
      }
    };

    fetchDropdownData();
  }, [canReadRoles, canReadDepartments]);

  /* =================================================================
     ACTIVATE / DEACTIVATE
     ================================================================= */
  const handleToggleStatus = async (user) => {
    try {
      const result = await api.patch(`/api/user/${user._id}/status`, {
        isActive: !user.isActive, // "!" flips true into false
      });

      toast.success(result.data.message);
      fetchUsers();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  /* =================================================================
     CHANGE THE ROLE
     ================================================================= */
  const handleAssignRole = async () => {
    if (!selectedRoleId) {
      toast.error("Please choose a role");
      return;
    }

    setRoleSaving(true);

    try {
      const result = await api.patch(`/api/user/${roleModalUser._id}/role`, {
        role: selectedRoleId,
      });

      toast.success(result.data.message);

      setRoleModalUser(null);
      fetchUsers();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRoleSaving(false);
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/user/${deleteTarget._id}`);

      toast.success(result.data.message);

      setDeleteTarget(null);
      fetchUsers();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const selectClass =
    "h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white";

  return (
    <div className="flex flex-col gap-5">
      {/* ==================== header ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Employees</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalUsers} employee{totalUsers === 1 ? "" : "s"} found
          </p>
        </div>

        {canCreate && (
          <button
            onClick={() => {
              setEditingUser(null); // null = "add" mode
              setShowForm(true);
            }}
            className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <MdAdd size={19} /> Add Employee
          </button>
        )}
      </div>

      {/* ==================== search + filters ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <MdSearch
            size={19}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1); // a new search always starts on page 1
            }}
            placeholder="Search by name, email or employee ID"
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        {canReadRoles && (
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="">All roles</option>
            {roles.map((role) => (
              <option key={role._id} value={role._id}>
                {role.name}
              </option>
            ))}
          </select>
        )}

        {canReadDepartments && (
          <select
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department._id} value={department._id}>
                {department.name}
              </option>
            ))}
          </select>
        )}

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* ==================== the table ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-16 flex justify-center">
            <ClipLoader size={35} color="#4f46e5" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            No employees found.
          </div>
        ) : (
          /* overflow-x-auto lets the table scroll sideways on a phone */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Employee</th>
                  <th className="text-left font-medium px-5 py-3">Role</th>
                  <th className="text-left font-medium px-5 py-3">
                    Department
                  </th>
                  <th className="text-left font-medium px-5 py-3">Status</th>
                  <th className="text-right font-medium px-5 py-3">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {/*
                  .map() draws one <tr> per user.
                  The "key" helps React know which row is which.
                */}
                {users.map((user) => {
                  const photo = getPhotoUrl(user.photoUrl);

                  // an admin must not act on their own row
                  const isMe = user._id === userData?._id;

                  return (
                    <tr key={user._id} className="hover:bg-slate-50">
                      {/* ---------- employee ---------- */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {photo ? (
                            <img
                              src={photo}
                              alt={user.fullName}
                              className="w-9 h-9 rounded-full object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-xs">
                              {user.firstName?.charAt(0).toUpperCase()}
                            </div>
                          )}

                          <div>
                            <p className="font-medium text-slate-800">
                              {user.fullName}
                              {isMe && (
                                <span className="ml-1.5 text-xs text-indigo-600">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {user.email}
                            </p>
                            <p className="text-xs text-slate-400">
                              {user.employeeId}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* ---------- role ---------- */}
                      <td className="px-5 py-3">
                        <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                          {user.role?.name || "-"}
                        </span>
                      </td>

                      {/* ---------- department ---------- */}
                      <td className="px-5 py-3 text-slate-600">
                        {user.department?.name || "-"}
                      </td>

                      {/* ---------- status ---------- */}
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full ${
                            user.isActive
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                          }`}
                        >
                          {user.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>

                      {/* ---------- action buttons ---------- */}
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canUpdate && (
                            <button
                              title="Edit"
                              onClick={() => {
                                setEditingUser(user);
                                setShowForm(true);
                              }}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                            >
                              <MdEdit size={18} />
                            </button>
                          )}

                          {canAssignRole && !isMe && (
                            <button
                              title="Change role"
                              onClick={() => {
                                setRoleModalUser(user);
                                setSelectedRoleId(user.role?._id || "");
                              }}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-amber-600 flex items-center justify-center"
                            >
                              <MdSecurity size={18} />
                            </button>
                          )}

                          {canChangeStatus && !isMe && (
                            <button
                              title={user.isActive ? "Deactivate" : "Activate"}
                              onClick={() => handleToggleStatus(user)}
                              className={`w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center ${
                                user.isActive
                                  ? "text-green-600"
                                  : "text-slate-400"
                              }`}
                            >
                              {user.isActive ? (
                                <MdToggleOn size={22} />
                              ) : (
                                <MdToggleOff size={22} />
                              )}
                            </button>
                          )}

                          {canDelete && !isMe && (
                            <button
                              title="Delete"
                              onClick={() => setDeleteTarget(user)}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                            >
                              <MdDelete size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ==================== pagination ==================== */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <p className="text-sm text-slate-500">
              Page {page} of {totalPages}
            </p>

            <div className="flex gap-2">
              <button
                // Math.max stops the page from going below 1
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page === 1}
                className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
              >
                <MdChevronLeft size={20} />
              </button>

              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page === totalPages}
                className="w-9 h-9 rounded-lg border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50"
              >
                <MdChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ==================== add / edit pop-up ==================== */}
      <UserFormModal
        isOpen={showForm}
        editingUser={editingUser}
        roles={roles}
        departments={departments}
        onClose={() => setShowForm(false)}
        onSaved={fetchUsers}
      />

      {/* ==================== change role pop-up ==================== */}
      <Modal
        isOpen={Boolean(roleModalUser)}
        title="Change Role"
        onClose={() => setRoleModalUser(null)}
        maxWidth="max-w-md"
      >
        <p className="text-sm text-slate-600">
          Choose the new role for <b>{roleModalUser?.fullName}</b>.
        </p>

        <select
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          className="w-full h-11 px-3 mt-4 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">Select a role</option>
          {roles.map((role) => (
            <option key={role._id} value={role._id}>
              {role.name}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setRoleModalUser(null)}
            className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>

          <button
            onClick={handleAssignRole}
            disabled={roleSaving}
            className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[120px]"
          >
            {roleSaving ? <ClipLoader size={20} color="white" /> : "Save role"}
          </button>
        </div>
      </Modal>

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this employee?"
        message={`${deleteTarget?.fullName} will lose access immediately. This can only be undone by an administrator in the database.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Users;
