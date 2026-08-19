/*
=========================================================================
  PAGE: Not Found  (404)
=========================================================================
  Shown when the URL does not match any route in App.jsx.
=========================================================================
*/

import { Link } from "react-router-dom";

function NotFound() {
  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-indigo-600">404</h1>

        <h2 className="text-xl font-semibold text-slate-800 mt-3">
          Page not found
        </h2>

        <p className="text-sm text-slate-500 mt-2">
          The page you are looking for does not exist.
        </p>

        <Link
          to="/"
          className="inline-block mt-6 px-5 h-11 leading-[44px] rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
