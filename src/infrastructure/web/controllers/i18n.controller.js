import { I18nService } from '../../../services/i18n.service.js';

export const I18nController = {
  getTranslations(req, res) {
    try {
      const { lang } = req.params;

      if (!lang || typeof lang !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
        return res.status(400).json({ error: 'invalid_language_code' });
      }

      // Client sends its cached version via header → skip data if already up to date
      const clientVersion = req.headers['x-translations-version']
        ? Number(req.headers['x-translations-version'])
        : null;

      const result = I18nService.getTranslations(lang, clientVersion);

      if (result.upToDate) {
        return res.status(304)
          .set('X-Version', String(result.version))
          .json({ version: result.version, upToDate: true });
      }

      res.json(result);

    } catch (error) {
      const notFound = error.message?.startsWith('translations_not_found');
      console.error('[i18n] Error:', error.message);
      res.status(notFound ? 404 : 500).json({ error: error.message || 'failed_to_load_translations' });
    }
  }
};
