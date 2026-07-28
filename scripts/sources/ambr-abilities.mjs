// Capacités d'un personnage (soin, bouclier, buff) déduites des descriptions
// de talents fournies par Ambr.
//
// C'est une donnée factuelle, pas une opinion : elle se lit dans le texte du
// jeu plutôt que dans une liste éditoriale. Une liste de guide range Xingqiu
// parmi les soigneurs sans dire pourquoi ; la description, elle, précise que
// ses épées « restaurent les PV du personnage déployé », donc l'équipe.
//
// Seuls les talents comptent : les constellations sont conditionnées à des
// duplicatas que tout le monde n'a pas.

import { fetchHtml } from "../http.mjs";

const AMBR = "https://gi.yatta.moe/api/v2/fr";

// L'effet doit profiter à quelqu'un d'autre que le lanceur : les tournures qui
// désignent le personnage actif ou l'équipe.
// « à proximité » est écarté à dessein : le jeu s'en sert surtout pour les
// ennemis (« inflige des DGT aux ennemis proches »).
const TEAM =
  /personnages? (se trouvant|présents?)|personnage(s)? (déployé|actif|de l['’]équipe|dans l['’]équipe)|membres de l['’]équipe|tous les personnages|alliés|dans (le champ|la zone|le cercle)/i;

// Le préfixe « soign » couvre « soigne » comme « sont soignés », `\w` ne
// matcherait pas le « é » de la forme accordée.
const HEAL = /(restaure|régénère|rend|redonne|soign)[^.]{0,80}\bPV\b/i;
const SHIELD = /bouclier/i;
// Le gain peut être donné (« confère ») ou reçu (« obtiennent un bonus d'ATQ »).
const BUFF =
  /((augmente|accroît|confère|octroie|accorde|offre|obtiennent|bénéficient)[^.]{0,90}|bonus (d['’]|de ))(ATQ|DÉF|PV max|DGT|maîtrise élémentaire|taux crit|recharge d['’]énergie)/i;

// Les descriptions portent des « \n » en toutes lettres : sans les traiter, le
// découpage en phrases échoue et un effet déteint sur le suivant.
const strip = (s) =>
  String(s ?? "").replace(/<[^>]*>/g, "").replace(/\\n/g, ". ").replace(/\s+/g, " ");

/** Capacités déduites d'un texte de talent. */
export function abilitiesOf(description) {
  const tags = new Set();
  // Phrase par phrase : « augmente ses propres dégâts » ne doit pas être lu
  // comme un buff d'équipe sous prétexte que « équipe » apparaît plus loin.
  for (const phrase of strip(description).split(/(?<=[.!?])\s+/)) {
    // Un bouclier se chiffre en DÉF ou en PV : sans cette sortie, il serait
    // aussi compté comme un gain de statistique.
    if (SHIELD.test(phrase)) {
      tags.add("shield");
      continue;
    }
    if (HEAL.test(phrase) && TEAM.test(phrase)) tags.add("heal");
    if (BUFF.test(phrase) && TEAM.test(phrase)) tags.add("buff");
  }
  return tags;
}

/** { id du personnage → [capacités] } pour tout le roster. */
export async function fetchAbilities(onProgress) {
  const list = JSON.parse(await fetchHtml(`${AMBR}/avatar`)).data.items;
  const out = {};
  let done = 0;

  for (const key of Object.keys(list)) {
    const raw = await fetchHtml(`${AMBR}/avatar/${key}`);
    done++;
    onProgress?.(done, Object.keys(list).length);
    if (!raw) continue;

    const detail = JSON.parse(raw).data;
    const tags = new Set();
    for (const talent of Object.values(detail?.talent ?? {})) {
      for (const tag of abilitiesOf(talent.description)) tags.add(tag);
    }
    // Les variantes du Voyageur partagent l'id numérique côté HoYoLAB.
    const id = key.split("-")[0];
    out[id] = [...new Set([...(out[id] ?? []), ...tags])];
  }
  return out;
}
