/*
=========================================================================
  APP CONFIGURATION
=========================================================================
  One place for values that the whole app needs.

  import.meta.env is how Vite gives us the variables from the .env file.
  Remember: the name must start with VITE_ or Vite will hide it.
=========================================================================
*/

// where the backend is running
export const serverUrl =
  import.meta.env.VITE_SERVER_URL || "http://localhost:8000";

/*
  Turns the photo path saved in the database into a full URL.

  The database stores  "/uploads/1712-me.png"
  The browser needs    "http://localhost:8000/uploads/1712-me.png"
*/
export const getPhotoUrl = (photoUrl) => {
  if (!photoUrl) {
    return "";
  }

  // if it is already a full address (http...), use it as it is
  if (photoUrl.startsWith("http")) {
    return photoUrl;
  }

  return serverUrl + photoUrl;
};

/*
  Turns "2026-07-30T00:00:00.000Z" into "30 Jul 2026".
  Returns "-" when the date is empty, so tables never show "null".
*/
export const formatDate = (dateValue) => {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(dateValue);

  // isNaN checks for an invalid date
  if (isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/*
  Turns a date into the "YYYY-MM-DD" text that an
  <input type="date"> understands.

  IT READS THE LOCAL DATE, NOT THE UTC ONE, and that is the whole point
  of the four lines below.

  This used to be `date.toISOString().split("T")[0]`, which is one
  character shorter and wrong for everybody east of Greenwich. A date
  stored as 2026-07-30T00:00:00+05:30 is 2026-07-29T18:30Z, so
  toISOString() handed the edit form "2026-07-29" - a day earlier than
  the SAME date printed one row above by formatDate(), which uses
  toLocaleDateString and therefore reads the local calendar.

  The two must agree. A user in India opening a leave request that ran
  30 Jul - 2 Aug saw those dates in the table, edited nothing, pressed
  Save, and shifted their own leave a day earlier.
*/
export const toInputDate = (dateValue) => {
  if (!dateValue) {
    return "";
  }

  const date = new Date(dateValue);

  if (isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};
