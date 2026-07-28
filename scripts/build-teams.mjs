// Génère src/data/teams.fr.json : équipes agrégées, rangs par rôle et matrice
// de synergie. Scraping ponctuel, hors-ligne : l'app ne lit que le JSON produit.
//   node scripts/build-teams.mjs              (tout le roster)
//   node scripts/build-teams.mjs Furina Xiao  (quelques persos, pour tester)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRoster, rosterChars } from "./roster.mjs";
import { fetchTiers, fetchAllTeams, fetchCharacterTeams } from "./sources/game8-teams.mjs";
import { fetchAbilities } from "./sources/ambr-abilities.mjs";
import { fetchKqmTeams } from "./sources/kqm-teams.mjs";
import { aggregate } from "./teams-aggregate.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "teams.fr.json");

async function main() {
  const filter = process.argv.slice(2);
  await loadRoster();
  const chars = [...rosterChars().values()]
    .filter((c) => !c.id.includes("-")) // le Voyageur n'a pas de page dédiée
    .filter((c) => !filter.length || filter.includes(c.en));

  console.log(`Tier list et capacités…`);
  const tiers = await fetchTiers();
  const abilities = await fetchAbilities();
  console.log(`  ${tiers.length} rangs, ` +
    ["heal", "shield", "buff"]
      .map((t) => `${Object.values(abilities).filter((l) => l.includes(t)).length} ${t}`)
      .join(", "));

  const teams = [];
  if (!filter.length) {
    const global = await fetchAllTeams();
    teams.push(...global.map((t) => ({ ...t, source: "game8" })));
    console.log(`  ${global.length} équipes dans l'article général`);
  }

  console.log(`${chars.length} personnages…`);
  let done = 0;
  for (const c of chars) {
    const [g8, kqm] = [
      await fetchCharacterTeams(c.en).catch(() => []),
      await fetchKqmTeams(c.en).catch(() => []),
    ];
    teams.push(...g8.map((t) => ({ ...t, source: "game8" })));
    teams.push(...kqm.map((t) => ({ ...t, source: "kqm" })));
    if (++done % 20 === 0 || filter.length) {
      console.log(`  ${c.en} : ${g8.length} game8, ${kqm.length} kqm`);
    }
  }

  const data = aggregate({ tiers, teams, abilities });
  const out = {
    _meta: { sources: ["game8", "kqm"], generated: new Date().toISOString() },
    ...data,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out) + "\n");

  const byTier = {};
  for (const t of data.teams) byTier[t.tier] = (byTier[t.tier] ?? 0) + 1;
  console.log(`\n${teams.length} équipes brutes → ${data.teams.length} uniques`);
  console.log(`Répartition : ${Object.entries(byTier).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`Écrit dans ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
