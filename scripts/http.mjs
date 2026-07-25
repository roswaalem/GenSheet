// Récupération HTTP pour le scraping hors-ligne : User-Agent navigateur (sinon
// game8 bloque), cache disque (on ne re-télécharge pas une même URL dans une
// session) et délai poli entre requêtes réseau.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const CACHE = join(tmpdir(), "gensheet-scrape-cache");
const DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFor = (url) => join(CACHE, createHash("sha1").update(url).digest("hex") + ".html");

// Renvoie le HTML (depuis le cache si présent), ou null sur 404 / erreur.
export async function fetchHtml(url) {
  const cacheFile = keyFor(url);
  try {
    return await readFile(cacheFile, "utf8");
  } catch {
    // pas en cache : on télécharge
  }
  await sleep(DELAY_MS);
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  } catch (e) {
    console.warn(`  ! réseau ${url} : ${e.message}`);
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(cacheFile, html);
  return html;
}
