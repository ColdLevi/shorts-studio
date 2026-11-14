#!/usr/bin/env node
// Import a local skill folder as inert text into quarantine. Does not execute or install anything.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [sourceArg, sourceUrl = "unknown-source", license = "unverified"] = process.argv.slice(2);
if (!sourceArg) {
  console.error("Usage: node scripts/import-skill.mjs <local-skill-folder> [source-url] [license]");
  process.exit(2);
}
const source = path.resolve(sourceArg);
const stat = await fs.stat(source);
if (!stat.isDirectory()) throw new Error("Source must be a directory");
const files = await fs.readdir(source);
const candidate = files.find(x => /^SKILL\.md$/i.test(x)) ?? files.find(x => /\.md$/i.test(x));
if (!candidate) throw new Error("No markdown skill instructions found");
const body = await fs.readFile(path.join(source,candidate),"utf8");
if (body.length > 100_000) throw new Error("Skill content exceeds 100 KB safety limit");
const slug = path.basename(source).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50) || "imported-skill";
const id = `external.${slug}`;
const destination = path.join(root,"external","review",slug);
await fs.mkdir(destination,{recursive:true});
const digest = crypto.createHash("sha256").update(body).digest("hex");
const manifest = {
  id, name: slug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()),
  version:"0.1.0", category:"external-import",
  description:"Imported skill awaiting security, license and quality review.",
  triggers:[], capabilities:[], formats:["any"], genres:["any"],
  dependencies:[], conflicts:[], quality_checks:[], engines:[],
  priority:10, content_file:"SKILL.md", status:"review",
  provenance:{kind:"external",source:sourceUrl,license,imported_at:new Date().toISOString(),sha256:digest}
};
await fs.writeFile(path.join(destination,"SKILL.md"),body);
await fs.writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(`Quarantined ${id} at ${path.relative(root,destination)} (status=review).`);
console.log("No imported code was executed. Review license, instructions and provenance before promotion.");
