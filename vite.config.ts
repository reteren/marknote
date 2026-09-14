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
  },
});
