/*
=========================================================================
  COMPONENT: RequestTypeSettings   (Module 9)
=========================================================================
  Create, rename, retire and delete the kinds of request employees can
  raise.

  Until Module 9 this was an eight-item array in the source code, in
  two copies - one in the backend and one in the frontend. Adding
  "Overtime" needed a developer, a deploy and a restart. It is a
  collection now, and this card owns it.

  THE TWO WARNINGS ON THIS SCREEN ARE THE WHOLE POINT
  ---------------------------------------------------
  A request type is a word three other modules have already written
  down: every Request stores it, every Workflow routes by it, every
  report groups by it. So the two destructive actions are not symmetric
  with the ones on the Roles page, and the UI says so out loud:

    RENAMING  rewrites the requests and workflows carrying the old
              name, in the same second. The confirmation says how many
              will move, because "rename Laptop to Hardware" quietly
              editing 340 approved requests should never be a surprise.

    DELETING  is refused by the backend while anything still points at
              the type. The card offers the alternative first: switch
              it off, and it disappears from the new request form while
              everything that already carries it keeps working.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineCategory,
  MdAdd,
  MdEdit,
  MdDelete,
  MdOutlineAttachMoney,
  MdOutlineDateRange,
  MdOutlineVisibilityOff,
} from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import SettingsCard, {
  settingsInputClass,
  settingsLabelClass,
} from "./SettingsCard.jsx";
import Modal from "../Modal.jsx";
import ConfirmDialog from "../ConfirmDialog.jsx";

// what an empty "Add request type" form looks like
const emptyForm = {
  name: "",
  description: "",
  categories: "",
  needsAmount: false,
  needsDates: false,
  isActive: true,
};

function RequestTypeSettings({ types, loading, canEdit, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // the type whose on/off switch is being flipped, so only its row spins
  const [togglingId, setTogglingId] = useState(null);

  /* =================================================================
     OPEN THE FORM
     -----------------------------------------------------------------
     The categories are a textarea, one per line, because a list of
     five suggestions is faster to type and read that way than through
     five separate inputs with their own add and remove buttons.
     ================================================================= */
  const openAddForm = () => {
    setEditingType(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (type) => {
    setEditingType(type);
    setForm({
      name: type.name,
      description: type.description || "",
      categories: (type.categories || []).join("\n"),
      needsAmount: Boolean(type.needsAmount),
      needsDates: Boolean(type.needsDates),
      isActive: Boolean(type.isActive),
    });
    setShowForm(true);
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  /* =================================================================
     SAVE (create or update)
     ================================================================= */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("The request type needs a name");
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      // one category per line, blanks dropped
      categories: form.categories
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      needsAmount: form.needsAmount,
      needsDates: form.needsDates,
      isActive: form.isActive,
    };

    try {
      const result = editingType
        ? await api.put(`/api/request-type/${editingType._id}`, payload)
        : await api.post("/api/request-type/create", payload);

      /*
        The backend's message is used rather than a fixed one, because
        after a rename it carries the count of requests and workflows
        that moved with it - the single most important thing to tell
        somebody who just renamed a type.
      */
      toast.success(result.data.message);

      setShowForm(false);
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     SWITCH A TYPE ON OR OFF
     -----------------------------------------------------------------
     The everyday alternative to deleting, and it is one click on the
     row rather than something buried in the edit form.
     ================================================================= */
  const toggleActive = async (type) => {
    setTogglingId(type._id);

    try {
      const result = await api.put(`/api/request-type/${type._id}`, {
        isActive: !type.isActive,
      });

      toast.success(
        type.isActive
          ? `"${type.name}" is switched off. Existing requests are unaffected.`
          : `"${type.name}" can be chosen again.`
      );

      onChanged();
      return result;
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setTogglingId(null);
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/request-type/${deleteTarget._id}`);

      toast.success(result.data.message);
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      /*
        The refusal ("used by 340 request(s)... switch it off instead")
        is the most useful message this card ever shows, so the dialog
        is closed and the toast is left to do the explaining.
      */
      toast.error(getErrorMessage(error));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SettingsCard
        icon={<MdOutlineCategory size={20} />}
        title="Request types"
        description="The kinds of request an employee can raise. Each one carries its own category suggestions and decides which extra fields the request form shows."
        footer={
          canEdit && (
            <div className="mt-4">
              <button
                type="button"
                onClick={openAddForm}
                className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 flex items-center gap-1.5"
              >
                <MdAdd size={18} /> Add request type
              </button>
            </div>
          )
        }
      >
        {loading ? (
          <div className="py-10 flex justify-center">
            <ClipLoader size={30} color="#4f46e5" />
          </div>
        ) : types.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl py-8 text-center">
            <p className="text-sm text-slate-500">
              There are no request types yet.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Nobody can raise a request until at least one exists.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
            {types.map((type) => (
              <div
                key={type._id}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className={`text-sm font-medium ${
                        type.isActive ? "text-slate-800" : "text-slate-400"
                      }`}
                    >
                      {type.name}
                    </p>

                    {!type.isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        <MdOutlineVisibilityOff size={12} />
                        Switched off
                      </span>
                    )}

                    {/* what the request form will show for this type */}
                    {type.needsAmount && (
                      <span
                        title="The request form shows an Amount field"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"
                      >
                        <MdOutlineAttachMoney size={12} />
                        Amount
                      </span>
                    )}

                    {type.needsDates && (
                      <span
                        title="The request form shows start and end dates"
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700"
                      >
                        <MdOutlineDateRange size={12} />
                        Dates
                      </span>
                    )}
                  </div>

                  {type.description && (
                    <p className="text-xs text-slate-500 mt-1">
                      {type.description}
                    </p>
                  )}

                  {(type.categories || []).length > 0 && (
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {type.categories.length} category suggestion(s):{" "}
                      {type.categories.join(", ")}
                    </p>
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* on / off */}
                    <button
                      type="button"
                      title={
                        type.isActive
                          ? "Switch off - it disappears from the new request form"
                          : "Switch on"
                      }
                      onClick={() => toggleActive(type)}
                      disabled={togglingId === type._id}
                      className={`h-6 w-11 rounded-full transition-colors relative disabled:opacity-50 ${
                        type.isActive ? "bg-indigo-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                          type.isActive ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      title="Edit"
                      onClick={() => openEditForm(type)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                    >
                      <MdEdit size={17} />
                    </button>

                    <button
                      type="button"
                      title="Delete"
                      onClick={() => setDeleteTarget(type)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                    >
                      <MdDelete size={17} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {/* ==================== add / edit pop-up ==================== */}
      <Modal
        isOpen={showForm}
        title={editingType ? "Edit request type" : "Add request type"}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={settingsLabelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Overtime"
                className={settingsInputClass}
              />

              {/*
                THE RENAME WARNING. Shown only while editing, and only
                once the name has really been changed - a warning that
                is always there is a warning nobody reads.
              */}
              {editingType && form.name.trim() !== editingType.name && (
                <p className="text-xs text-amber-600">
                  Renaming also rewrites every existing request and
                  workflow that carries "{editingType.name}", so nothing
                  is left pointing at a word that no longer exists.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={settingsLabelClass}>Description</label>
              <input
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="What is this type for?"
                className={settingsInputClass}
              />
            </div>
          </div>

          {/* ---------- the categories ---------- */}
          <div className="flex flex-col gap-1.5 mt-4">
            <label className={settingsLabelClass}>
              Category suggestions
            </label>
            <textarea
              name="categories"
              value={form.categories}
              onChange={handleChange}
              rows={5}
              placeholder={"Sick Leave\nCasual Leave\nUnpaid Leave"}
              className="px-3 py-2.5 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 w-full resize-y"
            />
            <p className="text-xs text-slate-400">
              One per line. They only SUGGEST - the category field on a
              request is free text, so an employee can always type their
              own.
            </p>
          </div>

          {/* ---------- which fields the form shows ---------- */}
          <div className="mt-5">
            <p className={`${settingsLabelClass} mb-2`}>
              Extra fields on the request form
            </p>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="needsAmount"
                  checked={form.needsAmount}
                  onChange={handleChange}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span className="text-sm text-slate-600">
                  Show an Amount field (Purchase, Expense, Budget ...)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="needsDates"
                  checked={form.needsDates}
                  onChange={handleChange}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span className="text-sm text-slate-600">
                  Show Start date and End date (Leave, Travel ...)
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={form.isActive}
                  onChange={handleChange}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span className="text-sm text-slate-600">
                  Employees can choose this type
                </span>
              </label>
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
              ) : editingType ? (
                "Save changes"
              ) : (
                "Create type"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this request type?"
        message={`"${deleteTarget?.name}" will be removed. This only works when no request and no workflow still uses it - if any do, switch it off instead and they will keep working.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default RequestTypeSettings;
