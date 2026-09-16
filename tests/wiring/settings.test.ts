// Мета-тест на фронтенде: проверка того, что настройки из defaultSettings
// не остаются «витриной», а действительно читаются и применяются в приложении
// за пределами окна настроек и модуля состояния.
//
// Окно настроек долго сохраняло значения в settings.json, которые никем
// в приложении не читались. Этот тест гарантирует, что каждая настройка либо
// имеет потребителя в src/ (эффекты, расширения CodeMirror, вспомогательные модули),
// либо зафиксирована в списке именованных исключений с указанием причины
// (обработка на стороне Rust или параллельный перенос в задачах W85/W86/W87).

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
 * Явный реестр исключений для настроек, которые не читаются напрямую
 * в обычном коде фронтенда за пределами окна настроек.
 *
 * Каждая запись обязана содержать внятное техническое обоснование.
 */
export const SETTINGS_EXCEPTIONS: readonly SettingException[] = [
  // --- Настройки, применяемые на бэкенде в Rust (windows.*) ---
  {
    path: "windows.rememberSizeAndPosition",
    reason:
      "Обрабатывается в Rust: src-tauri/src/lib.rs (window_state_flags настраивает tauri_plugin_window_state)",
  },
  {
    path: "windows.startupAction",
    reason:
      "Не применяется: значение startScreen работает само собой, а recentFiles неприменимо — списка недавних файлов в программе нет. Решение владельца: завести список или убрать настройку",
  },
  {
    path: "windows.raiseExistingWindow",
    reason:
      "Обрабатывается в Rust: src-tauri/src/windows.rs (existing_window_label поднимает уже открытое окно вместо создания дубликата)",
  },

  // --- Разделы в процессе переноса в параллельных задачах (W85 / W86 / W87) ---
  {
    path: "editor.zoomPercent",
    reason:
      "В процессе переноса (W85): масштаб редактора настраивается через src/editor/zoom.ts и действия zoom",
  },




  // --- Раздел файлов и сохранения (ожидает реализации подключения) ---
  {
    path: "files.autosave",
    reason:
      "Ожидает реализации подключения: глобальный переключатель автосохранения в src/state/autosave.ts",
  },
  {
    path: "files.autosaveDelayMs",
    reason:
      "Ожидает реализации подключения: задержка таймера автосохранения в src/state/autosave.ts",
  },
  {
    path: "files.saveOnWindowBlur",
    reason:
      "Ожидает реализации подключения: автосохранение при blur окна в src/state/autosave.ts",
  },
  {
    path: "files.newDocumentFormat",
    reason:
      "Ожидает реализации подключения: формат нового документа по умолчанию в src/state/actions.ts",
  },
  {
    path: "files.newDocumentEncoding",
    reason:
      "Ожидает реализации подключения: кодировка новых документов (фиксированная utf8)",
  },
  {
    path: "files.newDocumentLineEnding",
    reason:
      "Ожидает реализации подключения: системные/lf/crlf переводы строк новых документов",
  },
  {
    path: "files.trimTrailingSpaces",
    reason:
      "Ожидает реализации подключения: удаление хвостовых пробелов при сохранении файла",
  },
  {
    path: "files.finalNewline",
    reason:
      "Ожидает реализации подключения: добавление завершающего перевода строки при сохранении",
  },

  // --- Язык интерфейса ---
  {
    path: "language",
    reason:
      "Применяется реактивно внутри src/state/settings.svelte.ts (applyLanguagePreference вызывает setInterfaceLanguage при загрузке и изменении)",
  },
];

/** Рекурсивно собирает все конечные (листовые) пути свойств объекта настроек. */
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
        // Исключаем модуль состояния настроек, окно настроек с подкаталогом и словари локалей
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
 * Проверяет, читается ли данная настройка в переданном файле.
 *
 * Распознаёт:
 * 1. Прямой доступ: settings.editor.fontSize, settings?.editor?.fontSize, editor?.fontSize
 * 2. Доступ через settingsState: settingsState.settings.editor.fontSize
 * 3. Доступ через скобки: editor["fontSize"], settings["editor"]["fontSize"]
 * 4. Деструктуризацию: const { fontSize } = editor; const { fontSize } = settings.editor
 * 5. Контекстный доступ к фасетам/конфигурациям разделов (например, val.renderFormulas, config.revealMarkup)
 */
export function isSettingReadInContent(path: string, content: string, filePath = ""): boolean {
  if (path.includes(".")) {
    const [section, prop] = path.split(".", 2);
    const escapedSection = escapeRegex(section);
    const escapedProp = escapeRegex(prop);

    // Доступ вида settings.section.prop, settings?.section?.prop, section.prop, section?.prop
    const dotAccess = new RegExp(
      `(?:\\bsettingsState\\??\\.settings\\??\\.|\\bsettings\\??\\.)?${escapedSection}\\??\\.${escapedProp}\\b`,
    );
    if (dotAccess.test(content)) return true;

    // Доступ через квадратные скобки: section["prop"]
    const bracketAccess = new RegExp(
      `\\b${escapedSection}\\s*\\[\\s*["']${escapedProp}["']\\s*\\]`,
    );
    if (bracketAccess.test(content)) return true;

    // Деструктуризация: { prop } = ...section
    const destructuring = new RegExp(
      `\\{[^}]*\\b${escapedProp}\\b[^}]*\\}\\s*=\\s*(?:[A-Za-z0-9_$]+\\??\\.)*${escapedSection}\\b`,
    );
    if (destructuring.test(content)) return true;

    // Раздел, переданный целиком, разбирается в модуле, названном по этому
    // разделу: settings.spellcheck уходит в src/editor/spellcheck.ts, и там
    // поле читается уже как options.enabled или config.enabled.
    //
    // Правило намеренно узкое: свободное чтение вида options.enabled
    // засчитывается только в файле, чей путь назван именем раздела. Иначе
    // любое поле enabled в любом модуле закрывало бы любую настройку, и
    // проверка перестала бы что-либо ловить.
    if (filePath.toLowerCase().includes(section.toLowerCase())) {
      const sectionConfigAccess = new RegExp(
        `\\b(?:${escapedSection}|config|options|opts|val|preview|previewConfig)\\??\\.${escapedProp}\\b`,
      );
      if (sectionConfigAccess.test(content)) return true;
    }
  } else {
    // Верхнеуровневое свойство (например, language)
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

describe("настройки не остаются витриной (settings wiring)", () => {
  const leafPaths = extractLeafPaths(defaultSettings as unknown as Record<string, unknown>);
  const sourceFiles = collectSourceFiles(SRC_ROOT);
  const exceptionMap = new Map(SETTINGS_EXCEPTIONS.map((item) => [item.path, item.reason]));

  it("находит все листовые поля defaultSettings (35 полей)", () => {
    expect(leafPaths.length).toBeGreaterThanOrEqual(33);
    expect(leafPaths).toContain("language");
    expect(leafPaths).toContain("editor.fontSize");
    expect(leafPaths).toContain("livePreview.enabled");
    expect(leafPaths).toContain("files.autosave");
    expect(leafPaths).toContain("windows.startupAction");
  });

  it("все исключения в SETTINGS_EXCEPTIONS валидны, уникальны и имеют описание причины", () => {
    const leafSet = new Set(leafPaths);
    const seen = new Set<string>();
    const failures: string[] = [];

    for (const exception of SETTINGS_EXCEPTIONS) {
      if (seen.has(exception.path)) {
        failures.push(`Дубликат исключения: '${exception.path}'`);
      }
      seen.add(exception.path);

      if (!leafSet.has(exception.path)) {
        failures.push(
          `Устаревшее исключение: '${exception.path}' не существует в defaultSettings`,
        );
      }

      if (!exception.reason || exception.reason.trim().length === 0) {
        failures.push(`У исключения '${exception.path}' отсутствует описание причины`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("каждая настройка из defaultSettings читается в src/ либо имеет зарегистрированное исключение", () => {
    const missing: Array<{ path: string; hint: string }> = [];

    for (const path of leafPaths) {
      if (exceptionMap.has(path)) {
        continue;
      }

      const readers = findReadersForSetting(path, sourceFiles);
      if (readers.length === 0) {
        missing.push({
          path,
          hint: `Настройка '${path}' не читается нигде в src/ (за пределами окна настроек и модуля состояния). Добавьте её реальное использование в коде приложения или зарегистрируйте обоснованное исключение в SETTINGS_EXCEPTIONS.`,
        });
      }
    }

    const failureLines = missing.map((m) => `- ${m.hint}`);
    expect(
      missing,
      [
        "Настройки, остающиеся витриной (не применяются и не имеют обоснованного исключения):",
        ...failureLines,
      ].join("\n"),
    ).toEqual([]);
  });

  it("проверяет чувствительность: неприменённая фиктивная настройка без исключения гарантированно падает", () => {
    const fakeUnwiredSetting = "spellcheck.unwiredTestProbe";
    const readers = findReadersForSetting(fakeUnwiredSetting, sourceFiles);
    expect(readers).toEqual([]);
  });
});
