// Complements ESLint with the house convention that const exposes an immutable graph.
import ts from "typescript";
import fs from "node:fs";

type Edit = { readonly start: number; readonly end: number; readonly replacement: string };
const shouldFix: boolean = process.argv.includes("--fix");
let configFile: ReturnType<typeof ts.readConfigFile> = ts.readConfigFile("tsconfig.json", (fileName: string): string | undefined =>
  ts.sys.readFile(fileName),
);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const rawConfig: unknown = configFile.config;
if (typeof rawConfig !== "object" || rawConfig === null) throw new Error("Invalid TypeScript configuration");
let parsed: ts.ParsedCommandLine = ts.parseJsonConfigFileContent(rawConfig, ts.sys, ".");
let program: ts.Program = ts.createProgram(parsed.fileNames, parsed.options);
let checker: ts.TypeChecker = program.getTypeChecker();
let failures: string[] = [];
let checkedCount: number = 0;

function isMutableType(type: ts.Type, seen: Set<ts.Type>): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection()) return type.types.some((member: ts.Type): boolean => isMutableType(member, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  if (type.getCallSignatures().length) return false;
  const name: string | undefined = type.getSymbol()?.getName();
  if (name === "ReadonlyArray" || name === "ReadonlyMap" || name === "ReadonlySet") {
    return checker.getTypeArguments(type as ts.TypeReference).some((argument: ts.Type): boolean => isMutableType(argument, seen));
  }
  if (checker.isTupleType(type)) {
    // TypeScript exposes this runtime test as boolean rather than a type predicate.
    let tuple: ts.TupleTypeReference = type as ts.TupleTypeReference;
    return !tuple.target.readonly || checker.getTypeArguments(tuple).some((element: ts.Type): boolean => isMutableType(element, seen));
  }
  if (checker.isArrayType(type)) return true;
  if (name === "Map" || name === "Set" || name === "RegExp" || name === "Date" || name === "URL") return true;
  // Mapped Readonly records still need immutable values beneath their readonly keys.
  if (type.aliasSymbol?.name === "Readonly") {
    return (
      type.getProperties().some((property: ts.Symbol): boolean => {
        let declaration: ts.Declaration | undefined = property.valueDeclaration ?? property.declarations?.[0];
        return declaration !== undefined && isMutableType(checker.getTypeOfSymbolAtLocation(property, declaration), seen);
      }) || checker.getIndexInfosOfType(type).some((info: ts.IndexInfo): boolean => isMutableType(info.type, seen))
    );
  }
  for (let property of type.getProperties()) {
    let declaration: ts.Declaration | undefined = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) continue;
    if (ts.isSetAccessorDeclaration(declaration)) return true;
    const readonly: boolean =
      (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0 || ts.isGetAccessorDeclaration(declaration);
    if (!readonly || isMutableType(checker.getTypeOfSymbolAtLocation(property, declaration), seen)) return true;
  }
  return checker.getIndexInfosOfType(type).some((info: ts.IndexInfo): boolean => !info.isReadonly || isMutableType(info.type, seen));
}
function report(file: ts.SourceFile, node: ts.Node, message: string): void {
  let position: ts.LineAndCharacter = file.getLineAndCharacterOfPosition(node.getStart(file));
  failures.push(`${file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`);
}
function checkFile(file: ts.SourceFile): void {
  if (file.isDeclarationFile || file.fileName.includes("node_modules/")) return;
  checkedCount++;
  let edits: Edit[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const) {
      const isMutable: boolean = node.declarations.some((declaration: ts.VariableDeclaration): boolean =>
        isMutableType(checker.getTypeAtLocation(declaration.name), new Set()),
      );
      if (isMutable) {
        if (shouldFix) edits.push({ start: node.getStart(file), end: node.getStart(file) + 5, replacement: "let" });
        else report(file, node, "Use let for an exposed mutable graph or resource");
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) {
      // A callback supplied directly to a call is a value; a named local operation is behavior.
      report(file, node, "Use a function declaration for named behavior");
    }
    if (ts.isAsExpression(node) && ts.isAsExpression(node.expression)) report(file, node, "Do not use double assertions");
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["filter", "find", "some", "every"].includes(node.expression.name.text)
    ) {
      let callback: ts.Expression | undefined = node.arguments[0];
      if (callback && ts.isArrowFunction(callback)) {
        let signature: ts.Signature | undefined = checker.getSignatureFromDeclaration(callback);
        if (signature && !checker.getTypePredicateOfSignature(signature)) {
          let returnType: ts.Type = checker.getReturnTypeOfSignature(signature);
          if (!(returnType.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)))
            report(file, callback, "Membership callbacks must declare a boolean return contract");
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (shouldFix && edits.length) {
    let source: string = file.text;
    for (const edit of edits.sort((left: Edit, right: Edit): number => right.start - left.start))
      source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
    fs.writeFileSync(file.fileName, source);
  }
}
for (let file of program.getSourceFiles()) checkFile(file);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`House checks passed for ${checkedCount} TypeScript files${shouldFix ? " (mutable bindings repaired)" : ""}.`);
