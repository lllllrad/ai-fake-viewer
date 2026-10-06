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

// Enforce reconstructed boundaries while legacy modules are replaced incrementally.
for (const [directory, allowed] of [
  ["packages/domain", ["packages/domain"]],
  [
    "packages/application",
    ["packages/domain", "packages/application", "packages/contracts"],
  ],
  ["packages/contracts", ["packages/contracts"]],
] as const) {
  test(`${directory} has no transport, persistence or provider dependencies`, () => {
    for (const file of sources(directory)) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const imports: string[] = [];
      const visit = (node: ts.Node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          imports.push(node.moduleSpecifier.text);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require"))
        ) {
          assert(
            node.arguments.length === 1 &&
              ts.isStringLiteral(node.arguments[0]),
            `${file}: computed imports cannot hide dependencies`,
          );
          imports.push((node.arguments[0] as ts.StringLiteral).text);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const specifier of imports) {
        if (directory === "packages/contracts" && specifier === "zod") continue;
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
