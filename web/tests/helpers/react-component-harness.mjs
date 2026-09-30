import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const REACT_DOUBLE_SOURCE = String.raw`
let hookSlots = [];
let hookCursor = 0;
let effectContext = null;

export const Fragment = Symbol.for("acceptance.react.fragment");

export function __clearHooks() {
  hookSlots = [];
  hookCursor = 0;
}

export function __beginRender() {
  hookCursor = 0;
}

export function useState(initialValue) {
  const slot = hookCursor++;
  if (!Object.prototype.hasOwnProperty.call(hookSlots, slot)) {
    hookSlots[slot] = typeof initialValue === "function" ? initialValue() : initialValue;
  }
  const stateSlots = hookSlots;
  const setValue = (nextValue) => {
    stateSlots[slot] = typeof nextValue === "function" ? nextValue(stateSlots[slot]) : nextValue;
  };
  return [hookSlots[slot], setValue];
}

export function useMemo(factory) {
  return factory();
}

export function useEffect(callback, dependencies) {
  if (!effectContext) return;
  const slot = hookCursor++;
  const previous = hookSlots[slot];
  if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies?.[index]))) {
    effectContext.pending.push(() => {
      previous?.cleanup?.();
      hookSlots[slot] = { dependencies, cleanup: callback() };
    });
  }
}

export function __createContext() { return { slots: [], pending: [] }; }
export function __renderContext(context, callback) {
  const previous = { hookSlots, hookCursor, effectContext };
  hookSlots = context.slots; hookCursor = 0; effectContext = context;
  try { return callback(); }
  finally { hookSlots = previous.hookSlots; hookCursor = previous.hookCursor; effectContext = previous.effectContext; }
}
export function __flushContext(context) {
  return __renderContext(context, () => { const pending = context.pending.splice(0); pending.forEach((effect) => effect()); });
}
export function __disposeContext(context) { context.slots.forEach((slot) => slot?.cleanup?.()); }

export function useRef(initialValue) {
  const slot = hookCursor++;
  if (!Object.prototype.hasOwnProperty.call(hookSlots, slot)) hookSlots[slot] = { current: initialValue };
  return hookSlots[slot];
}

export function useCallback(callback) {
  return callback;
}

export function jsx(type, props, key) {
  return { type, key: key ?? null, props: props ?? {} };
}

export const jsxs = jsx;
`;

const RELATIVE_IMPORT = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveTypeScriptModule(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = /\.tsx?$/i.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Cannot resolve test-time TypeScript dependency ${specifier} from ${importer}`);
}

async function compileModuleGraph({ sourcePath, sourceRoot, outputRoot, entry = false }) {
  const relativeSource = path.relative(sourceRoot, sourcePath);
  const outputPath = path.join(outputRoot, relativeSource).replace(/\.tsx?$/i, ".mjs");
  let source = await readFile(sourcePath, "utf8");
  if (entry) source += "\nexport { ProductApp, Dashboard, Vacancies, VacancySettings };\n";

  const dependencies = [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1]);
  const replacements = new Map();
  for (const specifier of dependencies) {
    const dependencyPath = await resolveTypeScriptModule(sourcePath, specifier);
    const dependencyOutput = await compileModuleGraph({ sourcePath: dependencyPath, sourceRoot, outputRoot });
    let rewritten = path.relative(path.dirname(outputPath), dependencyOutput).replaceAll("\\", "/");
    if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
    replacements.set(specifier, rewritten);
  }

  let emitted = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  }).outputText;

  let reactDouble = path.relative(path.dirname(outputPath), path.join(outputRoot, "react-double.mjs")).replaceAll("\\", "/");
  if (!reactDouble.startsWith(".")) reactDouble = `./${reactDouble}`;
  emitted = emitted
    .replaceAll('"react/jsx-runtime"', JSON.stringify(reactDouble))
    .replaceAll('"react"', JSON.stringify(reactDouble));

  for (const [specifier, rewritten] of replacements) {
    const quotedSpecifier = new RegExp(`(["'])${escapeRegExp(specifier)}\\1`, "g");
    emitted = emitted.replace(quotedSpecifier, JSON.stringify(rewritten));
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, emitted, "utf8");
  return outputPath;
}

export async function loadVacancySettingsHarness() {
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vacancy-abc-acceptance-"));
  await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE_SOURCE, "utf8");

  const entryPath = await compileModuleGraph({
    sourcePath: path.join(sourceRoot, "app/page.tsx"),
    sourceRoot,
    outputRoot,
    entry: true,
  });
  const [entryModule, reactDouble] = await Promise.all([
    import(pathToFileURL(entryPath).href),
    import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href),
  ]);

  return {
    create(props) {
      reactDouble.__clearHooks();
      return {
        render() {
          reactDouble.__beginRender();
          return entryModule.VacancySettings(props);
        },
      };
    },
    async cleanup() {
      await rm(outputRoot, { recursive: true, force: true });
    },
  };
}

export async function loadVacanciesHarness() {
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vacancy-header-acceptance-"));
  await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE_SOURCE, "utf8");

  const entryPath = await compileModuleGraph({
    sourcePath: path.join(sourceRoot, "app/page.tsx"),
    sourceRoot,
    outputRoot,
    entry: true,
  });
  const [entryModule, reactDouble] = await Promise.all([
    import(pathToFileURL(entryPath).href),
    import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href),
  ]);

  return {
    create(props) {
      reactDouble.__clearHooks();
      return {
        render() {
          reactDouble.__beginRender();
          return entryModule.Vacancies(props);
        },
      };
    },
    async cleanup() {
      await rm(outputRoot, { recursive: true, force: true });
    },
  };
}

export async function loadDriveDashboardHarness() {
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "google-drive-dashboard-acceptance-"));
  await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE_SOURCE, "utf8");

  const entryPath = await compileModuleGraph({
    sourcePath: path.join(sourceRoot, "app/page.tsx"),
    sourceRoot,
    outputRoot,
    entry: true,
  });
  const [entryModule, reactDouble] = await Promise.all([
    import(pathToFileURL(entryPath).href),
    import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href),
  ]);

  return {
    create(props) {
      reactDouble.__clearHooks();
      return {
        render() {
          reactDouble.__beginRender();
          return entryModule.Dashboard(props);
        },
      };
    },
    async cleanup() {
      await rm(outputRoot, { recursive: true, force: true });
    },
  };
}

// Unlike the single-component harnesses, this mounts independent component hook
// contexts and effects, so application navigation can use the actual editor ref.
export async function loadVacancyNavigationHarness() {
  const sourceRoot = path.resolve(import.meta.dirname, "../..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vacancy-navigation-acceptance-"));
  await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE_SOURCE, "utf8");
  const entryPath = await compileModuleGraph({ sourcePath: path.join(sourceRoot, "app/page.tsx"), sourceRoot, outputRoot, entry: true });
  const [entryModule, reactDouble] = await Promise.all([
    import(pathToFileURL(entryPath).href), import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href),
  ]);
  const contexts = [];
  return {
    mount(component, props) {
      const context = reactDouble.__createContext();
      contexts.push(context);
      const renderComponent = typeof component === "string" ? entryModule[component] : component;
      return {
        render(nextProps = props) { props = nextProps; return reactDouble.__renderContext(context, () => renderComponent(props)); },
        flushEffects() { reactDouble.__flushContext(context); },
        dispose() { reactDouble.__disposeContext(context); },
      };
    },
    async cleanup() { contexts.forEach(reactDouble.__disposeContext); await rm(outputRoot, { recursive: true, force: true }); },
  };
}
