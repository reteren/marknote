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
    { keys: "Ctrl+Z", action: "Отменить" },
    { keys: "Ctrl+Shift+Z / Ctrl+Y", action: "Повторить" },
    { keys: "Ctrl+X / Ctrl+C / Ctrl+V", action: "Вырезать / копировать / вставить" },
    { keys: "Ctrl+Shift+V", action: "Вставить как простой текст" },
    { keys: "Ctrl+A", action: "Выделить всё" },
    { keys: "Ctrl+D", action: "Удалить строку" },
    { keys: "Alt+↑ / Alt+↓", action: "Переместить строку вверх / вниз" },
    { keys: "Ctrl+B", action: "Жирный" },
    { keys: "Ctrl+I", action: "Курсив" },
    { keys: "Ctrl+E", action: "Код" },
    { keys: "Ctrl+K", action: "Ссылка" },
    { keys: "Ctrl+1 … Ctrl+6", action: "Заголовок уровня" },
    { keys: "Ctrl+0", action: "Убрать заголовок (приоритет keymap)" },
    { keys: "Ctrl+Shift+K", action: "Блок кода" },
    { keys: "Tab / Shift+Tab", action: "Изменить уровень списка" },
    { keys: "Ctrl+Home / Ctrl+End", action: "В начало / конец документа" },
    { keys: "Ctrl+N", action: "Новый документ" },
    { keys: "Ctrl+Shift+N", action: "Новый документ с выбором типа" },
    { keys: "Ctrl+O", action: "Открыть файл" },
    { keys: "Ctrl+S", action: "Сохранить" },
    { keys: "Ctrl+Shift+S", action: "Сохранить как" },
    { keys: "Ctrl+W", action: "Закрыть окно" },
    { keys: "Ctrl+F / Ctrl+H", action: "Поиск / замена" },
    { keys: "Ctrl+G", action: "Перейти к строке" },
    { keys: "Ctrl+±", action: "Масштаб текста" },
  ];

  const markdownEntries: MarkdownEntry[] = [
    { syntax: "**жирный**", meaning: "Жирное начертание" },
    { syntax: "*курсив*", meaning: "Курсивное начертание" },
    { syntax: "~~зачёркнутый~~", meaning: "Зачёркивание" },
    { syntax: "==подсветка==", meaning: "Подсветка фрагмента" },
    { syntax: "`код`", meaning: "Строчный код" },
    { syntax: "[текст](https://example.com)", meaning: "Ссылка (Ctrl+клик открывает http/https/mailto)" },
    { syntax: "![](image.png)", meaning: "Изображение относительно открытого файла" },
    { syntax: "# Заголовок", meaning: "Заголовок 1–6 уровней" },
    { syntax: "- [ ] задача", meaning: "Невыполненная задача; [x] — выполненная" },
    { syntax: "> цитата", meaning: "Цитата; вложенные цитаты поддерживаются" },
    { syntax: "> [!NOTE] текст", meaning: "Callout: note, tip, info, success, question, warning, danger, example, quote" },
    { syntax: "$x^2$", meaning: "Строчная формула" },
    { syntax: "$$x^2$$", meaning: "Блочная формула" },
    { syntax: "[^1] … [^1]: текст", meaning: "Сноска и её определение" },
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
          Горячие клавиши
        {:else if mode === "markdownReference"}
          Справка по Markdown
        {:else}
          О программе
        {/if}
      </h2>
      <button type="button" class="close-button" aria-label="Закрыть справку" onclick={() => onClose?.()}>×</button>
    </header>

    {#if mode === "shortcuts"}
      <p class="intro">Сочетания редактора; команды файла, поиска, масштаба и окна доступны, когда оболочка передаёт обработчики.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Клавиши</th><th>Действие</th></tr>
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
      <p class="intro">Короткая шпаргалка по разметке, которую понимает MarkNote.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Запись</th><th>Результат</th></tr>
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
        <p>Быстрый редактор Markdown с живым предпросмотром и поддержкой обычных текстовых форматов.</p>
        <dl>
          <div><dt>Версия</dt><dd>{version}</dd></div>
          <div><dt>Лицензия</dt><dd>MIT</dd></div>
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
