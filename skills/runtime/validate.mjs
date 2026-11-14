import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(await fs.readFile(path.join(root,"registry/index.json"),"utf8"));
const ids = new Set();
const errors = [];
for (const entry of index.skills) {
  if (ids.has(entry.id)) errors.push(`Duplicate registry ID: ${entry.id}`);
  ids.add(entry.id);
  const p = path.resolve(root, entry.manifest);
  if (!p.startsWith(root + path.sep)) { errors.push(`Unsafe manifest path: ${entry.manifest}`); continue; }
  try {
    const m = JSON.parse(await fs.readFile(p,"utf8"));
    if (m.id !== entry.id) errors.push(`ID mismatch for ${entry.id}`);
    for (const key of ["name","version","category","description","triggers","capabilities","content_file","status","provenance"]) {
      if (!(key in m)) errors.push(`${entry.id}: missing ${key}`);
    }
    if (!["active","review","disabled"].includes(m.status)) errors.push(`${entry.id}: invalid status`);
    const content = path.resolve(path.dirname(p),m.content_file);
    if (!content.startsWith(path.dirname(p)+path.sep)) errors.push(`${entry.id}: unsafe content path`);
    else await fs.access(content);
  } catch (e) { errors.push(`${entry.id}: ${e.message}`); }
}
for (const entry of index.skills) {
  try {
    const m=JSON.parse(await fs.readFile(path.resolve(root,entry.manifest),"utf8"));
    for (const dep of m.dependencies ?? []) if (!ids.has(dep)) errors.push(`${m.id}: missing dependency ${dep}`);
  } catch {}
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: ${index.skills.length} registered skills; manifests and content paths valid.`);
