/*
=========================================================================
  PAGE: Login
=========================================================================
  The user types email + password.
  The backend answers with the user AND sets two httpOnly cookies
  (accessToken + refreshToken). We never touch those cookies ourselves -
  the browser sends them automatically because axios is configured with
  withCredentials: true.

  One card in the middle of the screen, split in two:
    left   -> the form
    right  -> the logo and one line about the product. Decoration only,
              so it is hidden on phones (hidden md:flex).
=========================================================================
*/

import { useState } from "react";
import { useNavigate, useLocation, Navigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { FaRegEyeSlash, FaEye } from "react-icons/fa";

import { api, getErrorMessage } from "../utils/api.js";
import { setUserData } from "../redux/userSlice.js";
import { LogoFull, CompanyMark, CompanyWordmark } from "../components/Logo.jsx";
/*
  MODULE 9 - the company name and logo on the login screen.

  This is the one page that proves the branding endpoint had to be
  public: it draws before anybody has logged in, which is exactly the
  moment there is no token to check. See getPublicSettings() in the
  backend settings controller.
*/
import useCompanySettings from "../CustomHooks/useCompanySettings.js";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { userData } = useSelector((state) => state.user);

  // the company name and logo, from the one public settings route
  const { company } = useCompanySettings();

  /*
    Already logged in? Then this page is useless - go to the dashboard.
    (This happens when somebody types /login by hand.)
  */
  if (userData) {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async (event) => {
    // stops the browser from reloading the page when the form is sent
    event.preventDefault();

    // ---- check the form before calling the server ----
    if (!email.trim() || !password) {
      toast.error("Please enter your email and password");
      return;
    }

    setLoading(true);

    try {
      const result = await api.post("/api/auth/login", { email, password });

      // save the user in Redux, so the whole app knows who is logged in
      dispatch(setUserData(result.data.user));

      toast.success(result.data.message);

      /*
        WHERE TO SEND THEM, in order of how much we trust the answer.

        location.state.from  ProtectedRoute put it there when it turned
                             somebody away, and it never leaves the app
        ?next=...            the axios interceptor put it there when a
                             session expired mid-work and the browser
                             had to be navigated rather than routed

        Both are checked for a leading "/" before being used. `next`
        arrives from the URL bar, where anybody can type, and a value
        like "//evil.example" or "https://evil.example" is a link the
        browser would happily treat as another site - so a login form
        that obeyed it would be an open redirect.
      */
      const nextParam = new URLSearchParams(location.search).get("next");

      const isSafePath = (path) =>
        typeof path === "string" && path.startsWith("/") && !path.startsWith("//");

      const redirectTo =
        (isSafePath(location.state?.from) && location.state.from) ||
        (isSafePath(nextParam) && nextParam) ||
        "/";

      navigate(redirectTo, { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      // runs whether it worked or not, so the button never stays stuck
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl shadow-slate-300/40 ring-1 ring-slate-200 flex overflow-hidden">
        {/* ==================== LEFT: the form ==================== */}
        <div className="w-full md:w-1/2 p-8 sm:p-10">
          <div className="mb-8">
            <div className="flex items-center gap-2.5 mb-7 min-w-0">
              <CompanyMark company={company} className="w-10 h-10" />
              <CompanyWordmark company={company} className="text-xl" />
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="text-slate-500 text-sm mt-1.5">
              Login to your employee account
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {/* ---------- email ---------- */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-4 focus:ring-blue-50"
              />
            </div>

            {/* ---------- password ---------- */}
            <div className="flex flex-col gap-1.5 relative">
              <label
                htmlFor="password"
                className="text-sm font-medium text-slate-700"
              >
                Password
              </label>

              <input
                id="password"
                // switching the type is what hides / shows the password
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full h-11 px-3 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-4 focus:ring-blue-50"
              />

              <button
                type="button"
                onClick={() => setShowPassword((previous) => !previous)}
                className="absolute right-3 top-9 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <FaEye size={17} /> : <FaRegEyeSlash size={17} />}
              </button>
            </div>

            <div className="flex justify-end">
              <Link
                to="/forget-password"
                className="text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline"
              >
                Forgot your password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-blue-700 text-white font-medium text-sm shadow-sm hover:bg-blue-800 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? <ClipLoader size={22} color="white" /> : "Login"}
            </button>
          </form>

          <p className="text-xs text-slate-400 mt-6 text-center">
            Accounts are created by your administrator.
          </p>
        </div>

        {/* ==================== RIGHT: decoration ====================
            "hidden md:flex" -> invisible on phones, visible from
            medium screens upwards.                                   */}
        <div className="relative overflow-hidden hidden md:flex w-1/2 bg-gradient-to-br from-blue-50 via-white to-teal-50 border-l border-blue-100/70 flex-col items-center justify-center p-10 text-center">
          {/*
            TWO SOFT GLOWS - the blue and the teal of the logo.
            They are big blurred circles sitting in the corners, which
            gives the flat panel a bit of depth. "absolute" keeps them
            behind the logo instead of pushing it around, and blur-3xl
            is what turns a hard circle into a glow.
          */}
          <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-blue-400/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-teal-400/20 blur-3xl" />

          {/* the content, lifted above the two glows */}
          <div className="relative z-10 flex flex-col items-center">
            {/*
              mix-blend-multiply blends the white background of the logo
              file into the panel behind it, so we see the mark and the
              wordmark instead of a white rectangle.
            */}
            <LogoFull className="h-36 mix-blend-multiply" />

            <p className="text-slate-600 text-sm mt-6 leading-relaxed max-w-xs">
              One place for your employees, roles, permissions and
              departments.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
