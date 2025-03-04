import type { GeneratorOptions, GeneratorResult } from "@babel/generator";
import invariant from "../invariant";
import { type Cache, getOrSetFromCache } from "./cache";
import {
  type Babel,
  type NodePath,
  parse,
  traverse,
  generate,
  t,
} from "./babel";

type ExportDeclaration = Babel.ExportDeclaration;
type Identifier = Babel.Identifier;
type Pattern = Babel.Pattern;
type Statement = Babel.Statement;
type VariableDeclarator = Babel.VariableDeclarator;

type ExportDependencies = Map<string, Dependencies>;

type Dependencies = {
  topLevelStatements: Set<Statement>;
  topLevelNonModuleStatements: Set<Statement>;
  importedIdentifierNames: Set<string>;
  exportedVariableDeclarators: Set<VariableDeclarator>;
};

function codeToAst(code: string, cache: Cache, cacheKey: string): Babel.File {
  // We use structuredClone to allow AST mutation without modifying the cache.
  return structuredClone(
    getOrSetFromCache(cache, `${cacheKey}::codeToAst`, code, () =>
      parse(code, { sourceType: "module" })
    )
  );
}

function assertNodePath(
  path: NodePath | NodePath[] | null | undefined
): asserts path is NodePath {
  invariant(
    path && !Array.isArray(path),
    `Expected a Path, but got ${Array.isArray(path) ? "an array" : path}`
  );
}

function assertNodePathIsStatement(
  path: NodePath | NodePath[] | null | undefined
): asserts path is NodePath<Statement> {
  invariant(
    path && !Array.isArray(path) && t.isStatement(path.node),
    `Expected a Statement path, but got ${
      Array.isArray(path) ? "an array" : path?.node?.type
    }`
  );
}

function assertNodePathIsVariableDeclarator(
  path: NodePath | NodePath[] | null | undefined
): asserts path is NodePath<VariableDeclarator> {
  invariant(
    path && !Array.isArray(path) && t.isVariableDeclarator(path.node),
    `Expected an Identifier path, but got ${
      Array.isArray(path) ? "an array" : path?.node?.type
    }`
  );
}

function assertNodePathIsPattern(
  path: NodePath | NodePath[] | null | undefined
): asserts path is NodePath<Pattern> {
  invariant(
    path && !Array.isArray(path) && t.isPattern(path.node),
    `Expected a Pattern path, but got ${
      Array.isArray(path) ? "an array" : path?.node?.type
    }`
  );
}

function getExportDependencies(
  code: string,
  cache: Cache,
  cacheKey: string
): ExportDependencies {
  return getOrSetFromCache(
    cache,
    `${cacheKey}::getExportDependencies`,
    code,
    () => {
      let exportDependencies: ExportDependencies = new Map();
      let ast = codeToAst(code, cache, cacheKey);

      function handleExport(
        exportName: string,
        exportPath: NodePath<ExportDeclaration>,
        identifiersPath: NodePath = exportPath
      ) {
        let identifiers = getDependentIdentifiersForPath(identifiersPath);

        let topLevelStatements = new Set([
          exportPath.node,
          ...getTopLevelStatementsForPaths(identifiers),
        ]);

        // We also keep track of non-import statements since import statements
        // get more fine-grained filtering, meaning that we often need to
        // exclude import statements in our chunking logic.
        let topLevelNonModuleStatements = new Set(
          Array.from(topLevelStatements).filter(
            (statement) =>
              !t.isImportDeclaration(statement) &&
              !t.isExportDeclaration(statement)
          )
        );

        // We keep track of imported identifiers for each export since we
        // perform more fine-grained filtering on import statements.
        let importedIdentifierNames = new Set<string>();
        for (let identifier of identifiers) {
          if (identifier.parentPath.parentPath?.isImportDeclaration()) {
            importedIdentifierNames.add(identifier.node.name);
          }
        }

        // We keep track of variable declarators for each export since we
        // perform more fine-grained filtering on export statements.
        let exportedVariableDeclarators = new Set<VariableDeclarator>();
        for (let identifier of identifiers) {
          // export const foo = ...;
          if (
            identifier.parentPath.isVariableDeclarator() &&
            identifier.parentPath.parentPath.parentPath?.isExportNamedDeclaration()
          ) {
            exportedVariableDeclarators.add(identifier.parentPath.node);
            continue;
          }

          // export const { foo } = ...;
          let isWithinExportDestructuring = Boolean(
            identifier.findParent((path) =>
              Boolean(
                path.isPattern() &&
                  path.parentPath?.isVariableDeclarator() &&
                  path.parentPath.parentPath?.parentPath?.isExportNamedDeclaration()
              )
            )
          );
          if (isWithinExportDestructuring) {
            let currentPath: NodePath | null = identifier;
            while (currentPath) {
              if (
                // Check the identifier is within a variable declaration, and if
                // so, ensure we're on the left-hand side of the expression
                // since these identifiers are what make up the export names,
                // e.g. export const { foo } = { foo: bar }; should pick up
                // `foo` but not `bar`.
                currentPath.parentPath?.isVariableDeclarator() &&
                currentPath.parentKey === "id"
              ) {
                exportedVariableDeclarators.add(currentPath.parentPath.node);
                break;
              }
              currentPath = currentPath.parentPath;
            }
          }
        }

        let dependencies: Dependencies = {
          topLevelStatements,
          topLevelNonModuleStatements,
          importedIdentifierNames,
          exportedVariableDeclarators,
        };

        exportDependencies.set(exportName, dependencies);
      }

      traverse(ast, {
        ExportDeclaration(exportPath) {
          let { node } = exportPath;

          // export * from "./module"
          if (t.isExportAllDeclaration(node)) {
            return;
          }

          // export default ...;
          if (t.isExportDefaultDeclaration(node)) {
            handleExport("default", exportPath);
            return;
          }

          let { declaration } = node;

          // export const foo = ..., { bar } = ...;
          if (t.isVariableDeclaration(declaration)) {
            let { declarations } = declaration;
            for (let i = 0; i < declarations.length; i++) {
              let declarator = declarations[i];

              // export const foo = ...;
              if (t.isIdentifier(declarator.id)) {
                let declaratorPath = exportPath.get(
                  `declaration.declarations.${i}`
                );

                assertNodePathIsVariableDeclarator(declaratorPath);

                handleExport(declarator.id.name, exportPath, declaratorPath);
                continue;
              }

              // export const { foo } = ...;
              if (t.isPattern(declarator.id)) {
                let exportedPatternPath = exportPath.get(
                  `declaration.declarations.${i}.id`
                );

                assertNodePathIsPattern(exportedPatternPath);

                let identifiers =
                  getIdentifiersForPatternPath(exportedPatternPath);

                for (let identifier of identifiers) {
                  handleExport(identifier.node.name, exportPath, identifier);
                }
              }
            }

            return;
          }

          // export function foo() {}
          // export class Foo {}
          if (
            t.isFunctionDeclaration(declaration) ||
            t.isClassDeclaration(declaration)
          ) {
            invariant(
              declaration.id,
              "Expected exported function or class declaration to have a name when not the default export"
            );
            handleExport(declaration.id.name, exportPath);
            return;
          }

          // export { foo, bar }
          if (t.isExportNamedDeclaration(node)) {
            for (let specifier of node.specifiers) {
              if (t.isIdentifier(specifier.exported)) {
                let name = specifier.exported.name;
                let specifierPath = exportPath
                  .get("specifiers")
                  .find((path) => path.node === specifier);

                invariant(
                  specifierPath,
                  `Expected to find specifier path for ${name}`
                );

                handleExport(name, exportPath, specifierPath);
              }
            }
            return;
          }

          // This should never happen:
          // @ts-expect-error: We've handled all the export types
          throw new Error(`Unknown export node type: ${node.type}`);
        },
      });

      return exportDependencies;
    }
  );
}

function getDependentIdentifiersForPath(
  path: NodePath,
  state?: { visited: Set<NodePath>; identifiers: Set<NodePath<Identifier>> }
): Set<NodePath<Identifier>> {
  let { visited, identifiers } = state ?? {
    visited: new Set(),
    identifiers: new Set(),
  };

  // Ensure we don't recurse indefinitely
  if (visited.has(path)) {
    return identifiers;
  }

  visited.add(path);

  // Recursively traverse the AST to find all identifiers the path depends on.
  path.traverse({
    Identifier(path) {
      // We can skip all of this work if we've already processed this identifier.
      if (identifiers.has(path)) {
        return;
      }

      identifiers.add(path);

      let binding = path.scope.getBinding(path.node.name);

      if (!binding) {
        return;
      }

      getDependentIdentifiersForPath(binding.path, { visited, identifiers });

      // Trace all references to the identifier
      for (let reference of binding.referencePaths) {
        // Each export declaration is handled separately in our chunking logic
        // so we don't want to trace the entire export statement, otherwise all
        // identifiers in the export statement will be marked as dependencies
        // and we won't be able to split chunks sharing this export statement.
        if (reference.isExportNamedDeclaration()) {
          continue;
        }

        getDependentIdentifiersForPath(reference, {
          visited,
          identifiers,
        });
      }

      // For completeness we also want to trace constant violations since, even
      // though the code results in a runtime error, it still compiles.
      for (let constantViolation of binding.constantViolations) {
        getDependentIdentifiersForPath(constantViolation, {
          visited,
          identifiers,
        });
      }
    },
  });

  let topLevelStatement = getTopLevelStatementPathForPath(path);
  let withinImportStatement = topLevelStatement.isImportDeclaration();
  let withinExportStatement = topLevelStatement.isExportDeclaration();

  // Include all identifiers in the top-level statement as dependencies, except
  // for import/export statements since they have more fine-grained filtering.
  if (!withinImportStatement && !withinExportStatement) {
    getDependentIdentifiersForPath(topLevelStatement, {
      visited,
      identifiers,
    });
  }

  // Destructuring assignments in export statements have more fine-grained
  // filtering, so we include all identifiers in the expression as dependencies.
  if (
    withinExportStatement &&
    path.isIdentifier() &&
    (t.isPattern(path.parentPath.node) || // [foo]
      t.isPattern(path.parentPath.parentPath?.node)) // {nested: foo}
  ) {
    // Find the root `const foo = ...` within `export const foo = ...`.
    let variableDeclarator = path.findParent((p) => p.isVariableDeclarator());
    assertNodePath(variableDeclarator);

    getDependentIdentifiersForPath(variableDeclarator, {
      visited,
      identifiers,
    });
  }

  return identifiers;
}

function getTopLevelStatementPathForPath(path: NodePath): NodePath<Statement> {
  let ancestry = path.getAncestry();

  // The last node is the Program node so we want the ancestor before that.
  let topLevelStatement = ancestry[ancestry.length - 2];
  assertNodePathIsStatement(topLevelStatement);

  return topLevelStatement;
}

function getTopLevelStatementsForPaths(paths: Set<NodePath>): Set<Statement> {
  let topLevelStatements = new Set<Statement>();

  for (let path of paths) {
    let topLevelStatement = getTopLevelStatementPathForPath(path);
    topLevelStatements.add(topLevelStatement.node);
  }

  return topLevelStatements;
}

function getIdentifiersForPatternPath(
  patternPath: NodePath<Pattern>,
  identifiers: Set<NodePath<Identifier>> = new Set()
): Set<NodePath<Identifier>> {
  function walk(currentPath: NodePath) {
    if (currentPath.isIdentifier()) {
      identifiers.add(currentPath);
      return;
    }

    if (currentPath.isObjectPattern()) {
      let { properties } = currentPath.node;
      for (let i = 0; i < properties.length; i++) {
        const property = properties[i];
        if (t.isObjectProperty(property)) {
          let valuePath = currentPath.get(`properties.${i}.value`);
          assertNodePath(valuePath);
          walk(valuePath);
        } else if (t.isRestElement(property)) {
          let argumentPath = currentPath.get(`properties.${i}.argument`);
          assertNodePath(argumentPath);
          walk(argumentPath);
        }
      }
    } else if (currentPath.isArrayPattern()) {
      let { elements } = currentPath.node;
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element) {
          let elementPath = currentPath.get(`elements.${i}`);
          assertNodePath(elementPath);
          walk(elementPath);
        }
      }
    } else if (currentPath.isRestElement()) {
      let argumentPath = currentPath.get("argument");
      assertNodePath(argumentPath);
      walk(argumentPath);
    }
  }

  walk(patternPath);
  return identifiers;
}

const getExportedName = (exported: t.Identifier | t.StringLiteral): string => {
  return t.isIdentifier(exported) ? exported.name : exported.value;
};

function setsIntersect(set1: Set<any>, set2: Set<any>): boolean {
  // To optimize the check, we always iterate over the smaller set.
  let smallerSet = set1;
  let largerSet = set2;
  if (set1.size > set2.size) {
    smallerSet = set2;
    largerSet = set1;
  }

  for (let element of smallerSet) {
    if (largerSet.has(element)) {
      return true;
    }
  }

  return false;
}

export function hasChunkableExport(
  code: string,
  exportName: string,
  cache: Cache,
  cacheKey: string
): boolean {
  return getOrSetFromCache(
    cache,
    `${cacheKey}::hasChunkableExport::${exportName}`,
    code,
    () => {
      let exportDependencies = getExportDependencies(code, cache, cacheKey);
      let dependencies = exportDependencies.get(exportName);

      // If there are no dependencies, the export wasn't found in the file.
      if (!dependencies) {
        return false;
      }

      // Loop through all other exports to see if they have top level non-import
      // statements in common with the export we're trying to chunk.
      for (let [currentExportName, currentDependencies] of exportDependencies) {
        if (currentExportName === exportName) {
          continue;
        }

        // As soon as we find any top level non-import statements in common with
        // another export, we know this export cannot be placed in its own
        // chunk. The reason import statements aren't factored into this check
        // is because we perform more fine-grained optimizations on them,
        // filtering out all unused imports within each chunk, meaning that it's
        // okay for multiple exports to share an import statement. We perform a
        // deeper check on imported identifiers in the step after this.
        if (
          setsIntersect(
            currentDependencies.topLevelNonModuleStatements,
            dependencies.topLevelNonModuleStatements
          )
        ) {
          return false;
        }
      }

      // If the export we're trying to chunk depends on more than one exported
      // variable declarator (where one of them might be the chunked export
      // itself), it means it must depend on other exports and can't be chunked,
      // so we can bail out early before comparing against other exports.
      if (dependencies.exportedVariableDeclarators.size > 1) {
        return false;
      }

      // Loop through all other exports to see if they depend on the export
      // we're trying to chunk.
      if (dependencies.exportedVariableDeclarators.size > 0) {
        for (let [
          currentExportName,
          currentDependencies,
        ] of exportDependencies) {
          if (currentExportName === exportName) {
            continue;
          }

          // As soon as we find any exported variable declarators in common with
          // another export, we know this export cannot be placed in its own
          // chunk. Note that the chunk can still share top level export
          // statements with other exports because we filter out all unused
          // exports, so we can treat each exported variable name as a separate
          // entity in this check.
          if (
            setsIntersect(
              currentDependencies.exportedVariableDeclarators,
              dependencies.exportedVariableDeclarators
            )
          ) {
            return false;
          }
        }
      }

      return true;
    }
  );
}

export function getChunkedExport(
  code: string,
  exportName: string,
  generateOptions: GeneratorOptions = {},
  cache: Cache,
  cacheKey: string
): GeneratorResult | undefined {
  return getOrSetFromCache(
    cache,
    `${cacheKey}::getChunkedExport::${exportName}::${JSON.stringify(
      generateOptions
    )}`,
    code,
    () => {
      // If we already know the export isn't chunkable, we can bail out early.
      if (!hasChunkableExport(code, exportName, cache, cacheKey)) {
        return undefined;
      }

      let exportDependencies = getExportDependencies(code, cache, cacheKey);
      let dependencies = exportDependencies.get(exportName);
      invariant(dependencies, "Expected export to have dependencies");

      let topLevelStatementsArray = Array.from(dependencies.topLevelStatements);
      let exportedVariableDeclaratorsArray = Array.from(
        dependencies.exportedVariableDeclarators
      );

      let ast = codeToAst(code, cache, cacheKey);

      // Filter the AST body to only include statements that are part of the
      // chunked export's dependencies. Note that since we bailed out early if
      // the export isn't chunkable, we can now simply remove any unused imports
      // and top-level statements.
      ast.program.body = ast.program.body
        .filter((node) =>
          topLevelStatementsArray.some((statement) =>
            t.isNodesEquivalent(node, statement)
          )
        )
        // Remove unused imports
        .map((node) => {
          // Skip non-import nodes for this step, return node as-is
          if (!t.isImportDeclaration(node)) {
            return node;
          }

          // If the chunked export doesn't depend on any imported identifiers,
          // we know it can't contain any imports statements, so we remove it.
          if (dependencies.importedIdentifierNames.size === 0) {
            return null;
          }

          // Filter out unused import specifiers. Note that this handles
          // default imports, named imports, and namespace imports.
          node.specifiers = node.specifiers.filter((specifier) =>
            dependencies.importedIdentifierNames.has(specifier.local.name)
          );

          // Ensure we haven't removed all specifiers. If we have, it means
          // our dependency analysis is incorrect.
          invariant(
            node.specifiers.length > 0,
            "Expected import statement to have used specifiers"
          );

          // Keep the modified AST node
          return node;
        })
        // Filter export statements
        .map((node) => {
          // Skip non-export nodes for this step, return node as-is
          if (!t.isExportDeclaration(node)) {
            return node;
          }

          // `export * from "./module";
          // Not chunkable, always remove within chunks.
          if (t.isExportAllDeclaration(node)) {
            return null;
          }

          // export default ...;
          // If we're chunking the default export, keep it,
          // otherwise remove it.
          if (t.isExportDefaultDeclaration(node)) {
            return exportName === "default" ? node : null;
          }

          let { declaration } = node;

          // export const foo = ..., { bar } = ...;
          if (t.isVariableDeclaration(declaration)) {
            // Only keep variable declarators for the chunked export
            declaration.declarations = declaration.declarations.filter((node) =>
              exportedVariableDeclaratorsArray.some((declarator) =>
                t.isNodesEquivalent(node, declarator)
              )
            );

            // If the export statement is now empty, remove it
            if (declaration.declarations.length === 0) {
              return null;
            }

            // Keep the modified AST node
            return node;
          }

          // export function foo() {}
          // export class Foo {}
          if (
            t.isFunctionDeclaration(node.declaration) ||
            t.isClassDeclaration(node.declaration)
          ) {
            // If the function/class name matches the export name, keep the
            // node, otherwise remove it.
            return node.declaration.id?.name === exportName ? node : null;
          }

          // export { foo, bar }
          if (t.isExportNamedDeclaration(node)) {
            // export {}
            // Remove empty export statements within chunks
            if (node.specifiers.length === 0) {
              return null;
            }

            // Only keep specifiers for the chunked export
            node.specifiers = node.specifiers.filter(
              (specifier) => getExportedName(specifier.exported) === exportName
            );

            // If the export statement is now empty, remove it
            if (node.specifiers.length === 0) {
              return null;
            }

            // Keep the modified AST node
            return node;
          }

          // This should never happen:
          // @ts-expect-error: We've handled all the export types
          throw new Error(`Unknown export node type: ${node.type}`);
        })
        .filter((node): node is NonNullable<typeof node> => node !== null);

      return generate(ast, generateOptions);
    }
  );
}

export function omitChunkedExports(
  code: string,
  exportNames: readonly string[],
  generateOptions: GeneratorOptions = {},
  cache: Cache,
  cacheKey: string
): GeneratorResult | undefined {
  return getOrSetFromCache(
    cache,
    `${cacheKey}::omitChunkedExports::${exportNames.join(
      ","
    )}::${JSON.stringify(generateOptions)}`,
    code,
    () => {
      const isChunkable = (exportName: string): boolean =>
        hasChunkableExport(code, exportName, cache, cacheKey);

      const isOmitted = (exportName: string): boolean =>
        exportNames.includes(exportName) && isChunkable(exportName);

      const isRetained = (exportName: string): boolean =>
        !isOmitted(exportName);

      let exportDependencies = getExportDependencies(code, cache, cacheKey);

      let allExportNames = Array.from(exportDependencies.keys());
      let omittedExportNames = allExportNames.filter(isOmitted);
      let retainedExportNames = allExportNames.filter(isRetained);

      let omittedStatements = new Set<Statement>();
      let omittedExportedVariableDeclarators = new Set<VariableDeclarator>();

      for (let omittedExportName of omittedExportNames) {
        let dependencies = exportDependencies.get(omittedExportName);

        invariant(
          dependencies,
          `Expected dependencies for ${omittedExportName}`
        );

        // Now that we know the export is chunkable, add all of its top level
        // non-module statements to the set of statements to be omitted from the
        // main chunk. Note that we don't include top level module statements in
        // this step because we perform more fine-grained filtering of module
        // statements below.
        for (let statement of dependencies.topLevelNonModuleStatements) {
          omittedStatements.add(statement);
        }

        // We also want to omit any exported variable declarators that belong to
        // the chunked export.
        for (let declarator of dependencies.exportedVariableDeclarators) {
          omittedExportedVariableDeclarators.add(declarator);
        }
      }

      let ast = codeToAst(code, cache, cacheKey);

      let omittedStatementsArray = Array.from(omittedStatements);
      let omittedExportedVariableDeclaratorsArray = Array.from(
        omittedExportedVariableDeclarators
      );

      ast.program.body = ast.program.body
        // Remove top level statements that belong solely to the chunked
        // exports that are being omitted.
        .filter((node) =>
          omittedStatementsArray.every(
            (statement) => !t.isNodesEquivalent(node, statement)
          )
        )
        // Remove unused imports.
        .map((node): Statement | null => {
          // Skip non-import nodes for this step, return node as-is
          if (!t.isImportDeclaration(node)) {
            return node;
          }

          // If there are no specifiers, this is a side effect import. Side
          // effects implicitly belong to the main chunk, so we leave them.
          if (node.specifiers.length === 0) {
            return node;
          }

          // Remove import specifiers that are only used by the omitted chunks.
          // This ensures only the necessary imports remain in the main chunk.
          node.specifiers = node.specifiers.filter((specifier) => {
            let importedName = specifier.local.name;

            // Keep the import specifier if it's depended on by any of the
            // retained exports.
            for (let retainedExportName of retainedExportNames) {
              let dependencies = exportDependencies.get(retainedExportName);
              if (dependencies?.importedIdentifierNames?.has(importedName)) {
                return true;
              }
            }

            // Now that we've bailed out early and kept the import specifier if
            // any retained exports depend on it, remove the import specifier if
            // it's depended on by any of the omitted exports.
            for (let omittedExportName of omittedExportNames) {
              let dependencies = exportDependencies.get(omittedExportName);
              if (dependencies?.importedIdentifierNames?.has(importedName)) {
                return false;
              }
            }

            // Keep the import specifier if it isn't depended on by any export.
            return true;
          });

          // If the import statement is now empty, remove it
          if (node.specifiers.length === 0) {
            return null;
          }

          // Keep the modified AST node
          return node;
        })
        // Filter out omitted exports and remove unused identifiers
        .map((node): Statement | null => {
          // Skip non-export nodes for this step, return node as-is
          if (!t.isExportDeclaration(node)) {
            return node;
          }

          // The main chunk should include all "export *" declarations
          if (t.isExportAllDeclaration(node)) {
            return node;
          }

          // export default ...;
          if (t.isExportDefaultDeclaration(node)) {
            return isOmitted("default") ? null : node;
          }

          // export const foo = ..., { bar } = ...;
          if (t.isVariableDeclaration(node.declaration)) {
            // Remove any omitted exported variable declarators
            node.declaration.declarations =
              node.declaration.declarations.filter((node) =>
                omittedExportedVariableDeclaratorsArray.every(
                  (declarator) => !t.isNodesEquivalent(node, declarator)
                )
              );

            // If the export statement is now empty, remove it
            if (node.declaration.declarations.length === 0) {
              return null;
            }

            // Keep the modified AST node
            return node;
          }

          // export function foo() {}
          // export class foo {}
          if (
            t.isFunctionDeclaration(node.declaration) ||
            t.isClassDeclaration(node.declaration)
          ) {
            invariant(
              node.declaration.id,
              "Expected exported function or class declaration to have a name when not the default export"
            );
            return isOmitted(node.declaration.id.name) ? null : node;
          }

          // export { foo, bar }
          if (t.isExportNamedDeclaration(node)) {
            // export {}
            // Keep empty export statements in main chunk
            if (node.specifiers.length === 0) {
              return node;
            }

            // Remove omitted export specifiers
            node.specifiers = node.specifiers.filter((specifier) => {
              const exportedName = getExportedName(specifier.exported);
              return !isOmitted(exportedName);
            });

            // If the export statement is now empty, remove it
            if (node.specifiers.length === 0) {
              return null;
            }

            // Keep the modified AST node
            return node;
          }

          // This should never happen:
          // @ts-expect-error: We've handled all the export types
          throw new Error(`Unknown node type: ${node.type}`);
        })
        // Filter out statements that were entirely omitted above.
        .filter((node): node is NonNullable<typeof node> => node !== null);

      if (ast.program.body.length === 0) {
        return undefined;
      }

      return generate(ast, generateOptions);
    }
  );
}

export function detectRouteChunks(
  code: string,
  cache: Cache,
  cacheKey: string
): {
  hasRouteChunks: boolean;
  hasRouteChunkByExportName: Record<RouteChunkExportName, boolean>;
  chunkedExports: RouteChunkExportName[];
} {
  const hasRouteChunkByExportName = Object.fromEntries(
    routeChunkExportNames.map((exportName) => [
      exportName,
      hasChunkableExport(code, exportName, cache, cacheKey),
    ])
  ) as Record<RouteChunkExportName, boolean>;

  const chunkedExports = Object.entries(hasRouteChunkByExportName)
    .filter(([, isChunked]) => isChunked)
    .map(([exportName]) => exportName as RouteChunkExportName);

  const hasRouteChunks = chunkedExports.length > 0;

  return {
    hasRouteChunks,
    hasRouteChunkByExportName,
    chunkedExports,
  };
}

export const routeChunkExportNames = [
  "clientAction",
  "clientLoader",
  "unstable_clientMiddleware",
  "HydrateFallback",
] as const;
export type RouteChunkExportName = (typeof routeChunkExportNames)[number];

const mainChunkName = "main" as const;
export const routeChunkNames = ["main", ...routeChunkExportNames] as const;
export type RouteChunkName = (typeof routeChunkNames)[number];

export function getRouteChunkCode(
  code: string,
  chunkName: RouteChunkName,
  cache: Cache,
  cacheKey: string
): GeneratorResult | undefined {
  if (chunkName === mainChunkName) {
    return omitChunkedExports(code, routeChunkExportNames, {}, cache, cacheKey);
  }

  return getChunkedExport(code, chunkName, {}, cache, cacheKey);
}

const routeChunkQueryStringPrefix = "?route-chunk=";
type RouteChunkQueryString =
  `${typeof routeChunkQueryStringPrefix}${RouteChunkName}`;

const routeChunkQueryStrings: Record<RouteChunkName, RouteChunkQueryString> = {
  main: `${routeChunkQueryStringPrefix}main`,
  clientAction: `${routeChunkQueryStringPrefix}clientAction`,
  clientLoader: `${routeChunkQueryStringPrefix}clientLoader`,
  unstable_clientMiddleware: `${routeChunkQueryStringPrefix}unstable_clientMiddleware`,
  HydrateFallback: `${routeChunkQueryStringPrefix}HydrateFallback`,
};

export function getRouteChunkModuleId(
  filePath: string,
  chunkName: RouteChunkName
): string {
  return `${filePath}${routeChunkQueryStrings[chunkName]}`;
}

export function isRouteChunkModuleId(id: string): boolean {
  return Object.values(routeChunkQueryStrings).some((queryString) =>
    id.endsWith(queryString)
  );
}

function isRouteChunkName(name: string): name is RouteChunkName {
  return name === mainChunkName || routeChunkExportNames.includes(name as any);
}

export function getRouteChunkNameFromModuleId(
  id: string
): RouteChunkName | null {
  if (!isRouteChunkModuleId(id)) {
    return null;
  }

  let chunkName = id.split(routeChunkQueryStringPrefix)[1].split("&")[0];

  if (!isRouteChunkName(chunkName)) {
    return null;
  }

  return chunkName;
}
