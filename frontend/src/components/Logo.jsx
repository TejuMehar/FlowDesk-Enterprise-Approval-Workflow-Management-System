/*
=========================================================================
  COMPONENT: Logo
=========================================================================
  One place for the FlowDesk logo, so every screen uses the same file
  (public/FlowDesk.png) and we never repeat the sizing math.

  The picture we were given is the FULL lockup: the "F" symbol on top,
  then the word "FlowDesk", then the tagline. That is great on a big
  surface like the login screen, but useless in a 36px corner of the
  sidebar - the tagline would be two pixels tall.

  So there are two variants:

    <LogoMark />  ->  only the "F" symbol, cropped out of the picture.
                      Used next to a text wordmark (sidebar, navbar...).

    <LogoFull />  ->  the whole lockup, untouched.
                      Used where there is room to breathe (login page).

  HOW THE CROP WORKS
  The picture is square and the symbol sits in roughly the top middle of
  it. We put the image inside a box with "overflow-hidden", blow the
  image up to 217% of that box and slide it up/left so that only the
  symbol stays visible. Everything below (the word + tagline) falls
  outside the box and is clipped away.
=========================================================================
*/

import { getPhotoUrl } from "../utils/config.js";

/* the path is relative to the "public" folder, so it starts with "/" */
const LOGO_SRC = "/FlowDesk.png";

/* ---------------- only the "F" symbol ---------------- */
function LogoMark({ className = "w-9 h-9" }) {
  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded-lg bg-white ${className}`}
    >
      <img
        src={LOGO_SRC}
        alt=""
        /*
          aria-hidden: the symbol carries no information of its own,
          the word "FlowDesk" is always written next to it.
        */
        aria-hidden="true"
        className="absolute max-w-none w-[217%] left-[-61%] top-[-31%]"
      />
    </span>
  );
}

/* ---------------- the complete logo ---------------- */
function LogoFull({ className = "h-24" }) {
  return (
    <img
      src={LOGO_SRC}
      alt="FlowDesk"
      className={`w-auto object-contain ${className}`}
    />
  );
}

/* =====================================================================
   MODULE 9 - THE COMPANY'S OWN MARK AND NAME
   ---------------------------------------------------------------------
   Everything above draws FlowDesk. These two draw whatever the company
   uploaded on the Settings page, and fall back to FlowDesk when it has
   not uploaded anything.

   They are in this file rather than in the Settings folder because the
   three places that use them - the sidebar, the navbar and the login
   page - already imported from here, and a logo should have one home.

   THE FALLBACK IS NOT A LOADING STATE. The company settings arrive
   from an unauthenticated endpoint that may be slow or may fail, and a
   login page that draws nothing until branding loads is worse than one
   that briefly says FlowDesk. So both components render something
   useful with no props at all.
   ===================================================================== */

/*
  The small square mark: the uploaded logo, or the built-in "F".

  object-contain and not object-cover: a company logo is usually wide,
  and cover would crop the ends off it. Contain shows all of it inside
  the square, letterboxed.
*/
function CompanyMark({ company, className = "w-9 h-9" }) {
  if (company?.companyLogo) {
    return (
      <span
        className={`relative block shrink-0 overflow-hidden rounded-lg bg-white ${className}`}
      >
        <img
          src={getPhotoUrl(company.companyLogo)}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-contain"
        />
      </span>
    );
  }

  return <LogoMark className={className} />;
}

/*
  The name next to the mark.

  "FlowDesk" is drawn in its two brand colours; any other company name
  is drawn in one. Splitting an arbitrary name in half and colouring
  the pieces would look like a rendering bug, not like branding.
*/
function CompanyWordmark({ company, className = "text-[16px]" }) {
  const name = company?.companyName || "FlowDesk";

  if (name === "FlowDesk") {
    return (
      <span className={`font-semibold tracking-tight leading-none ${className}`}>
        <span className="text-blue-700">Flow</span>
        <span className="text-slate-900">Desk</span>
      </span>
    );
  }

  return (
    <span
      className={`font-semibold tracking-tight leading-none text-slate-900 truncate ${className}`}
      title={name}
    >
      {name}
    </span>
  );
}

export { LogoMark, LogoFull, CompanyMark, CompanyWordmark };
