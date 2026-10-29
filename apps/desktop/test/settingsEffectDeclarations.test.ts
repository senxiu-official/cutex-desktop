import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTINGS_EFFECT_EXEMPTIONS } from "../src/renderer/src/lib/settingsEffectPolicy";

// TypeScript 7 exposes no old compiler AST API. Reuse the existing React transform's
// TypeScript/JSX parser through normal dependency resolution; never pin a .pnpm path.
const require = createRequire(import.meta.url);
const reactRequire = createRequire(require.resolve("@vitejs/plugin-react"));
const babelRequire = createRequire(reactRequire.resolve("@babel/core"));
// Babel nodes intentionally have different property shapes for each syntax kind.
type Node = { type: string; [key: string]: any };
const { parse } = babelRequire("@babel/parser") as { parse(source: string, options: object): Node };
const ROOT = fileURLToPath(new URL("../src/renderer/src/", import.meta.url));
const FORM = join(ROOT, "components/settings/Form.tsx");
const DECLARATIONS = new Set(["SettingRow", "DefaultableToggleRow", "LinkRow", "SettingsGroup"]);
const CONTAINERS = new Set(["SettingsPage", "Section", "SettingsEffectCard", "PartSource"]);
const MUTATIONS = new Set(["onChange", "onValueChange", "onCheckedChange", "onInput", "onSubmit", "onSave", "onPatch"]);
const relativeName = (file: string) => relative(ROOT, file).replaceAll("\\", "/");
const location = (file: string, node: Node) => `${relativeName(file)}:${node.loc.start.line}`;
function walk(node: unknown, visit: (node: Node, ancestors: Node[]) => void, ancestors: Node[] = []): void {
  if (!node || typeof node !== "object" || !("type" in node)) return;
  const current = node as Node; visit(current, ancestors);
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral", "JSXText", "TemplateElement", "RegExpLiteral", "BigIntLiteral"].includes(current.type)) return;
  const next = [...ancestors, current];
  for (const [key, value] of Object.entries(current)) {
    if (["loc", "start", "end", "comments", "leadingComments", "trailingComments", "extra"].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, next);
    else walk(value, visit, next);
  }
}
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(directory, entry.name))
    : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []);
}
function sourceModule(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return;
  const stem = resolve(dirname(file), specifier);
  return [stem, `${stem}.ts`, `${stem}.tsx`, join(stem, "index.ts"), join(stem, "index.tsx")].find(candidate => existsSync(candidate) && /\.tsx?$/.test(candidate));
}
function unbox(node: Node): Node {
  return ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(node.type) ? unbox(node.expression) : node;
}
const keyName = (node: Node | undefined) => !node ? undefined : node.type === "Identifier" || node.type === "JSXIdentifier" ? node.name : node.type === "StringLiteral" ? node.value : undefined;
interface Unit { ast: Node; imports: Map<string, { file: string; imported: string }>; variables: Map<string, Node> }
const units = new Map<string, Unit>();
function unit(file: string): Unit {
  const existing = units.get(file); if (existing) return existing;
  return parseUnit(file, readFileSync(file, "utf8"));
}
function parseUnit(file: string, source: string): Unit {
  let ast: Node;
  try { ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"], createImportExpressions: true }); }
  catch (error) { throw Error(`${relativeName(file)}: ${error instanceof Error ? error.message : String(error)}`); }
  const result: Unit = { ast, imports: new Map(), variables: new Map() };
  units.set(file, result);
  // Module bindings are top-level; traversing huge locale dictionaries here would
  // add work without discovering another import or registered component binding.
  for (const statement of result.ast.program.body as Node[]) {
    const node = ["ExportNamedDeclaration", "ExportDefaultDeclaration"].includes(statement.type) ? statement.declaration : statement;
    if (!node) continue;
    if (node.type === "ImportDeclaration") {
      const target = sourceModule(file, node.source.value); if (!target) continue;
      for (const specifier of node.specifiers) result.imports.set(specifier.local.name, { file: target, imported: specifier.type === "ImportSpecifier" ? keyName(specifier.imported) : specifier.type === "ImportNamespaceSpecifier" ? "*" : "default" });
    }
    if (node.type === "VariableDeclaration") for (const declaration of node.declarations) {
      if (declaration.id.type === "Identifier" && declaration.init) result.variables.set(declaration.id.name, declaration.init);
    }
  }
  return result;
}
function arrayItems(file: string, expression: Node): Node[] {
  const value = unbox(expression);
  if (value.type === "Identifier") {
    const initializer = unit(file).variables.get(value.name);
    if (initializer) return arrayItems(file, initializer);
  }
  if (value.type !== "ArrayExpression") throw Error(`${location(file, value)}: unresolved registry array; extend the AST audit rather than skip it`);
  return value.elements.flatMap((element: Node | null) => {
    if (!element) throw Error(`${location(file, value)}: registry array hole`);
    return element.type === "SpreadElement" ? arrayItems(file, element.argument) : [unbox(element)];
  });
}
function property(object: Node, name: string): Node | undefined {
  return object.properties.find((entry: Node) => entry.type === "ObjectProperty" && keyName(entry.key) === name)?.value;
}
function literal(file: string, node: Node | undefined, field: string, seen = new Set<string>()): string {
  if (node) {
    const value = unbox(node);
    if (value.type === "StringLiteral") return value.value;
    if (value.type === "TemplateLiteral" && !value.expressions.length) return value.quasis[0].value.cooked;
    if (value.type === "Identifier") {
      const key = `${file}#${value.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        const context = unit(file), local = context.variables.get(value.name);
        if (local) return literal(file, local, field, seen);
        const imported = context.imports.get(value.name);
        if (imported) return literal(imported.file, unit(imported.file).variables.get(imported.imported), field, seen);
      }
    }
  }
  throw Error(`${relativeName(file)}: registry ${field} must be statically enumerable`);
}
function componentSources(file: string, node: Node | undefined): string[] {
  if (!node) throw Error(`${relativeName(file)}: missing registered component`);
  const value = unbox(node), context = unit(file);
  if (value.type === "Identifier") {
    const imported = context.imports.get(value.name); if (imported) return [imported.file];
    const initializer = context.variables.get(value.name);
    if (initializer) return componentSources(file, initializer);
    // Locally declared component: all JSX in that source is audited below.
    let found = false;
    walk(context.ast, current => { if (current.type === "FunctionDeclaration" && current.id?.name === value.name) found = true; });
    if (found) return [file];
  }
  const found = new Set<string>();
  walk(value, current => {
    if (current.type === "ImportExpression" && current.source.type === "StringLiteral") {
      const target = sourceModule(file, current.source.value); if (target) found.add(target);
    }
  });
  if (found.size) return [...found];
  throw Error(`${location(file, value)}: unresolved registered component; extend the AST audit`);
}
interface Registration { page: string; id: string; slot: string; file: string; roots: string[] }
function registrations(): Registration[] {
  const registry = join(ROOT, "modules/registry.ts"), context = unit(registry);
  const modules = context.variables.get("MODULES"); if (!modules) throw Error("Missing MODULES registry");
  const result: Registration[] = [];
  for (const reference of arrayItems(registry, modules)) {
    const file = reference.type === "Identifier" && context.imports.get(reference.name)?.file;
    if (!file) throw Error(`${location(registry, reference)}: unresolved registered module`);
    walk(unit(file).ast, node => {
      if (node.type !== "ObjectProperty" || !["settings.page", "settings.section"].includes(keyName(node.key))) return;
      const slot = keyName(node.key)!;
      for (const row of arrayItems(file, node.value)) {
        if (row.type !== "ObjectExpression") throw Error(`${location(file, row)}: unresolved settings registration`);
        result.push({ page: literal(file, property(row, "page"), "page"), id: literal(file, property(row, "id"), "id"), slot, file,
          roots: componentSources(file, property(row, slot === "settings.page" ? "Page" : "Section")) });
      }
    });
  }
  return result;
}
const registered = registrations();
const pages = new Set(registered.filter(row => row.slot === "settings.page").map(row => row.page));
// Follow component imports (including JSX aliases and lazy chunks), not state/helper imports
// that would pull the entire application back into every page's dependency graph.
function componentGraph(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const collect = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    const current = unit(file), jsxNames = new Set<string>();
    walk(current.ast, node => {
      if (node.type === "JSXOpeningElement") jsxNames.add(node.name.type === "JSXMemberExpression" ? node.name.object.name : node.name.name);
      if (node.type === "ImportExpression" && node.source.type === "StringLiteral") {
        const target = sourceModule(file, node.source.value); if (target) collect(target);
      }
    });
    for (const name of jsxNames) { const imported = current.imports.get(name); if (imported) collect(imported.file); }
    // Component barrels can use re-exports rather than JSX themselves.
    walk(current.ast, node => {
      if (["ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source?.type === "StringLiteral") {
        const target = sourceModule(file, node.source.value); if (target) collect(target);
      }
    });
  };
  for (const root of roots) collect(root);
  return seen;
}
let graph: Map<string, Set<string>> | undefined;
const registeredGraph = () => graph ??= new Map(registered.map(row => [row.id, componentGraph(row.roots)]));
const jsxName = (name: Node): string | undefined => name.type === "JSXIdentifier" ? name.name : name.type === "JSXMemberExpression" ? name.property.name : undefined;
function primitive(file: string, opening: Node): string | undefined {
  const name = jsxName(opening.name), context = unit(file);
  if (file === FORM) return name;
  if (opening.name.type === "JSXMemberExpression") {
    const imported = context.imports.get(opening.name.object.name);
    return imported?.file === FORM && imported.imported === "*" ? name : undefined;
  }
  const imported = name && context.imports.get(name);
  return imported && imported.file === FORM ? imported.imported : undefined;
}
const attributes = (opening: Node) => new Map<string, Node>(opening.attributes.filter((entry: Node) => entry.type === "JSXAttribute").map((entry: Node) => [entry.name.name, entry]));
const isAbsent = (attribute: Node) => !attribute.value || attribute.value.type === "JSXExpressionContainer"
  && (attribute.value.expression.type === "JSXEmptyExpression" || attribute.value.expression.type === "NullLiteral"
    || attribute.value.expression.type === "Identifier" && attribute.value.expression.name === "undefined");

const reactFactories = new Map<string, { names: Set<string>; namespaces: Set<string> }>();
function constructedElement(file: string, node: Node): { kind?: string; props?: Node } | undefined {
  if (node.type !== "CallExpression") return;
  let factory = reactFactories.get(file);
  if (!factory) {
    const names = new Set(["createElement"]), namespaces = new Set<string>();
    for (const statement of unit(file).ast.program.body as Node[]) if (statement.type === "ImportDeclaration" && statement.source.value === "react") {
      for (const specifier of statement.specifiers) {
        if (specifier.type === "ImportSpecifier" && keyName(specifier.imported) === "createElement") names.add(specifier.local.name);
        if (["ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(specifier.type)) namespaces.add(specifier.local.name);
      }
    }
    factory = { names, namespaces }; reactFactories.set(file, factory);
  }
  const { names, namespaces } = factory, callee = node.callee;
  if (!(callee.type === "Identifier" && names.has(callee.name))
    && !(callee.type === "MemberExpression" && namespaces.has(callee.object.name) && keyName(callee.property) === "createElement")) return;
  const element = node.arguments[0]; if (!element) return;
  const kind = element.type === "Identifier" ? unit(file).imports.get(element.name)?.imported ?? element.name : undefined;
  return { kind, props: node.arguments[1] && unbox(node.arguments[1]) };
}
function declarationIssues(file: string): string[] {
  const issues: string[] = [];
  walk(unit(file).ast, node => {
    const constructed = constructedElement(file, node);
    if (constructed?.kind && DECLARATIONS.has(constructed.kind)) {
      for (const field of ["agents", "source"]) {
        const props = constructed.props;
        const index = props?.type === "ObjectExpression" ? props.properties.findIndex((entry: Node) => entry.type === "ObjectProperty" && keyName(entry.key) === field) : -1;
        const value = index >= 0 ? props!.properties[index].value : undefined;
        if (!value || value.type === "NullLiteral" || value.type === "Identifier" && value.name === "undefined")
          issues.push(`${location(file, node)} ${constructed.kind}: missing explicit ${field}`);
        else if (props!.properties.slice(index + 1).some((entry: Node) => entry.type === "SpreadElement"))
          issues.push(`${location(file, node)} ${constructed.kind}: spread can overwrite explicit ${field}`);
      }
      return;
    }
    if (!["JSXOpeningElement", "JSXSelfClosingElement"].includes(node.type)) return;
    const kind = primitive(file, node); if (!kind || !DECLARATIONS.has(kind)) return;
    const props = attributes(node);
    for (const field of ["agents", "source"]) {
      const attribute = props.get(field);
      if (!attribute || isAbsent(attribute)) issues.push(`${location(file, node)} ${kind}: missing explicit ${field}`);
      else if (node.attributes.slice(node.attributes.indexOf(attribute) + 1).some((entry: Node) => entry.type === "JSXSpreadAttribute"))
        issues.push(`${location(file, node)} ${kind}: spread can overwrite explicit ${field}`);
    }
  });
  return issues;
}
const production = sources(ROOT).filter(file => !relativeName(file).startsWith("dev/"));

// A custom child can inherit a real row/group context from its callers. Follow those
// JSX component edges rather than falsely demanding a second declaration inside a
// reusable input component. Unresolved callback-only mutation controls fail closed.
function componentKey(file: string, name: string): string {
  for (const statement of unit(file).ast.program.body as Node[]) {
    if (name === "default" && statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration;
      if (declaration.type === "Identifier") return `${file}#${declaration.name}`;
      if (declaration.id?.name) return `${file}#${declaration.id.name}`;
    }
    if (statement.type === "ExportNamedDeclaration") for (const specifier of statement.specifiers ?? []) {
      if (keyName(specifier.exported) === name && !statement.source) return `${file}#${keyName(specifier.local)}`;
    }
  }
  return `${file}#${name}`;
}
function enclosingComponent(file: string, ancestors: Node[]): string {
  for (const node of [...ancestors].reverse()) {
    if (node.type === "FunctionDeclaration" && node.id?.name) return componentKey(file, node.id.name);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      const initializer = unbox(node.init);
      const callable = ["ArrowFunctionExpression", "FunctionExpression"].includes(initializer.type)
        || initializer.type === "CallExpression" && initializer.arguments.some((argument: Node) => ["ArrowFunctionExpression", "FunctionExpression"].includes(argument.type));
      if (callable) return componentKey(file, node.id.name);
    }
  }
  return componentKey(file, "default");
}
interface ControlContext { file: string; node: Node; caller: string; declared: boolean; card: boolean; navigation?: string; implementation?: string; factory?: string; target?: string }
function targetComponent(file: string, opening: Node): string | undefined {
  const name = jsxName(opening.name); if (!name || !/^[A-Z]/.test(name)) return;
  const imported = opening.name.type === "JSXMemberExpression"
    ? unit(file).imports.get(opening.name.object.name) : unit(file).imports.get(name);
  return imported ? componentKey(imported.file, imported.imported === "*" ? name : imported.imported) : componentKey(file, name);
}
const HOST_PICKER = componentKey(join(ROOT, "components/HostPicker.tsx"), "HostPicker");
function semanticNavigation(file: string, node: Node, ancestors: Node[]): string | undefined {
  if (targetComponent(file, node) === HOST_PICKER) return "HostPicker selects the host being viewed; it does not change a setting";
  for (const parent of ancestors) if (parent.type === "JSXElement") {
    const opening = parent.openingElement, name = jsxName(opening.name), role = attributes(opening).get("role")?.value;
    const value = role?.type === "StringLiteral" ? role.value : role?.expression?.type === "StringLiteral" ? role.expression.value : undefined;
    if (name === "nav" || value === "search" || value === "toolbar") return `explicit navigation DOM: ${name === "nav" ? "nav" : `role=${value}`}`;
  }
}
interface LocalFactory { name: string; scope: Node; slots: Set<number> }
function rowFactories(file: string): LocalFactory[] {
  const bindings: LocalFactory[] = [];
  walk(unit(file).ast, (node, ancestors) => {
    const name = node.type === "FunctionDeclaration" ? node.id?.name : node.type === "VariableDeclarator" && node.id.type === "Identifier" ? node.id.name : undefined;
    if (!name) return;
    const scope = [...ancestors].reverse().find(parent => parent.type === "BlockStatement" || parent.type === "Program")!;
    const candidate = node.type === "FunctionDeclaration" ? node : node.init && unbox(node.init);
    const slots = new Set<number>();
    bindings.push({ name, scope, slots }); // Keep non-function shadows too: they must not inherit an outer proof.
    if (!candidate || !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(candidate.type)) return;
    const parameters = new Map<string, { index: number; used: boolean; safe: boolean }>();
    candidate.params.forEach((parameter: Node, index: number) => {
      if (parameter.type === "Identifier") parameters.set(parameter.name, { index, used: false, safe: true });
    });
    if (!parameters.size) return;
    walk(candidate.body, (use, parents) => {
      if (use.type !== "Identifier") return;
      const parameter = parameters.get(use.name); if (!parameter) return;
      const parent = parents.at(-1);
      if (parents.some(entry => entry.type.startsWith("TS"))
        || parent?.type === "MemberExpression" && parent.property === use && !parent.computed
        || parent?.type === "ObjectProperty" && parent.key === use && !parent.shorthand) return;
      const rendered = parent?.type === "JSXExpressionContainer" && parent.expression === use
        && parents.some(entry => entry.type === "JSXElement" && DECLARATIONS.has(primitive(file, entry.openingElement) ?? ""));
      parameter.used ||= rendered;
      parameter.safe &&= rendered; // Every runtime use must stay inside the declared row; escaping invalidates proof.
    });
    for (const parameter of parameters.values()) if (parameter.used && parameter.safe) slots.add(parameter.index);
  });
  return bindings;
}
function localFactoryContext(factories: LocalFactory[], node: Node, ancestors: Node[]): string | undefined {
  for (const call of [...ancestors].reverse()) if (call.type === "CallExpression" && call.callee.type === "Identifier") {
    const argument = call.arguments.findIndex((value: Node) => value === node || ancestors.includes(value));
    if (argument < 0) continue;
    const binding = factories.filter(factory => factory.name === call.callee.name && ancestors.includes(factory.scope))
      .sort((a, b) => ancestors.indexOf(b.scope) - ancestors.indexOf(a.scope))[0];
    if (binding?.slots.has(argument)) return `local row factory ${binding.name} renders parameter ${argument + 1} inside a declared row`;
  }
}
function staticAttribute(opening: Node, name: string): string | boolean | undefined {
  const attribute = attributes(opening).get(name); if (!attribute) return;
  if (!attribute.value) return true;
  if (["StringLiteral", "BooleanLiteral"].includes(attribute.value.type)) return attribute.value.value;
  if (attribute.value.type === "JSXExpressionContainer" && ["StringLiteral", "BooleanLiteral"].includes(attribute.value.expression.type)) return attribute.value.expression.value;
}
function implementationControl(node: Node): string | undefined {
  const classes = staticAttribute(node, "className");
  if (jsxName(node.name) === "input" && staticAttribute(node, "type") === "file"
    && (staticAttribute(node, "hidden") === true || typeof classes === "string" && classes.split(/\s+/).includes("hidden")))
    return "implementation-control: hidden file input backing a visible picker";
}
function customControlAudit() {
  const reached = new Set([...registeredGraph().values()].flatMap(files => [...files]));
  const calls = new Map<string, ControlContext[]>(), controls: ControlContext[] = [];
  const declarations = new Set<string>(), cards = new Set<string>();
  const factories = new Map([...reached].map(file => [file, rowFactories(file)]));
  for (const file of reached) if (file !== FORM && !relativeName(file).startsWith("dev/")) walk(unit(file).ast, (node, ancestors) => {
    if (node.type !== "JSXOpeningElement") return;
    const kind = primitive(file, node), caller = enclosingComponent(file, ancestors);
    if (kind && DECLARATIONS.has(kind)) declarations.add(caller);
    if (kind === "Section" || kind === "Card" || kind === "SettingsEffectCard") cards.add(caller);
  });
  for (const file of reached) if (file !== FORM && !relativeName(file).startsWith("dev/")) walk(unit(file).ast, (node, ancestors) => {
    if (node.type !== "JSXOpeningElement") return;
    const kind = primitive(file, node), name = jsxName(node.name), props = attributes(node);
    const factory = localFactoryContext(factories.get(file) ?? [], node, ancestors);
    const declared = !!factory || ancestors.some(parent => parent.type === "JSXElement" && DECLARATIONS.has(primitive(file, parent.openingElement) ?? ""));
    const card = ancestors.some(parent => parent.type === "JSXElement" &&
      (["Section", "Card", "SettingsEffectCard"].includes(primitive(file, parent.openingElement) ?? "") || cards.has(targetComponent(file, parent.openingElement) ?? "")));
    const caller = enclosingComponent(file, ancestors), target = targetComponent(file, node);
    const navigation = semanticNavigation(file, node, ancestors), implementation = implementationControl(node);
    const context = { file, node, caller, declared, card, navigation, implementation, factory, target };
    if (target && !kind) calls.set(target, [...(calls.get(target) ?? []), context]);
    if (kind && DECLARATIONS.has(kind)) return;
    const editable = ["input", "select", "textarea"].includes(name ?? "") || [...MUTATIONS].some(field => props.has(field));
    if (editable) controls.push(context);
  });
  const inheritedDeclaration = (key: string, seen = new Set<string>()): boolean => {
    if (seen.has(key)) return false;
    const uses = calls.get(key); if (!uses?.length) return false;
    return uses.every(use => use.declared || inheritedDeclaration(use.caller, new Set([...seen, key])));
  };
  const inheritedNavigation = (key: string, seen = new Set<string>()): boolean => {
    if (key === HOST_PICKER) return true;
    if (seen.has(key)) return false;
    const uses = calls.get(key); if (!uses?.length) return false;
    return uses.every(use => !!use.navigation || inheritedNavigation(use.caller, new Set([...seen, key])));
  };
  const inheritedCard = (key: string, seen = new Set<string>()): boolean => {
    if (seen.has(key)) return false;
    return (calls.get(key) ?? []).some(use => use.card || inheritedCard(use.caller, new Set([...seen, key])));
  };
  // A wrapper's onChange prop is not an extra setting when its own component
  // recursively renders declared controls (e.g. ProxyEditor -> SettingRow).
  const componentDeclaresControls = (key: string, seen = new Set<string>()): boolean => {
    if (seen.has(key)) return false;
    const children = controls.filter(control => control.caller === key);
    if (!children.length) return declarations.has(key);
    return children.every(control => control.declared || !!control.implementation || inheritedDeclaration(control.caller) || !!control.navigation
      || inheritedNavigation(control.caller) || !!control.target && componentDeclaresControls(control.target, new Set([...seen, key])));
  };
  const inventory = controls.map(control => {
    const reason = control.implementation ?? control.factory ?? (control.declared ? "inside an explicit row/group"
      : inheritedDeclaration(control.caller) ? "caller supplies an explicit row/group"
      : control.navigation ?? (inheritedNavigation(control.caller) ? "navigation component/caller (including HostPicker)" : undefined)
      ?? (control.target && componentDeclaresControls(control.target) ? "component recursively declares its own controls" : undefined));
    return { file: relativeName(control.file), line: control.node.loc.start.line, component: jsxName(control.node.name),
      settingsCard: control.card || inheritedCard(control.caller), classification: reason ? "classified" : "unclassified", reason: reason ?? "manual classification required" };
  });
  return { inventory, unclassified: inventory.filter(control => control.classification === "unclassified"),
    failures: inventory.filter(control => control.classification === "unclassified")
      .map(control => `${control.file}:${control.line} ${control.component}: setting control needs a declared row/group or semantic navigation container`) };
}

// Optional machine-readable inventory is source collection, outside per-test timeouts.
    if (process.env.SETTINGS_EFFECT_AUDIT_REPORT === "1") {
      const declarations: { file: string; line: number; kind: string; conditional: boolean; agents?: string; source?: string }[] = [];
      for (const file of production) walk(unit(file).ast, (node, ancestors) => {
        if (node.type !== "JSXOpeningElement") return;
        const kind = primitive(file, node);
        if (kind && (DECLARATIONS.has(kind) || kind === "Section" || kind === "SettingsEffectCard")) declarations.push({ file: relativeName(file), line: node.loc.start.line, kind,
          agents: attributes(node).get("agents")?.value ? readFileSync(file, "utf8").slice(attributes(node).get("agents")!.value.start, attributes(node).get("agents")!.value.end) : undefined,
          source: attributes(node).get("source")?.value ? readFileSync(file, "utf8").slice(attributes(node).get("source")!.value.start, attributes(node).get("source")!.value.end) : undefined,
          conditional: ancestors.some(parent => ["ConditionalExpression", "LogicalExpression", "IfStatement", "SwitchCase"].includes(parent.type)) });
      });
      console.info("SETTINGS_EFFECT_AUDIT " + JSON.stringify({
        registrations: registered.map(row => ({ ...row, file: relativeName(row.file), roots: row.roots.map(relativeName), componentGraph: [...registeredGraph().get(row.id)!].map(relativeName) })),
        declarations, missing: sources(ROOT).flatMap(declarationIssues), customControls: customControlAudit(),
      }));
    }

describe("exhaustive settings effect declarations", () => {
  it("detects missing fields behind aliases/branches and refuses spreads that overwrite declarations", () => {
    const file = join(ROOT, "__settings_effect_fixture.tsx");
    try {
      parseUnit(file, `import { SettingRow as Field, SettingsGroup } from './components/settings/Form';
        import { createElement as h } from 'react';
        const Constructed = () => h(Field, { agents: 'none' });
        const Example = () => enabled ? <Field agents="none" /> : <SettingsGroup source="host" />;
        const Null = () => <Field agents={undefined} source="local" />;
        const Overwrite = () => <Field agents="none" source="local" {...unreviewed} />;
        const Explicit = () => <Field {...rest} agents="none" source="local" />;`);
      const issues = declarationIssues(file);
      expect(issues.filter(issue => issue.includes("missing explicit source"))).toHaveLength(2);
      expect(issues.filter(issue => issue.includes("missing explicit agents"))).toHaveLength(2);
      expect(issues.filter(issue => issue.includes("spread can overwrite"))).toHaveLength(2);
      expect(issues).toHaveLength(6);
    } finally { units.delete(file); reactFactories.delete(file); }
  });
  it("propagates declared editor wrappers, recognizes semantic navigation, and rejects unclassified controls both inside and outside cards", () => {
    const file = join(ROOT, "__settings_effect_controls_fixture.tsx"), previous = graph;
    try {
      parseUnit(file, `import { Section, SettingRow, Toggle } from './components/settings/Form';
        import { HostPicker } from './components/HostPicker';
        const Editor = () => <SettingRow agents="none" source="local"><Toggle onChange={save} /></SettingRow>;
        const Good = () => <Section><Editor onChange={save} /><nav><input onChange={filter} /></nav>
          <div role="search"><input onChange={filter} /></div><div role="toolbar"><input onChange={filter} /></div>
          <HostPicker onChange={viewHost} /></Section>;
        const Bad = () => <Section><input onChange={save} /></Section>;
        const UnclassifiedOutside = () => <input onChange={needsReview} />;`);
      graph = new Map([["fixture", new Set([file])]]);
      const report = customControlAudit();
      expect(report.failures).toHaveLength(2);
      expect(report.unclassified).toHaveLength(2);
      expect(report.unclassified.some(control => !control.settingsCard)).toBe(true);
      expect(report.inventory.some(control => control.reason === "component recursively declares its own controls")).toBe(true);
      expect(report.inventory.filter(control => control.reason.startsWith("explicit navigation DOM:"))).toHaveLength(3);
      expect(report.inventory.some(control => control.reason.startsWith("HostPicker selects"))).toBe(true);
    } finally { graph = previous; units.delete(file); reactFactories.delete(file); }
  });
  it("proves local row-factory parameter flow and classifies only genuinely hidden file implementation controls", () => {
    const file = join(ROOT, "__settings_effect_factory_fixture.tsx"), previous = graph;
    try {
      parseUnit(file, `import { Section, SettingRow } from './components/settings/Form';
        const Example = () => {
          const row = (field, label, control) => <SettingRow agents="newAgents" source="host" label={label}>{control}</SettingRow>;
          const escaping = (field, label, control) => control;
          return <Section>{row('f', 'label', <input onChange={save} />)}
            {escaping('f', 'label', <input onChange={save} />)}
            <input type="file" className="hidden" onChange={upload} />
            <input type="file" hidden onChange={upload} />
            <input type="file" className="block" onChange={upload} />
            <input type="text" hidden onChange={save} />
          </Section>;
        };`);
      graph = new Map([["fixture", new Set([file])]]);
      const report = customControlAudit();
      expect(report.failures).toHaveLength(3);
      expect(report.inventory.filter(control => control.reason.startsWith("local row factory row"))).toHaveLength(1);
      expect(report.inventory.filter(control => control.reason.startsWith("implementation-control:"))).toHaveLength(2);
    } finally { graph = previous; units.delete(file); reactFactories.delete(file); }
  });
  it("enumerates every module page and injected section, including gated registrations", () => {
    expect(pages.size).toBeGreaterThan(0);
    expect(new Set(registered.map(row => row.id)).size).toBe(registered.length);
    expect(registered.filter(row => row.slot === "settings.section").length).toBeGreaterThan(0);
    expect(registered.filter(row => !pages.has(row.page)).map(row => row.id)).toEqual([]);
    expect(registered.filter(row => !registeredGraph().get(row.id)?.size).map(row => row.id)).toEqual([]);
    expect(pages.has("profiles")).toBe(true);

  }, 30_000); // Builds every registered component graph; slow under full-suite load on Windows.
  it("requires explicit timing and source on every renderer row/group, including conditional and host-dependent JSX", () => {
    // Deliberately checks all source JSX, not one rendered host/runtime snapshot.
    expect(sources(ROOT).flatMap(declarationIssues)).toEqual([]);
  }, 30_000); // Parses every settings source file; slow under full-suite load on Windows.
  it("allows exactly the named registered Profile placement exception with a reason", () => {
    expect(Object.keys(SETTINGS_EFFECT_EXEMPTIONS)).toEqual(["profiles"]);
    for (const [page, exemption] of Object.entries(SETTINGS_EFFECT_EXEMPTIONS)) {
      expect(pages.has(page), page).toBe(true);
      expect(exemption.reason.trim().length, page).toBeGreaterThan(20);
      expect(exemption).not.toHaveProperty("timing");
      expect(exemption.scope).toBe("baseline");
    }
  });
  it("centralizes timing markers and DOM effect metadata in Form rather than individual settings pages", () => {
    const issues: string[] = [];
    for (const file of production) if (file !== FORM) walk(unit(file).ast, node => {
      const constructed = constructedElement(file, node);
      if (constructed?.kind && ["AgentsChip", "EffectMarkers", "AgentTimingIcon", "SourceTag", "WhereChip", "EffectScope", "ScopeLine"].includes(constructed.kind))
        issues.push(`${location(file, node)} manual ${constructed.kind}`);
      if (node.type !== "JSXOpeningElement") return;
      const name = primitive(file, node) ?? jsxName(node.name);
      if (["AgentsChip", "EffectMarkers", "AgentTimingIcon", "SourceTag", "WhereChip", "EffectScope", "ScopeLine"].includes(name ?? "")) issues.push(`${location(file, node)} manual ${name}`);
      for (const field of ["data-settings-agents", "data-timing-presentation", "data-effect-timing", "data-effect-source", "data-effect-all-hosts", "data-effect-host", "data-effect-scope-marker", "data-effect-card-summary"])
        if (attributes(node).has(field)) issues.push(`${location(file, node)} manual ${field}`);
    });
    for (const file of production) walk(unit(file).ast, node => {
      if (node.type !== "ObjectExpression") return;
      const keys = node.properties.map((entry: Node) => keyName(entry.key));
      if (keys.includes("page") && (keys.includes("Page") || keys.includes("Section")) && keys.includes("agents"))
        issues.push(`${location(file, node)} page/card effect default`);
    });
    expect(issues).toEqual([]);
  });
  it("keeps row effect types mandatory and rejects page/card defaults as a source of timing or scope", () => {
    const issues: string[] = [];
    let effectType: Node | undefined;
    walk(unit(FORM).ast, node => { if (node.type === "TSTypeAliasDeclaration" && node.id.name === "SettingEffect") effectType = node.typeAnnotation; });
    expect(effectType?.type).toBe("TSTypeLiteral");
    for (const field of ["agents", "source"]) {
      const member = effectType?.members.find((entry: Node) => keyName(entry.key) === field);
      expect(member?.optional, field).not.toBe(true);
      const references: string[] = [];
      walk(member?.typeAnnotation, node => { if (node.type === "TSTypeReference") references.push(node.typeName.name); });
      expect(references, field).toContain(field === "agents" ? "SettingsAgents" : "SettingsSource");
    }
    walk(unit(FORM).ast, node => {
      if (node.type !== "FunctionDeclaration" || !node.id || ![...CONTAINERS, ...DECLARATIONS].includes(node.id.name)) return;
      const pattern = node.params[0];
      if (DECLARATIONS.has(node.id.name)) {
        let requiresEffect = false;
        walk(pattern?.typeAnnotation, member => {
          if (member.type === "TSTypeReference" && member.typeName.name === "SettingEffect") requiresEffect = true;
        });
        if (!requiresEffect) issues.push(`${location(FORM, node)} ${node.id.name}: must require the central SettingEffect contract`);
      }
      for (const entry of pattern?.properties ?? []) if (["agents", "source"].includes(keyName(entry.key)) && entry.value?.type === "AssignmentPattern")
        issues.push(`${location(FORM, entry)} ${node.id.name}: effect prop has a default`);
      if (CONTAINERS.has(node.id.name)) walk(node.body, (child, ancestors) => {
        const parent = ancestors.at(-1);
        if (child.type === "Identifier" && ["agents", "source"].includes(child.name)
          && !(parent?.type === "JSXAttribute" && parent.name === child)
          && !(parent?.type === "ObjectProperty" && parent.key === child && !parent.shorthand)
          && !(parent?.type === "MemberExpression" && parent.property === child && !parent.computed))
          issues.push(`${location(FORM, child)} ${node.id.name}: consumes container ${child.name} rather than row metadata`);
      });
    });
    expect(issues).toEqual([]);
  });
  it("requires editable settings-card controls to declare effects directly or through their component, with semantic navigation classified separately", () => {
    expect(customControlAudit().failures).toEqual([]);
  });
});
