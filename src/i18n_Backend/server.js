const express = require("express");
const { getTranslations } = require("./poeditor.js");
const { cache } = require("./cache.js");

const app = express();
const PORT = 3000;
const CACHE_TTL = 300;

app.get("/translations/:lang", async (req, res) => {
  const { lang } = req.params;
  const cacheKey = `translations_${lang}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await getTranslations(lang);

    const response = {
      version: Date.now(),
      data
    };

    cache.set(cacheKey, response, CACHE_TTL);
    res.json(response);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_load_translations" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
