import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildInstallerHooks } from "../scripts/generate-installer-hooks.mjs";

const config = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

describe("generated NSIS installer hooks", () => {
  it("sets the document icon for every Tauri file association ProgId and removes it on uninstall", () => {
    const hooks = buildInstallerHooks(config);
    const progIds = [...new Set(config.bundle.fileAssociations.map(({ name }) => name))];

    for (const progId of progIds) {
      const key = `Software\\Classes\\${progId}\\DefaultIcon`;
      expect(hooks).toContain(`WriteRegStr HKCU "${key}" "" "$INSTDIR\\document.ico,0"`);
      expect(hooks).toContain(`DeleteRegKey HKCU "${key}"`);
    }

    expect(hooks).toContain('!insertmacro UPDATEFILEASSOC');
    expect(config.bundle.resources).toMatchObject({ "icons/document.ico": "document.ico" });
  });

  it("writes each ProgId icon override only once even when several extensions share it", () => {
    const hooks = buildInstallerHooks(config);

    for (const { name } of config.bundle.fileAssociations) {
      const line = `WriteRegStr HKCU "Software\\Classes\\${name}\\DefaultIcon"`;
      expect(hooks.split(line)).toHaveLength(2);
    }
  });
});
