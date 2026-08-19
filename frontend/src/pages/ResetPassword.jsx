/*
=========================================================================
  PAGE: Reset Password
=========================================================================
  The user arrives here by clicking the link in the email:

      http://localhost:5173/reset-password/<token>

  useParams() reads that <token> out of the address bar, and we send it
  to the backend together with the new password.
=========================================================================
*/

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { FaRegEyeSlash, FaEye } from "react-icons/fa";

import { api, getErrorMessage } from "../utils/api.js";

function ResetPassword() {
  // the ":token" part of the URL defined in App.jsx
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    // ---- the same rules as the backend, checked here first so the
    //      user gets an answer immediately ----
    if (!password || !confirmPassword) {
      toast.error("Please fill both password fields");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const result = await api.post(`/api/auth/reset-password/${token}`, {
        password,
        confirmPassword,
      });

      toast.success(result.data.message);
      navigate("/login");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-semibold text-slate-800">
          Set a new password
        </h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Your new password must be at least 8 characters and contain an
          uppercase letter, a lowercase letter and a number.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* ---------- new password ---------- */}
          <div className="flex flex-col gap-1.5 relative">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-700"
            >
              New password
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
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

          {/* ---------- confirm password ---------- */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-slate-700"
            >
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center"
          >
            {loading ? <ClipLoader size={22} color="white" /> : "Reset password"}
          </button>
        </form>

        <Link
          to="/login"
          className="block text-sm text-slate-500 hover:text-indigo-600 mt-6"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}

export default ResetPassword;
