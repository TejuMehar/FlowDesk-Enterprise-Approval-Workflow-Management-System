/*
=========================================================================
  COMPONENT: FullPageLoader
=========================================================================
  A spinner that fills the whole screen.
  We show it while the app is checking who is logged in.
=========================================================================
*/

import { ClipLoader } from "react-spinners";

function FullPageLoader({ message = "Loading..." }) {
  return (
    <div className="w-full h-screen flex flex-col items-center justify-center gap-4 bg-slate-100">
      <ClipLoader size={45} color="#4f46e5" />
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}

export default FullPageLoader;
