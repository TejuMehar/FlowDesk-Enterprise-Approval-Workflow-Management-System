/*
=========================================================================
  PAGE: Forgot Password
=========================================================================
  The user types their email, we ask the backend to send a reset link.

  NOTE: the backend always answers with the SAME message, whether the
  email exists or not. That is on purpose - otherwise a stranger could
  use this form to find out who has an account.
=========================================================================
*/

import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdMarkEmailRead, MdArrowBack } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";

function ForgetPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  // becomes true after the request worked, so we can show the "check
  // your inbox" screen instead of the form
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!email.trim()) {
      toast.error("Please enter your email");
      return;
    }

    setLoading(true);

    try {
      const result = await api.post("/api/auth/forgot-password", { email });

      toast.success(result.data.message);
      setIsSent(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        {/* the ? : below is a "ternary": condition ? A : B */}
        {isSent ? (
          /* ---------- screen 2: the link was sent ---------- */
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4">
              <MdMarkEmailRead size={28} />
            </div>

            <h1 className="text-xl font-semibold text-slate-800">
              Check your inbox
            </h1>

            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              If an account exists for <b>{email}</b>, we have sent a reset
              link to it. The link is valid for 15 minutes.
            </p>

            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline mt-6"
            >
              <MdArrowBack size={17} /> Back to login
            </Link>
          </div>
        ) : (
          /* ---------- screen 1: the form ---------- */
          <>
            <h1 className="text-2xl font-semibold text-slate-800">
              Forgot password?
            </h1>
            <p className="text-sm text-slate-500 mt-1 mb-6">
              Enter your email and we will send you a link to choose a new
              password.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-slate-700"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center"
              >
                {loading ? (
                  <ClipLoader size={22} color="white" />
                ) : (
                  "Send reset link"
                )}
              </button>
            </form>

            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 mt-6"
            >
              <MdArrowBack size={17} /> Back to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default ForgetPassword;
