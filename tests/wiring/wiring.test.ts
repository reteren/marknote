import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function filesUnder(directory: string, extension?: string): string[] {
  const result: string[] = [];
  const visit = (current: string) => {
    const entries: Dirent[] = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!extension || extname(entry.name) === extension) result.push(path);
    }
  };
  visit(directory);
  return result;
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function projectPath(path: string): string {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function exportedNames(text: string, suffix: string): string[] {
  const names: string[] = [];
  const expression = new RegExp(
    `export\\s+(?:const|function)\\s+([A-Za-z_$][\\w$]*${suffix})\\b`,
    "g",
  );
  for (const match of text.matchAll(expression)) names.push(match[1]);
  return names;
}

function failureMessage(title: string, lines: string[]): string {
  return [title, ...lines.map((line) => `- ${line}`)].join("\n");
}

describe("wiring contracts", () => {
  it("registers every live-preview *Builder export in plugin.ts", () => {
    const previewRoot = resolve(ROOT, "src/editor/livePreview");
    const modules = filesUnder(previewRoot, ".ts");
    const builders = modules.flatMap((path) =>
      exportedNames(source(path), "Builder").map((name) => ({ path, name })),
    );
    const plugin = source(resolve(previewRoot, "plugin.ts"));
    const registry = plugin.match(
      /export\s+const\s+livePreviewBlockBuilders\b[\s\S]*?=\s*\[([\s\S]*?)\]\s*;/,
    )?.[1] ?? "";
    const registered = new Set(
      [...registry.matchAll(/\b([A-Za-z_$][\w$]*Builder)\b/g)].map((match) => match[1]),
    );
    const missing = builders.filter(({ name }) => !registered.has(name));

    expect(
      missing,
      failureMessage(
        "Unregistered live-preview builders:",
        missing.map(({ path, name }) =>
          `${projectPath(path)} exports ${name}; add ${name} to livePreviewBlockBuilders in src/editor/livePreview/plugin.ts`,
        ),
      ),
    ).toEqual([]);
  });

  it("includes every live-preview *Theme and *Tooltip export in livePreview()", () => {
    const previewRoot = resolve(ROOT, "src/editor/livePreview");
    const index = source(resolve(previewRoot, "index.ts"));
    const returnedExtensions = index.match(
      /export\s+function\s+livePreview\b[\s\S]*?return\s*\[([\s\S]*?)\]\s*;/,
    )?.[1] ?? "";
    const modules = filesUnder(previewRoot, ".ts").filter((path) => basename(path) !== "index.ts");
    const themes = modules.flatMap((path) =>
      exportedNames(source(path), "(?:Theme|Tooltip)").map((name) => ({ path, name })),
    );
    const missing = themes.filter(({ name }) => !new RegExp(`\\b${name}\\b`).test(returnedExtensions));

    expect(
      missing,
      failureMessage(
        "Unregistered live-preview extensions:",
        missing.map(({ path, name }) =>
          `${projectPath(path)} exports ${name}; import it and add it to the livePreview() return array in src/editor/livePreview/index.ts`,
        ),
      ),
    ).toEqual([]);
  });

  it("declares every Rust module in its crate module tree", () => {
    const rustRoot = resolve(ROOT, "src-tauri/src");
    const libPath = resolve(rustRoot, "lib.rs");
    const lib = source(libPath);
    // lib.rs is the root itself, and main.rs is a binary entry point rather
    // than a child module. Every other direct .rs file must be declared.
    const missingRootModules = filesUnder(rustRoot, ".rs")
      .filter((path) => dirname(path) === rustRoot)
      .filter((path) => !["lib.rs", "main.rs"].includes(basename(path)))
      .filter((path) => {
        const name = basename(path, ".rs");
        return !new RegExp(`(?:^|\\n)\\s*(?:pub\\s+)?mod\\s+${name}\\s*;`).test(lib);
      });

    const formatsRoot = resolve(rustRoot, "formats");
    const formatsMod = source(resolve(formatsRoot, "mod.rs"));
    const missingFormatModules = filesUnder(formatsRoot, ".rs")
      .filter((path) => basename(path) !== "mod.rs")
      .filter((path) => {
        const name = basename(path, ".rs");
        return !new RegExp(`(?:^|\\n)\\s*(?:pub\\s+)?mod\\s+${name}\\s*;`).test(formatsMod);
      });

    const failures = [
      ...missingRootModules.map((path) =>
        `${projectPath(path)} is not declared in src-tauri/src/lib.rs; add mod ${basename(path, ".rs")};`,
      ),
      ...missingFormatModules.map((path) =>
        `${projectPath(path)} is not declared in src-tauri/src/formats/mod.rs; add pub mod ${basename(path, ".rs")};`,
      ),
    ];

    // A detector can be declared and still be dead code.  Keep the specific
    // safety boundary that protects open_file in this wiring check as well.
    const binaryPath = resolve(rustRoot, "binary.rs");
    const commandsPath = resolve(rustRoot, "commands.rs");
    if (missingRootModules.length === 0 && existsSync(binaryPath) && existsSync(commandsPath)) {
      const binarySource = source(binaryPath);
      const commandsSource = source(commandsPath);
      const detectors = [...binarySource.matchAll(/pub\s+fn\s+(is_binary(?:_[A-Za-z0-9]+)?)\s*\(/g)].map(
        (match) => match[1],
      );
      const openFileStart = commandsSource.indexOf("fn open_file");
      const nextCommand = commandsSource.indexOf("#[tauri::command]", openFileStart + 1);
      const openFileBody = openFileStart < 0
        ? ""
        : commandsSource.slice(openFileStart, nextCommand < 0 ? commandsSource.length : nextCommand);
      if (detectors.length > 0 && !detectors.some((detector) =>
        new RegExp(`\\bbinary::${detector}\\s*\\(`).test(openFileBody)
      )) {
        failures.push(
          `src-tauri/src/binary.rs exports ${detectors.join(", ")}, but open_file does not call a detector; add binary::is_binary*(...) in src-tauri/src/commands.rs`,
        );
      }
    }
    expect(failures, failureMessage("Unregistered Rust modules:", failures)).toEqual([]);
  });

  it("keeps Rust commands, invoke_handler, and CONTRACTS.md section 5 in sync", () => {
    const rustRoot = resolve(ROOT, "src-tauri/src");
    const commandSources = filesUnder(rustRoot, ".rs");
    const commandDeclarations: Array<{ name: string; path: string }> = [];
    const commandExpression = /#\[tauri::command(?:\s*\([^\]]*\))?\][\s\S]*?\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/g;
    for (const path of commandSources) {
      for (const match of source(path).matchAll(commandExpression)) {
        commandDeclarations.push({ name: match[1], path });
      }
    }
    const declared = new Set(commandDeclarations.map(({ name }) => name));

    const lib = source(resolve(rustRoot, "lib.rs"));
    const handlerBody = lib.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/)?.[1] ?? "";
    const registered = [...handlerBody.matchAll(/\bcommands::([A-Za-z_]\w*)\b/g)].map((match) => match[1]);
    const registeredSet = new Set(registered);

    const contracts = source(resolve(ROOT, "docs/CONTRACTS.md"));
    const contractsSection = contracts.split(/^##\s+5\./m)[1]?.split(/^##\s+6\./m)[0] ?? "";
    const documented = [...contractsSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
    const documentedSet = new Set(documented);

    const failures = [
      ...commandDeclarations
        .filter(({ name }) => !registeredSet.has(name))
        .map(({ name, path }) =>
          `${projectPath(path)} declares #[tauri::command] ${name}, but it is not registered; add commands::${name} to invoke_handler in src-tauri/src/lib.rs`,
        ),
      ...registered
        .filter((name) => !declared.has(name))
        .map((name) =>
          `src-tauri/src/lib.rs registers commands::${name}, but no such #[tauri::command] was found; remove the entry or add the command in src-tauri/src/`,
        ),
      ...documented
        .filter((name) => !declared.has(name))
        .map((name) =>
          `docs/CONTRACTS.md §5 requires IPC command ${name}, but it is not among #[tauri::command]; IPC owner W1 must implement it in src-tauri/src/ and register it in lib.rs`,
        ),
    ];
    expect(failures, failureMessage("IPC command mismatches:", failures)).toEqual([]);
  });

  it("mounts every src/ui component from App.svelte or a mounted component", () => {
    const srcRoot = resolve(ROOT, "src");
    const uiRoot = resolve(srcRoot, "ui");
    const uiFiles = filesUnder(uiRoot, ".svelte");
    const allComponents = filesUnder(srcRoot, ".svelte");
    const imports = new Map<string, Array<{ child: string; localName: string; used: boolean }>>();
    const importExpression = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']([^"']+\.svelte)["']/g;
    for (const importer of allComponents) {
      const importerSource = source(importer);
      const edges: Array<{ child: string; localName: string; used: boolean }> = [];
      for (const match of importerSource.matchAll(importExpression)) {
        const child = resolve(dirname(importer), match[2]);
        if (!child.endsWith(".svelte") || !allComponents.includes(child)) continue;
        const localName = match[1];
        const tag = new RegExp(`<${localName}(?:\\s|/?>)`);
        edges.push({ child, localName, used: tag.test(importerSource) });
      }
      // A lazily mounted dialog is a real component edge too. Keep the
      // reachability contract aware of dynamic imports used for code-splitting.
      const dynamicImportExpression = /import\(\s*["']([^"']+\.svelte)["']\s*\)/g;
      for (const match of importerSource.matchAll(dynamicImportExpression)) {
        const child = resolve(dirname(importer), match[1]);
        if (!child.endsWith(".svelte") || !allComponents.includes(child)) continue;
        edges.push({ child, localName: basename(child, ".svelte"), used: true });
      }
      imports.set(importer, edges);
    }

    const app = resolve(srcRoot, "App.svelte");
    const mounted = new Set<string>([app]);
    const queue = [app];
    while (queue.length > 0) {
      const importer = queue.shift()!;
      for (const edge of imports.get(importer) ?? []) {
        if (!edge.used || mounted.has(edge.child)) continue;
        mounted.add(edge.child);
        queue.push(edge.child);
      }
    }

    const failures: string[] = [];
    for (const component of uiFiles) {
      if (mounted.has(component)) continue;
      const importers = allComponents.flatMap((importer) =>
        (imports.get(importer) ?? [])
          .filter((edge) => edge.child === component)
          .map((edge) =>
            edge.used
              ? `${projectPath(importer)} imports the component, but it is unreachable from App.svelte`
              : `${projectPath(importer)} imports it as ${edge.localName}, but does not mount the <${edge.localName}> tag`,
          ),
      );
      failures.push(
        `${projectPath(component)} is not mounted: import it and use it as <${basename(component, ".svelte")}> in App.svelte or an already mounted component${importers.length ? ` (${importers.join("; ")})` : ""}`,
      );
    }

    expect(failures, failureMessage("Unmounted UI components:", failures)).toEqual([]);
  });

  it("routes every external opener through safeLinkHref", () => {
    const srcRoot = resolve(ROOT, "src");
    const sourceFiles = filesUnder(srcRoot).filter((path) => [".ts", ".svelte"].includes(extname(path)));
    const failures: string[] = [];
    const directWindowOpen = /\bwindow\.open\s*\(/g;
    // Match the common adapter form `dialogs.openLink(url)` (one dot before
    // the method).  Keep this intentionally broad so a new external opener
    // cannot evade the wiring check by choosing another receiver name.
    const adapterOpenLink = /\b[A-Za-z_$][\w$]*\.openLink\s*\(/g;

    for (const path of sourceFiles) {
      const text = source(path);
      for (const match of text.matchAll(directWindowOpen)) {
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        const before = text.slice(Math.max(0, match.index - 600), match.index);
        const invocation = text.slice(match.index, match.index + 180);
        const argument = invocation.match(/window\.open\s*\(\s*([A-Za-z_$][\w$]*)/)?.[1];
        const normalizedVariable = argument && new RegExp(
          `(?:const|let|var)\\s+${argument}\\s*=\\s*safeLinkHref\\s*\\(`,
        ).test(before);
        const inlineNormalized = /^window\.open\s*\(\s*safeLinkHref\s*\(/.test(invocation);
        const guarded = Boolean(normalizedVariable || inlineNormalized);
        if (!guarded) {
          failures.push(
            `${projectPath(path)}:${line} calls window.open without safeLinkHref; import the helper from src/editor/livePreview/inline.ts and open only its result`,
          );
        }
      }
      for (const match of text.matchAll(adapterOpenLink)) {
        const line = text.slice(0, match.index).split(/\r?\n/).length;
        const before = text.slice(Math.max(0, match.index - 600), match.index);
        const invocation = text.slice(match.index, match.index + 180);
        const argument = invocation.match(/\.openLink\s*\(\s*([A-Za-z_$][\w$]*)/)?.[1];
        const normalizedVariable = argument && new RegExp(
          `(?:const|let|var)\\s+${argument}\\s*=\\s*safeLinkHref\\s*\\(`,
        ).test(before);
        const inlineNormalized = /\.openLink\s*\(\s*safeLinkHref\s*\(/.test(invocation);
        const guarded = Boolean(normalizedVariable || inlineNormalized);
        if (!guarded) {
          failures.push(
            `${projectPath(path)}:${line} calls external openLink without safeLinkHref; validate the URL before passing it to adapter/dialogs.openLink`,
          );
        }
      }
    }

    expect(failures, failureMessage("Safe-link check bypass:", failures)).toEqual([]);
  });
});
