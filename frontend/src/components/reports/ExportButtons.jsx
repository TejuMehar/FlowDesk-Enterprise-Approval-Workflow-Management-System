/*
=========================================================================
  COMPONENT: ExportButtons   (Module 8 - Reports & Search)
=========================================================================
  PDF / Excel / CSV, as three plain buttons.

  THEY ARE THREE BUTTONS AND NOT A DROPDOWN on purpose. A dropdown is
  the right shape when the options are many or rarely used; these are
  three, they are the reason somebody came to the page, and hiding them
  behind a menu would add a click to the most common action on it.

  WHY THE DOWNLOAD IS NOT A PLAIN <a href>
  ----------------------------------------
  Because a link cannot carry credentials the way our axios instance
  does, and it cannot show an error. The export routes sit behind isAuth
  and report:export, so a bare link would either be refused or - worse -
  quietly download a page of JSON saying "you do not have permission".

  So the file is fetched as a `blob` (the browser's word for "some
  bytes"), wrapped in a temporary link and clicked in code. This is the
  same dance AuditLogs.jsx does; the difference is only that there are
  three formats here, and one of them can take a few seconds, which is
  why each button has its own spinner.
=========================================================================
*/

import { ClipLoader } from "react-spinners";
import {
  MdOutlinePictureAsPdf,
  MdOutlineGridOn,
  MdOutlineDescription,
} from "react-icons/md";

import { EXPORT_FORMATS } from "../../utils/reportConstants.js";

const FORMAT_ICONS = {
  pdf: <MdOutlinePictureAsPdf size={17} />,
  excel: <MdOutlineGridOn size={17} />,
  csv: <MdOutlineDescription size={17} />,
};

/*
  @param onExport  called with the format key ("pdf" | "excel" | "csv")
  @param busy      the format currently downloading, or ""
  @param disabled  true while the report itself is still loading
*/
function ExportButtons({ onExport, busy = "", disabled = false }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {EXPORT_FORMATS.map((format) => (
        <button
          key={format.key}
          onClick={() => onExport(format.key)}
          /*
            EVERY button is disabled while ANY of them is working. Two
            exports of the same report at once is never what somebody
            meant - it is an impatient second click - and letting it
            through would download the same file twice.
          */
          disabled={disabled || busy !== ""}
          title={format.hint}
          className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {busy === format.key ? (
            <ClipLoader size={15} color="#4f46e5" />
          ) : (
            FORMAT_ICONS[format.key]
          )}
          {format.label}
        </button>
      ))}
    </div>
  );
}

export default ExportButtons;
