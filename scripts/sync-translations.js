#!/usr/bin/env node
/**
 * sync-translations.js
 * Descarga traducciones de POEditor y las guarda en data/translations/
 *
 * Uso:
 *   node scripts/sync-translations.js           → todos los idiomas
 *   node scripts/sync-translations.js es en fr  → idiomas específicos
 *
 * Requiere en .env: POEDITOR_API_TOKEN, POEDITOR_PROJECT_ID
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env") });

const API_TOKEN = process.env.POEDITOR_API_TOKEN;
const PROJECT_ID = process.env.POEDITOR_PROJECT_ID;
const TRANSLATIONS_DIR = path.join(ROOT, "data", "translations");

if (!API_TOKEN || !PROJECT_ID) {
  console.error("❌  POEDITOR_API_TOKEN and POEDITOR_PROJECT_ID must be set in .env");
  process.exit(1);
}

fs.mkdirSync(TRANSLATIONS_DIR, { recursive: true });

async function getAvailableLanguages() {
  const res = await fetch("https://api.poeditor.com/v2/languages/list", {
    method: "POST",
    body: new URLSearchParams({ api_token: API_TOKEN, id: PROJECT_ID })
  });
  const json = await res.json();
  if (json.response?.status !== "success") throw new Error("Failed to list languages: " + JSON.stringify(json));
  return json.result.languages.map(l => l.code);
}

async function downloadLanguage(lang) {
  const exportRes = await fetch("https://api.poeditor.com/v2/projects/export", {
    method: "POST",
    body: new URLSearchParams({
      api_token: API_TOKEN,
      id: PROJECT_ID,
      language: lang,
      type: "json"
    })
  });
  const exportData = await exportRes.json();
  if (!exportData.result?.url) throw new Error(`No URL for lang '${lang}': ` + JSON.stringify(exportData));

  const translations = await fetch(exportData.result.url).then(r => r.json());

  const clean = {};
  translations.forEach(item => {
    if (item.definition) clean[item.term] = item.definition;
  });
  return clean;
}

async function main() {
  const requestedLangs = process.argv.slice(2);
  const langs = requestedLangs.length > 0 ? requestedLangs : await getAvailableLanguages();

  console.log(`\n📥  Syncing ${langs.length} language(s): ${langs.join(", ")}\n`);

  let ok = 0;
  let fail = 0;

  for (const lang of langs) {
    try {
      process.stdout.write(`  [${lang}] downloading... `);
      const data = await downloadLanguage(lang);
      const count = Object.keys(data).length;

      const payload = {
        version: Date.now(),
        lang,
        count,
        data
      };

      const filePath = path.join(TRANSLATIONS_DIR, `${lang}.json`);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
      console.log(`✅  ${count} strings → data/translations/${lang}.json`);
      ok++;
    } catch (err) {
      console.log(`❌  ${err.message}`);
      fail++;
    }
  }

  console.log(`\n✔  Done: ${ok} ok, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
