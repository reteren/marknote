import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/** WebView2 supports woff2, so do not emit duplicate ttf/woff files. */
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

// The port is fixed because it is also the devUrl in tauri.conf.json.
export default defineConfig({
  plugins: [katexWoff2Only(), svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri rebuilds Cargo; Vite must not watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105", // WebView2 on supported Windows 10 versions
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          // KaTeX is needed only by an editor that contains a formula.
          if (moduleId.includes("/node_modules/katex/")) return "katex";
          return undefined;
        },
      },
    },
  },
});
