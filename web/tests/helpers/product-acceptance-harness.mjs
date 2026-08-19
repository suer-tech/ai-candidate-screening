import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const REACT_DOUBLE = String.raw`
let slots = [];
let cursor = 0;
export const Fragment = Symbol.for("acceptance.react.fragment");
export function __reset() { slots = []; cursor = 0; }
export function __begin() { cursor = 0; }
export function useState(initialValue) {
  const slot = cursor++;
  if (!Object.prototype.hasOwnProperty.call(slots, slot)) slots[slot] = typeof initialValue === "function" ? initialValue() : initialValue;
  const setValue = (nextValue) => { slots[slot] = typeof nextValue === "function" ? nextValue(slots[slot]) : nextValue; };
  return [slots[slot], setValue];
}
export function useMemo(factory) { return factory(); }
export function useCallback(callback) { return callback; }
export function useEffect() {}
export function useRef(initialValue) { return { current: initialValue }; }
export function jsx(type, props, key) { return { type, key: key ?? null, props: props ?? {} }; }
export const jsxs = jsx;
`;

const RELATIVE_IMPORT = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveModule(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
    }
  }
  throw new Error(`Cannot resolve ${specifier} from ${importer}`);
}

async function compileGraph({ sourcePath, sourceRoot, outputRoot, entry = false, seen = new Map() }) {
  if (seen.has(sourcePath)) return seen.get(sourcePath);
  const outputPath = path.join(outputRoot, path.relative(sourceRoot, sourcePath)).replace(/\.tsx?$/i, ".mjs");
  seen.set(sourcePath, outputPath);
  let source = await readFile(sourcePath, "utf8");
  if (entry) source += "\nexport { Dashboard, Vacancies, CreateVacancy, CandidateDetail, MaterialsPanel, PdfPreview };\n";

  const replacements = new Map();
  for (const specifier of [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1])) {
    const dependency = await resolveModule(sourcePath, specifier);
    const emitted = await compileGraph({ sourcePath: dependency, sourceRoot, outputRoot, seen });
    let rewritten = path.relative(path.dirname(outputPath), emitted).replaceAll("\\", "/");
    if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
    replacements.set(specifier, rewritten);
  }

  let emitted = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
  }).outputText;
  let reactDouble = path.relative(path.dirname(outputPath), path.join(outputRoot, "react-double.mjs")).replaceAll("\\", "/");
  if (!reactDouble.startsWith(".")) reactDouble = `./${reactDouble}`;
  emitted = emitted.replaceAll('"react/jsx-runtime"', JSON.stringify(reactDouble)).replaceAll('"react"', JSON.stringify(reactDouble));
  for (const [specifier, rewritten] of replacements) {
    emitted = emitted.replace(new RegExp(`(["'])${escapeRegExp(specifier)}\\1`, "g"), JSON.stringify(rewritten));
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, emitted, "utf8");
  return outputPath;
}

export async function loadProductUiHarness() {
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "product-acceptance-"));
  await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE, "utf8");
  const entry = await compileGraph({ sourcePath: path.join(sourceRoot, "app/page.tsx"), sourceRoot, outputRoot, entry: true });
  const [components, react] = await Promise.all([
    import(pathToFileURL(entry).href),
    import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href),
  ]);
  return {
    create(name, props) {
      assert.equal(typeof components[name], "function", `${name} is an observable UI component`);
      react.__reset();
      return { render: () => { react.__begin(); return components[name](props); } };
    },
    cleanup: () => rm(outputRoot, { recursive: true, force: true }),
  };
}

export function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (node === null || node === undefined || typeof node === "boolean" || typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}

export function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return textContent(node.props?.children);
}

export function findAll(tree, predicate) {
  const result = [];
  walk(tree, (node) => { if (predicate(node)) result.push(node); });
  return result;
}

export function findButton(tree, label) {
  const button = findAll(tree, (node) => node.type === "button" && textContent(node).replace(/^[^\p{L}\p{N}]*/u, "").replace(/›$/, "").trim() === label)[0];
  assert.ok(button, `Button ${JSON.stringify(label)} is present`);
  return button;
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["tests", "node_modules", ".next", ".vinext", ".wrangler", "dist"].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (!/\.test\.[^.]+$/i.test(entry.name) && /\.(?:ts|tsx|js|mjs|json)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
}

export async function readProductSource() {
  const root = path.resolve(import.meta.dirname, "../..");
  const files = await sourceFiles(root);
  const parts = await Promise.all(files.map(async (file) => `\n/* ${path.relative(root, file)} */\n${await readFile(file, "utf8")}`));
  return parts.join("\n");
}
