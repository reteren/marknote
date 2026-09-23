import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
const hookPath = path.join(repositoryRoot, "src-tauri", "windows", "installer-hooks.nsh");

export function buildInstallerHooks(config) {
  const associations = config.bundle?.fileAssociations ?? [];
  const productName = config.productName ?? "MarkNote";
  const description = config.bundle?.shortDescription ?? config.bundle?.description ?? productName;
  const documentIconTarget = config.bundle?.resources?.["icons/document.ico"];
  if (!documentIconTarget) {
    throw new Error('bundle.resources must map "icons/document.ico" to its install path');
  }

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

  const progIds = [...new Set(entries.map(({ progId }) => progId))];
  const iconPath = String(documentIconTarget).replaceAll("/", "\\");
  const quote = (value) => String(value).replaceAll("$", "$$").replaceAll('"', '$\\"');
  const capabilityPath = `Software\\${productName}\\Capabilities`;
  const appPath = `Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe`;
  const lines = [
    "; GENERATED FILE — do not edit by hand.",
    "; Source of truth: bundle.fileAssociations and bundle.resources in src-tauri/tauri.conf.json.",
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
  for (const progId of progIds) {
    lines.push(`  WriteRegStr HKCU "Software\\Classes\\${quote(progId)}\\DefaultIcon" "" "$INSTDIR\\${iconPath},0"`);
  }

  lines.push(
    `  WriteRegStr HKCU "Software\\RegisteredApplications" "${quote(productName)}" "${capabilityPath}"`,
    "  !insertmacro UPDATEFILEASSOC",
    "!macroend",
    "",
    "!macro NSIS_HOOK_POSTUNINSTALL",
    `  DeleteRegValue HKCU "Software\\RegisteredApplications" "${quote(productName)}"`,
    `  DeleteRegKey HKCU "${capabilityPath}"`,
    // Remove the vendor root ONLY when it is empty. Tauri keeps its installation
    // record there too; updates need it to find the previous installation.
    // Unconditionally removing it would break updates for the sake of a clean
    // registry. /ifempty removes our marker without touching anything else.
    `  DeleteRegKey /ifempty HKCU "Software\\${productName}"`,
    `  DeleteRegKey HKCU "${appPath}"`,
  );
  for (const progId of progIds) {
    lines.push(`  DeleteRegKey HKCU "Software\\Classes\\${quote(progId)}\\DefaultIcon"`);
  }

  lines.push("  !insertmacro UPDATEFILEASSOC", "!macroend", "");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const output = buildInstallerHooks(config);
  const extensionCount = (config.bundle?.fileAssociations ?? []).reduce(
    (count, association) => count + (association.ext?.length ?? 0),
    0,
  );

  await mkdir(path.dirname(hookPath), { recursive: true });
  await writeFile(hookPath, output, "utf8");
  console.log(`Generated ${path.relative(repositoryRoot, hookPath)} from ${path.relative(repositoryRoot, configPath)} (${extensionCount} extensions).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
