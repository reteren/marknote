(() => {
  const md = { id: "markdown", label: "Markdown", defaultExtension: "md", extensions: ["md"], editable: true, creatable: true, livePreview: true, autosave: true, lossy: false, syntaxMode: null, template: "" };
  let cb = 0;
  window.__MN_LOG = []; window.__ERR = []; window.addEventListener("error", (e) => window.__ERR.push(String(e.error && e.error.stack || e.message))); const ce = console.error; console.error = (...a) => { window.__ERR.push(a.map((x) => x && x.stack ? x.stack : String(x)).join(" ")); ce(...a); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (fn) => { const id = ++cb; window["_" + id] = fn; return id; },
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      window.__MN_LOG.push(cmd);
      switch (cmd) {
        case "list_creatable_formats": return [md];
        case "new_document": return { text: "", format: md };
        case "take_pending_file": case "take_pending_format": return null;
        case "get_recent_files": return [];
        case "get_resolved_language": return "en";
        case "plugin:event|listen": return 1;
        case "plugin:event|unlisten": return null;
        default:
          if (cmd.startsWith("plugin:")) return null;
          throw new Error("mock: " + cmd);
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
})();
