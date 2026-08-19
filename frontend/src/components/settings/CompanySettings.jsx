/*
=========================================================================
  COMPONENT: CompanySettings   (Module 9 - System Configuration)
=========================================================================
  Who this FlowDesk belongs to: the company name, the logo and the
  timezone the company runs on.

  ALL THREE ARE READ SOMEWHERE, which is the rule of this module - a
  setting nothing reads is a promise the application does not keep:

    companyName   the sidebar, the browser tab, the login page and the
                  heading of every email FlowDesk sends
    companyLogo   the same three places on screen
    timezone      config/workingCalendar.js on the backend, which the
                  reminder engine asks before it emails anybody. It is
                  what stops a server hosted in UTC from sending the
                  "8am daily summary" at half past one in the
                  afternoon.

  THE LOGO HAS ITS OWN ROUTE, not a field in this form. It is a file,
  so it travels as multipart/form-data through the same uploader that
  has handled profile photos since Module 1, and it uploads the moment
  it is chosen rather than waiting for Save. Two different kinds of
  save on one button is how you end up with a form that loses the
  picture when the name is invalid.
=========================================================================
*/

import { useRef, useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineBusiness,
  MdOutlineUploadFile,
  MdOutlineDelete,
  MdOutlinePublic,
} from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import { getPhotoUrl } from "../../utils/config.js";
import SettingsCard, {
  settingsInputClass,
  settingsLabelClass,
} from "./SettingsCard.jsx";

function CompanySettings({ settings, timezones, canEdit, onSaved }) {
  const [form, setForm] = useState({
    companyName: settings.companyName || "",
    timezone: settings.timezone || "UTC",
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // lets the "Choose a file" button open the hidden file input
  const fileInputRef = useRef(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  /* =================================================================
     SAVE THE NAME AND THE TIMEZONE
     ================================================================= */
  const handleSave = async () => {
    if (!form.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

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

  /* =================================================================
     UPLOAD A LOGO
     -----------------------------------------------------------------
     FormData is what turns a file into something a request can carry.
     We do NOT set a Content-Type header by hand: the browser has to
     add its own multipart boundary, and typing the header ourselves
     is what breaks it.
     ================================================================= */
  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("logo", file);

    setUploading(true);

    try {
      const result = await api.post("/api/settings/logo", formData);

      toast.success(result.data.message);
      onSaved(result.data.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);

      /*
        Clearing the input matters: without it, choosing the SAME file
        again fires no change event, and an admin who re-cropped their
        logo would think the button had stopped working.
      */
      event.target.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    setUploading(true);

    try {
      const result = await api.delete("/api/settings/logo");

      toast.success(result.data.message);
      onSaved(result.data.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsCard
      icon={<MdOutlineBusiness size={20} />}
      title="Company"
      description="The name and mark this FlowDesk wears - on screen, in the browser tab and at the top of every email it sends."
      onSave={handleSave}
      saving={saving}
      canEdit={canEdit}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>
            Company name <span className="text-red-500">*</span>
          </label>
          <input
            name="companyName"
            value={form.companyName}
            onChange={handleChange}
            placeholder="e.g. Acme Industries"
            disabled={!canEdit}
            className={settingsInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>
            <span className="inline-flex items-center gap-1.5">
              <MdOutlinePublic size={15} className="text-slate-400" />
              Timezone
            </span>
          </label>

          <select
            name="timezone"
            value={form.timezone}
            onChange={handleChange}
            disabled={!canEdit}
            className={settingsInputClass}
          >
            {/*
              The saved timezone might not be in the suggested list - an
              admin can save any zone the server recognises. Adding it
              at the top means selecting it back is never impossible.
            */}
            {!timezones.includes(form.timezone) && (
              <option value={form.timezone}>{form.timezone}</option>
            )}

            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>

          <p className="text-xs text-slate-400">
            Reminders and the daily summary are sent on this clock.
          </p>
        </div>
      </div>

      {/* ==================== the logo ==================== */}
      <div className="mt-5 pt-5 border-t border-slate-100">
        <label className={settingsLabelClass}>Company logo</label>

        <div className="flex flex-wrap items-center gap-4 mt-3">
          {/* ---------- the preview ---------- */}
          <div className="w-16 h-16 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
            {settings.companyLogo ? (
              <img
                src={getPhotoUrl(settings.companyLogo)}
                alt="Company logo"
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-slate-400 text-center px-1">
                No logo
              </span>
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {/*
                A file input cannot be styled, so the real one is
                hidden and a normal button is drawn instead. Clicking
                the button clicks the input.
              */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
              >
                {uploading ? (
                  <ClipLoader size={16} color="#475569" />
                ) : (
                  <MdOutlineUploadFile size={17} />
                )}
                {settings.companyLogo ? "Replace logo" : "Upload logo"}
              </button>

              {settings.companyLogo && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={uploading}
                  className="h-10 px-4 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-60 flex items-center gap-1.5"
                >
                  <MdOutlineDelete size={17} />
                  Remove
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 mt-3">
          PNG, JPG or WebP, up to 2 MB. A wide mark on a transparent
          background works best - it is drawn small, next to the company
          name.
        </p>
      </div>
    </SettingsCard>
  );
}

export default CompanySettings;
