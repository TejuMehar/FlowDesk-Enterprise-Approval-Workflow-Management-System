/*
=========================================================================
  COMPONENT: AttendanceSummaryCards
=========================================================================
  The five headline numbers of any attendance period, whoever it is
  about: my month, my team's fortnight, one employee's quarter.

  ONE COMPONENT FOR ALL THREE, because they are the same five questions
  and the answers must be phrased identically wherever they appear. A
  manager comparing "my own attendance" with "Ravi's attendance" is
  comparing two of these, and a card that counted differently on one of
  the pages would make that comparison a lie.

  WHY FIVE, AND WHY THESE
  -----------------------
    Attendance   the headline. Present days out of expected days.
    Present      the raw count behind it, because a percentage with no
                 denominator is a number people argue with
    Absent       the one that gets acted on
    Hours        what the time actually added up to
    Punctuality  the second dimension - somebody can be there every
                 day and never on time, and one number cannot say both

  The performance SCORE is deliberately not one of them. It belongs
  beside the four parts it is made of (see PerformerList), not on a row
  of facts - a card that shows a judgement next to four measurements
  reads as if it were a measurement too.
=========================================================================
*/

import {
  MdOutlineEventAvailable,
  MdOutlineCheckCircle,
  MdOutlineCancel,
  MdOutlineTimer,
  MdOutlineAlarm,
} from "react-icons/md";

import StatCard from "../dashboard/StatCard.jsx";
import { formatMinutes, formatRate } from "../../utils/attendanceConstants.js";

/*
  @param summary  anything summariseDays() produced on the backend
  @param to       optional link the cards point at
*/
function AttendanceSummaryCards({ summary, to = null }) {
  if (!summary) {
    return null;
  }

  const cards = [
    {
      label: "Attendance",
      /*
        StatCard formats its value as a number, so the rate is passed
        as the NOTE and the present count as the value. That is the
        right way round anyway: the count is the fact and the rate is
        the reading of it.

        THE VALUE IS expectedPresentDays, NOT presentDays. They differ
        by the weekend and holiday shifts, and pairing "6" with "of 5
        days" underneath would be a card that visibly does not add up.
        The extra days get their own line below rather than being
        folded silently into the headline.
      */
      value: summary.expectedPresentDays,
      icon: <MdOutlineEventAvailable size={20} />,
      tone: "indigo",
      note:
        summary.attendanceRate === null
          ? "nothing expected yet"
          : `${formatRate(summary.attendanceRate)} of ${summary.workingDays} days`,
    },
    {
      label: "Days on time",
      value: summary.onTimeDays,
      icon: <MdOutlineCheckCircle size={20} />,
      tone: "green",
      note:
        summary.punctualityRate === null
          ? null
          : `${formatRate(summary.punctualityRate)} punctual`,
    },
    {
      label: "Absent",
      value: summary.absentDays,
      icon: <MdOutlineCancel size={20} />,
      tone: summary.absentDays > 0 ? "red" : "slate",
      note:
        summary.halfDays > 0
          ? `${summary.halfDays} half day${summary.halfDays === 1 ? "" : "s"} too`
          : summary.absentDays === 0
          ? "a full record"
          : null,
    },
    {
      label: "Hours worked",
      /*
        Hours as the value and minutes in the note: a card is read at a
        glance, and "138" is a glance while "138h 41m" is a sentence.
      */
      value: Math.round(summary.workedMinutes / 60),
      icon: <MdOutlineTimer size={20} />,
      tone: "sky",
      /*
        Work on a closed day is called out HERE rather than on the
        attendance card, because hours are the only total it really
        belongs in - it raises the time worked and, deliberately,
        nothing else about the period.
      */
      note:
        summary.offDayWorkedDays > 0
          ? `incl. ${summary.offDayWorkedDays} day${
              summary.offDayWorkedDays === 1 ? "" : "s"
            } off-shift`
          : summary.avgDayMinutes !== null
          ? `${formatMinutes(summary.avgDayMinutes)} a day`
          : null,
    },
    {
      label: "Late arrivals",
      value: summary.lateDays,
      icon: <MdOutlineAlarm size={20} />,
      tone: summary.lateDays > 0 ? "amber" : "slate",
      note:
        summary.lateDays > 0
          ? `${formatMinutes(summary.lateMinutes)} in total`
          : "never late",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
      {cards.map((card) => (
        <StatCard key={card.label} to={to} {...card} />
      ))}
    </div>
  );
}

export default AttendanceSummaryCards;
