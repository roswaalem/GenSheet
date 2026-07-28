// Parser GameWith : troisième source de builds, aux côtés de game8 et KQM.
//
// La page d'un personnage sépare nettement ses sections (« Best Weapon for X »,
// « X Best Artifacts ») : on collecte les liens de chacune et on les classe via
// genshin-db, comme pour game8. Les statistiques recommandées ne sont pas
// extraites : les deux autres sources les couvrent, et l'agrégation vote.

import * as cheerio from "cheerio";
import { fetchHtml } from "../http.mjs";
import { matchWeapon, matchArtifact } from "../normalize.mjs";

const INDEX = "https://gamewith.net/genshin-impact/article/show/22357"; // Character List
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const txt = ($, el) => $(el).text().replace(/\s+/g, " ").trim();

// Entrées de navigation qui traînent dans la liste des personnages.
const NAV = /list|tier|news|code|banner|guide|weapon|artifact|specialt|event|map|wish/i;

let indexCache = null;

async function index() {
  if (indexCache) return indexCache;
  indexCache = {};
  const html = await fetchHtml(INDEX);
  if (!html) return indexCache;
  const $ = cheerio.load(html);
  $('a[href*="/genshin-impact/article/show/"]').each((_, a) => {
    const name = txt($, a);
    if (!name || name.length > 24 || NAV.test(name)) return;
    const key = norm(name);
    if (key && !indexCache[key]) indexCache[key] = $(a).attr("href");
  });
  return indexCache;
}

// Liens d'une section, du titre h2 correspondant jusqu'au titre h2 suivant.
//
// Seuls les blocs de recommandation comptent : ailleurs, la section renvoie
// vers des personnages et d'autres guides, et le rapprochement de genshin-db
// est assez permissif pour prendre « Eula » ou « Xiao » pour une arme.
const BLOCKS = ".genshin_seiza, .genshin_substitute, table";

function collect($, titleRe, matcher) {
  const found = [];
  const seen = new Set();
  $("h2").each((_, el) => {
    if (!titleRe.test(txt($, el))) return;
    let node = $(el).next();
    while (node.length && node[0].name !== "h2") {
      const blocks = node.is(BLOCKS) ? node : node.find(BLOCKS);
      blocks.find("a").each((_, a) => {
        // GameWith insère un markup échappé dans le texte du lien :
        // « <img alt='Skyward Blade' />Skyward Blade ».
        const label = txt($, a).replace(/<[^>]*>/g, "").trim();
        if (label.length < 3) return;
        const key = matcher(label);
        if (key && !seen.has(key)) {
          seen.add(key);
          found.push(label);
        }
      });
      node = node.next();
    }
  });
  return found;
}

/** Build unique d'un personnage, ou `null` si la page ne dit rien d'exploitable. */
export async function fetchGameWith(enName) {
  const url = (await index())[norm(enName)];
  if (!url) return null;
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const weapons = collect($, /best weapons?\b/i, matchWeapon);
  const artifacts = collect($, /best artifacts?\b/i, matchArtifact);
  if (!weapons.length && !artifacts.length) return null;

  return [
    {
      // GameWith ne publie qu'un build principal par personnage : le rôle est
      // laissé à l'agrégation, qui le rapproche de ceux des autres sources.
      role: "Support",
      weapons,
      artifacts,
      mainStats: { sands: [], goblet: [], circlet: [] },
      subStats: [],
    },
  ];
}
