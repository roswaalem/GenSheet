// Consensus entre sources pour les équipes. En entrée : des équipes brutes
// (noms de personnages tels que lus sur les sites) et la tier list. En sortie :
// des équipes dédupliquées par leur composition, avec un rôle par membre, un
// archétype canonique et une note calculée, plus la matrice de co-occurrence
// des paires, qui sert au composeur à juger des équipes jamais publiées.

import { resolve, rosterChars } from "./roster.mjs";
import { teamArchetype } from "../src/reactions.js";

const TIER_SCORE = { SS: 100, S: 86, A: 74, B: 62, C: 52, D: 44 };
const DEFAULT_SCORE = 60;

// Ordre important : les motifs les plus spécifiques d'abord (hyperfloraison
// avant floraison, floraison lunaire avant floraison).
const ARCHETYPES = [
  [/hyperbloom/i, "hyperfloraison"],
  [/burgeon/i, "eclosion"],
  [/lunar.?bloom|lunarbloom/i, "floraison-lunaire"],
  [/bloom|nilou/i, "floraison"],
  [/vape|vaporize/i, "vaporisation"],
  [/melt/i, "fonte"],
  [/freeze|permafreeze/i, "gel"],
  [/aggravate|quicken|spread/i, "aggravation"],
  [/electro.?charg|taser/i, "electro-affecte"],
  [/overload/i, "surcharge"],
  [/burning/i, "combustion"],
  [/crystallize/i, "cristallisation"],
  [/swirl/i, "diffusion"],
  [/mono/i, "mono-element"],
  [/physical/i, "physique"],
  [/plunge/i, "plongeon"],
];

const ROLES = ["Main DPS", "Sub-DPS", "Support"];

/** Libellé de rôle d'un site → rôle canonique. */
export function canonRole(label) {
  const l = String(label ?? "").toLowerCase();
  if (/main/.test(l)) return "Main DPS";
  if (/sub|off.?field/.test(l)) return "Sub-DPS";
  if (/support|buff|heal|shield/.test(l)) return "Support";
  if (/dps|carry/.test(l)) return "Main DPS";
  return null;
}

export function aggregate({ tiers, teams, abilities }) {
  const characters = buildCharacters(tiers, abilities);
  const merged = mergeTeams(teams, characters);
  return {
    characters,
    teams: merged,
    synergy: pairCounts(merged),
  };
}

// --- Personnages ------------------------------------------------------------

// Roster complet + rang par rôle (tier list) + capacités (soin, bouclier, buff).
function buildCharacters(tiers, abilities) {
  const out = {};
  for (const c of rosterChars().values()) {
    // L'icône est embarquée : les équipes s'affichent même sans le catalogue.
    out[c.id] = { name: c.fr, element: c.element, rarity: c.rarity, icon: c.icon, roles: {}, tags: [] };
  }

  for (const { name, role, tier } of tiers) {
    const id = resolve(name);
    const canon = canonRole(role);
    if (!id || !canon || !out[id]) continue;
    const known = out[id].roles[canon];
    // Un personnage peut apparaître plusieurs fois : on garde son meilleur rang.
    if (!known || TIER_SCORE[tier] > TIER_SCORE[known]) out[id].roles[canon] = tier;
  }

  // Les capacités viennent des descriptions de talents, déjà indexées par id :
  // aucune résolution de nom, donc aucune chance de se tromper de personnage.
  for (const [id, list] of Object.entries(abilities ?? {})) {
    if (out[id]) out[id].tags = [...list];
  }
  return out;
}

/** Rôle où le personnage est le mieux classé (à défaut : Support). */
function mainRole(char) {
  let best = null;
  for (const role of ROLES) {
    const t = char?.roles?.[role];
    if (t && (!best || TIER_SCORE[t] > TIER_SCORE[char.roles[best]])) best = role;
  }
  return best ?? "Support";
}

// --- Équipes ----------------------------------------------------------------

function mergeTeams(teams, characters) {
  const groups = new Map();

  for (const team of teams) {
    const slots = team.slots.map((s) => ({
      id: resolve(s.name),
      role: canonRole(s.role),
      alternatives: (s.alternatives ?? []).map(resolve).filter(Boolean),
    }));
    const ids = slots.map((s) => s.id).filter(Boolean);
    // Une équipe doit tenir debout : 3 membres identifiés au minimum, et un
    // même personnage ne peut pas occuper deux slots.
    if (ids.length < 3 || new Set(ids).size !== ids.length) continue;

    const key = [...ids].sort().join("|");
    let g = groups.get(key);
    if (!g) {
      g = { ids, slots: new Map(), archetypes: new Map(), sources: new Set(), count: 0, flex: 0 };
      groups.set(key, g);
    }
    g.count++;
    g.sources.add(team.source);
    g.flex = Math.max(g.flex, 4 - ids.length);

    for (const s of slots) {
      if (!s.id) continue;
      const cur = g.slots.get(s.id) ?? { roles: new Map(), alternatives: new Set() };
      if (s.role) cur.roles.set(s.role, (cur.roles.get(s.role) ?? 0) + 1);
      for (const a of s.alternatives) cur.alternatives.add(a);
      g.slots.set(s.id, cur);
    }

    const arch = archetypeOf(team.archetype, new Set(ids));
    if (arch) g.archetypes.set(arch, (g.archetypes.get(arch) ?? 0) + 1);
  }

  return [...groups.values()]
    .map((g) => finalize(g, characters))
    .sort((a, b) => b.score - a.score);
}

// « Furina Freeze » → « gel » : on retire d'abord les noms des membres, qui
// titrent souvent la section sans décrire l'archétype.
function archetypeOf(raw, memberIds) {
  const words = String(raw ?? "").split(/\s+/).filter((w) => {
    const id = resolve(w);
    return !id || !memberIds.has(id);
  });
  const cleaned = words.join(" ");
  for (const [re, key] of ARCHETYPES) if (re.test(cleaned)) return key;
  return null;
}

function finalize(g, characters) {
  const members = g.ids.map((id) => {
    const votes = g.slots.get(id);
    const role = topKey(votes.roles) ?? mainRole(characters[id]);
    return { id, role, ...(votes.alternatives.size ? { alt: [...votes.alternatives] } : {}) };
  });

  // Un seul porteur de dégâts : au-delà, les suivants passent en sub-DPS.
  let mains = 0;
  for (const m of members) {
    if (m.role !== "Main DPS") continue;
    if (mains++) m.role = "Sub-DPS";
  }

  const quality = avg(members.map((m) => TIER_SCORE[characters[m.id]?.roles?.[m.role]] ?? DEFAULT_SCORE));
  const consensus = Math.min(12, 4 * (g.sources.size - 1) + 2 * (g.count - 1));
  const score = Math.round(Math.min(100, quality + consensus - g.flex * 8));

  // À défaut de titre explicite, l'archétype se lit dans les éléments réunis.
  const elements = members.map((m) => characters[m.id]?.element).filter(Boolean);
  const main = members.find((m) => m.role === "Main DPS") ?? members[0];

  return {
    members,
    archetype: topKey(g.archetypes) ?? teamArchetype(elements, characters[main.id]?.element),
    score,
    tier: tierOf(score),
    sources: [...g.sources],
    ...(g.flex ? { flex: g.flex } : {}),
  };
}

const tierOf = (s) => (s >= 92 ? "SS" : s >= 84 ? "S" : s >= 74 ? "A" : s >= 64 ? "B" : "C");

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const topKey = (map) =>
  [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

// --- Synergie ---------------------------------------------------------------

// Nombre d'équipes publiées où deux personnages jouent ensemble. C'est le seul
// signal disponible pour juger une composition que personne n'a documentée.
function pairCounts(teams) {
  const out = {};
  for (const t of teams) {
    const ids = t.members.map((m) => m.id).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`;
        out[k] = (out[k] ?? 0) + 1;
      }
    }
  }
  return out;
}
