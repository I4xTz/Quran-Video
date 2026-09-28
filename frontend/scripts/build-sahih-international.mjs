// Bundles the Saheeh International English translation as a static local
// JSON file (same flat { "surah:ayah": "text" } shape as the Açık Kuran
// ones), so the app never depends on a live API for it.
//
// Source: api.alquran.cloud edition "en.sahih" (tanzil.net-sourced) -- the
// original Saheeh International edition. Quran.com's resource 20 carries a
// later revised edition instead (different wording in ~1100 verses, e.g.
// 1:7 "evoked" -> "earned", extra "[i.e., ...]" glosses); the original was
// chosen as the shorter, more widely used text for on-video display.
//
// Re-run with: node frontend/scripts/build-sahih-international.mjs
// Output: frontend/src/data/translations/sahih_international.json

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data", "translations");
const OUT_FILE = path.join(OUT_DIR, "sahih_international.json");

const TOTAL_VERSES = 6236;

const res = await fetch("https://api.alquran.cloud/v1/quran/en.sahih");
if (!res.ok) throw new Error(`alquran.cloud responded ${res.status}`);
const { data } = await res.json();

const out = {};
for (const surah of data.surahs) {
  for (const ayah of surah.ayahs) {
    out[`${surah.number}:${ayah.numberInSurah}`] = ayah.text.trim();
  }
}

const count = Object.keys(out).length;
if (count !== TOTAL_VERSES) throw new Error(`Expected ${TOTAL_VERSES} verses, got ${count}`);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(out));
console.log(`Wrote ${count} verses to ${OUT_FILE}`);
