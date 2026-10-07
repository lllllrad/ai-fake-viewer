import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import ts from "typescript";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function dependencies(file: string, source: string) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const literal = (node: ts.Node | undefined) => {
    assert(
      node && ts.isStringLiteral(node),
      `${file}: computed imports cannot hide dependencies`,
    );
    imports.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      literal(node.moduleSpecifier);
    if (ts.isImportTypeNode(node)) {
      assert(
        ts.isLiteralTypeNode(node.argument),
        `${file}: import type must name its dependency`,
      );
      literal(node.argument.literal);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      literal(node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      assert.equal(
        node.arguments.length,
        1,
        `${file}: import requires one literal dependency`,
      );
      literal(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

// Include type-only dependencies: route signatures must not expose concrete database/provider adapters.
for (const [directory, allowed, external] of [
  ["packages/domain", ["packages/domain"], []],
  [
    "packages/application",
    ["packages/domain", "packages/application", "packages/contracts"],
    [],
  ],
  ["packages/contracts", ["packages/contracts"], ["zod"]],
  [
    "apps/server/http/routes",
    ["apps/server/http/routes", "packages/application", "packages/contracts"],
    ["fastify", "zod", "node:stream"],
  ],
] as const) {
  test(`${directory} imports only dependencies permitted by its responsibility`, () => {
    for (const file of sources(directory)) {
      const imports = dependencies(file, readFileSync(file, "utf8"));
      for (const specifier of imports) {
        if ((external as readonly string[]).includes(specifier)) continue;
        assert(
          specifier.startsWith("."),
          `${file}: unexpected external dependency ${specifier}`,
        );
        const destination = relative(
          process.cwd(),
          resolve(dirname(file), specifier),
        );
        assert(
          allowed.some((prefix) => destination.startsWith(`${prefix}/`)),
          `${file}: dependency leaves its boundary: ${specifier}`,
        );
      }
    }
  });
}

test("boundary inspection includes type imports, re-exports and deferred dependencies", () => {
  assert.deepEqual(
    dependencies(
      "fixture.ts",
      `
    import type { A } from "./a.ts";
    export type { B } from "./b.ts";
    type Database = import("node:sqlite").DatabaseSync;
    import client = require("provider-sdk");
    const deferred = import("./deferred.ts");
    const runtime = require("./runtime.ts");
  `,
    ),
    [
      "./a.ts",
      "./b.ts",
      "node:sqlite",
      "provider-sdk",
      "./deferred.ts",
      "./runtime.ts",
    ],
  );
  assert.throws(
    () => dependencies("fixture.ts", "import(providerPath)"),
    /computed imports/,
  );
  assert.throws(
    () => dependencies("fixture.ts", "require(providerPath)"),
    /computed imports/,
  );
});

test("live server static dependencies exclude manual persona authoring and audition generation", () => {
  const visited = new Set<string>();
  const forbidden = new Set([
    resolve("packages/persona/service.ts"),
    resolve("packages/persona/generator.ts"),
    resolve("packages/infrastructure/experiments/interactive.ts"),
    resolve("packages/infrastructure/experiments/models.ts"),
    resolve("apps/experiments/app.ts"),
  ]);
  const visit = (file: string) => {
    assert(
      !forbidden.has(file),
      `Live composition loads authoring module: ${relative(process.cwd(), file)}`,
    );
    if (visited.has(file)) return;
    visited.add(file);
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
        continue;
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
        continue;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
      const specifier = node.moduleSpecifier;
      if (
        !specifier ||
        !ts.isStringLiteral(specifier) ||
        !specifier.text.startsWith(".")
      )
        continue;
      const target = resolve(dirname(file), specifier.text);
      if (target.endsWith(".ts")) visit(target);
    }
  };
  visit(resolve("apps/server/app.ts"));
  assert(visited.has(resolve("packages/infrastructure/cast/runtime.ts")));
});

test("app and host packages cannot import service-owned AI implementations", () => {
  for (const file of [...sources("apps"), ...sources("packages")]) {
    for (const specifier of dependencies(file, readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = relative(process.cwd(), resolve(dirname(file), specifier));
      assert(
        !target.startsWith("services/"),
        `${file} imports AI service implementation: ${specifier}`,
      );
    }
  }
  const registry = readFileSync(
    "packages/application/reactions/pipelines.ts",
    "utf8",
  );
  assert(
    !registry.includes("ConstructorParameters") &&
      !registry.includes("keyof ReactionCoordinator"),
  );
  const host = readFileSync(
    "packages/application/reactions/coordinator.ts",
    "utf8",
  );
  assert(
    !host.includes("generateReviewedDraft") &&
      !host.includes("chooseCastMember"),
  );
});
