import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "apps/experiments/web",
  plugins: [react()],
  build: { outDir: "../../../dist/experiments", emptyOutDir: true },
});
