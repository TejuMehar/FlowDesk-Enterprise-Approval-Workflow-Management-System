/*
=========================================================================
  DASHBOARD CONSTANTS   (Module 5 - Dashboard & Analytics)
=========================================================================
  A frontend copy of backend/config/dashboardConstants.js, plus the
  colours and the small formatting helpers every chart shares.

  WHY THE CHART COLOURS LIVE HERE AND NOT IN THE CHARTS
  -----------------------------------------------------
  Four charts on one page have to read as ONE picture. If "approved"
  were green in the column chart and teal in the line chart, the reader
  would have to relearn the colours for every card. So the colour of a
  status is decided once, here, and every chart imports it.
=========================================================================
*/

/* =====================================================================
   THE STATUS COLOURS
   ---------------------------------------------------------------------
   These four are NOT picked by eye. They were checked with a
   colour-blindness simulator and the four of them stay apart under
   protanopia, deuteranopia and tritanopia (the pairwise difference stays
   above the safe threshold in every combination).

   That is why "rejected" is a deep red rather than a bright one and why
   "returned" is violet instead of the orange its badge uses elsewhere in
   the app: red-vs-green and orange-vs-amber are exactly the pairs that
   collapse into the same colour for roughly 1 in 12 men.

   Colour is never the ONLY channel anyway - every chart also has a
   legend, direct labels and a table view - but a chart that also works
   without colour is simply a better chart.
   ===================================================================== */
export const CHART_COLORS = {
  approved: "#1baf7a", // aqua green
  rejected: "#d03b3b", // deep red
  pending: "#eda100", // amber
  returned: "#4a3aa7", // violet

  // one single hue for "how big is this", where colour carries no meaning
  magnitude: "#2a78d6", // blue
};

/*
  The chrome of a chart: everything that is NOT data.
  All of it is deliberately quiet - the data is the only thing on the
  card allowed to be loud.
*/
export const CHART_INK = {
  surface: "#ffffff", // the card behind the chart, used for the 2px gaps
  grid: "#e2e8f0", // slate-200, hairline, solid (never dashed)
  axis: "#cbd5e1", // slate-300, the baseline
  muted: "#94a3b8", // slate-400, axis numbers
  label: "#64748b", // slate-500, month names
  strong: "#334155", // slate-700, direct value labels
};

/*
  The three series every "what happened to these requests" chart uses,
  in the order they are stacked (bottom to top).
*/
export const REQUEST_OUTCOME_SERIES = [
  { key: "approved", label: "Approved", color: CHART_COLORS.approved },
  { key: "rejected", label: "Rejected", color: CHART_COLORS.rejected },
  { key: "pending", label: "In progress", color: CHART_COLORS.pending },
];

/*
  The three DECISIONS the approval trends chart plots. A decision is
  something an approver did, which is a different thing from the state a
  request ended up in - so this list is not the same as the one above.
*/
export const APPROVAL_TREND_SERIES = [
  { key: "approved", label: "Approved", color: CHART_COLORS.approved },
  { key: "rejected", label: "Rejected", color: CHART_COLORS.rejected },
  { key: "returned", label: "Returned", color: CHART_COLORS.returned },
];

/*
  How far the charts look back when the page opens. Must match
  DEFAULT_CHART_MONTHS in backend/config/dashboardConstants.js, so the
  first draw and the backend's own default agree.
*/
export const DEFAULT_CHART_MONTHS = 6;

// the "last N months" buttons above the charts
export const MONTH_RANGE_OPTIONS = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
];

/* =====================================================================
   THE COLOUR OF A STAT CARD
   ---------------------------------------------------------------------
   Tailwind reads class names as plain text at build time, so a class
   built at runtime ("bg-" + colour + "-50") would simply be thrown away.
   Every combination therefore has to appear here in full.
   ===================================================================== */
export const CARD_TONES = {
  indigo: {
    tile: "bg-indigo-50 text-indigo-600",
    hover: "hover:border-indigo-300 hover:shadow-indigo-100",
    accent: "text-indigo-600",
  },
  green: {
    tile: "bg-green-50 text-green-600",
    hover: "hover:border-green-300 hover:shadow-green-100",
    accent: "text-green-600",
  },
  amber: {
    tile: "bg-amber-50 text-amber-600",
    hover: "hover:border-amber-300 hover:shadow-amber-100",
    accent: "text-amber-600",
  },
  red: {
    tile: "bg-red-50 text-red-600",
    hover: "hover:border-red-300 hover:shadow-red-100",
    accent: "text-red-600",
  },
  orange: {
    tile: "bg-orange-50 text-orange-600",
    hover: "hover:border-orange-300 hover:shadow-orange-100",
    accent: "text-orange-600",
  },
  violet: {
    tile: "bg-violet-50 text-violet-600",
    hover: "hover:border-violet-300 hover:shadow-violet-100",
    accent: "text-violet-600",
  },
  sky: {
    tile: "bg-sky-50 text-sky-600",
    hover: "hover:border-sky-300 hover:shadow-sky-100",
    accent: "text-sky-600",
  },
  slate: {
    tile: "bg-slate-100 text-slate-500",
    hover: "hover:border-slate-400 hover:shadow-slate-100",
    accent: "text-slate-500",
  },
};

/* =====================================================================
   SMALL HELPERS
   ===================================================================== */

/*
  1284 -> "1,284".  Kept in one place so a number never appears in two
  different shapes on the same screen.
*/
export const formatNumber = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("en-IN");
};

/*
  A share of a total, as a rounded percentage.
  Returns 0 instead of NaN when the total is 0, so a fresh install with
  no data still draws a chart instead of showing "NaN%".
*/
export const toPercent = (value, total) => {
  if (!total) {
    return 0;
  }

  return Math.round((value / total) * 100);
};

/*
  THE TOP OF A CHART'S Y AXIS.

  A chart whose axis stops exactly at the biggest value gets ugly tick
  labels (0, 4.25, 8.5, 12.75, 17). This rounds the gap between the
  ticks UP to a "clean" number, so 17 becomes an axis of 0/5/10/15/20.

  TWO RULES THIS HAS TO OBEY
    1. THE STEP MUST BE A WHOLE NUMBER. Every chart in this app counts
       whole things - requests, decisions - and "2.5 requests" on an
       axis is nonsense. That is why the ladder below is rounded up to
       integers and why the step never goes under 1.
    2. IT MUST NOT WASTE THE CARD. Snapping only to 1/2/5/10 sounds
       tidy but is far too coarse: a chart whose tallest column is 99
       would get an axis up to 200, and every column would use half the
       height it deserves. The extra rungs (1.2, 1.5, 2.5, 3, 4, 6, 8)
       keep the tallest column filling most of the plot.

  @param maxValue  the biggest value in the data
  @param tickCount how many gaps the axis is divided into
*/
const NICE_STEP_LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export const niceAxisMax = (maxValue, tickCount = 4) => {
  // an empty chart still needs an axis, so we give it 0 - 4
  if (!maxValue || maxValue <= 0) {
    return tickCount;
  }

  // never below 1, or a chart with a single request would get 0.25 steps
  const roughStep = Math.max(maxValue / tickCount, 1);

  // the power of ten just below the step, e.g. 5.75 -> 1, 24.75 -> 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));

  const niceStep =
    NICE_STEP_LADDER.map((multiple) => Math.ceil(multiple * magnitude)).find(
      (step) => step >= roughStep
    ) || Math.ceil(roughStep);

  return niceStep * tickCount;
};

/*
  The y-axis tick values, from 0 up to the maximum.
  [0, 5, 10, 15, 20] for a max of 20 and 4 gaps.
*/
export const buildAxisTicks = (axisMax, tickCount = 4) => {
  const step = axisMax / tickCount;

  return Array.from({ length: tickCount + 1 }, (_, index) => index * step);
};

/*
  "2 hours ago", "3 days ago" ...
  The activity feed needs the DISTANCE in time much more than the exact
  date - "5 minutes ago" is easier to judge than "31 Jul 2026, 14:20".
*/
export const timeAgo = (dateValue) => {
  if (!dateValue) {
    return "";
  }

  const date = new Date(dateValue);

  if (isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const steps = [
    { limit: 60, name: "minute", size: 60 },
    { limit: 24, name: "hour", size: 3600 },
    { limit: 7, name: "day", size: 86400 },
    { limit: 5, name: "week", size: 604800 },
    { limit: 12, name: "month", size: 2592000 },
  ];

  for (const step of steps) {
    const value = Math.floor(seconds / step.size);

    if (value < step.limit) {
      return `${value} ${step.name}${value === 1 ? "" : "s"} ago`;
    }
  }

  const years = Math.floor(seconds / 31536000);

  return `${years} year${years === 1 ? "" : "s"} ago`;
};
