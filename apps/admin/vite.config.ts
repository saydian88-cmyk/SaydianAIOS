import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
  server: { port: 3211, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});
