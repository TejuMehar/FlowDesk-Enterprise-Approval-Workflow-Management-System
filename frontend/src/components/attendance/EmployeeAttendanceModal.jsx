/*
=========================================================================
  COMPONENT: EmployeeAttendanceModal
=========================================================================
  One employee's attendance, in full - the drill-down from the team
  board, the live board and the two ranked lists.

  It is the SAME three components the employee's own page uses (the
  summary cards, the calendar and the history table), pointed at
  somebody else. That is deliberate: a manager looking at Ravi's month
  and Ravi looking at Ravi's month must see the identical picture, or
  the conversation that follows starts with an argument about the
  numbers.

  THE ONE THING IT ADDS IS THE CORRECTION
  ---------------------------------------
  Clicking a day opens the form that fixes it. A manager reading a
  strange day and a manager fixing it are the same moment, and making
  them two screens is how a wrong record survives for a month.

  WHO CAN OPEN IT AT ALL is not decided here. The backend answers 404
  for anybody outside the caller's scope, so a guessed id is a dead end
  rather than an employee directory - see getEmployeeAttendance() in
  backend/controllers/attendanceController.js.
=========================================================================
*/

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdOutlineApartment, MdOutlineBadge, MdOutlineEditNote } from "react-icons/md";

import { api, getErrorMessage } from "../../utils/api.js";
import { getPhotoUrl } from "../../utils/config.js";
import Modal from "../Modal.jsx";
import AttendanceSummaryCards from "./AttendanceSummaryCards.jsx";
import AttendanceCalendar from "./AttendanceCalendar.jsx";
import AttendanceHistoryTable from "./AttendanceHistoryTable.jsx";
import CorrectionModal from "./CorrectionModal.jsx";
import {
  minutesToClock,
  formatMinutes,
} from "../../utils/attendanceConstants.js";

function EmployeeAttendanceModal({ userId, range, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("daily");
  const [correcting, setCorrecting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const { data: answer } = await api.get(
        `/api/attendance/employee/${userId}`,
        { params: { from: range.from, to: range.to, period } }
      );

      setData(answer);
    } catch (error) {
      toast.error(getErrorMessage(error));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [userId, range.from, range.to, period, onClose]);

  useEffect(() => {
    load();
  }, [load]);

  const employee = data?.employee;

  const openCorrection = (day) => {
    if (!data?.canCorrect || !day.record) {
      return;
    }

    setCorrecting(day);
  };

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        maxWidth="max-w-5xl"
        title={
          employee
            ? `${employee.firstName} ${employee.lastName} - attendance`
            : "Attendance"
        }
      >
        {loading ? (
          <div className="py-16 flex justify-center">
            <ClipLoader size={28} color="#4f46e5" />
          </div>
        ) : (
          data && (
            <div className="flex flex-col gap-5">
              {/* ==================== who ==================== */}
              <div className="flex flex-wrap items-center gap-4 pb-5 border-b border-slate-200">
                {getPhotoUrl(employee.photoUrl) ? (
                  <img
                    src={getPhotoUrl(employee.photoUrl)}
                    alt=""
                    className="w-14 h-14 rounded-full object-cover border-2 border-indigo-100"
                  />
                ) : (
                  <span className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 border-2 border-indigo-200 flex items-center justify-center text-xl font-semibold">
                    {employee.firstName?.charAt(0)?.toUpperCase()}
                  </span>
                )}

                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-800">
                    {employee.firstName} {employee.lastName}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <MdOutlineBadge size={13} />
                      {employee.employeeId}
                    </span>

                    <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
                      <MdOutlineApartment size={13} />
                      {employee.department?.name || "No department"}
                    </span>

                    <span className="text-xs text-slate-500">
                      {employee.designation}
                    </span>
                  </div>
                </div>

                {/*
                  The pattern they are being judged by, on the same
                  screen as the judgement. A manager reading "6 late
                  days" has to be able to see which start time that was
                  measured against without leaving the page.
                */}
                <div className="ml-auto text-right">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">
                    Judged against
                  </p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5 tabular-nums">
                    {minutesToClock(data.policy.shiftStartMinutes)} -{" "}
                    {minutesToClock(data.policy.shiftEndMinutes)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {formatMinutes(data.policy.fullDayMinutes)} day,{" "}
                    {formatMinutes(data.policy.breakAllowanceMinutes)} break
                  </p>
                </div>
              </div>

              {/* ==================== the numbers ==================== */}
              <AttendanceSummaryCards summary={data.summary} />

              {/* ==================== the period switch ==================== */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-500">{data.range.label}</p>

                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                  {["daily", "weekly", "monthly"].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPeriod(key)}
                      aria-pressed={period === key}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                        period === key
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* ==================== the picture ==================== */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-1">
                  <AttendanceCalendar
                    days={data.days}
                    onSelect={data.canCorrect ? openCorrection : null}
                  />
                </div>

                <div className="lg:col-span-2">
                  <AttendanceHistoryTable
                    rows={data.rows}
                    period={period}
                    onSelect={data.canCorrect ? openCorrection : null}
                  />
                </div>
              </div>

              {data.canCorrect && (
                <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <MdOutlineEditNote size={15} />
                  Click any day with a record to correct its times. Every
                  correction is kept in the audit log with the reason you give.
                </p>
              )}
            </div>
          )
        )}
      </Modal>

      {correcting && (
        <CorrectionModal
          day={correcting}
          employee={employee}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            load();
          }}
        />
      )}
    </>
  );
}

export default EmployeeAttendanceModal;
