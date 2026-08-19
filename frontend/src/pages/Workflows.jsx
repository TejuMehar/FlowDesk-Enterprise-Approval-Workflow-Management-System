/*
=========================================================================
  PAGE: Workflows   (Module 3 - Workflow Builder)
=========================================================================
  The LIST of approval workflows.

  A workflow is the route a request travels before it is finished:

      Employee -> Manager -> Finance -> Director -> Completed

  This page only creates / renames / deletes / switches workflows on and
  off. The stages themselves are designed on the builder page
  (WorkflowBuilder.jsx), which opens when you press "Open Builder".

  Only ONE workflow per request type can be active at a time, so
  switching one on quietly switches the previous one off - the backend
  does that for us.
=========================================================================
*/

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdAdd,
  MdEdit,
  MdDelete,
  MdSearch,
  MdAccountTree,
  MdTune,
  MdToggleOn,
  MdToggleOff,
} from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { PERMISSIONS, hasPermission } from "../utils/permissions.js";
/*
  MODULE 9 - the request types come from the database now.

  The two dropdowns on this page ask DIFFERENT questions, and the hook
  gives a different list to each:

    the FILTER at the top  -> typeNames, every type there has ever
                              been, so a workflow built for a type that
                              has since been retired stays findable
    the FORM in the pop-up -> activeTypes, because a NEW workflow may
                              only be built for a type employees can
                              actually choose
*/
import useRequestTypes from "../CustomHooks/useRequestTypes.js";
import { describeApprover } from "../utils/workflowConstants.js";

import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

function Workflows() {
  const navigate = useNavigate();
  const { userData } = useSelector((state) => state.user);

  /*
    MODULE 9 - two lists from one hook. See the import note: the filter
    shows every type, the "new workflow" form only the active ones.
  */
  const { typeNames, activeTypes } = useRequestTypes();

  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ---------------- search + filters ---------------- */
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  /* ---------------- add / edit pop-up ---------------- */
  const [showForm, setShowForm] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    /*
      MODULE 9 - empty, not "Leave". A company that renamed or deleted
      that type would otherwise open this form pre-filled with a value
      the backend is about to reject. openAddForm() below picks the
      first type that really exists instead.
    */
    requestType: "",
  });

  /* ---------------- delete pop-up ---------------- */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // the id of the workflow whose switch is busy, so only that one spins
  const [togglingId, setTogglingId] = useState("");

  const canCreate = hasPermission(userData, PERMISSIONS.WORKFLOW_CREATE);
  const canUpdate = hasPermission(userData, PERMISSIONS.WORKFLOW_UPDATE);
  const canDelete = hasPermission(userData, PERMISSIONS.WORKFLOW_DELETE);

  /* =================================================================
     LOAD THE WORKFLOWS
     ================================================================= */
  const fetchWorkflows = async () => {
    setLoading(true);

    try {
      /*
        URLSearchParams builds "?search=x&requestType=y" for us and
        escapes anything the admin typed, so we never build the query
        string by hand.
      */
      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (typeFilter) {
        params.set("requestType", typeFilter);
      }

      if (activeFilter) {
        params.set("isActive", activeFilter);
      }

      const query = params.toString() ? `?${params.toString()}` : "";
      const result = await api.get(`/api/workflow/all${query}`);

      setWorkflows(result.data.workflows);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  /*
    Runs when the page opens and whenever the search or a filter changes.
    The 400 ms timer stops us calling the backend on every letter typed.
  */
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWorkflows();
    }, 400);

    return () => clearTimeout(timer);
  }, [search, typeFilter, activeFilter]);

  /* =================================================================
     OPEN THE FORM
     ================================================================= */
  const openAddForm = () => {
    setEditingWorkflow(null);
    setForm({
      name: "",
      description: "",
      // whatever the admin put first in Settings, not a hard-coded guess
      requestType: activeTypes[0]?.name || "",
    });
    setShowForm(true);
  };

  const openEditForm = (workflow) => {
    setEditingWorkflow(workflow);
    setForm({
      name: workflow.name,
      description: workflow.description || "",
      requestType: workflow.requestType,
    });
    setShowForm(true);
  };

  /* =================================================================
     SAVE (create or rename)
     ================================================================= */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("Workflow name is required");
      return;
    }

    setSaving(true);

    try {
      if (editingWorkflow) {
        const result = await api.put(
          `/api/workflow/${editingWorkflow._id}`,
          form
        );
        toast.success(result.data.message);
        setShowForm(false);
        fetchWorkflows();
      } else {
        const result = await api.post("/api/workflow/create", form);
        toast.success(result.data.message);
        setShowForm(false);

        // a brand new workflow has no stages yet, so go straight to the builder
        navigate(`/workflows/${result.data.workflow._id}`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     ACTIVATE / DEACTIVATE
     ================================================================= */
  const handleToggleActive = async (workflow) => {
    setTogglingId(workflow._id);

    try {
      const result = await api.patch(`/api/workflow/${workflow._id}/active`, {
        isActive: !workflow.isActive,
      });

      toast.success(result.data.message);
      fetchWorkflows();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setTogglingId("");
    }
  };

  /* =================================================================
     DELETE
     ================================================================= */
  const handleDelete = async () => {
    setDeleting(true);

    try {
      const result = await api.delete(`/api/workflow/${deleteTarget._id}`);

      toast.success(result.data.message);
      setDeleteTarget(null);
      fetchWorkflows();
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
          <h1 className="text-xl font-semibold text-slate-800">Workflows</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {workflows.length} workflow{workflows.length === 1 ? "" : "s"}
          </p>
        </div>

        {canCreate && (
          <button
            onClick={openAddForm}
            className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <MdAdd size={19} /> Create Workflow
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by workflow name"
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">All request types</option>
          {typeNames.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
        >
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      {/* ==================== the cards ==================== */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 flex justify-center">
          <ClipLoader size={35} color="#4f46e5" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-500 text-sm">
          No workflows found. Create one to design an approval route.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workflows.map((workflow) => (
            <div
              key={workflow._id}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col"
            >
              {/* ---------- title row ---------- */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <MdAccountTree size={21} />
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-800 truncate">
                      {workflow.name}
                    </h3>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {workflow.requestType}
                    </span>
                  </div>
                </div>

                <div className="flex gap-1 shrink-0">
                  {canUpdate && (
                    <button
                      title="Rename"
                      onClick={() => openEditForm(workflow)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center"
                    >
                      <MdEdit size={18} />
                    </button>
                  )}

                  {canDelete && (
                    <button
                      title="Delete"
                      onClick={() => setDeleteTarget(workflow)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                    >
                      <MdDelete size={18} />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-500 mt-3">
                {workflow.description || "No description"}
              </p>

              {/* ---------- the route, in one line ---------- */}
              <div className="mt-4 flex-1">
                <p className="text-xs text-slate-500 mb-1.5">
                  {workflow.stages.length} stage
                  {workflow.stages.length === 1 ? "" : "s"}
                </p>

                {workflow.stages.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No stages yet - open the builder to design this route.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded">
                      Employee
                    </span>

                    {workflow.stages.map((stage) => (
                      <span
                        key={stage.order}
                        className="flex items-center gap-1"
                      >
                        <span className="text-slate-400">&rarr;</span>
                        <span
                          title={stage.name}
                          className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded"
                        >
                          {describeApprover(stage)}
                        </span>
                      </span>
                    ))}

                    <span className="text-slate-400">&rarr;</span>
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded">
                      Completed
                    </span>
                  </div>
                )}
              </div>

              {/* ---------- active switch + builder link ---------- */}
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                {canUpdate ? (
                  <button
                    onClick={() => handleToggleActive(workflow)}
                    disabled={togglingId === workflow._id}
                    className={`flex items-center gap-1.5 text-sm font-medium disabled:opacity-60 ${
                      workflow.isActive ? "text-emerald-600" : "text-slate-400"
                    }`}
                  >
                    {workflow.isActive ? (
                      <MdToggleOn size={26} />
                    ) : (
                      <MdToggleOff size={26} />
                    )}
                    {workflow.isActive ? "Active" : "Inactive"}
                  </button>
                ) : (
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      workflow.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {workflow.isActive ? "Active" : "Inactive"}
                  </span>
                )}

                <button
                  onClick={() => navigate(`/workflows/${workflow._id}`)}
                  className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 flex items-center gap-1.5"
                >
                  <MdTune size={17} /> Open Builder
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ==================== add / edit pop-up ==================== */}
      <Modal
        isOpen={showForm}
        title={editingWorkflow ? "Edit Workflow" : "Create Workflow"}
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
              placeholder="e.g. Purchase Approval"
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Request type <span className="text-red-500">*</span>
            </label>
            <select
              value={form.requestType}
              onChange={(e) =>
                setForm({ ...form, requestType: e.target.value })
              }
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 bg-white"
            >
              {/*
                An EXISTING workflow may be routed by a type that has
                since been switched off. Its name would not be in
                activeTypes, so the dropdown would silently show the
                first option instead and a plain Save would move the
                workflow to a type nobody chose. Adding the current
                value back keeps the form honest.
              */}
              {form.requestType &&
                !activeTypes.some((type) => type.name === form.requestType) && (
                  <option value={form.requestType}>
                    {form.requestType} (switched off)
                  </option>
                )}

              {activeTypes.map((type) => (
                <option key={type._id} value={type.name}>
                  {type.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              Only one workflow per request type can be active at a time.
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
              placeholder="When should this approval route be used?"
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
              className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[150px]"
            >
              {saving ? (
                <ClipLoader size={20} color="white" />
              ) : editingWorkflow ? (
                "Save changes"
              ) : (
                "Create & open builder"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== delete confirmation ==================== */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this workflow?"
        message={`"${deleteTarget?.name}" and all of its stages will be removed. An active workflow must be switched off first.`}
        confirmText="Yes, delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Workflows;
