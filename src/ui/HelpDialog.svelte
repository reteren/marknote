<script lang="ts">
  import { onMount } from "svelte";
  import packageInfo from "../../package.json";
  import { translate as t } from "../i18n";

  export type HelpMode = "shortcuts" | "markdownReference" | "about";

  type Shortcut = { keys: string; actionKey: string };
  type MarkdownEntry = { syntax: string; meaningKey: string };
  type Props = {
    mode: HelpMode;
    onClose?: () => void;
  };

  let { mode, onClose }: Props = $props();
  let dialogRef: HTMLDivElement | undefined = $state();

  const version = packageInfo.version;
  const shortcuts: Shortcut[] = [
    { keys: "Ctrl+Z", actionKey: "help.action.undo" },
    { keys: "Ctrl+Shift+Z / Ctrl+Y", actionKey: "help.action.redo" },
    { keys: "Ctrl+X / Ctrl+C / Ctrl+V", actionKey: "help.action.clipboard" },
    { keys: "Ctrl+Shift+V", actionKey: "help.action.pastePlainText" },
    { keys: "Ctrl+A", actionKey: "help.action.selectAll" },
    { keys: "Ctrl+D", actionKey: "help.action.deleteLine" },
    { keys: "Alt+↑ / Alt+↓", actionKey: "help.action.moveLine" },
    { keys: "Ctrl+B", actionKey: "help.action.bold" },
    { keys: "Ctrl+I", actionKey: "help.action.italic" },
    { keys: "Ctrl+E", actionKey: "help.action.code" },
    { keys: "Ctrl+K", actionKey: "help.action.link" },
    { keys: "Ctrl+1 … Ctrl+6", actionKey: "help.action.setHeading" },
    { keys: "Ctrl+0", actionKey: "help.action.removeHeading" },
    { keys: "Ctrl+Shift+K", actionKey: "help.action.codeBlock" },
    { keys: "Tab / Shift+Tab", actionKey: "help.action.listIndent" },
    { keys: "Ctrl+Home / Ctrl+End", actionKey: "help.action.documentStartEnd" },
    { keys: "Ctrl+N", actionKey: "help.action.newDocument" },
    { keys: "Ctrl+Shift+N", actionKey: "help.action.newWithFormat" },
    { keys: "Ctrl+O", actionKey: "help.action.openFile" },
    { keys: "Ctrl+S", actionKey: "help.action.save" },
    { keys: "Ctrl+Shift+S", actionKey: "help.action.saveAs" },
    { keys: "Ctrl+W", actionKey: "help.action.closeWindow" },
    { keys: "Ctrl+F / Ctrl+H", actionKey: "help.action.findReplace" },
    { keys: "Ctrl+G", actionKey: "help.action.goToLine" },
    { keys: "Ctrl+±", actionKey: "help.action.zoom" },
  ];

  const markdownEntries: MarkdownEntry[] = [
    { syntax: "**bold**", meaningKey: "help.meaning.bold" },
    { syntax: "*italic*", meaningKey: "help.meaning.italic" },
    { syntax: "~~strikethrough~~", meaningKey: "help.meaning.strikethrough" },
    { syntax: "==highlight==", meaningKey: "help.meaning.highlight" },
    { syntax: "`code`", meaningKey: "help.meaning.inlineCode" },
    { syntax: "[label](https://example.com)", meaningKey: "help.meaning.link" },
    { syntax: "![](image.png)", meaningKey: "help.meaning.image" },
    { syntax: "# Heading", meaningKey: "help.meaning.heading" },
    { syntax: "- [ ] task", meaningKey: "help.meaning.task" },
    { syntax: "> quote", meaningKey: "help.meaning.quote" },
    { syntax: "> [!NOTE] text", meaningKey: "help.meaning.callout" },
    { syntax: "$x^2$", meaningKey: "help.meaning.inlineFormula" },
    { syntax: "$$x^2$$", meaningKey: "help.meaning.blockFormula" },
    { syntax: "[^1] … [^1]: text", meaningKey: "help.meaning.footnote" },
  ];

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose?.();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose?.();
  }

  onMount(() => {
    dialogRef?.focus();
  });
</script>

<div
  class="help-backdrop"
  role="presentation"
  onclick={handleBackdropClick}
>
  <div
    bind:this={dialogRef}
    class="help-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-dialog-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="dialog-header">
      <h2 id="help-dialog-title">{mode === "shortcuts" ? t("menu.keyboardShortcuts") : mode === "markdownReference" ? t("menu.markdownReference") : t("menu.about")}</h2>
      <button type="button" class="close-button" aria-label={t("help.close")} onclick={() => onClose?.()}>×</button>
    </header>

    {#if mode === "shortcuts"}
      <p class="intro">{t("help.keyboardIntro")}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>{t("help.shortcutsColumn")}</th><th>{t("help.actionColumn")}</th></tr>
          </thead>
          <tbody>
            {#each shortcuts as shortcut}
              <tr>
                <td><kbd>{shortcut.keys}</kbd></td>
                <td>{t(shortcut.actionKey)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if mode === "markdownReference"}
      <p class="intro">{t("help.markdownIntro")}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>{t("help.syntaxColumn")}</th><th>{t("help.meaningColumn")}</th></tr>
          </thead>
          <tbody>
            {#each markdownEntries as entry}
              <tr>
                <td><code>{entry.syntax}</code></td>
                <td>{t(entry.meaningKey)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="about-content">
        <p class="app-name">{t("app.name")}</p>
        <p>{t("about.description")}</p>
        <dl>
          <div><dt>{t("about.version")}</dt><dd>{version}</dd></div>
          <div><dt>{t("about.license")}</dt><dd>{t("about.licenseName")}</dd></div>
        </dl>
      </div>
    {/if}
  </div>
</div>

<style>
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg-modifier-hover);
  }

  .help-dialog {
    display: flex;
    flex-direction: column;
    width: min(620px, 100%);
    max-height: min(720px, 100%);
    overflow: hidden;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    background: var(--bg-secondary);
    color: var(--text-normal);
    box-shadow: 0 12px 40px var(--bg-secondary-alt);
    outline: none;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--bg-modifier-border);
  }

  h2 {
    margin: 0;
    color: var(--text-normal);
    font-family: var(--font-ui);
    font-size: 16px;
    font-weight: 600;
  }

  .close-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .close-button:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .close-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .intro,
  .about-content {
    margin: 0;
    padding: 14px 18px 8px;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    line-height: var(--line-height-ui);
  }

  .table-wrap {
    overflow: auto;
    padding: 0 18px 18px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    line-height: var(--line-height-ui);
  }

  th,
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--bg-modifier-border);
    text-align: start;
    vertical-align: top;
  }

  th {
    color: var(--text-muted);
    font-weight: 500;
  }

  td:first-child {
    width: 42%;
    color: var(--text-accent);
  }

  kbd,
  code {
    padding: 2px 4px;
    border-radius: var(--radius-s);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-mono);
  }

  .about-content {
    padding-bottom: 20px;
  }

  .app-name {
    margin: 0 0 8px;
    color: var(--text-normal);
    font-size: 20px;
    font-weight: 600;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 18px 0 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding-top: 8px;
    border-top: 1px solid var(--bg-modifier-border);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    color: var(--text-normal);
  }
</style>
