import { I18nService } from "../services/i18n.service.js";

export const I18nController = {
  async getTranslations(req, res) {
    try {
      const { lang } = req.params;
      
      if (!lang || typeof lang !== 'string') {
        return res.status(400).json({ error: "invalid_language_code" });
      }

      const translations = await I18nService.getTranslationsWithCache(lang);
      res.json(translations);
      
    } catch (error) {
      console.error("Error in getTranslations:", error);
      res.status(500).json({ error: error.message || "failed_to_load_translations" });
    }
  }
};
