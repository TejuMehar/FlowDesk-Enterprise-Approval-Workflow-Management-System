/*
=========================================================================
  COMPONENT: SettingsCard   (Module 9 - System Configuration)
=========================================================================
  The white box every settings section is drawn in: an icon, a title, a
  sentence explaining what the section is for, and a Save button at the
  bottom.

  It exists because the Settings page has five sections that all look
  the same and all behave the same way, and five copies of the same
  forty lines is how the fourth one ends up subtly different from the
  other three.

  THE `canEdit` PROP DOES TWO THINGS AT ONCE, and that is the point:
  it hides the Save button AND explains why. A page that silently drops
  the button leaves the reader wondering whether it is missing or they
  are; a line saying "you do not have permission to change this" is the
  difference between a broken screen and a locked one.
=========================================================================
*/

import { ClipLoader } from "react-spinners";
import { MdLockOutline } from "react-icons/md";

function SettingsCard({
  icon,
  title,
  description,
  children,
  onSave,
  saving = false,
  canEdit = true,
  saveLabel = "Save changes",
  // set when the section is locked for a reason other than permission
  lockedMessage = "",
  footer = null,
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      {/* ---------- header ---------- */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-indigo-600">{icon}</span>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>

      {description && (
        <p className="text-sm text-slate-500 mb-5">{description}</p>
      )}

      {/* ---------- the fields of this section ---------- */}
      {children}

      {/* ---------- anything extra the section wants under its fields ---------- */}
      {footer}

      {/* ---------- save ---------- */}
      {onSave && (
        <div className="flex items-center justify-between gap-3 mt-6 pt-5 border-t border-slate-100">
          {canEdit ? (
            <span className="text-xs text-slate-400">
              {lockedMessage || ""}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <MdLockOutline size={14} />
              You do not have permission to change this
            </span>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="h-11 px-6 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[140px] shrink-0"
            >
              {saving ? <ClipLoader size={20} color="white" /> : saveLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/*
  The input styling used by every settings field, exported so the five
  section files do not each carry their own copy of a class string that
  has to stay identical.
*/
export const settingsInputClass =
  "h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 w-full disabled:bg-slate-50 disabled:text-slate-400";

export const settingsLabelClass = "text-sm font-medium text-slate-700";

export default SettingsCard;
