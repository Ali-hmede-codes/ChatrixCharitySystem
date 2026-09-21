import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": {
        target: "http://127.0.0.1:4173",
        ws: true,
      },
      "/logo": "http://127.0.0.1:4173",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ["exceljs"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      exceljs: path.resolve(__dirname, "node_modules/exceljs/dist/exceljs.min.js"),
    },
  },
});
