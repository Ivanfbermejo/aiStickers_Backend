const fetch = require("node-fetch");

const API_TOKEN = "6ece31d5665cfc5bc7c39e7b95e924c6";
const PROJECT_ID = "825532";

async function getTranslations(lang) {
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

module.exports = { getTranslations };
