// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { createEditor } from "../src/editor/createEditor";
import { applyEditorSettings } from "../src/editor/settings";
import { spellcheckSettingsExtensions } from "../src/editor/settings/spellcheck";
import { markdownFormat } from "../src/state/formats.svelte";
import { defaultSettings, type Settings } from "../src/state/settings.svelte";

const views: EditorView[] = [];

function createTestEditor(settings: Settings | null = null, doc = "hello world"): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = createEditor({
    parent,
    doc,
    format: markdownFormat,
    settings,
    onChange: () => undefined,
    onStats: () => undefined,
  });
  views.push(view);
  return view;
}

function typeText(view: EditorView, text: string): void {
  for (const char of text) {
    const sel = view.state.selection.main;
    const from = sel.from;
    const to = sel.to;
    let handled = false;
    for (const handler of view.state.facet(EditorView.inputHandler)) {
      if (
        handler(view, from, to, char, () =>
          view.state.update({
            changes: { from, to, insert: char },
            selection: { anchor: from + char.length },
          }),
        )
      ) {
        handled = true;
        break;
      }
    }
    if (!handled) {
      view.dispatch({
        changes: { from, to, insert: char },
        selection: { anchor: from + char.length },
        userEvent: "input.type",
      });
    }
  }
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("spellcheck and autoCorrect settings", () => {
  it("returns empty extensions when settings is null", () => {
    expect(spellcheckSettingsExtensions(null)).toEqual([]);
  });

  it("applies spellcheck.enabled to contentDOM attribute and updates via applyEditorSettings", () => {
    const view = createTestEditor({
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, enabled: false },
    });
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");

    applyEditorSettings(view, {
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, enabled: true },
    });
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("true");
  });

  it("applies spellcheck.language to contentDOM lang attribute", () => {
    const view = createTestEditor({
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, language: "ru" },
    });
    expect(view.contentDOM.getAttribute("lang")).toBe("ru");

    applyEditorSettings(view, {
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, language: "de" },
    });
    expect(view.contentDOM.getAttribute("lang")).toBe("de");
  });

  it("puts exactly one language tag into the lang attribute", () => {
    // Атрибут lang по спецификации HTML принимает одну метку BCP 47: значение
    // вида "en de" недопустимо, язык элемента становится «invalid», и словарь
    // движок не выберет вообще — проверка орфографии просто пропадёт. Поэтому
    // в настройках один язык, и в области правки ровно одна метка.
    const view = createTestEditor({
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, language: "de" },
    });

    const lang = view.contentDOM.getAttribute("lang") ?? "";
    expect(lang).toBe("de");
    expect(lang.trim().split(/\s+/)).toHaveLength(1);
    expect(view.contentDOM.querySelectorAll("[lang]")).toHaveLength(0);
  });

  it("leaves the editable area without a lang attribute when no language is set", () => {
    const view = createTestEditor({
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, language: "" },
    });
    expect(view.contentDOM.hasAttribute("lang")).toBe(false);
  });

  it("applies spellcheck.skipCodeFormulaLinks to mark code, formula, and links with spellcheck=false", () => {
    const doc = "Here is `inline code` and [link](https://example.com) and $$x=1$$";
    const view = createTestEditor(
      {
        ...defaultSettings,
        spellcheck: { ...defaultSettings.spellcheck, enabled: true, skipCodeFormulaLinks: true },
      },
      doc,
    );

    const skipElements = view.contentDOM.querySelectorAll('[spellcheck="false"]');
    expect(skipElements.length).toBeGreaterThan(0);

    applyEditorSettings(view, {
      ...defaultSettings,
      spellcheck: { ...defaultSettings.spellcheck, enabled: true, skipCodeFormulaLinks: false },
    });
    const skipElementsDisabled = view.contentDOM.querySelectorAll('[spellcheck="false"]');
    expect(skipElementsDisabled.length).toBe(0);
  });

  it("applies autoCorrect.smartQuotes to convert quotes to typographic smart quotes with one-step undo", () => {
    const view = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, smartQuotes: true },
      },
      "",
    );
    typeText(view, '"');
    expect(view.state.doc.toString()).toBe("“");

    undo(view);
    expect(view.state.doc.toString()).toBe('"');

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    typeText(view, 'hello"');
    expect(view.state.doc.toString()).toBe('"hello”');

    const codeView = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, smartQuotes: true },
      },
      "`code`",
    );
    codeView.dispatch({ selection: { anchor: 5 } });
    typeText(codeView, '"');
    expect(codeView.state.doc.toString()).toBe("`code\"`");
  });

  it("applies autoCorrect.doubleHyphenToEmDash to convert -- to em-dash with one-step undo and skips inside code", () => {
    const view = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, doubleHyphenToEmDash: true },
      },
      "",
    );
    typeText(view, "--");
    expect(view.state.doc.toString()).toBe("—");

    undo(view);
    expect(view.state.doc.toString()).toBe("--");

    const codeView = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, doubleHyphenToEmDash: true },
      },
      "```\n\n```",
    );
    codeView.dispatch({ selection: { anchor: 4 } });
    typeText(codeView, "--");
    expect(codeView.state.doc.toString()).toBe("```\n--\n```");
  });

  it("applies autoCorrect.capitalizeAfterPeriod to capitalize lowercase letter after period with one-step undo", () => {
    const view = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, capitalizeAfterPeriod: true },
      },
      "Sentence. ",
    );
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    typeText(view, "s");
    expect(view.state.doc.toString()).toBe("Sentence. S");

    undo(view);
    expect(view.state.doc.toString()).toBe("Sentence. s");

    const linkView = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, capitalizeAfterPeriod: true },
      },
      "[link. ](https://example.com)",
    );
    linkView.dispatch({ selection: { anchor: 7 } });
    typeText(linkView, "s");
    expect(linkView.state.doc.toString()).toBe("[link. s](https://example.com)");
  });

  it("applies autoCorrect.threeDotsToEllipsis to convert ... to ellipsis with one-step undo and skips inside formulas", () => {
    const view = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, threeDotsToEllipsis: true },
      },
      "",
    );
    typeText(view, "...");
    expect(view.state.doc.toString()).toBe("…");

    undo(view);
    expect(view.state.doc.toString()).toBe("...");

    const mathView = createTestEditor(
      {
        ...defaultSettings,
        autoCorrect: { ...defaultSettings.autoCorrect, threeDotsToEllipsis: true },
      },
      "$x + $",
    );
    mathView.dispatch({ selection: { anchor: 5 } });
    typeText(mathView, "...");
    expect(mathView.state.doc.toString()).toBe("$x + ...$");
  });
});
