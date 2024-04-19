// Adapted from https://github.com/egoist/babel-plugin-eliminator/blob/d29859396b7708b7f7abbacdd951cbbc80902f00/src/index.ts
// Which was originally adapted from https://github.com/vercel/next.js/blob/574fe0b582d5cc1b13663121fd47a3d82deaaa17/packages/next/build/babel/plugins/next-ssg-transform.ts
import type { GeneratorOptions } from "@babel/generator";

import type { BabelTypes, NodePath } from "./babel";
import { parse, traverse, generate, t } from "./babel";

function getIdentifier(
  path: NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ArrowFunctionExpression
  >
): NodePath<BabelTypes.Identifier> | null {
  let parentPath = path.parentPath;
  if (parentPath.type === "VariableDeclarator") {
    let variablePath = parentPath as NodePath<BabelTypes.VariableDeclarator>;
    let name = variablePath.get("id");
    return name.node.type === "Identifier"
      ? (name as NodePath<BabelTypes.Identifier>)
      : null;
  }

  if (parentPath.type === "AssignmentExpression") {
    let variablePath = parentPath as NodePath<BabelTypes.AssignmentExpression>;
    let name = variablePath.get("left");
    return name.node.type === "Identifier"
      ? (name as NodePath<BabelTypes.Identifier>)
      : null;
  }

  if (path.node.type === "ArrowFunctionExpression") {
    return null;
  }

  return path.node.id && path.node.id.type === "Identifier"
    ? (path.get("id") as NodePath<BabelTypes.Identifier>)
    : null;
}

function isIdentifierReferenced(
  ident: NodePath<BabelTypes.Identifier>
): boolean {
  let binding = ident.scope.getBinding(ident.node.name);
  if (binding?.referenced) {
    // Functions can reference themselves, so we need to check if there's a
    // binding outside the function scope or not.
    if (binding.path.type === "FunctionDeclaration") {
      return !binding.constantViolations
        .concat(binding.referencePaths)
        // Check that every reference is contained within the function:
        .every((ref) => ref.findParent((parent) => parent === binding?.path));
    }

    return true;
  }
  return false;
}

export const removeExports = (
  source: string,
  exportsToRemove: string[],
  generateOptions: GeneratorOptions = {}
) => {
  let document = parse(source, { sourceType: "module" });

  let referencedIdentifiers = new Set<NodePath<BabelTypes.Identifier>>();
  let removedExports = new Set<string>();

  let markImport = (
    path: NodePath<
      | BabelTypes.ImportSpecifier
      | BabelTypes.ImportDefaultSpecifier
      | BabelTypes.ImportNamespaceSpecifier
    >
  ) => {
    let local = path.get("local");
    if (isIdentifierReferenced(local)) {
      referencedIdentifiers.add(local);
    }
  };

  let markFunction = (
    path: NodePath<
      | BabelTypes.FunctionDeclaration
      | BabelTypes.FunctionExpression
      | BabelTypes.ArrowFunctionExpression
    >
  ) => {
    let identifier = getIdentifier(path);
    if (identifier?.node && isIdentifierReferenced(identifier)) {
      referencedIdentifiers.add(identifier);
    }
  };

  traverse(document, {
    VariableDeclarator(variablePath) {
      if (variablePath.node.id.type === "Identifier") {
        let local = variablePath.get("id") as NodePath<BabelTypes.Identifier>;
        if (isIdentifierReferenced(local)) {
          referencedIdentifiers.add(local);
        }
      } else if (variablePath.node.id.type === "ObjectPattern") {
        let pattern = variablePath.get(
          "id"
        ) as NodePath<BabelTypes.ObjectPattern>;

        let properties = pattern.get("properties");
        properties.forEach((p) => {
          let local = p.get(
            p.node.type === "ObjectProperty"
              ? "value"
              : p.node.type === "RestElement"
              ? "argument"
              : (function () {
                  throw new Error("invariant");
                })()
          ) as NodePath<BabelTypes.Identifier>;
          if (isIdentifierReferenced(local)) {
            referencedIdentifiers.add(local);
          }
        });
      } else if (variablePath.node.id.type === "ArrayPattern") {
        let pattern = variablePath.get(
          "id"
        ) as NodePath<BabelTypes.ArrayPattern>;

        let elements = pattern.get("elements");
        elements.forEach((element) => {
          let local: NodePath<BabelTypes.Identifier>;
          if (element.node?.type === "Identifier") {
            local = element as NodePath<BabelTypes.Identifier>;
          } else if (element.node?.type === "RestElement") {
            local = element.get("argument") as NodePath<BabelTypes.Identifier>;
          } else {
            return;
          }

          if (isIdentifierReferenced(local)) {
            referencedIdentifiers.add(local);
          }
        });
      }
    },

    FunctionDeclaration: markFunction,
    FunctionExpression: markFunction,
    ArrowFunctionExpression: markFunction,
    ImportSpecifier: markImport,
    ImportDefaultSpecifier: markImport,
    ImportNamespaceSpecifier: markImport,

    ExportNamedDeclaration(path) {
      let shouldRemove = false;

      // Handle re-exports: export { preload } from './foo'
      path.node.specifiers = path.node.specifiers.filter((spec) => {
        if (spec.exported.type !== "Identifier") {
          return true;
        }

        let { name } = spec.exported;
        for (let namedExport of exportsToRemove) {
          if (name === namedExport) {
            removedExports.add(namedExport);
            return false;
          }
        }

        return true;
      });

      let { declaration } = path.node;

      // When no re-exports are left, remove the path
      if (!declaration && path.node.specifiers.length === 0) {
        shouldRemove = true;
      }

      if (declaration && declaration.type === "VariableDeclaration") {
        declaration.declarations = declaration.declarations.filter(
          (declarator: BabelTypes.VariableDeclarator) => {
            for (let name of exportsToRemove) {
              if ((declarator.id as BabelTypes.Identifier).name === name) {
                removedExports.add(name);
                return false;
              }
            }
            return true;
          }
        );
        if (declaration.declarations.length === 0) {
          shouldRemove = true;
        }
      }

      if (declaration && declaration.type === "FunctionDeclaration") {
        for (let name of exportsToRemove) {
          if (declaration.id?.name === name) {
            shouldRemove = true;
            removedExports.add(name);
          }
        }
      }

      if (shouldRemove) {
        path.remove();
      }
    },
    ExportDefaultDeclaration(path) {
      if (exportsToRemove.includes("default")) {
        removedExports.add("default");
        path.remove();
        return false;
      }
    },
  });

  if (removedExports.size === 0) {
    // No server-specific exports found so there's
    // no need to remove unused references
    return generate(document, generateOptions);
  }

  let referencesRemovedInThisPass: number;

  let sweepFunction = (
    path: NodePath<
      | BabelTypes.FunctionDeclaration
      | BabelTypes.FunctionExpression
      | BabelTypes.ArrowFunctionExpression
    >
  ) => {
    let identifier = getIdentifier(path);
    if (
      identifier?.node &&
      referencedIdentifiers.has(identifier) &&
      !isIdentifierReferenced(identifier)
    ) {
      ++referencesRemovedInThisPass;

      if (
        t.isAssignmentExpression(path.parentPath.node) ||
        t.isVariableDeclarator(path.parentPath.node)
      ) {
        path.parentPath.remove();
      } else {
        path.remove();
      }
    }
  };

  let sweepImport = (
    path: NodePath<
      | BabelTypes.ImportSpecifier
      | BabelTypes.ImportDefaultSpecifier
      | BabelTypes.ImportNamespaceSpecifier
    >
  ) => {
    let local = path.get("local");
    if (referencedIdentifiers.has(local) && !isIdentifierReferenced(local)) {
      ++referencesRemovedInThisPass;
      path.remove();
      if (
        (path.parent as BabelTypes.ImportDeclaration).specifiers.length === 0
      ) {
        path.parentPath.remove();
      }
    }
  };

  // Traverse again to remove unused references. This happens at least once,
  // then repeats until no more references are removed.
  do {
    referencesRemovedInThisPass = 0;

    traverse(document, {
      Program(path) {
        path.scope.crawl();
      },
      // eslint-disable-next-line no-loop-func
      VariableDeclarator(variablePath) {
        if (variablePath.node.id.type === "Identifier") {
          let local = variablePath.get("id") as NodePath<BabelTypes.Identifier>;
          if (
            referencedIdentifiers.has(local) &&
            !isIdentifierReferenced(local)
          ) {
            ++referencesRemovedInThisPass;
            variablePath.remove();
          }
        } else if (variablePath.node.id.type === "ObjectPattern") {
          let pattern = variablePath.get(
            "id"
          ) as NodePath<BabelTypes.ObjectPattern>;

          let beforeCount = referencesRemovedInThisPass;
          let properties = pattern.get("properties");
          properties.forEach((property) => {
            let local = property.get(
              property.node.type === "ObjectProperty"
                ? "value"
                : property.node.type === "RestElement"
                ? "argument"
                : (function () {
                    throw new Error("invariant");
                  })()
            ) as NodePath<BabelTypes.Identifier>;

            if (
              referencedIdentifiers.has(local) &&
              !isIdentifierReferenced(local)
            ) {
              ++referencesRemovedInThisPass;
              property.remove();
            }
          });

          if (
            beforeCount !== referencesRemovedInThisPass &&
            pattern.get("properties").length < 1
          ) {
            variablePath.remove();
          }
        } else if (variablePath.node.id.type === "ArrayPattern") {
          let pattern = variablePath.get(
            "id"
          ) as NodePath<BabelTypes.ArrayPattern>;

          let beforeCount = referencesRemovedInThisPass;
          let elements = pattern.get("elements");
          elements.forEach((e) => {
            let local: NodePath<BabelTypes.Identifier>;
            if (e.node?.type === "Identifier") {
              local = e as NodePath<BabelTypes.Identifier>;
            } else if (e.node?.type === "RestElement") {
              local = e.get("argument") as NodePath<BabelTypes.Identifier>;
            } else {
              return;
            }

            if (
              referencedIdentifiers.has(local) &&
              !isIdentifierReferenced(local)
            ) {
              ++referencesRemovedInThisPass;
              e.remove();
            }
          });

          if (
            beforeCount !== referencesRemovedInThisPass &&
            pattern.get("elements").length < 1
          ) {
            variablePath.remove();
          }
        }
      },
      FunctionDeclaration: sweepFunction,
      FunctionExpression: sweepFunction,
      ArrowFunctionExpression: sweepFunction,
      ImportSpecifier: sweepImport,
      ImportDefaultSpecifier: sweepImport,
      ImportNamespaceSpecifier: sweepImport,
    });
  } while (referencesRemovedInThisPass);

  return {
    code:
      generate(document, generateOptions).code +
      `\n${[...removedExports]
        .map((exp) =>
          exp === "default" ? "export default 1;" : `export const ${exp} = 1;`
        )
        .join("\n")}`,
  };
};
