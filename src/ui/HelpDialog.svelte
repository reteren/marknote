<script lang="ts">
  import { onMount } from "svelte";
  import packageInfo from "../../package.json";

  export type HelpMode = "shortcuts" | "markdownReference" | "about";

  type Shortcut = { keys: string; action: string };
  type MarkdownEntry = { syntax: string; meaning: string };
  type Props = {
    mode: HelpMode;
    onClose?: () => void;
  };

  let { mode, onClose }: Props = $props();
  let dialogRef: HTMLDivElement | undefined = $state();

  const version = packageInfo.version;
  const shortcuts: Shortcut[] = [
    { keys: "Ctrl+Z", action: "Undo" },
    { keys: "Ctrl+Shift+Z / Ctrl+Y", action: "Redo" },
    { keys: "Ctrl+X / Ctrl+C / Ctrl+V", action: "Cut / copy / paste" },
    { keys: "Ctrl+Shift+V", action: "Paste as plain text" },
    { keys: "Ctrl+A", action: "Select all" },
    { keys: "Ctrl+D", action: "Delete line" },
    { keys: "Alt+↑ / Alt+↓", action: "Move line up / down" },
    { keys: "Ctrl+B", action: "Bold" },
    { keys: "Ctrl+I", action: "Italic" },
    { keys: "Ctrl+E", action: "Code" },
    { keys: "Ctrl+K", action: "Link" },
    { keys: "Ctrl+1 … Ctrl+6", action: "Set heading level" },
    { keys: "Ctrl+0", action: "Remove heading (takes precedence in the keymap)" },
    { keys: "Ctrl+Shift+K", action: "Code block" },
    { keys: "Tab / Shift+Tab", action: "Change list indentation" },
    { keys: "Ctrl+Home / Ctrl+End", action: "Go to document start / end" },
    { keys: "Ctrl+N", action: "New document" },
    { keys: "Ctrl+Shift+N", action: "New document with format picker" },
    { keys: "Ctrl+O", action: "Open file" },
    { keys: "Ctrl+S", action: "Save" },
    { keys: "Ctrl+Shift+S", action: "Save as" },
    { keys: "Ctrl+W", action: "Close window" },
    { keys: "Ctrl+F / Ctrl+H", action: "Find / replace" },
    { keys: "Ctrl+G", action: "Go to line" },
    { keys: "Ctrl+±", action: "Change editor text size" },
  ];

  const markdownEntries: MarkdownEntry[] = [
    { syntax: "**bold**", meaning: "Bold emphasis" },
    { syntax: "*italic*", meaning: "Italic emphasis" },
    { syntax: "~~strikethrough~~", meaning: "Strikethrough" },
    { syntax: "==highlight==", meaning: "Highlighted text" },
    { syntax: "`code`", meaning: "Inline code" },
    { syntax: "[label](https://example.com)", meaning: "Link (Ctrl-click opens http, https, or mailto)" },
    { syntax: "![](image.png)", meaning: "Image relative to the open document" },
    { syntax: "# Heading", meaning: "Heading levels 1–6" },
    { syntax: "- [ ] task", meaning: "Unchecked task; [x] marks it complete" },
    { syntax: "> quote", meaning: "Blockquote; nested quotes are supported" },
    { syntax: "> [!NOTE] text", meaning: "Callout types: note, tip, info, success, question, warning, danger, example, quote" },
    { syntax: "$x^2$", meaning: "Inline formula" },
    { syntax: "$$x^2$$", meaning: "Block formula" },
    { syntax: "[^1] … [^1]: text", meaning: "Footnote reference and definition" },
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
      <h2 id="help-dialog-title">
        {#if mode === "shortcuts"}
          Keyboard Shortcuts
        {:else if mode === "markdownReference"}
          Markdown Reference
        {:else}
          About
        {/if}
      </h2>
      <button type="button" class="close-button" aria-label="Close help" onclick={() => onClose?.()}>×</button>
    </header>

    {#if mode === "shortcuts"}
      <p class="intro">Editor shortcuts. File, search, zoom, and window commands are available when the application shell supplies their handlers.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Shortcut</th><th>Action</th></tr>
          </thead>
          <tbody>
            {#each shortcuts as shortcut}
              <tr>
                <td><kbd>{shortcut.keys}</kbd></td>
                <td>{shortcut.action}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if mode === "markdownReference"}
      <p class="intro">A quick reference for the Markdown features supported by MarkNote.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Syntax</th><th>What it does</th></tr>
          </thead>
          <tbody>
            {#each markdownEntries as entry}
              <tr>
                <td><code>{entry.syntax}</code></td>
                <td>{entry.meaning}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="about-content">
        <p class="app-name">MarkNote</p>
        <p>A fast Markdown editor with live preview and support for common text formats.</p>
        <dl>
          <div><dt>Version</dt><dd>{version}</dd></div>
          <div><dt>License</dt><dd>MIT</dd></div>
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
    text-align: left;
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
