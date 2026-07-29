import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/saidian-work/",
  plugins: [vue()],
  server: { port: 3212, strictPort: true },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/element-plus") || id.includes("node_modules/@element-plus")) return "element-plus";
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) return "editor";
          if (id.includes("node_modules/vue") || id.includes("node_modules/@vue")) return "vue";
        },
      },
    },
  },
});
