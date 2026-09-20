import { readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_ROOT = resolve(ROOT, "src");
const SCAN_ROOTS = ["editor", "state", "ui"].map((name) => resolve(SOURCE_ROOT, name));

type ExportedValue = {
  file: string;
  name: string;
};

// These APIs are explicitly intended for tests or integration access; each
// comment explains why the application does not call it.
const EXPORTED_VALUE_EXCEPTIONS: ReadonlyArray<{
  file: string;
  name: string;
  reason: string;
}> = [
  {
    file: "src/editor/createEditor.ts",
    name: "setEditorDocumentFormat",
    // Keep the documented API alias even though the app uses the canonical name.
    reason: "Documented backward-compatibility alias; behavior is tested through setEditorFormat.",
  },
  {
    file: "src/editor/keymap.ts",
    name: "marknoteKeyBindings",
    // The module explicitly exposes these real bindings for tests and integrations.
    reason: "The module exports real bindings for tests and integrations that need to inspect them.",
  },
  {
    file: "src/editor/keymap.ts",
    name: "getMarknoteKeyBindings",
    // The factory is provided for the same tests and integrations, not the app.
    reason: "The real-binding factory is exported for tests and integrations, as documented by the module.",
  },
  {
    file: "src/editor/livePreview/plugin.ts",
    name: "buildDecorationSets",
    // A pure test entry separates decoration calculation from the DOM dependency.
    reason: "The pure function is exported to test preview without a browser; runtime uses the EditorView variant internally.",
  },
  {
    file: "src/editor/livePreview/plugin.ts",
    name: "previewDecorations",
    // The inspection facade is needed by integration tests and documented by the module.
    reason: "The module explicitly describes this export as a facade for tests and integrations.",
  },
  {
    file: "src/editor/livePreview/plugin.ts",
    name: "decorationRanges",
    // The diagnostic utility intentionally simplifies DecorationSet assertions in tests.
    reason: "The module explicitly describes this utility as test-only; the app works with DecorationSet directly.",
  },
  {
    file: "src/editor/livePreview/widgets/Math.ts",
    name: "clearMathCache",
    // Clearing the global cache lets render tests stay isolated.
    reason: "Clears the global render cache so tests can independently verify result reuse.",
  },
];

function filesUnder(directory: string): string[] {
  const result: string[] = [];
  for (const entry of ts.sys.readDirectory(directory, [".ts", ".svelte"], undefined, ["**/*"])) {
    result.push(resolve(entry));
  }
  return result;
}

function svelteScript(file: string): string {
  const text = readFileSync(file, "utf8");
  const scriptTexts = extname(file) === ".svelte"
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    : [text];
  return scriptTexts.join("\n");
}

function hasModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((item) => item.kind === modifier) ?? false);
}

function exportedValues(file: string): ExportedValue[] {
  const text = readFileSync(file, "utf8");
  if (extname(file) !== ".ts") return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Set<string>();
  const result: ExportedValue[] = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.add(statement.name.text);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        const name = hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name.text;
        result.push({ file, name });
      }
    } else if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      result.push({ file, name: "default" });
    } else if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (isConst) declarations.add(declaration.name.text);
        if (isConst && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
          result.push({ file, name: declaration.name.text });
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      result.push({ file, name: "default" });
    }
  }

  // Also include local function/const values exposed through `export { value }`.
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const specifier of statement.exportClause.elements) {
      const localName = specifier.propertyName?.text ?? specifier.name.text;
      if (declarations.has(localName)) result.push({ file, name: specifier.name.text });
    }
  }

  return result;
}

function isUsableReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isVariableDeclaration(parent))
    && parent.name === node
  ) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isTypeNode(ancestor)) return false;
    if (ts.isStatement(ancestor)) break;
  }
  return true;
}

function isExportedAliasReference(node: ts.Identifier): boolean {
  let declaration: ts.Node | undefined = node.parent;
  while (declaration && !ts.isVariableDeclaration(declaration)) declaration = declaration.parent;
  if (!declaration || !declaration.initializer) return false;

  let initializer = declaration.initializer;
  while (
    ts.isAsExpression(initializer)
    || ts.isSatisfiesExpression(initializer)
    || ts.isParenthesizedExpression(initializer)
  ) initializer = initializer.expression;
  if (initializer !== node) return false;

  const statement = declaration.parent?.parent;
  return Boolean(statement && ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword));
}

function sourceReferences(sourcePaths: string[], candidates: ExportedValue[]): Set<string> {
  const references = new Set<string>();
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    allowArbitraryExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const virtualSvelte = new Map<string, string>();
  for (const path of sourcePaths.filter((file) => extname(file) === ".svelte")) {
    virtualSvelte.set(`${path}.wiring.ts`, svelteScript(path));
  }
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => virtualSvelte.has(resolve(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName) => virtualSvelte.get(resolve(fileName)) ?? originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtualText = virtualSvelte.get(resolve(fileName));
    if (virtualText !== undefined) {
      return ts.createSourceFile(fileName, virtualText, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const tsFiles = sourcePaths.filter((file) => extname(file) === ".ts");
  const program = ts.createProgram([...tsFiles, ...virtualSvelte.keys()], options, host);
  const checker = program.getTypeChecker();
  const candidateSymbols = new Map<ts.Symbol, string[]>();
  const resolvedSymbol = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
    if (!symbol) return undefined;
    return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  };

  for (const candidate of candidates) {
    const file = program.getSourceFile(candidate.file);
    const moduleSymbol = file && checker.getSymbolAtLocation(file);
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.name === candidate.name);
    const valueSymbol = resolvedSymbol(exported);
    if (valueSymbol) {
      const key = `${resolve(candidate.file)}#${candidate.name}`;
      candidateSymbols.set(valueSymbol, [...(candidateSymbols.get(valueSymbol) ?? []), key]);
    }
  }

  // The checker follows named imports/re-exports and distinguishes same-named
  // local variables, so a comment, property name, or shadowed identifier cannot
  // accidentally make an export look connected.
  for (const file of program.getSourceFiles()) {
    const sourceRelative = relative(SOURCE_ROOT, resolve(file.fileName));
    if (sourceRelative === ".." || sourceRelative.startsWith(`..${sep}`)) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isUsableReference(node) && !isExportedAliasReference(node)) {
        const symbol = resolvedSymbol(checker.getSymbolAtLocation(node));
        for (const key of (symbol && candidateSymbols.get(symbol)) ?? []) references.add(key);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return references;
}

describe("export wiring", () => {
  function deadExports() {
    const sourcePaths = filesUnder(SOURCE_ROOT);
    const candidates = SCAN_ROOTS.flatMap((root) => filesUnder(root)
      .filter((file) => extname(file) === ".ts")
      .flatMap(exportedValues));
    const sourceImports = sourceReferences(sourcePaths, candidates);

    for (const candidate of candidates) {
      const key = `${resolve(candidate.file)}#${candidate.name}`;
      const exception = EXPORTED_VALUE_EXCEPTIONS.find(
        (entry) => entry.file === relative(ROOT, candidate.file).replaceAll("\\", "/")
          && entry.name === candidate.name,
      );
      if (exception && !exception.reason.trim()) {
        throw new Error(`Exception ${exception.file}#${exception.name} has no explanation`);
      }
      if (exception) sourceImports.add(key);
    }

    const staleExceptions = EXPORTED_VALUE_EXCEPTIONS.filter(
      ({ file, name }) => !candidates.some((candidate) =>
        relative(ROOT, candidate.file).replaceAll("\\", "/") === file && candidate.name === name,
      ),
    );

    const dead = candidates.filter(({ file, name }) => !sourceImports.has(`${resolve(file)}#${name}`));
    return {
      dead,
      failures: [
        ...dead.map(({ file, name }) =>
          `${relative(ROOT, file).replaceAll("\\", "/")} exports ${name}, but src/ does not use it; add a call, remove the export, or add one justified exception to EXPORTED_VALUE_EXCEPTIONS`,
        ),
        ...staleExceptions.map(({ file, name }) =>
          `Exception ${file}#${name} no longer matches an export; remove the stale EXPORTED_VALUE_EXCEPTIONS entry`,
        ),
      ],
    };
  }

  it("uses each exported function/constant in src or documents an explicit exception", () => {
    const { failures } = deadExports();

    expect(failures, ["Dead function/constant exports:", ...failures].join("\n")).toEqual([]);
  });

  it("keeps setEditorFormat called from the application, not only imported by tests", () => {
    const { dead } = deadExports();
    expect(
      dead.some(({ file, name }) => file.endsWith("createEditor.ts") && name === "setEditorFormat"),
      "src/editor/createEditor.ts exports setEditorFormat, but no application source uses it; call it when the document format changes or remove the export",
    ).toBe(false);
  });
});
