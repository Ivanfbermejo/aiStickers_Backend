import fs from 'fs';
import path from 'path';
import { env } from '../../../config/env.js';

/**
 * Style Controller
 * Returns sticker generation styles/prompts from JSON config
 */
export class StyleController {
  
  /**
   * Get all available sticker styles
   * GET /api/v1/styles
   */
  static async getStyles(req, res) {
    try {
      const stylesPath = path.join(env.DATA_DIR, 'styles.json');
      
      // Read styles from JSON file
      const data = fs.readFileSync(stylesPath, 'utf8');
      const styles = JSON.parse(data);
      
      return res.json({
        success: true,
        count: styles.styles?.length || 0,
        styles: styles.styles || []
      });
      
    } catch (error) {
      console.error('[StyleController] Error loading styles:', error);
      
      // Fallback to default styles if file missing
      const fallbackStyles = [
        {
          id: "love",
          emoji: "💘",
          name: "Amor Pixar",
          prompt: "Transform the person in the photo into a cute Pixar-style character deeply in love, preserving their exact facial features, face shape, eye color, hair style and color, skin tone, and distinctive characteristics. Add big sparkling eyes, rosy cheeks, and heart-shaped particles floating around them. Keep the face recognizable and faithful to the original person."
        },
        {
          id: "disney",
          emoji: "👑",
          name: "Príncipe/Princesa Disney",
          prompt: "Transform the person in the photo into a Disney prince or princess while maintaining their exact facial features, face shape, eye color, hair style and color, skin tone, and distinctive characteristics. Add elegant royal attire, magical sparkles, long flowing hair, and a fairytale castle background. Ensure the face remains perfectly recognizable and faithful to the original person."
        }
      ];
      
      return res.json({
        success: true,
        count: fallbackStyles.length,
        styles: fallbackStyles,
        fallback: true
      });
    }
  }
}
