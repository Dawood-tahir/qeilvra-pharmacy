// Read-only source inventory. Findings are review prompts, not deletion decisions.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean))];
const sources = new Map(files.filter(file => /\.(?:[cm]?[jt]sx?|sql|css|html|json|toml|md|ya?ml)$/.test(file) || [".env.example", ".gitignore"].includes(file)).map(file => [file, fs.readFileSync(file, "utf8")]));
const imports = [], risks = [], definitions = new Map();
for (const [file, text] of sources) {
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ file, specifier: node.moduleSpecifier.text });
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push({ file, specifier: node.arguments[0].text });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // Never emit matching secret values, including when scanning examples/tests.
  for (const [name, pattern] of Object.entries({ rawHtml: /dangerouslySetInnerHTML/g, dynamicCode: /\beval\(|new Function\(/g, elevatedClient: /createAdminClient\(/g, secretReference: /SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY/g, jwtLiteral: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, secretLiteral: /sb_secret_[A-Za-z0-9_-]{15,}/g })) {
    const count = [...text.matchAll(pattern)].length;
    if (count) risks.push({ file, name, count });
  }
  if (file.startsWith("supabase/migrations/")) {
    for (const match of text.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\(/gi)) definitions.set(match[1], file);
  }
}
const pkg = JSON.parse(sources.get("package.json"));
const dependencyUse = Object.keys(pkg.dependencies).map(name => ({ name, imports: imports.filter(item => item.specifier === name || item.specifier.startsWith(name + "/")).map(item => item.file) }));
const referenced = new Set(imports.map(({file,specifier}) => specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)) : ""));
const unreferencedModules = [...sources.keys()].filter(file => /^(components|lib)\/.+\.[jt]sx?$/.test(file) && !referenced.has(file.replace(/\.[jt]sx?$/, "")));
const inventory = [...sources].map(([file,text]) => ({ file, bytes: Buffer.byteLength(text), sha256: crypto.createHash("sha256").update(text).digest("hex") }));
const report = { generatedAt: new Date().toISOString(), worktreeFiles: files.length, inspectedTextFiles: sources.size, otherFiles: files.filter(file => !sources.has(file)), inventory, dependencyUse, unreferencedModules, riskMarkers: risks, latestFunctionDefinitions: Object.fromEntries(definitions) };
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(report,null,2));
console.log(JSON.stringify({ worktreeFiles:files.length, inspectedTextFiles:sources.size, unusedDependencyCandidates:dependencyUse.filter(item=>!item.imports.length).map(item=>item.name), unreferencedModules, riskMarkers:risks.filter(item=>!item.file.startsWith("tests/")) },null,2));
