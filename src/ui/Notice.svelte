<script lang="ts">
  export type NoticeSeverity = "info" | "warning" | "error";

  export type NoticeAction = {
    label: string;
    action: string;
    primary?: boolean;
  };

  export type NoticePreset = "file-changed" | "file-deleted" | "lossy-warning";

  type Props = {
    open?: boolean;
    preset?: NoticePreset;
    severity?: NoticeSeverity;
    message?: string;
    detail?: string;
    actions?: NoticeAction[];
    dismissible?: boolean;
    onAction?: (action: string) => void;
    onClose?: () => void;
  };

  let {
    open = true,
    preset,
    severity: propSeverity,
    message: propMessage,
    detail = "",
    actions: propActions,
    dismissible = true,
    onAction,
    onClose,
  }: Props = $props();

  const presetConfig = $derived.by<{
    severity: NoticeSeverity;
    message: string;
    actions: NoticeAction[];
  }>(() => {
    switch (preset) {
      case "file-changed":
        return {
          severity: "warning",
          message: "File changed on disk",
          actions: [
            { label: "Reload", action: "reload", primary: true },
            { label: "Keep mine", action: "keep-mine" },
          ],
        };
      case "file-deleted":
        return {
          severity: "error",
          message: "File no longer exists on disk",
          actions: [{ label: "Save", action: "save", primary: true }],
        };
      case "lossy-warning":
        return {
          severity: "warning",
          message: "Formatting may be lost when saving in this format",
          actions: [
            { label: "Save anyway", action: "save-lossy" },
            { label: "Save as Markdown…", action: "save-markdown", primary: true },
          ],
        };
      default:
        return {
          severity: "info",
          message: "",
          actions: [],
        };
    }
  });

  const effectiveSeverity = $derived(propSeverity ?? (preset ? presetConfig.severity : "info"));
  const effectiveMessage = $derived(propMessage ?? (preset ? presetConfig.message : ""));
  const effectiveActions = $derived(propActions ?? (preset ? presetConfig.actions : []));

  function handleAction(actionId: string): void {
    onAction?.(actionId);
  }

  function handleClose(): void {
    onClose?.();
  }
</script>

{#if open && (effectiveMessage || effectiveActions.length > 0)}
  <aside
    class="notice-bar"
    class:severity-info={effectiveSeverity === "info"}
    class:severity-warning={effectiveSeverity === "warning"}
    class:severity-error={effectiveSeverity === "error"}
    role="status"
    aria-live="polite"
    aria-label="Уведомление"
  >
    <div class="content">
      <span class="icon" aria-hidden="true">
        {#if effectiveSeverity === "info"}
          ℹ
        {:else if effectiveSeverity === "warning"}
          ⚠
        {:else}
          ✕
        {/if}
      </span>

      <span class="message-text">
        <strong class="title">{effectiveMessage}</strong>
        {#if detail}
          <span class="detail">{detail}</span>
        {/if}
      </span>
    </div>

    <div class="controls">
      {#if effectiveActions.length > 0}
        <div class="actions">
          {#each effectiveActions as item}
            <button
              type="button"
              class="action-btn"
              class:action-primary={item.primary}
              onclick={() => handleAction(item.action)}
            >
              {item.label}
            </button>
          {/each}
        </div>
      {/if}

      {#if dismissible}
        <button
          type="button"
          class="close-btn"
          aria-label="Закрыть уведомление"
          title="Закрыть"
          onclick={handleClose}
        >
          ✕
        </button>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .notice-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--bg-modifier-border);
    font-family: var(--font-ui);
    font-size: var(--font-size-ui);
    line-height: var(--line-height-ui);
    color: var(--text-normal);
    user-select: none;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .notice-bar.severity-info {
    border-left: 3px solid var(--accent);
  }

  .notice-bar.severity-warning {
    border-left: 3px solid rgb(var(--callout-warning, 224, 175, 104));
  }

  .notice-bar.severity-error {
    border-left: 3px solid var(--text-error);
  }

  .content {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .icon {
    font-size: 13px;
    flex-shrink: 0;
  }

  .severity-info .icon {
    color: var(--text-accent);
  }

  .severity-warning .icon {
    color: rgb(var(--callout-warning, 224, 175, 104));
  }

  .severity-error .icon {
    color: var(--text-error);
  }

  .message-text {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-weight: 500;
    color: var(--text-normal);
  }

  .detail {
    color: var(--text-muted);
    font-size: 12px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .action-btn {
    padding: 3px 9px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    outline: none;
    transition: background 0.1s ease, border-color 0.1s ease;
  }

  .action-btn:hover {
    background: var(--bg-modifier-hover);
    border-color: var(--bg-modifier-border-hover);
  }

  .action-btn:active {
    background: var(--bg-modifier-active);
  }

  .action-btn.action-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
    font-weight: 500;
  }

  .action-btn.action-primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .close-btn {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    outline: none;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .close-btn:hover {
    background: var(--bg-modifier-hover);
    color: var(--text-normal);
  }

  .close-btn:active {
    background: var(--bg-modifier-active);
  }

  .close-btn:focus-visible,
  .action-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
