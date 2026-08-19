/*
=========================================================================
  REDUX STORE
=========================================================================
  The store is the box that holds ALL the slices together.
  main.jsx wraps the app in <Provider store={store}>, which is what
  makes useSelector() and useDispatch() work everywhere.
=========================================================================
*/

import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice.js";

export const store = configureStore({
  reducer: {
    // in a component we read it with:
    //   const { userData } = useSelector((state) => state.user);
    user: userReducer,
  },
});

export default store;
