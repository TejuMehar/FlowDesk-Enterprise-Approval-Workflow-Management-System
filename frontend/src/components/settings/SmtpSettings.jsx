/*
=========================================================================
  COMPONENT: SmtpSettings   (Module 9 - System Configuration)
=========================================================================
  The mail server FlowDesk sends everything through: the verification
  emails of Module 1, the approval emails of Module 6, the reminders
  and the daily summary.

  THREE THINGS TO NOTICE
  ----------------------

  1. THE PASSWORD BOX IS ALWAYS EMPTY, and there is a line under it
     saying why. The saved password never leaves the server (see
     sanitizeSettings() in the backend controller), so there is nothing
     to put in the box - the browser is only told WHETHER one exists.
     Leaving it blank keeps the saved one; typing replaces it. That is
     how every mail client has done it for thirty years.

  2. THE WHOLE CARD CAN BE LOCKED. This is behind its own permission,
     settings:smtp, because whoever holds a mailbox credential can send
     email AS THE COMPANY - to anybody, saying anything, from an
     address employees have been trained to trust. An admin without it
     does not even receive the host and username, so the card draws a
     short explanation instead of an empty form.

  3. THE PORT AND THE TLS SWITCH MOVE TOGETHER. Getting that pair
     wrong is the single most common reason correct credentials still
     cannot send mail, so choosing a known port flips the switch for
     you and the backend refuses the combinations that cannot work.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import {
  MdOutlineMailOutline,
  MdOutlineSend,
  MdLockOutline,
  MdOutlineCheckCircle,
} from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import { SMTP_PORT_HINTS } from "../../utils/settingsConstants.js";
import SettingsCard, {
  settingsInputClass,
  settingsLabelClass,
} from "./SettingsCard.jsx";

function SmtpSettings({ settings, presets, canEdit, onSaved, myEmail }) {
  const smtp = settings.smtp || {};

  const [form, setForm] = useState({
    enabled: Boolean(smtp.enabled),
    host: smtp.host || "",
    port: smtp.port || 587,
    secure: Boolean(smtp.secure),
    user: smtp.user || "",
    password: "", // always starts empty - see the note at the top
    fromName: smtp.fromName || "",
    fromEmail: smtp.fromEmail || "",
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState(myEmail || "");

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  /*
    Typing a well-known port sets the TLS switch to the only answer
    that works for it. The admin can still override it afterwards -
    this is a shortcut, not a rule.
  */
  const handlePortChange = (event) => {
    const port = event.target.value;
    const hint = SMTP_PORT_HINTS[port];

    setForm((previous) => ({
      ...previous,
      port,
      secure: hint ? hint.secure : previous.secure,
    }));
  };

  // one click fills in a known provider
  const applyPreset = (preset) => {
    setForm((previous) => ({
      ...previous,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
    }));
  };

  /* =================================================================
     SAVE
     ================================================================= */
  const handleSave = async () => {
    setSaving(true);

    try {
      const result = await api.put("/api/settings/smtp", form);

      toast.success(result.data.message);

      // the box goes back to empty: the password is saved now
      setForm((previous) => ({ ...previous, password: "" }));

      onSaved(result.data.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* =================================================================
     SEND A TEST EMAIL
     -----------------------------------------------------------------
     It sends the values ON SCREEN, not the saved ones, so an admin can
     try a new password before committing to it. Anything left blank
     falls back to what is saved.

     This is the one place in FlowDesk where a mail failure is shown to
     the user - everywhere else a broken mailbox must not break the
     action that caused the email. Here the error IS the answer, and
     nodemailer's own wording ("Invalid login: 535-5.7.8 Username and
     Password not accepted") is far more use than anything we could
     write over it.
     ================================================================= */
  const handleTest = async () => {
    if (!testTo.trim()) {
      toast.error("Enter an address to send the test to");
      return;
    }

    setTesting(true);

    try {
      const result = await api.post("/api/settings/smtp/test", {
        to: testTo.trim(),
        host: form.host,
        port: form.port,
        secure: form.secure,
        user: form.user,
        password: form.password, // blank = use the saved one
      });

      toast.success(result.data.message);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  /* =================================================================
     THE LOCKED VERSION
     -----------------------------------------------------------------
     Drawn when the backend did not send the block at all. It says what
     is missing rather than showing an empty form, so nobody spends ten
     minutes filling in fields that will be refused on save.
     ================================================================= */
  if (smtp.visible === false || !canEdit) {
    return (
      <SettingsCard
        icon={<MdOutlineMailOutline size={20} />}
        title="Mail server (SMTP)"
        description="Where FlowDesk sends its email from."
      >
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
          <MdLockOutline size={20} className="text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-700">
              This section needs the "Configure Mail Server" permission
            </p>
            <p className="text-sm text-slate-500 mt-1">
              A mail server login lets whoever holds it send email as the
              company, so it is kept separate from the rest of the
              settings. Ask a Super Admin if you need it.
            </p>
          </div>
        </div>
      </SettingsCard>
    );
  }

  const portHint = SMTP_PORT_HINTS[form.port];

  return (
    <SettingsCard
      icon={<MdOutlineMailOutline size={20} />}
      title="Mail server (SMTP)"
      description="Where FlowDesk sends its email from. While this is switched off it falls back to the USER_EMAIL / USER_PASSWORD pair in the server's .env file, and if that is empty too, email links are printed in the backend terminal instead."
      onSave={handleSave}
      saving={saving}
      canEdit={canEdit}
      saveLabel="Save mail server"
    >
      {/* ==================== on / off ==================== */}
      <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 p-4 mb-5">
        <input
          type="checkbox"
          name="enabled"
          checked={form.enabled}
          onChange={handleChange}
          className="w-4 h-4 accent-indigo-600 mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">
            Use this mail server
          </span>
          <span className="block text-sm text-slate-500 mt-0.5">
            Switched on, every email FlowDesk sends goes through it. It
            cannot be switched on until a host, a username and a password
            are all filled in.
          </span>
        </span>
      </label>

      {/* ==================== presets ==================== */}
      {presets.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-slate-400 mb-2">
            Fill in a known provider:
          </p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                className="h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ==================== the connection ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className={settingsLabelClass}>Host</label>
          <input
            name="host"
            value={form.host}
            onChange={handleChange}
            placeholder="smtp.gmail.com"
            className={settingsInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Port</label>
          <input
            name="port"
            type="number"
            value={form.port}
            onChange={handlePortChange}
            placeholder="587"
            className={settingsInputClass}
          />
          {portHint && (
            <p className="text-xs text-slate-400">{portHint.hint}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Encryption</label>
          <label className="h-11 px-3 rounded-lg border border-slate-300 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="secure"
              checked={form.secure}
              onChange={handleChange}
              className="w-4 h-4 accent-indigo-600"
            />
            <span className="text-sm text-slate-600">
              Use TLS from the start
            </span>
          </label>
          <p className="text-xs text-slate-400">
            On for port 465, off for 587.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Username</label>
          <input
            name="user"
            value={form.user}
            onChange={handleChange}
            placeholder="you@company.com"
            className={settingsInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>Password</label>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder={
              smtp.hasPassword ? "Leave blank to keep the saved one" : "App password"
            }
            className={settingsInputClass}
          />

          {smtp.hasPassword ? (
            <p className="flex items-center gap-1 text-xs text-green-600">
              <MdOutlineCheckCircle size={14} />A password is saved. It is
              never sent back to the browser.
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              For Gmail this must be an App Password, not your normal one.
            </p>
          )}
        </div>
      </div>

      {/* ==================== who it comes from ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-5 border-t border-slate-100">
        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>From name</label>
          <input
            name="fromName"
            value={form.fromName}
            onChange={handleChange}
            placeholder={settings.companyName || "FlowDesk"}
            className={settingsInputClass}
          />
          <p className="text-xs text-slate-400">
            Blank uses the company name.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={settingsLabelClass}>From address</label>
          <input
            name="fromEmail"
            value={form.fromEmail}
            onChange={handleChange}
            placeholder="no-reply@company.com"
            className={settingsInputClass}
          />
          <p className="text-xs text-slate-400">
            Blank uses the username above.
          </p>
        </div>
      </div>

      {/* ==================== the test ==================== */}
      <div className="mt-5 pt-5 border-t border-slate-100">
        <label className={settingsLabelClass}>Send a test email</label>

        <p className="text-sm text-slate-500 mt-1 mb-3">
          Sends one message using the values on this screen, saved or
          not - so you can try a password before committing to it.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
            placeholder="you@company.com"
            className={`${settingsInputClass} sm:flex-1`}
          />

          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-1.5 shrink-0 min-w-[150px]"
          >
            {testing ? (
              <ClipLoader size={18} color="#475569" />
            ) : (
              <>
                <MdOutlineSend size={17} /> Send test email
              </>
            )}
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

export default SmtpSettings;
