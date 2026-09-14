import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Порт фиксирован: он же прописан как devUrl в tauri.conf.json.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri пересобирает cargo, Vite за ним следить не должен
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105", // WebView2 на поддерживаемых Windows 10
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          // KaTeX нужен только редактору, в котором встретилась формула.
          if (moduleId.includes("/node_modules/katex/")) return "katex";
          return undefined;
        },
      },
    },
  },
});
