import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: { port: 3211, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});

