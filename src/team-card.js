// Carte d'équipe, partagée entre la page Équipes et la fiche personnage.
// Le contexte porte ce qui dépend de l'appelant :
//   { characters, owned: Set d'ids possédés }
// Les portraits viennent du jeu de données lui-même : les équipes s'affichent
// donc même si le catalogue n'a pas pu être chargé.

import { esc } from "./util.js";
import { archetypeLabel, ROLE_LABEL } from "./teams-data.js";

export function teamCardHtml(team, ctx, { badge = null, reasons = null, note = "", title = null } = {}) {
  const main = team.members.find((m) => m.role === "Main DPS") ?? team.members[0];
  // Le porteur situe l'équipe ; sur sa propre fiche, il est déjà connu.
  const label = title ?? `${archetypeLabel(team.archetype)} · ${ctx.characters[main.id]?.name ?? "?"}`;
  const mark = badge
    ? `<span class="tier-badge is-score">${esc(badge)}</span>`
    : `<span class="tier-badge t-${team.tier}">${team.tier}</span>`;
  return `
    <div class="team-card">
      <div class="team-head">
        ${mark}
        <span class="team-title">${esc(label)}</span>
        ${note}
      </div>
      <div class="team-members">${team.members.map((m) => memberHtml(m, ctx)).join("")}</div>
      ${reasons ? `<div class="team-reasons">${reasons.map(reasonHtml).join("")}</div>` : ""}
    </div>`;
}

function memberHtml(m, ctx) {
  const c = ctx.characters[m.id] ?? {};
  const state = m.swapped ? "swapped" : ctx.owned.has(m.id) ? "owned" : "missing";
  const name = c.name ?? m.id;
  return `
    <div class="team-member ${state}" style="--elem: var(--${c.element ?? "ac"})"
         data-char="${esc(m.id)}" tabindex="0" role="button" title="Fiche de ${esc(name)}">
      <div class="tm-portrait">
        ${c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" />` : ""}
        <span class="elem-dot"></span>
      </div>
      <div class="tm-plate">
        <div class="tm-name">${esc(c.name ?? m.id)}</div>
        <div class="tm-role">${esc(ROLE_LABEL[m.role] ?? m.role)}</div>
      </div>
    </div>`;
}

const reasonHtml = (r) =>
  `<span class="reason ${r.kind}">${r.kind === "good" ? "✦" : r.kind === "bad" ? "✕" : "!"} ${esc(r.text)}</span>`;
