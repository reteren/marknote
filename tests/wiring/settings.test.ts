// Frontend meta-test: verify that defaultSettings values are not a facade but
// are actually read and applied by the app outside the settings window and
// state module.
//
// The settings window used to save values to settings.json that nothing in the
// app read. This test guarantees that every setting either has a consumer in
// src/ (effects, CodeMirror extensions, helper modules) or appears in a named
// exception list with a reason (Rust-side handling or a parallel W85/W86/W87 migration).

import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../src/state/settings.svelte";

const ROOT = process.cwd();
const SRC_ROOT = resolve(ROOT, "src");

export type SettingException = {
  path: string;
  reason: string;
};

/**
 * Explicit registry of settings that are not read directly by ordinary
 * frontend code outside the settings window.
 *
 * Every entry must contain a clear technical justification.
 */
export const SETTINGS_EXCEPTIONS: readonly SettingException[] = [
  // --- Settings applied by the Rust backend (windows.*) ---
  {
    path: "windows.rememberSizeAndPosition",
    reason:
      "Handled in Rust: src-tauri/src/lib.rs (window_state_flags configures tauri_plugin_window_state)",
  },
  {
    path: "windows.raiseExistingWindow",
    reason:
      "Handled in Rust: src-tauri/src/windows.rs (existing_window_label raises an existing window instead of creating a duplicate)",
  },

  // --- Interface language ---
  {
    path: "language",
    reason:
      "Applied reactively in src/state/settings.svelte.ts (applyLanguagePreference calls setInterfaceLanguage on load and change)",
  },
];

/** Recursively collects all leaf property paths from a settings object. */
export function extractLeafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...extractLeafPaths(value as Record<string, unknown>, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectSourceFiles(dir: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (extname(entry.name) === ".ts" || extname(entry.name) === ".svelte") {
        const rel = relative(ROOT, fullPath).replaceAll("\\", "/");
        // Exclude the settings state module, settings window and subdirectory, and locale dictionaries.
        if (
          rel === "src/state/settings.svelte.ts" ||
          rel === "src/ui/SettingsWindow.svelte" ||
          rel.startsWith("src/ui/settings/") ||
          rel.startsWith("src/i18n/locales/")
        ) {
          continue;
        }
        files.push({
          path: rel,
          content: readFileSync(fullPath, "utf8"),
        });
      }
    }
  };

  visit(dir);
  return files;
}

/**
 * Checks whether the given setting is read in the supplied file.
 *
 * Recognizes:
 * 1. Direct access: settings.editor.fontSize, settings?.editor?.fontSize, editor?.fontSize
 * 2. Access through settingsState: settingsState.settings.editor.fontSize
 * 3. Bracket access: editor["fontSize"], settings["editor"]["fontSize"]
 * 4. Destructuring: const { fontSize } = editor; const { fontSize } = settings.editor
 * 5. Contextual access to section facets/configs (for example, val.renderFormulas, config.revealMarkup)
 */
export function isSettingReadInContent(path: string, content: string, filePath = ""): boolean {
  if (path.includes(".")) {
    const [section, prop] = path.split(".", 2);
    const escapedSection = escapeRegex(section);
    const escapedProp = escapeRegex(prop);

    // Access such as settings.section.prop, settings?.section?.prop, section.prop, section?.prop.
    const dotAccess = new RegExp(
      `(?:\\bsettingsState\\??\\.settings\\??\\.|\\bsettings\\??\\.)?${escapedSection}\\??\\.${escapedProp}\\b`,
    );
    if (dotAccess.test(content)) return true;

    // Bracket access: section["prop"].
    const bracketAccess = new RegExp(
      `\\b${escapedSection}\\s*\\[\\s*["']${escapedProp}["']\\s*\\]`,
    );
    if (bracketAccess.test(content)) return true;

    // Destructuring: { prop } = ...section.
    const destructuring = new RegExp(
      `\\{[^}]*\\b${escapedProp}\\b[^}]*\\}\\s*=\\s*(?:[A-Za-z0-9_$]+\\??\\.)*${escapedSection}\\b`,
    );
    if (destructuring.test(content)) return true;

    // A whole section is handled in the module named after that section:
    // settings.spellcheck goes to src/editor/spellcheck.ts, where the field is
    // read as options.enabled or config.enabled.
    //
    // This rule is intentionally narrow: a free read such as options.enabled
    // counts only in a file whose path is named after the section. Otherwise
    // any enabled field in any module would satisfy any setting and the check
    // would stop catching anything.
    if (filePath.toLowerCase().includes(section.toLowerCase())) {
      const sectionConfigAccess = new RegExp(
        `\\b(?:${escapedSection}|config|options|opts|val|preview|previewConfig)\\??\\.${escapedProp}\\b`,
      );
      if (sectionConfigAccess.test(content)) return true;
    }
  } else {
    // Top-level property (for example, language).
    const escapedProp = escapeRegex(path);
    const directAccess = new RegExp(
      `(?:\\bsettingsState\\??\\.)?\\bsettings\\??\\.${escapedProp}\\b`,
    );
    if (directAccess.test(content)) return true;

    const bracketAccess = new RegExp(
      `(?:\\bsettingsState\\??\\.)?\\bsettings\\s*\\[\\s*["']${escapedProp}["']\\s*\\]`,
    );
    if (bracketAccess.test(content)) return true;

    const destructuring = new RegExp(
      `\\{[^}]*\\b${escapedProp}\\b[^}]*\\}\\s*=\\s*(?:settingsState\\.)?settings\\b`,
    );
    if (destructuring.test(content)) return true;
  }

  return false;
}

export function findReadersForSetting(
  path: string,
  sourceFiles: Array<{ path: string; content: string }>,
): string[] {
  return sourceFiles
    .filter(({ content, path: filePath }) => isSettingReadInContent(path, content, filePath))
    .map(({ path }) => path);
}

describe("settings are not a facade (settings wiring)", () => {
  const leafPaths = extractLeafPaths(defaultSettings as unknown as Record<string, unknown>);
  const sourceFiles = collectSourceFiles(SRC_ROOT);
  const exceptionMap = new Map(SETTINGS_EXCEPTIONS.map((item) => [item.path, item.reason]));

  it("finds all defaultSettings leaf fields (33 fields)", () => {
    expect(leafPaths.length).toBeGreaterThanOrEqual(33);
    expect(leafPaths).toContain("language");
    expect(leafPaths).toContain("editor.fontSize");
    expect(leafPaths).toContain("livePreview.enabled");
    expect(leafPaths).toContain("files.autosave");
    expect(leafPaths).toContain("windows.startupAction");
  });

  it("all SETTINGS_EXCEPTIONS entries are valid, unique, and justified", () => {
    const leafSet = new Set(leafPaths);
    const seen = new Set<string>();
    const failures: string[] = [];

    for (const exception of SETTINGS_EXCEPTIONS) {
      if (seen.has(exception.path)) {
        failures.push(`Duplicate exception: '${exception.path}'`);
      }
      seen.add(exception.path);

      if (!leafSet.has(exception.path)) {
        failures.push(
          `Stale exception: '${exception.path}' does not exist in defaultSettings`,
        );
      }

      if (!exception.reason || exception.reason.trim().length === 0) {
        failures.push(`Exception '${exception.path}' has no reason`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("each defaultSettings value is read in src/ or has a registered exception", () => {
    const missing: Array<{ path: string; hint: string }> = [];

    for (const path of leafPaths) {
      if (exceptionMap.has(path)) {
        continue;
      }

      const readers = findReadersForSetting(path, sourceFiles);
      if (readers.length === 0) {
        missing.push({
          path,
          hint: `Setting '${path}' is not read anywhere in src/ (outside the settings window and state module). Add real use in app code or register a justified exception in SETTINGS_EXCEPTIONS.`,
        });
      }
    }

    const failureLines = missing.map((m) => `- ${m.hint}`);
    expect(
      missing,
      [
        "Settings that remain a facade (not applied and without a justified exception):",
        ...failureLines,
      ].join("\n"),
    ).toEqual([]);
  });

  it("checks sensitivity: an unused fake setting without an exception reliably fails", () => {
    const fakeUnwiredSetting = "spellcheck.unwiredTestProbe";
    const readers = findReadersForSetting(fakeUnwiredSetting, sourceFiles);
    expect(readers).toEqual([]);
  });
});
