/*
=========================================================================
  COMPONENT: EmployeeIdSettings   (Module 1, kept in Module 9)
=========================================================================
  The shape of the auto-generated employeeId, for example "EMP-0001":

      employeeIdPrefix -> what it should START WITH   ("EMP-")
      employeeIdSuffix -> what it should END WITH      ("")

  This was the WHOLE of the Settings page before Module 9. It is now one
  card among five, and it is unchanged apart from being lifted out of
  the page into its own file.

  Changing these only affects employees created AFTER the change -
  existing employeeIds are never rewritten. That is the opposite of the
  rule the request types follow (a rename there DOES rewrite history),
  and both are right for their own reason: an employee ID is a name a
  person has been given and told to quote, while a request type is a
  label a system groups by.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { MdOutlineBadge } from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import SettingsCard, {
  settingsInputClass,
  settingsLabelClass,
} from "./SettingsCard.jsx";

function EmployeeIdSettings({ settings, canEdit, onSaved }) {
  const [form, setForm] = useState({
    employeeIdPrefix: settings.employeeIdPrefix || "",
    employeeIdSuffix: settings.employeeIdSuffix || "",
  });

  const [saving, setSaving] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const result = await api.put("/api/settings", form);

      toast.success(result.data.message);
      onSaved(result.data.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // a live preview so the admin can see the effect before saving
  const previewId =
    `${form.employeeIdPrefix}0001${form.employeeIdSuffix}`.toUpperCase();

  return (
    <SettingsCard
      icon={<MdOutlineBadge size={20} />}
      title="Employee ID format"
      description="What a new employee's ID should start with and end with. This only applies to employees created from now on - existing IDs stay exactly as they are."
      onSave={handleSave}
      saving={saving}
      canEdit={canEdit}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Starts with (prefix)</label>
          <input
            name="employeeIdPrefix"
            value={form.employeeIdPrefix}
            onChange={handleChange}
            placeholder="EMP-"
            disabled={!canEdit}
            className={settingsInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Ends with (suffix)</label>
          <input
            name="employeeIdSuffix"
            value={form.employeeIdSuffix}
            onChange={handleChange}
            placeholder="(optional)"
            disabled={!canEdit}
            className={settingsInputClass}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Preview:</span>
        <span className="font-mono font-medium text-slate-800 bg-slate-100 px-2 py-1 rounded">
          {previewId}
        </span>
      </div>
    </SettingsCard>
  );
}

export default EmployeeIdSettings;
