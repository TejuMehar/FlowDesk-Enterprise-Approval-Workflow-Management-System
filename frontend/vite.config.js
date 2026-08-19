/*
=========================================================================
  VITE CONFIG
=========================================================================
  Vite is the tool that runs the React app while we develop and builds
  it for production.

  Two plugins are used:
    react()        -> understands JSX and gives us hot reload
    tailwindcss()  -> Tailwind v4 plugin. Because of this we do NOT need
                      a tailwind.config.js or a postcss.config.js file.
                      One line in src/index.css is enough.
=========================================================================
*/

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173, // the URL is http://localhost:5173
    open: true, // open the browser automatically
  },
});
