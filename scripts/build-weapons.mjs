// Génère src/data/weapons.fr.json : provenance de chaque arme, par id du jeu.
//
// La liste des armes vient du catalogue Ambr, celui qu'affiche l'app, et la
// provenance de deux sources croisées : le wiki Fandom, qui l'énonce dans un
// champ dédié, et game8, qui la rédige. Seule la catégorie est conservée.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchWeaponObtain as fromGame8 } from "./sources/game8-weapons.mjs";
import { fetchWeaponObtain as fromFandom } from "./sources/fandom-weapons.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "weapons.fr.json");
const AMBR = "https://gi.yatta.moe/api/v2/fr/weapon";

// La liste vient du catalogue affiché par l'app, et non de genshin-db, qui
// retarde sur les sorties récentes, les armes sublimées y manquaient. Ambr
// fournit dans `route` le nom anglais, celui qu'emploie game8.
const catalog = await fetch(AMBR, { headers: { "User-Agent": "Gensheet/0.1.4" } }).then((r) => r.json());
const weapons = Object.values(catalog.data.items).filter((w) => w.rank >= 3);

console.log(`${weapons.length} armes (3★ et plus)…`);

const out = {};
let done = 0;
let found = 0;

let accords = 0;
let desaccords = 0;

for (const w of weapons) {
  const enName = w.route || w.name;
  // Séquentiel : chaque source impose son propre délai poli entre requêtes.
  const wiki = await fromFandom(enName);
  const guide = await fromGame8(enName);

  if (wiki.length && guide.length) {
    if (wiki[0] === guide[0]) accords++;
    else desaccords++;
  }
  // Le wiki énonce un fait dans un champ dédié, le guide le raconte dans une
  // phrase : en cas de désaccord, le fait l'emporte.
  const obtain = wiki.length ? wiki : guide;
  const sources = [wiki.length && "fandom", guide.length && "game8"].filter(Boolean);

  if (obtain.length) found++;
  out[w.id] = { obtain, sources };

  if (++done % 40 === 0) console.log(`  ${done}/${weapons.length} : ${found} avec provenance`);
}

console.log(`
croisement : ${accords} accords, ${desaccords} désaccords`);

const payload = {
  _meta: {
    generated: new Date().toISOString(),
    sources: ["fandom", "game8"],
    count: weapons.length,
    resolved: found,
  },
  ...out,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload), "utf8");
console.log(`\n${found}/${weapons.length} armes situées : écrit dans ${OUT}`);
