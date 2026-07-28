// Parser KQM pour les équipes. La section « Teams » d'une quick guide range les
// équipes par archétype (Vaporize, Freeze, Quickbloom…) ; chacune est la légende
// d'une image, de la forme « Furina (Neuvillette) Kazuha — Xilonen / Zhongli ».
// Un slot peut proposer des alternatives (« / ») ou rester générique (« Flex »,
// « Healer », « Pyro ») : on renvoie les libellés bruts, à résoudre en aval.

import * as cheerio from "cheerio";
import { quickguide } from "./kqm.mjs";

const txt = ($, el) => $(el).text().replace(/\s+/g, " ").trim();
// Titres qui structurent la section sans nommer d'archétype.
const NOT_ARCHETYPE = /^(teambuilding|notable teammates|example teams|limited roster|teams)$/i;

export async function fetchKqmTeams(enName) {
  const html = await quickguide(enName);
  if (!html) return [];
  const $ = cheerio.load(html);
  const h1 = $("h1").filter((_, el) => /^teams$/i.test(txt($, el))).first();
  if (!h1.length) return [];

  const teams = [];
  let archetype = "";
  let n = h1.next();
  for (let i = 0; i < 400 && n.length && !n.is("h1"); i++) {
    if (n.is("h2, h3, h4")) {
      const t = txt($, n);
      if (!NOT_ARCHETYPE.test(t)) archetype = t;
    } else {
      const caption = n.find("figcaption").first();
      const line = caption.length ? txt($, caption) : "";
      if (line.split(" — ").length >= 3) {
        teams.push({ archetype, slots: parseSlots(line), note: noteAfter($, n) });
      }
    }
    n = n.next();
  }
  return teams;
}

// « Xilonen / Zhongli / Pyro Traveler » → { name, alternatives }.
function parseSlots(line) {
  return line.split(" — ").map((slot) => {
    const opts = slot.split("/").map((s) => s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    return { name: opts[0] ?? "", alternatives: opts.slice(1) };
  }).filter((s) => s.name);
}

// Premier paragraphe explicatif après l'équipe (les rotations sont ignorées).
function noteAfter($, el) {
  let n = el.next();
  for (let i = 0; i < 4 && n.length && n.is("p, ul"); i++) {
    const t = txt($, n);
    if (t && !/^sample rotation/i.test(t)) return t.slice(0, 400);
    n = n.next();
  }
  return "";
}
