/*
=========================================================================
  PAGE: Change Password
=========================================================================
  For a user who is already logged in and knows their current password.

  On the backend this also logs the account out of every OTHER device,
  and gives this device a fresh pair of tokens - so the user stays
  logged in here.
=========================================================================
*/

import { useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { FaRegEyeSlash, FaEye } from "react-icons/fa";

import { api, getErrorMessage } from "../utils/api.js";
import { setUserData } from "../redux/userSlice.js";

function ChangePassword() {
  const dispatch = useDispatch();

  /*
    Instead of three separate useState calls we keep all the fields in
    ONE object. That way we can use a single handleChange function.
  */
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  /*
    One function for every input.
    e.target.name is the "name" attribute of the input that changed,
    e.target.value is what the user typed.

    [name]: value  -> the square brackets mean "use the VALUE of the
    variable name as the key".
  */
  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const { currentPassword, newPassword, confirmPassword } = form;

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please fill all three fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const result = await api.post("/api/auth/change-password", form);

      // the backend sends the user back, so we refresh Redux
      dispatch(setUserData(result.data.user));

      toast.success(result.data.message);

      // empty the form again
      setForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-slate-800">Change Password</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        For your security you will be logged out of all other devices.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4"
      >
        {/* ---------- current password ---------- */}
        <div className="flex flex-col gap-1.5 relative">
          <label className="text-sm font-medium text-slate-700">
            Current password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            name="currentPassword"
            value={form.currentPassword}
            onChange={handleChange}
            placeholder="Enter your current password"
            className="w-full h-11 px-3 pr-11 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={() => setShowPassword((previous) => !previous)}
            className="absolute right-3 top-9 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <FaEye size={17} /> : <FaRegEyeSlash size={17} />}
          </button>
        </div>

        {/* ---------- new password ---------- */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            name="newPassword"
            value={form.newPassword}
            onChange={handleChange}
            placeholder="At least 8 characters"
            className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <p className="text-xs text-slate-400">
            Must contain an uppercase letter, a lowercase letter and a number.
          </p>
        </div>

        {/* ---------- confirm ---------- */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            Confirm new password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={handleChange}
            placeholder="Repeat the new password"
            className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center mt-2"
        >
          {loading ? <ClipLoader size={22} color="white" /> : "Update password"}
        </button>
      </form>
    </div>
  );
}

export default ChangePassword;
