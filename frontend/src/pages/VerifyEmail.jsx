/*
=========================================================================
  PAGE: Verify Email
=========================================================================
  The user lands here from the link in the verification email:

      http://localhost:5173/verify-email/<token>

  This page has no form. As soon as it opens, useEffect sends the token
  to the backend and then shows one of three things:

      "checking..."  ->  status = "loading"
      "verified!"    ->  status = "success"
      "link expired" ->  status = "error"
=========================================================================
*/

import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ClipLoader } from "react-spinners";
import { MdCheckCircle, MdError } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";

function VerifyEmail() {
  const { token } = useParams();

  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  /*
    In development React runs useEffect TWICE on purpose (StrictMode),
    which would call the backend twice and make the second call fail,
    because the token is already used.
    This little "flag" makes sure we only send the request once.
  */
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    const verify = async () => {
      try {
        const result = await api.post(`/api/auth/verify-email/${token}`);

        setStatus("success");
        setMessage(result.data.message);
      } catch (error) {
        setStatus("error");
        setMessage(getErrorMessage(error));
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
        {/* ---------- while we are asking the backend ---------- */}
        {status === "loading" && (
          <>
            <ClipLoader size={40} color="#4f46e5" />
            <h1 className="text-xl font-semibold text-slate-800 mt-5">
              Verifying your email...
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              This only takes a moment.
            </p>
          </>
        )}

        {/* ---------- it worked ---------- */}
        {status === "success" && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
              <MdCheckCircle size={30} />
            </div>

            <h1 className="text-xl font-semibold text-slate-800 mt-5">
              Email verified
            </h1>
            <p className="text-sm text-slate-500 mt-2">{message}</p>

            <Link
              to="/login"
              className="inline-block mt-6 px-5 h-11 leading-[44px] rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              Go to login
            </Link>
          </>
        )}

        {/* ---------- the link was bad or too old ---------- */}
        {status === "error" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <MdError size={30} />
            </div>

            <h1 className="text-xl font-semibold text-slate-800 mt-5">
              Verification failed
            </h1>
            <p className="text-sm text-slate-500 mt-2">{message}</p>

            <Link
              to="/login"
              className="inline-block mt-6 text-sm text-indigo-600 hover:underline"
            >
              Back to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default VerifyEmail;
