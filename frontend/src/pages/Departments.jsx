/*
=========================================================================
  PAGE: Departments
=========================================================================
  Create, edit and delete departments, and choose the manager of each
  one.

  The manager dropdown is filled with the employees we get from
  /api/user/all. If the logged in user is not allowed to read users,
  the "Assign manager" button is simply hidden.
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
  MdSearch,
  MdPersonAdd,
  MdApartment,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
import { getPhotoUrl } from "../utils/config.js";

import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

function Departments() {
  const { userData } = useSelector((state) => state.user);

  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  /* ---------------- add / edit pop-up ---------------- */
  const [showForm, setShowForm] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", description: "" });

  /* ---------------- manager pop-up ---------------- */
  const [managerTarget, setManagerTarget] = useState(null);
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);

  /* ---------------- delete pop-up ---------------- */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = hasPermission(userData, PERMISSIONS.DEPARTMENT_CREATE);
  const canUpdate = hasPermission(userData, PERMISSIONS.DEPARTMENT_UPDATE);
  const canDelete = hasPermission(userData, PERMISSIONS.DEPARTMENT_DELETE);
  const canAssignManager = hasPermission(
    userData,
    PERMISSIONS.DEPARTMENT_ASSIGN_MANAGER
  );
  const canReadUsers = hasPermission(userData, PERMISSIONS.USER_READ);

  /* =================================================================
     LOAD THE DEPARTMENTS
     ================================================================= */
  const fetchDepartments = async (searchText = "") => {
    setLoading(true);

    try {
      const query = searchText.trim()
        ? `?search=${encodeURIComponent(searchText.trim())}`
        : "";

      const result = await api.get(`/api/department/all${query}`);

      setDepartments(result.data.departments);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  /*
    Runs when the page opens AND every time the search text changes.
    The 400 ms timer stops us from calling the backend on every letter.
  */
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDepartments(search);
    }, 400);

    return () => clearTimeout(timer);
  }, [search]);

  /* =================================================================
     LOAD THE EMPLOYEES (for the manager dropdown), once
     ================================================================= */
  useEffect(() => {
    const fetchEmployees = async () => {
      if (!canReadUsers) {
        return;
      }

      try {
        // limit=100 -> enough names for the dropdown
        const result = await api.get("/api/user/all?limit=100&status=active");
        setEmployees(result.data.users);
      } catch (error) {
        console.log("Employees error", error);
      }
    };

    fetchEmployees();
  }, [canReadUsers]);

  /* =================================================================
     OPEN THE FORM
     ================================================================= */
  const openAddForm = () => {
    setEditingDepartment(null);
    setForm({ name: "", code: "", description: "" });
    setShowForm(true);
  };

  const openEditForm = (department) => {
    setEditingDepartment(department);
    setForm({
      name: department.name,
      code: department.code,
      description: department.description || "",
    });
    setShowForm(true);
  };

  /* =================================================================
     SAVE (create or update)
     ================================================================= */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required");
      return;
    }

    setSaving(true);

    try {
      if (editingDepartment) {
        const result = await api.put(
          `/api/department/${editingDepartment._id}`,
          form
        );
        toast.success(result.data.message);
      } else {
        const result = await api.post("/api/department/create", form);
        toast.success(result.data.message);
      }

      setShowForm(false);
      fetchDepartments(search);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     ASSIGN THE MANAGER
     ================================================================= */
  const handleAssignManager = async () => {
    setManagerSaving(true);

    try {
      const result = await api.patch(
        `/api/department/${managerTarget._id}/manager`,
        // an empty selection means "remove the manager"
        { manager: selectedManagerId || null }
      );

      toast.success(result.data.message);

      setManagerTarget(null);
      fetchDepartments(search);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setManagerSaving(false);
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/department/${deleteTarget._id}`);

      toast.success(result.data.message);
      setDeleteTarget(null);
      fetchDepartments(search);
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
          <h1 className="text-xl font-semibold text-slate-800">Departments</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {departments.length} department
            {departments.length === 1 ? "" : "s"}
          </p>
        </div>

        {canCreate && (
          <button
            onClick={openAddForm}
            className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <MdAdd size={19} /> Add Department
          </button>
        )}
      </div>

      {/* ==================== search ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="relative max-w-md">
          <MdSearch
            size={19}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code"
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* ==================== the cards ==================== */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 flex justify-center">
          <ClipLoader size={35} color="#4f46e5" />
        </div>
      ) : departments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-500 text-sm">
          No departments found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {departments.map((department) => {
            const managerPhoto = getPhotoUrl(department.manager?.photoUrl);

            return (
              <div
                key={department._id}
                className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col"
              >
                {/* ---------- title row ---------- */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                      <MdApartment size={21} />
                    </div>

                    <div>
                      <h3 className="font-semibold text-slate-800">
                        {department.name}
                      </h3>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {department.code}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-1 shrink-0">
                    {canUpdate && (
                      <button
                        title="Edit"
                        onClick={() => openEditForm(department)}
                        className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                      >
                        <MdEdit size={18} />
                      </button>
                    )}

                    {canDelete && (
                      <button
                        title="Delete"
                        onClick={() => setDeleteTarget(department)}
                        className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                      >
                        <MdDelete size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-slate-500 mt-3 flex-1">
                  {department.description || "No description"}
                </p>

                {/* ---------- the manager ---------- */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mb-2">Manager</p>

                  {department.manager ? (
                    <div className="flex items-center gap-2">
                      {managerPhoto ? (
                        <img
                          src={managerPhoto}
                          alt="manager"
                          className="w-8 h-8 rounded-full object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                          {department.manager.firstName
                            ?.charAt(0)
                            .toUpperCase()}
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {department.manager.firstName}{" "}
                          {department.manager.lastName}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {department.manager.email}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      No manager assigned
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-slate-500">
                      {department.employeeCount} employee
                      {department.employeeCount === 1 ? "" : "s"}
                    </span>

                    {canAssignManager && canReadUsers && (
                      <button
                        onClick={() => {
                          setManagerTarget(department);
                          setSelectedManagerId(department.manager?._id || "");
                        }}
                        className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                      >
                        <MdPersonAdd size={15} />
                        {department.manager ? "Change" : "Assign"} manager
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== add / edit pop-up ==================== */}
      <Modal
        isOpen={showForm}
        title={editingDepartment ? "Edit Department" : "Add Department"}
        onClose={() => setShowForm(false)}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Human Resources"
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Code <span className="text-red-500">*</span>
            </label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. HR"
              maxLength={10}
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 uppercase"
            />
            <p className="text-xs text-slate-400">
              A short code, maximum 10 characters. It is saved in capitals.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
              placeholder="What does this department do?"
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 mt-2">
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
              className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[140px]"
            >
              {saving ? (
                <ClipLoader size={20} color="white" />
              ) : editingDepartment ? (
                "Save changes"
              ) : (
                "Create department"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== manager pop-up ==================== */}
      <Modal
        isOpen={Boolean(managerTarget)}
        title="Assign Manager"
        onClose={() => setManagerTarget(null)}
        maxWidth="max-w-md"
      >
        <p className="text-sm text-slate-600">
          Choose the manager of <b>{managerTarget?.name}</b>.
        </p>

        <select
          value={selectedManagerId}
          onChange={(e) => setSelectedManagerId(e.target.value)}
          className="w-full h-11 px-3 mt-4 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">No manager</option>
          {employees.map((employee) => (
            <option key={employee._id} value={employee._id}>
              {employee.fullName} ({employee.email})
            </option>
          ))}
        </select>

        <p className="text-xs text-slate-400 mt-2">
          The chosen employee is automatically moved into this department.
        </p>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setManagerTarget(null)}
            className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>

          <button
            onClick={handleAssignManager}
            disabled={managerSaving}
            className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[120px]"
          >
            {managerSaving ? <ClipLoader size={20} color="white" /> : "Save"}
          </button>
        </div>
      </Modal>

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this department?"
        message={`"${deleteTarget?.name}" will be removed. This only works when it has no employees left.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Departments;
