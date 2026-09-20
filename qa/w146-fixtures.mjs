// W146 acceptance fixtures. Run from the repository root:
//   node qa/w146-fixtures.mjs
// The generated files stay under qa/w146-fixtures and are safe to remove.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("qa/w146-fixtures");
mkdirSync(dir, { recursive: true });
const block = "# W146 large document\n\n- repeated Markdown content for release acceptance\n" + "x".repeat(4096) + "\n";
let large = "";
while (large.length < 5 * 1024 * 1024) large += block;
writeFileSync(resolve(dir, "large-5mb.md"), large.slice(0, 5 * 1024 * 1024), "utf8");
writeFileSync(resolve(dir, "sample.py"), "def greet(name):\n    return f\"Hello {name}\"\n\nprint(greet('MarkNote'))\n", "utf8");
writeFileSync(resolve(dir, "sample.json"), `${JSON.stringify({ name: "MarkNote", version: 146, valid: true, items: [1, 2, 3] }, null, 2)}\n`, "utf8");
writeFileSync(resolve(dir, "drag.md"), "# Drag fixture\n\nThis file is used for tab/drop acceptance.\n", "utf8");
console.log(JSON.stringify({ dir, files: ["large-5mb.md", "sample.py", "sample.json", "drag.md"].map((name) => ({ name, bytes: readFileSync(resolve(dir, name)).length })) }));
