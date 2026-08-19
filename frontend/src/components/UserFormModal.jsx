/*
=========================================================================
  COMPONENT: UserFormModal
=========================================================================
  One form used for BOTH "Add Employee" and "Edit Employee".

  How does it know which one it is?
  By the "editingUser" prop:
      editingUser = null    ->  we are creating a new employee
      editingUser = {...}   ->  we are editing that employee

  PROPS
    isOpen        show or hide the pop-up
    editingUser   null when adding, the user object when editing
    roles         the list of roles for the dropdown
    departments   the list of departments for the dropdown
    onClose       called when the user cancels
    onSaved       called after a successful save, so the Users page can
                  reload its table
=========================================================================
*/

import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";

import Modal from "./Modal.jsx";
import { api, getErrorMessage } from "../utils/api.js";
import { toInputDate } from "../utils/config.js";

// the empty form we start from when adding a new employee
const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  role: "",
  department: "",
  phone: "",
  designation: "",
  gender: "",
  dateOfBirth: "",
  dateOfJoining: "",
  address: "",
};

function UserFormModal({
  isOpen,
  editingUser,
  roles = [],
  departments = [],
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  // true when we are editing, false when we are adding
  const isEditMode = Boolean(editingUser);

  /*
    Every time the pop-up opens we refill the form:
      - editing -> with that employee's current values
      - adding  -> with empty values

    Without this useEffect the form would still show the data of the
    employee we edited before.
  */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (editingUser) {
      setForm({
        firstName: editingUser.firstName || "",
        lastName: editingUser.lastName || "",
        email: editingUser.email || "",
        password: "", // never pre-fill a password
        role: editingUser.role?._id || "",
        department: editingUser.department?._id || "",
        phone: editingUser.phone || "",
        designation: editingUser.designation || "",
        gender: editingUser.gender || "",
        dateOfBirth: toInputDate(editingUser.dateOfBirth),
        dateOfJoining: toInputDate(editingUser.dateOfJoining),
        address: editingUser.address || "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [isOpen, editingUser]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // ---- the checks we can do without the server ----
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First name and last name are required");
      return;
    }

    if (!form.email.trim()) {
      toast.error("Email is required");
      return;
    }

    if (!isEditMode && !form.role) {
      toast.error("Please choose a role");
      return;
    }

    setLoading(true);

    try {
      if (isEditMode) {
        /*
          When editing we do NOT send the role or the password.
          The role has its own button ("Change role") and the password
          is changed by the employee themselves.
        */
        const { password, role, ...detailsToUpdate } = form;

        const result = await api.put(
          `/api/user/${editingUser._id}`,
          detailsToUpdate
        );

        toast.success(result.data.message);
      } else {
        /*
          When adding, an empty password means "generate a temporary one
          and email it", so we simply remove the empty field.
        */
        const dataToSend = { ...form };

        if (!dataToSend.password) {
          delete dataToSend.password;
        }

        const result = await api.post("/api/user/create", dataToSend);

        toast.success(result.data.message);
      }

      onSaved(); // tell the Users page to reload its table
      onClose(); // close the pop-up
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  // the same tailwind classes for every input, written once
  const inputClass =
    "h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 w-full";

  return (
    <Modal
      isOpen={isOpen}
      title={isEditMode ? "Edit Employee" : "Add Employee"}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* ---------- first name ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              First name <span className="text-red-500">*</span>
            </label>
            <input
              name="firstName"
              value={form.firstName}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- last name ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Last name <span className="text-red-500">*</span>
            </label>
            <input
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- email ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- password: only when adding ---------- */}
          {!isEditMode && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                type="text"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Leave empty to email a temporary one"
                className={inputClass}
              />
            </div>
          )}

          {/* ---------- role: only when adding ---------- */}
          {!isEditMode && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                Role <span className="text-red-500">*</span>
              </label>
              <select
                name="role"
                value={form.role}
                onChange={handleChange}
                className={`${inputClass} bg-white`}
              >
                <option value="">Select a role</option>
                {roles.map((role) => (
                  <option key={role._id} value={role._id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ---------- department ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Department
            </label>
            <select
              name="department"
              value={form.department}
              onChange={handleChange}
              className={`${inputClass} bg-white`}
            >
              <option value="">No department</option>
              {departments.map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          {/* ---------- designation ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Designation
            </label>
            <input
              name="designation"
              value={form.designation}
              onChange={handleChange}
              placeholder="Software Engineer"
              className={inputClass}
            />
          </div>

          {/* ---------- phone ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Phone</label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- gender ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Gender</label>
            <select
              name="gender"
              value={form.gender}
              onChange={handleChange}
              className={`${inputClass} bg-white`}
            >
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* ---------- date of birth ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Date of birth
            </label>
            <input
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- date of joining ---------- */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Date of joining
            </label>
            <input
              type="date"
              name="dateOfJoining"
              value={form.dateOfJoining}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* ---------- address ---------- */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">
              Address
            </label>
            <textarea
              name="address"
              value={form.address}
              onChange={handleChange}
              rows={2}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
            />
          </div>
        </div>

        {/* ---------- buttons ---------- */}
        <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={loading}
            className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[140px]"
          >
            {loading ? (
              <ClipLoader size={20} color="white" />
            ) : isEditMode ? (
              "Save changes"
            ) : (
              "Create employee"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default UserFormModal;
