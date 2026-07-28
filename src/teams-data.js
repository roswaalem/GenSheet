// Accès au jeu de données des équipes (src/data/teams.fr.json), produit
// hors-ligne par `npm run data:teams`. Chargé une seule fois puis indexé.

import { ARCHETYPE_LABEL } from "./reactions.js";

export const TIERS = ["SS", "S", "A", "B", "C"];
export const ROLES = ["Main DPS", "Sub-DPS", "Support"];
export const ROLE_LABEL = { "Main DPS": "DPS principal", "Sub-DPS": "Sub-DPS", Support: "Support" };

let data = null;

/** { characters, teams, synergy, byCharacter }, byCharacter : id → équipes. */
export async function loadTeams() {
  if (data) return data;
  const raw = await fetch("data/teams.fr.json").then((r) => r.json());
  const byCharacter = new Map();
  for (const team of raw.teams) {
    team.members.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    for (const m of team.members) {
      if (!byCharacter.has(m.id)) byCharacter.set(m.id, []);
      byCharacter.get(m.id).push(team);
    }
  }
  data = { ...raw, byCharacter };
  return data;
}

export const archetypeLabel = (key) => ARCHETYPE_LABEL[key] ?? key;
