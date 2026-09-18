import { invoke } from "@tauri-apps/api/core";

export type RecentFileEntry = {
  path: string;
  openedAt: number;
};

export function extractFileName(filePath: string): string {
  if (!filePath) return "";
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.pop() || filePath;
}

export function extractDirectory(filePath: string): string {
  if (!filePath) return "";
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || "";
}

export function formatOpenedAt(timestamp: number, locale = "en"): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "";

  try {
    return date.toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toLocaleString();
  }
}

class RecentFilesState {
  items = $state<RecentFileEntry[]>([]);
  loading = $state(false);

  async load(): Promise<RecentFileEntry[]> {
    this.loading = true;
    try {
      const files = await invoke<RecentFileEntry[]>("get_recent_files");
      this.items = Array.isArray(files) ? files : [];
      return this.items;
    } catch {
      this.items = [];
      return [];
    } finally {
      this.loading = false;
    }
  }

  async add(path: string): Promise<void> {
    if (!path) return;
    try {
      await invoke("add_recent_file", { path });
      await this.load();
    } catch {
      // Ignore
    }
  }

  async clear(): Promise<void> {
    try {
      await invoke("clear_recent_files");
      this.items = [];
    } catch {
      // Ignore
    }
  }
}

export const recentFilesState = new RecentFilesState();
