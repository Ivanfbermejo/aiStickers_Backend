import fetch from "node-fetch";
import { env } from "../config/env.js";

class CacheService {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value, ttlSeconds) {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiry });
  }
}

const cache = new CacheService();

async function getTranslations(lang) {
  const exportRes = await fetch("https://api.poeditor.com/v2/projects/export", {
    method: "POST",
    body: new URLSearchParams({
      api_token: env.POEDITOR_API_TOKEN,
      id: env.POEDITOR_PROJECT_ID,
      language: lang,
      type: "json"
    })
  });

  const exportData = await exportRes.json();

  if (!exportData.result?.url) {
    throw new Error("Invalid POEditor response");
  }

  const fileUrl = exportData.result.url;
  const translations = await fetch(fileUrl).then(r => r.json());

  const clean = {};
  translations.forEach(item => {
    clean[item.term] = item.definition;
  });

  return clean;
}

export const I18nService = {
  async getTranslationsWithCache(lang) {
    const cacheKey = `translations_${lang}`;
    const CACHE_TTL = 300;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await getTranslations(lang);

      const response = {
        version: Date.now(),
        data
      };

      cache.set(cacheKey, response, CACHE_TTL);
      return response;

    } catch (error) {
      console.error("Failed to load translations:", error);
      throw new Error("failed_to_load_translations");
    }
  }
};
