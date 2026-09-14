import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/** WebView2 поддерживает woff2, поэтому не выпускаем дублирующие ttf/woff. */
function katexWoff2Only() {
  return {
    name: "marknote-katex-woff2-only",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      const normalizedId = id.replaceAll("\\", "/");
      if (!normalizedId.includes("/node_modules/katex/dist/katex.min.css")) return null;

      const code = source.replace(/@font-face\{[^}]*\}/g, (fontFace) =>
        fontFace.replace(/src:([^;}]+)(;?)/g, (_declaration, sources: string, terminator: string) => {
          const woff2Sources = sources.match(/url\([^)]*\.woff2(?:[?#][^)]*)?\)\s*format\([^)]*\)/g);
          return woff2Sources ? `src:${woff2Sources.join(",")}${terminator}` : _declaration;
        }),
      );
      return { code, map: null };
    },
  };
}

// Порт фиксирован: он же прописан как devUrl в tauri.conf.json.
export default defineConfig({
  plugins: [katexWoff2Only(), svelte()],
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
