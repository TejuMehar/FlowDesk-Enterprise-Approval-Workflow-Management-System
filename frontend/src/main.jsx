/*
=========================================================================
  MAIN ENTRY FILE OF THE REACT APP
=========================================================================
  This is the first file the browser runs. It takes our <App /> and puts
  it inside the <div id="root"> of index.html.

  We also wrap <App /> in three "providers":

    <BrowserRouter>  -> gives every page the ability to navigate
    <Provider>       -> gives every page access to the Redux store
    <ToastContainer> -> the little success / error messages in the corner
=========================================================================
*/

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import App from "./App.jsx";
import { store } from "./redux/store.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
        <ToastContainer position="top-center" autoClose={2000} />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);
