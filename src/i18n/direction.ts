/** Apply document-driven direction to editor content, independently of UI locale. */
export function applyDocumentTextDirection(element: HTMLElement): void {
  element.setAttribute("dir", "auto");
  element.style.unicodeBidi = "plaintext";
}
