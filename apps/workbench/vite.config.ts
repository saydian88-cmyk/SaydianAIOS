import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/saidian-work/",
  plugins: [vue()],
  server: { port: 3212, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});
