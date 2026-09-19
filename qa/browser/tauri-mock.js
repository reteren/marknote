(() => {
  const md = { id: "markdown", label: "Markdown", defaultExtension: "md", extensions: ["md"], editable: true, creatable: true, livePreview: true, autosave: true, lossy: false, syntaxMode: null, template: "" };
  const js = { id: "javascript", label: "JavaScript", defaultExtension: "js", extensions: ["js"], editable: true, creatable: true, livePreview: false, autosave: true, lossy: false, syntaxMode: "javascript", template: "" };
  const json = { id: "json", label: "JSON", defaultExtension: "json", extensions: ["json"], editable: true, creatable: true, livePreview: false, autosave: true, lossy: false, syntaxMode: "json", template: "{}\n" };
  const settings = { language: "en", spellcheck: { enabled: true, skipCodeFormulaLinks: true }, autoCorrect: { smartQuotes: false, doubleHyphenToEmDash: false, capitalizeAfterPeriod: false, threeDotsToEllipsis: false }, editor: { fontFamily: "system-sans", fontSize: 16, zoomPercent: 100, columnWidth: "normal", tabWidth: 4, insertSpaces: true, softWrap: true, showInvisibles: false, lineNumbers: false }, livePreview: { enabled: true, revealMarkup: "cursor", renderFormulas: true, renderImages: true, maxImageWidth: "column", disableAboveBytes: 5242880 }, files: { autosave: true, autosaveDelayMs: 2000, saveOnWindowBlur: true, newDocumentFormat: "markdown", newDocumentEncoding: "utf8", newDocumentLineEnding: "system", trimTrailingSpaces: false, finalNewline: false }, windows: { rememberSizeAndPosition: true, startupAction: "startScreen", raiseExistingWindow: true } };
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
        case "list_creatable_formats": return [md, js, json];
        case "new_document":
          if (args?.formatId === "javascript") return { text: "const answer = 42;\nreturn answer;\n", format: js };
          if (args?.formatId === "json") return { text: "{\"answer\":42}\n", format: json };
          return { text: "", format: md };
        case "get_settings": return structuredClone(settings);
        case "save_settings": return args?.settings ?? structuredClone(settings);
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
