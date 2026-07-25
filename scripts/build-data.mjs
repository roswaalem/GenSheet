// Génère src/data/builds.fr.json en agrégeant les builds recommandés de
// plusieurs sites (game8, …). Scraping ponctuel, hors-ligne : l'app ne lit que
// le JSON produit. À relancer à la demande :
//   node scripts/build-data.mjs            (tout le roster)
//   node scripts/build-data.mjs Furina Mavuika   (quelques persos, pour tester)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchGame8 } from "./sources/game8.mjs";
import { fetchKqm } from "./sources/kqm.mjs";
import { frWeapon, frArtifact, unresolvedNames } from "./normalize.mjs";
import { frStat } from "./stats.mjs";
import { aggregate } from "./aggregate.mjs";

const AMBR_EN = "https://gi.yatta.moe/api/v2/en/avatar";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "builds.fr.json");
const SOURCES = [
  { name: "game8", fetch: fetchGame8 },
  { name: "kqm", fetch: fetchKqm },
];

// Roster depuis Ambr : id de jeu (= id utilisé par l'app) + nom anglais.
async function roster() {
  const items = (await fetch(AMBR_EN).then((r) => r.json())).data.items;
  const seen = new Set();
  const out = [];
  for (const [key, v] of Object.entries(items)) {
    if (v.name === "Traveler") continue;
    const id = Number(key.split("-")[0]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: v.name });
  }
  return out;
}

// Un build brut (chaînes anglaises) → normalisé (FR + rareté + clés stables).
function normalizeBuild(b) {
  return {
    role: b.role,
    weapons: b.weapons.map(frWeapon),
    artifacts: b.artifacts.map(frArtifact),
    mainStats: {
      sands: b.mainStats.sands.map(frStat),
      goblet: b.mainStats.goblet.map(frStat),
      circlet: b.mainStats.circlet.map(frStat),
    },
    subStats: b.subStats.map(frStat),
  };
}

async function main() {
  const filter = process.argv.slice(2);
  const chars = (await roster()).filter((c) => !filter.length || filter.includes(c.name));
  console.log(`${chars.length} personnages, sources : ${SOURCES.map((s) => s.name).join(", ")}`);

  const out = { _meta: { sources: SOURCES.map((s) => s.name), generated: new Date().toISOString() } };
  let processed = 0;

  for (const c of chars) {
    const perSource = [];
    for (const src of SOURCES) {
      const raw = await src.fetch(c.name).catch(() => null);
      if (raw) perSource.push({ source: src.name, builds: raw.map(normalizeBuild) });
    }
    if (perSource.length) out[c.id] = { roles: aggregate(perSource) };
    if (++processed % 20 === 0 || filter.length) console.log(`  ${c.name} : ${perSource.length ? "ok" : "aucun build"}`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out) + "\n");
  console.log(`\n${Object.keys(out).length - 1} builds écrits dans ${OUT}`);
  const missing = unresolvedNames();
  if (missing.length) console.log(`Noms non résolus (${missing.length}) :`, missing.slice(0, 30).join(" | "));
}

main().catch((e) => { console.error(e); process.exit(1); });
