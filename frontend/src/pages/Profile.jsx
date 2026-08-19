/*
=========================================================================
  PAGE: My Profile   (Employee Profile + Upload Profile Photo)
=========================================================================
  Two things happen on this page:

  1. UPLOAD PHOTO
     A file cannot be sent as JSON, so we build a FormData object and
     axios sends it as "multipart/form-data". The backend reads it with
     multer.

  2. EDIT PROFILE
     A normal JSON request with the personal details. The employee can
     only edit their OWN details - role, department and email belong to
     the administrator.
=========================================================================
*/

import { useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { ClipLoader } from "react-spinners";
import { MdPhotoCamera, MdVerified, MdErrorOutline } from "react-icons/md";

import { api, getErrorMessage } from "../utils/api.js";
import { setUserData } from "../redux/userSlice.js";
import { getPhotoUrl, formatDate, toInputDate } from "../utils/config.js";

function Profile() {
  const { userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();

  /*
    The form starts with the values we already have.
    toInputDate turns the date into the "YYYY-MM-DD" text an
    <input type="date"> needs.
  */
  const [form, setForm] = useState({
    firstName: userData?.firstName || "",
    lastName: userData?.lastName || "",
    phone: userData?.phone || "",
    gender: userData?.gender || "",
    dateOfBirth: toInputDate(userData?.dateOfBirth),
    address: userData?.address || "",
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  /*
    The real <input type="file"> is ugly, so we hide it and click it
    from our own nice button. useRef gives us the handle to do that.
  */
  const fileInputRef = useRef(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  /* =================================================================
     1) UPLOAD THE PHOTO
     ================================================================= */
  const handlePhotoChange = async (event) => {
    // event.target.files is a list; we only allow one file
    const file = event.target.files[0];

    if (!file) {
      return;
    }

    // check the size here too, so the user gets an instant answer
    if (file.size > 2 * 1024 * 1024) {
      toast.error("The photo must be smaller than 2 MB");
      return;
    }

    /*
      FormData is the object browsers use to send files.
      "photo" MUST match upload.single("photo") in the backend route.
    */
    const formData = new FormData();
    formData.append("photo", file);

    setUploading(true);

    try {
      const result = await api.post("/api/user/profile/photo", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // update Redux so the navbar shows the new photo straight away
      dispatch(
        setUserData({ ...userData, photoUrl: result.data.photoUrl })
      );

      toast.success(result.data.message);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);

      /*
        Clear the input. Without this, choosing the SAME file again
        would not fire onChange, because the value did not change.
      */
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /* =================================================================
     2) SAVE THE PROFILE
     ================================================================= */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First name and last name are required");
      return;
    }

    setSaving(true);

    try {
      const result = await api.put("/api/user/profile/me", form);

      dispatch(setUserData(result.data.user));
      toast.success(result.data.message);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const photo = getPhotoUrl(userData?.photoUrl);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-800">My Profile</h1>

      {/* ==================== photo + read-only info ==================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* ---------- the photo ---------- */}
          <div className="relative">
            {photo ? (
              <img
                src={photo}
                alt="profile"
                className="w-28 h-28 rounded-full object-cover border-2 border-slate-200"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-4xl font-semibold">
                {userData?.firstName?.charAt(0).toUpperCase()}
              </div>
            )}

            {/* the small camera button on the corner of the photo */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-70 border-2 border-white"
            >
              {uploading ? (
                <ClipLoader size={15} color="white" />
              ) : (
                <MdPhotoCamera size={18} />
              )}
            </button>

            {/* the hidden real file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png, image/jpeg, image/jpg, image/webp"
              onChange={handlePhotoChange}
              className="hidden"
            />
          </div>

          {/* ---------- the details we cannot edit here ---------- */}
          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <h2 className="text-lg font-semibold text-slate-800">
                {userData?.fullName}
              </h2>

              {userData?.isEmailVerified ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  <MdVerified size={13} /> Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <MdErrorOutline size={13} /> Not verified
                </span>
              )}
            </div>

            <p className="text-sm text-slate-500 mt-0.5">{userData?.email}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
              <div>
                <p className="text-xs text-slate-500">Employee ID</p>
                <p className="text-sm font-medium text-slate-800">
                  {userData?.employeeId || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Role</p>
                <p className="text-sm font-medium text-slate-800">
                  {userData?.role?.name || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Department</p>
                <p className="text-sm font-medium text-slate-800">
                  {userData?.department?.name || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Joined</p>
                <p className="text-sm font-medium text-slate-800">
                  {formatDate(userData?.dateOfJoining)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-5 pt-5 border-t border-slate-100">
          Your email, role and department can only be changed by an
          administrator.
        </p>
      </div>

      {/* ==================== the editable form ==================== */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 p-6"
      >
        <h2 className="text-base font-semibold text-slate-800 mb-5">
          Personal details
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              First name
            </label>
            <input
              name="firstName"
              value={form.firstName}
              onChange={handleChange}
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Last name
            </label>
            <input
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Phone</label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="+91 98765 43210"
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Gender</label>
            <select
              name="gender"
              value={form.gender}
              onChange={handleChange}
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white"
            >
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Date of birth
            </label>
            <input
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={handleChange}
              className="h-11 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-slate-700">
              Address
            </label>
            <textarea
              name="address"
              value={form.address}
              onChange={handleChange}
              rows={3}
              placeholder="Street, city, state"
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            type="submit"
            disabled={saving}
            className="h-11 px-6 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center min-w-[140px]"
          >
            {saving ? <ClipLoader size={20} color="white" /> : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Profile;
