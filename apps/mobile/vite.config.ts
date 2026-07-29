import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "../../public",
  envDir: "../..",
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
