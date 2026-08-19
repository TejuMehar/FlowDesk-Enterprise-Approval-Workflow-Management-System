/*
=========================================================================
  REDUX SLICE: user
=========================================================================
  Redux is a box that stores data which MANY pages need.
  Here we keep the logged in user, so the navbar, the sidebar and every
  page can read it without passing props down again and again.

  A "slice" has three parts:
    name          -> a label
    initialState  -> the data when the app starts
    reducers      -> the functions that change the data
=========================================================================
*/

import { createSlice } from "@reduxjs/toolkit";

const userSlice = createSlice({
  name: "user",

  initialState: {
    // the logged in user, or null when nobody is logged in
    userData: null,

    /*
      false while we are still asking the backend "who is logged in?".
      Without this flag the app would show the login page for a split
      second on every refresh, even for a user who IS logged in.
    */
    authChecked: false,
  },

  reducers: {
    // action.payload is the value we send when we call the action
    setUserData: (state, action) => {
      state.userData = action.payload;
    },

    setAuthChecked: (state, action) => {
      state.authChecked = action.payload;
    },
  },
});

// these are the functions the components call with dispatch(...)
export const { setUserData, setAuthChecked } = userSlice.actions;

export default userSlice.reducer;
