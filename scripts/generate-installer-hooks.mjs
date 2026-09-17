import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
const hookPath = path.join(repositoryRoot, "src-tauri", "windows", "installer-hooks.nsh");

const config = JSON.parse(await readFile(configPath, "utf8"));
const associations = config.bundle?.fileAssociations ?? [];
const productName = config.productName ?? "MarkNote";
const description = config.bundle?.shortDescription ?? config.bundle?.description ?? productName;

const entries = [];
for (const association of associations) {
  const progId = String(association.name ?? "").trim();
  if (!progId) throw new Error("Every bundle.fileAssociations entry needs a name (ProgID)");
  for (const extension of association.ext ?? []) {
    const normalized = `.${String(extension).replace(/^\./u, "").toLowerCase()}`;
    if (!entries.some((entry) => entry.extension === normalized)) entries.push({ extension: normalized, progId });
  }
}
if (!entries.length) throw new Error("bundle.fileAssociations must contain at least one extension");

const quote = (value) => String(value).replaceAll("$", "$$").replaceAll('"', '$\\"');
const capabilityPath = `Software\\${productName}\\Capabilities`;
const appPath = `Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe`;
const lines = [
  "; GENERATED FILE — do not edit by hand.",
  "; Source of truth: bundle.fileAssociations in src-tauri/tauri.conf.json.",
  "; Regenerate with: npm run generate:installer-hooks",
  "",
  "!macro NSIS_HOOK_POSTINSTALL",
  `  WriteRegStr HKCU "${capabilityPath}" "ApplicationName" "${quote(productName)}"`,
  `  WriteRegStr HKCU "${capabilityPath}" "ApplicationDescription" "${quote(description)}"`,
];

for (const { extension, progId } of entries) {
  lines.push(`  WriteRegStr HKCU "${capabilityPath}\\FileAssociations" "${extension}" "${quote(progId)}"`);
}

lines.push(
  `  WriteRegStr HKCU "${appPath}" "FriendlyAppName" "${quote(productName)}"`,
  `  WriteRegStr HKCU "${appPath}\\shell\\open\\command" "" "$\\\"$INSTDIR\\\${MAINBINARYNAME}.exe$\\\" $\\\"%1$\\\""`,
);
for (const { extension } of entries) {
  lines.push(`  WriteRegStr HKCU "${appPath}\\SupportedTypes" "${extension}" ""`);
}

lines.push(
  `  WriteRegStr HKCU "Software\\RegisteredApplications" "${quote(productName)}" "${capabilityPath}"`,
  "  !insertmacro UPDATEFILEASSOC",
  "!macroend",
  "",
  "!macro NSIS_HOOK_POSTUNINSTALL",
  `  DeleteRegValue HKCU "Software\\RegisteredApplications" "${quote(productName)}"`,
  `  DeleteRegKey HKCU "${capabilityPath}"`,
    // Корень вендора удаляем ТОЛЬКО если он опустел. Там же Tauri держит свою
  // запись о месте установки: при обновлении она нужна, чтобы найти прошлую
  // установку. Безусловное удаление снесло бы её заодно — чистота в реестре
  // не стоит сломанного обновления. /ifempty убирает наш след, чужой не трогает.
  `  DeleteRegKey /ifempty HKCU "Software\\${productName}"`,
  `  DeleteRegKey HKCU "${appPath}"`,
  "  !insertmacro UPDATEFILEASSOC",
  "!macroend",
  "",
);

await mkdir(path.dirname(hookPath), { recursive: true });
await writeFile(hookPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Generated ${path.relative(repositoryRoot, hookPath)} from ${path.relative(repositoryRoot, configPath)} (${entries.length} extensions).`);
