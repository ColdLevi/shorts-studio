import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function tokens(value = "") {
  return String(value).toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

async function readRegistry(root = ROOT) {
  const index = JSON.parse(await fs.readFile(path.join(root, "registry/index.json"), "utf8"));
  const records = [];
  for (const entry of index.skills) {
    const manifestPath = path.resolve(root, entry.manifest);
    if (!manifestPath.startsWith(path.resolve(root) + path.sep)) throw new Error(`Unsafe manifest path: ${entry.manifest}`);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest.id !== entry.id) throw new Error(`Registry ID mismatch: ${entry.id}`);
    records.push({ ...manifest, _manifestPath: manifestPath, _root: root });
  }
  return records;
}

function scoreSkill(skill, input) {
  if (skill.status !== "active") return { score: 0, reasons: [] };
  const brief = tokens(input.brief);
  const requested = new Set([...(input.requestedCapabilities ?? []), ...(input.capabilities ?? [])].map(x => String(x).toLowerCase()));
  const briefSet = new Set(brief);
  const triggerHits = skill.triggers.filter(t => {
    const tt = tokens(t);
    return tt.length && tt.every(x => briefSet.has(x));
  });
  const capabilityHits = skill.capabilities.filter(c => requested.has(c.toLowerCase()));
  const genreHit = input.genre && (skill.genres ?? []).some(g => g === input.genre || g === "any");
  const formatHit = input.format && (skill.formats ?? []).some(f => f === input.format || f === "any");
  let score = (triggerHits.length * 5) + (capabilityHits.length * 8) + (genreHit ? 5 : 0) + (formatHit ? 2 : 0);
  const reasons = [];
  if (triggerHits.length) reasons.push(`brief matched: ${triggerHits.join(", ")}`);
  if (capabilityHits.length) reasons.push(`requested capabilities: ${capabilityHits.join(", ")}`);
  if (genreHit) reasons.push(`genre: ${input.genre}`);
  if (formatHit) reasons.push(`format: ${input.format}`);
  score += Math.round((skill.priority ?? 50) / 20);
  return { score, reasons };
}

function orderWithDependencies(selected, allById) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(skill) {
    if (visited.has(skill.id)) return;
    if (visiting.has(skill.id)) throw new Error(`Dependency cycle detected at ${skill.id}`);
    visiting.add(skill.id);
    for (const dep of skill.dependencies ?? []) {
      const dependency = allById.get(dep);
      if (!dependency) throw new Error(`Missing dependency "${dep}" required by "${skill.id}"`);
      if (dependency.status !== "active") throw new Error(`Dependency "${dep}" is not active`);
      visit(dependency);
    }
    visiting.delete(skill.id);
    visited.add(skill.id);
    ordered.push(skill);
  }
  for (const skill of selected) visit(skill);
  return ordered;
}

export async function selectSkills(input = {}, options = {}) {
  const root = options.root ?? ROOT;
  const maxSkills = Math.max(1, Math.min(20, options.maxSkills ?? 8));
  const all = await readRegistry(root);
  const allById = new Map(all.map(s => [s.id, s]));
  const scored = all.map(skill => ({ skill, ...scoreSkill(skill, input) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  const chosen = [];
  const chosenIds = new Set();
  for (const row of scored) {
    const conflicts = new Set(row.skill.conflicts ?? []);
    if (chosen.some(s => conflicts.has(s.id) || (s.conflicts ?? []).includes(row.skill.id))) continue;
    // Compute the full dependency closure before accepting a skill, so dependencies
    // never silently push the result over the requested context budget.
    const closure = [];
    const seen = new Set();
    const collect = skill => {
      if (seen.has(skill.id) || chosenIds.has(skill.id)) return;
      seen.add(skill.id);
      for (const dep of skill.dependencies ?? []) {
        const dependency = allById.get(dep);
        if (!dependency) throw new Error(`Missing dependency "${dep}" required by "${skill.id}"`);
        if (dependency.status !== "active") throw new Error(`Dependency "${dep}" is not active`);
        collect(dependency);
      }
      closure.push(skill);
    };
    collect(row.skill);
    if (chosen.length + closure.length > maxSkills) continue;
    for (const skill of closure) {
      if (chosenIds.has(skill.id)) continue;
      chosen.push(skill);
      chosenIds.add(skill.id);
    }
  }
  const ordered = orderWithDependencies(chosen, allById);
  const output = [];
  for (const skill of ordered) {
    const bodyPath = path.resolve(path.dirname(skill._manifestPath), skill.content_file);
    if (!bodyPath.startsWith(path.dirname(skill._manifestPath) + path.sep)) throw new Error(`Unsafe content path for ${skill.id}`);
    const content = await fs.readFile(bodyPath, "utf8");
    const row = scored.find(x => x.skill.id === skill.id);
    output.push({
      id: skill.id, name: skill.name, category: skill.category,
      score: row?.score ?? 0, reasons: row?.reasons ?? ["required dependency"],
      qualityChecks: skill.quality_checks ?? [], content
    });
  }
  return {
    registryVersion: 1,
    skills: output,
    context: output.map(s => `### ${s.name} [${s.id}]\n${s.content.trim()}`).join("\n\n")
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = key => { const i = args.indexOf(key); return i >= 0 ? args[i+1] : undefined; };
  const brief = get("--brief") ?? "";
  const format = get("--format") ?? "any";
  const genre = get("--genre");
  const result = await selectSkills({ brief, format, genre });
  console.log(JSON.stringify({skills: result.skills.map(({id,name,score,reasons})=>({id,name,score,reasons})), context:result.context}, null, 2));
}
