import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base is mandatory: Home Assistant Ingress serves the app from a
  // dynamic path such as /api/hassio_ingress/<token>/.
  base: "./",
  build: { outDir: "dist", assetsDir: "assets" },
});
