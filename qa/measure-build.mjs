// Build MarkNote and emit a reproducible Rollup module-size report.
// Run from the repository root: node qa/measure-build.mjs
// The report is written to qa/w142-build-report.json and dist is rebuilt.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, loadConfigFromFile } from "vite";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "qa/w142-build-report.json");
const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, resolve(root, "vite.config.ts"), root, "silent");
if (!loaded?.config) throw new Error("Unable to load vite.config.ts");

let report;
const reportPlugin = {
  name: "marknote-w142-build-report",
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((entry) => entry.type === "chunk").map((chunk) => {
      const modules = Object.entries(chunk.modules)
        .map(([id, info]) => ({
          id: id.replaceAll("\\", "/"),
          renderedBytes: info.renderedLength,
          originalBytes: info.originalLength,
        }))
        .sort((a, b) => b.renderedBytes - a.renderedBytes);
      return {
        fileName: chunk.fileName,
        bytes: Buffer.byteLength(chunk.code),
        gzipBytes: null,
        modules,
      };
    });
    const main = chunks.find((chunk) => chunk.fileName.startsWith("assets/index-"));
    report = {
      generatedAt: new Date().toISOString(),
      command: "npm run build",
      mainChunk: main?.fileName ?? null,
      mainChunkBytes: main?.bytes ?? null,
      chunks: chunks.map(({ modules: _modules, ...chunk }) => chunk),
      mainModules: main?.modules ?? [],
    };
  },
};

loaded.config.root = root;
loaded.config.configFile = false;
loaded.config.plugins = [...(loaded.config.plugins ?? []), reportPlugin];
await build(loaded.config);
if (!report) throw new Error("Rollup did not produce a report");
await mkdir(resolve(root, "qa"), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(reportPath);
console.log(JSON.stringify({ mainChunk: report.mainChunk, mainChunkBytes: report.mainChunkBytes, topModules: report.mainModules.slice(0, 10) }, null, 2));
