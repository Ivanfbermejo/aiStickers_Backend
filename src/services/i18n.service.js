import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_DIR = path.resolve(
  env.DATA_DIR || path.join(__dirname, "../../data"),
  "translations"
);

// In-memory cache: lang → { version, data }
const memCache = new Map();

function loadFromDisk(lang) {
  const filePath = path.join(TRANSLATIONS_DIR, `${lang}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[i18n] Failed to parse ${filePath}:`, err.message);
    return null;
  }
}

export const I18nService = {
  /**
   * Returns { version, data } for the given language.
   * Reads from disk once per process lifetime (hot-reloadable via clearCache).
   *
   * @param {string} lang   - language code, e.g. "es"
   * @param {number|null} clientVersion - version the client already has (optional)
   *   If clientVersion === stored version → returns { version, data: null } (no download needed)
   */
  getTranslations(lang, clientVersion = null) {
    if (!memCache.has(lang)) {
      const file = loadFromDisk(lang);
      if (!file) {
        throw new Error(`translations_not_found:${lang}`);
      }
      memCache.set(lang, { version: file.version, data: file.data });
      console.log(`[i18n] Loaded '${lang}' from disk (${Object.keys(file.data).length} strings, v${file.version})`);
    }

    const entry = memCache.get(lang);

    if (clientVersion !== null && Number(clientVersion) === entry.version) {
      return { version: entry.version, upToDate: true, data: null };
    }

    return { version: entry.version, upToDate: false, data: entry.data };
  },

  /** Force reload a language from disk (useful after running sync script) */
  clearCache(lang = null) {
    if (lang) {
      memCache.delete(lang);
      console.log(`[i18n] Cache cleared for '${lang}'`);
    } else {
      memCache.clear();
      console.log("[i18n] Full cache cleared");
    }
  }
};
