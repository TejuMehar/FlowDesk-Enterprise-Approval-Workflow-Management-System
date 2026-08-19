/*
=========================================================================
  CUSTOM HOOK: useGetCurrentUser
=========================================================================
  A "custom hook" is just a function whose name starts with "use" and
  which is allowed to use other hooks like useEffect.

  This one runs ONE time when the app starts and asks the backend
  "who is logged in?".

    - the cookie is still valid   -> we save the user in Redux
    - the cookie is gone/expired  -> we save null

  Either way we set authChecked = true at the end, which tells the app
  "the check is finished, you may now decide what to show".
=========================================================================
*/

import { useEffect } from "react";
import { useDispatch } from "react-redux";

import { api } from "../utils/api.js";
import { setUserData, setAuthChecked } from "../redux/userSlice.js";

const useGetCurrentUser = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const result = await api.get("/api/auth/me");

        // the backend answers { message, user }
        dispatch(setUserData(result.data.user));
      } catch (error) {
        // no valid session -> nobody is logged in
        dispatch(setUserData(null));
      } finally {
        // "finally" always runs, whether it worked or not
        dispatch(setAuthChecked(true));
      }
    };

    fetchCurrentUser();
  }, [dispatch]);
};

export default useGetCurrentUser;
