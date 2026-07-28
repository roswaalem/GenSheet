// Composeur d'équipes. Deux moteurs complémentaires :
//
//  - `ownedTeams` filtre les équipes documentées selon les personnages possédés
//    (jouables tout de suite, ou à un personnage près) ;
//  - `generateTeams` en invente d'autres. Une composition inédite est jugée sur
//    ses réactions, ses résonances, sa survie, la qualité de ses membres et la
//    fréquence à laquelle ses paires jouent ensemble dans les équipes publiées.
//    Ce dernier signal évite les compositions cohérentes sur le papier mais que
//    personne ne joue.

import { teamReactions, resonances, teamArchetype } from "./reactions.js";
import { ROLES } from "./teams-data.js";

const TIER_SCORE = { SS: 100, S: 86, A: 74, B: 62, C: 52, D: 44 };
const DEFAULT_SCORE = 55;

// --- Équipes documentées ----------------------------------------------------

/** Sépare les équipes du dataset en « jouables » et « à un personnage près ». */
export function ownedTeams(owned, data, anchor = null) {
  const set = new Set(owned);
  const ready = [];
  const candidates = [];
  for (const team of data.teams) {
    if (anchor && !team.members.some((m) => m.id === anchor)) continue;
    const missing = team.members.filter((m) => !set.has(m.id));
    if (!missing.length) ready.push(team);
    else if (missing.length === 1) candidates.push({ team, missing: missing[0] });
  }

  // Beaucoup d'équipes ne diffèrent que par leur porteur manquant et aboutissent
  // au même remplacement : on ne garde que la meilleure de chaque composition.
  const played = new Set(ready.map(keyOf));
  const best = new Map();
  for (const c of candidates) {
    const swap = suggestSwap(c.team, c.missing, owned, data);
    if (!swap) continue;
    const key = [...c.team.members.map((m) => m.id).filter((id) => id !== c.missing.id), swap].sort().join("|");
    if (played.has(key)) continue;
    const kept = best.get(key);
    if (!kept || c.team.score > kept.team.score) best.set(key, { ...c, swap });
  }

  return { ready, almost: [...best.values()].sort((a, b) => b.team.score - a.team.score) };
}

const keyOf = (team) => team.members.map((m) => m.id).sort().join("|");

// Remplaçant possédé pour un membre manquant : on privilégie le même élément et
// le même rôle, puis l'habitude de jouer avec le reste de l'équipe.
function suggestSwap(team, missing, owned, data) {
  const { characters } = data;
  const others = team.members.filter((m) => m.id !== missing.id).map((m) => m.id);
  const target = characters[missing.id];
  const inTeam = new Set(team.members.map((m) => m.id));

  let best = null;
  for (const id of owned) {
    if (inTeam.has(id)) continue;
    const c = characters[id];
    if (!c) continue;
    let s = affinity(id, others, data);
    if (c.element === target?.element) s += 8;
    if (c.roles?.[missing.role]) s += 6;
    if (!best || s > best.score) best = { id, score: s };
  }
  return best?.id ?? null;
}

// --- Notation d'une composition --------------------------------------------

/** Note sur 100 d'une composition quelconque, avec ses arguments. */
export function scoreTeam(ids, data) {
  const { characters } = data;
  const chars = ids.map((id) => characters[id]).filter(Boolean);
  const elements = chars.map((c) => c.element);
  const roles = assignRoles(ids, characters);
  const reactions = teamReactions(elements);
  const reso = resonances(elements);
  const tags = new Set(chars.flatMap((c) => c.tags ?? []));

  const quality = avg(ids.map((id) => TIER_SCORE[characters[id]?.roles?.[roles.get(id)]] ?? DEFAULT_SCORE));
  const reaction = reactions.length ? Math.min(24, reactions[0].weight * 2.2) : 0;
  const resonance = Math.min(10, reso.length * 6);
  const survival = tags.has("heal") ? 12 : tags.has("shield") ? 9 : -14;
  const habit = pairScore(ids, data.synergy);
  const carrier = [...roles.values()].filter((r) => r === "Main DPS").length;
  const rolePenalty = carrier === 1 ? 0 : -10;

  const score = clamp(Math.round(0.38 * quality + reaction + resonance + survival + habit + rolePenalty));
  const main = [...roles.entries()].find(([, r]) => r === "Main DPS")?.[0] ?? ids[0];
  const archetype = teamArchetype(elements, characters[main]?.element);

  return {
    score,
    roles,
    main,
    archetype,
    reasons: reasons({ archetype, reactions, reso, tags, chars, habit, carrier }),
  };
}

// Arguments affichés sous une proposition, du plus décisif au moins.
function reasons({ archetype, reactions, reso, tags, chars, habit, carrier }) {
  const out = [];
  // La réaction mise en avant est celle qui donne son nom à l'équipe.
  const main = reactions.find((r) => r.key === archetype) ?? reactions[0];
  if (main) out.push({ kind: "good", text: `Réaction ${labelOf(main.key)}` });
  for (const r of reso) out.push({ kind: "good", text: `Résonance ${r.label} : ${r.effect}` });

  const healer = chars.find((c) => c.tags?.includes("heal"));
  const shielder = chars.find((c) => c.tags?.includes("shield"));
  if (healer) out.push({ kind: "good", text: `Soins assurés par ${healer.name}` });
  else if (shielder) out.push({ kind: "good", text: `Bouclier de ${shielder.name}` });
  else out.push({ kind: "bad", text: "Ni soigneur ni bouclier : équipe fragile" });

  if (!tags.has("buff")) out.push({ kind: "warn", text: "Aucun buffeur : dégâts bruts" });
  if (carrier !== 1) {
    out.push({ kind: "warn", text: carrier ? "Plusieurs porteurs se disputent le terrain" : "Pas de vrai porteur de dégâts" });
  }
  if (habit >= 12) out.push({ kind: "good", text: "Duos qui ont fait leurs preuves" });
  else if (habit <= 2) out.push({ kind: "warn", text: "Association inhabituelle" });
  return out;
}

const labelOf = (key) => (key === "electro-affecte" ? "Électro-affecté" : key[0].toUpperCase() + key.slice(1));

// Rôle de chaque membre : un seul porteur, les autres repliés sur leur meilleur
// rôle de soutien.
export function assignRoles(ids, characters) {
  const scored = ids.map((id) => ({
    id,
    main: TIER_SCORE[characters[id]?.roles?.["Main DPS"]] ?? 0,
    best: bestRole(characters[id]),
  }));
  const carrier = scored.reduce((a, b) => (b.main > a.main ? b : a), scored[0]);
  const out = new Map();
  for (const s of scored) {
    if (s.id === carrier.id && carrier.main > 0) out.set(s.id, "Main DPS");
    else out.set(s.id, s.best === "Main DPS" ? "Sub-DPS" : s.best);
  }
  return out;
}

function bestRole(char) {
  let best = null;
  for (const role of ROLES) {
    const t = char?.roles?.[role];
    if (t && (!best || TIER_SCORE[t] > TIER_SCORE[char.roles[best]])) best = role;
  }
  return best ?? "Support";
}

// Habitude de jeu : à quel point ces personnages se croisent dans les équipes
// publiées. Plafonné pour ne pas écraser le reste de la note.
function pairScore(ids, synergy) {
  let total = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]].sort();
      total += synergy[`${a}|${b}`] ?? 0;
    }
  }
  return Math.min(22, total * 1.5);
}

// --- Génération -------------------------------------------------------------

const CARRIERS = 12;   // porteurs testés
const PARTNERS = 14;   // partenaires retenus par porteur

/**
 * Compositions inédites à partir des personnages possédés.
 * `anchor` impose un personnage, `exclude` écarte des compositions déjà vues.
 */
export function generateTeams(owned, data, { anchor = null, limit = 12, exclude = new Set() } = {}) {
  const { characters } = data;
  const pool = owned.filter((id) => characters[id]);
  if (pool.length < 4) return [];

  const carriers = pool
    .filter((id) => id !== anchor)
    .map((id) => ({ id, s: TIER_SCORE[characters[id]?.roles?.["Main DPS"]] ?? 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, CARRIERS)
    .map((x) => x.id);
  if (anchor) carriers.unshift(anchor);

  const candidates = [];
  for (const carrier of carriers) {
    const base = anchor && anchor !== carrier ? [carrier, anchor] : [carrier];
    const partners = pool
      .filter((id) => !base.includes(id))
      .map((id) => ({ id, a: affinity(id, base, data) }))
      .sort((a, b) => b.a - a.a)
      .slice(0, PARTNERS)
      .map((x) => x.id);

    for (const combo of combinations(partners, 4 - base.length)) {
      const ids = [...base, ...combo];
      const key = [...ids].sort().join("|");
      if (exclude.has(key)) continue;
      candidates.push({ ids, key, ...scoreTeam(ids, data) });
    }
  }

  // On varie les propositions : deux au plus autour d'un même porteur. Le
  // porteur retenu est celui que la composition désigne, pas celui d'où l'on
  // est parti : sinon toutes les équipes tournent autour du meilleur DPS.
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const perMain = new Map();
  const kept = [];
  for (const t of candidates) {
    if (seen.has(t.key)) continue;
    const n = perMain.get(t.main) ?? 0;
    if (n >= 2) continue;
    seen.add(t.key);
    perMain.set(t.main, n + 1);
    kept.push(t);
    if (kept.length >= limit) break;
  }
  return kept;
}

// Intérêt d'ajouter un personnage à un noyau : habitude de jeu d'abord,
// complémentarité élémentaire ensuite, qualité intrinsèque en dernier.
function affinity(id, base, data) {
  const { characters, synergy } = data;
  let s = 0;
  for (const other of base) {
    const [a, b] = [id, other].sort();
    s += 3 * (synergy[`${a}|${b}`] ?? 0);
    const pair = teamReactions([characters[id]?.element, characters[other]?.element]);
    if (pair.length) s += pair[0].weight;
  }
  const c = characters[id];
  const best = Math.max(...ROLES.map((r) => TIER_SCORE[c?.roles?.[r]] ?? 0), 0);
  return s + best / 20;
}

function* combinations(list, k) {
  if (k === 0) return yield [];
  for (let i = 0; i <= list.length - k; i++) {
    for (const rest of combinations(list.slice(i + 1), k - 1)) yield [list[i], ...rest];
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (n) => Math.max(0, Math.min(100, n));
