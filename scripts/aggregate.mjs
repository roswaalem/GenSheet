// Consensus entre sources. En entrée : builds normalisés, groupés par source.
// Les rôles hétérogènes sont ramenés à un petit ensemble canonique, puis armes,
// sets, stats et sous-stats sont fusionnés par vote (nb de sources) + rang.

function canonRole(label) {
  const l = label.toLowerCase();
  if (/support|buff|heal|shield/.test(l)) return "Support";
  if (/sub|off.?field/.test(l)) return "Sub-DPS";
  return "Main DPS";
}

// perSource = [ { source, builds: [ normalizedBuild ] } ]
export function aggregate(perSource) {
  const groups = new Map(); // rôle canonique → { builds:[{...,source}], sources:Set }
  for (const { source, builds } of perSource) {
    for (const b of builds) {
      const role = canonRole(b.role);
      if (!groups.has(role)) groups.set(role, { builds: [], sources: new Set() });
      const g = groups.get(role);
      g.builds.push({ ...b, source });
      g.sources.add(source);
    }
  }

  const order = { "Main DPS": 0, "Sub-DPS": 1, Support: 2 };
  return [...groups.entries()]
    .sort((a, b) => order[a[0]] - order[b[0]])
    .map(([name, g]) => ({
      name,
      weapons: voteItems(g.builds.flatMap((b) => tagged(b.weapons, b.source))),
      artifacts: voteItems(g.builds.flatMap((b) => tagged(b.artifacts, b.source))),
      mainStats: {
        sands: mergeOptions(g.builds.map((b) => b.mainStats.sands)),
        goblet: mergeOptions(g.builds.map((b) => b.mainStats.goblet)),
        circlet: mergeOptions(g.builds.map((b) => b.mainStats.circlet)),
      },
      subStats: mergeRanked(g.builds.map((b) => b.subStats)),
      sources: [...g.sources],
    }));
}

const tagged = (items, source) => items.map((it, rank) => ({ it, source, rank }));

// Vote sur des items {key,name,rarity} : nb de sources d'abord, rang moyen ensuite.
function voteItems(entries) {
  const agg = new Map();
  for (const { it, source, rank } of entries) {
    let e = agg.get(it.key);
    if (!e) { e = { id: it.id ?? null, name: it.name, rarity: it.rarity, icon: it.icon, sources: new Set(), rankSum: 0, cnt: 0 }; agg.set(it.key, e); }
    e.sources.add(source); e.rankSum += rank; e.cnt++;
  }
  return rankAgg(agg).slice(0, 8)
    .map((e) => ({ id: e.id, name: e.name, rarity: e.rarity, icon: e.icon, sources: [...e.sources] }));
}

const rankAgg = (agg) =>
  [...agg.values()].sort((a, b) => b.sources.size - a.sources.size || a.rankSum / a.cnt - b.rankSum / b.cnt);

// Options (stats principales) : union ordonnée par fréquence puis 1re apparition.
function mergeOptions(lists) {
  const count = new Map(), first = new Map();
  lists.flat().forEach((s, i) => {
    count.set(s, (count.get(s) || 0) + 1);
    if (!first.has(s)) first.set(s, i);
  });
  return [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || first.get(a) - first.get(b));
}

// Sous-stats : agrégation de rang (score = position inversée, sommée).
function mergeRanked(lists) {
  const score = new Map(), first = new Map();
  lists.forEach((l) => l.forEach((s, i) => {
    score.set(s, (score.get(s) || 0) + (l.length - i));
    if (!first.has(s)) first.set(s, i);
  }));
  return [...score.keys()].sort((a, b) => score.get(b) - score.get(a) || first.get(a) - first.get(b));
}
