/*
=========================================================================
  PAGE: Unauthorized  (403)
=========================================================================
  Shown when a logged in user opens a page their role does not allow,
  for example an Employee typing /roles into the address bar.
=========================================================================
*/

import { Link } from "react-router-dom";
import { MdBlock } from "react-icons/md";

function Unauthorized() {
  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
          <MdBlock size={30} />
        </div>

        <h1 className="text-2xl font-semibold text-slate-800 mt-5">
          Access denied
        </h1>

        <p className="text-sm text-slate-500 mt-2">
          Your role does not have permission to open this page. If you think
          this is a mistake, please contact your administrator.
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

export default Unauthorized;
