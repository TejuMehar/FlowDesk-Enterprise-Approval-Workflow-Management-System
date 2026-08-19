/*
=========================================================================
  COMPONENT: PayslipModal         (Module 12 - Payroll & Salary)
=========================================================================
  One payslip in a pop-up, with the download button under it.

  THE DOWNLOAD GOES THROUGH utils/download.js AND NOT THROUGH A LINK,
  and that is the whole reason this is a component rather than an <a>.
  A plain href would bypass the axios interceptor, so the receipt would
  work for the first fifteen minutes of a session and then quietly open
  a blank tab containing {"message":"Access token expired"} - see the
  long note at the top of utils/download.js.

  A DRAFT HAS NO DOWNLOAD BUTTON. The backend refuses it anyway (a
  receipt is a document, and a draft is a number still being checked),
  so drawing the button would only offer somebody an error.
=========================================================================
*/

import { useState } from "react";
import { toast } from "react-toastify";
import { MdOutlineFileDownload } from "react-icons/md";
import { ClipLoader } from "react-spinners";

import Modal from "../Modal.jsx";
import PayslipBreakdown from "./PayslipBreakdown.jsx";
import { downloadFile } from "../../utils/download.js";
import { payslipFileName, formatMonthLong } from "../../utils/salaryConstants.js";

function PayslipModal({ isOpen, payslip, onClose, showEmployee = false, footer = null }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);

    try {
      await downloadFile(
        `/api/salary/payslip/${payslip._id}/receipt`,
        payslipFileName(payslip)
      );

      toast.success("Payslip downloaded");
    } catch (error) {
      // downloadFile throws with the sentence the SERVER meant to send
      toast.error(error.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-3xl"
      title={payslip ? `Payslip - ${formatMonthLong(payslip.monthKey)}` : "Payslip"}
    >
      {payslip && (
        <div className="flex flex-col gap-5">
          <PayslipBreakdown payslip={payslip} showEmployee={showEmployee} />

          {/* whatever the payroll screen wants to add - pay, cancel, adjust */}
          {footer}

          <div className="flex justify-end gap-2 pt-1 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>

            {payslip.canDownload && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
              >
                {downloading ? (
                  <ClipLoader size={14} color="#ffffff" />
                ) : (
                  <MdOutlineFileDownload size={16} />
                )}
                Download receipt
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default PayslipModal;
