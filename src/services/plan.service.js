import fetch from "node-fetch";

/**
 * Servicio de gestión de planes de compra
 * Separa la lógica de planes del index.js principal
 */

// Lista de product IDs disponibles en Google Play
const GOOGLE_PLAY_PRODUCTS = [
  "com.animatedsticker.aistickers.coins_10",
  "com.animatedsticker.aistickers.basic_25",
  "com.animatedsticker.aistickers.plus_60",
  "com.animatedsticker.aistickers.pro_150",
  "com.animatedsticker.aistickers.vip_400"
];

// iOS App Store equivalents
const APP_STORE_PRODUCTS = [
  "com.animatedsticker.aistickers.ios.coins_10",
  "com.animatedsticker.aistickers.ios.basic_25",
  "com.animatedsticker.aistickers.ios.plus_60",
  "com.animatedsticker.aistickers.ios.pro_150",
  "com.animatedsticker.aistickers.ios.vip_400"
];

// Metadatos de planes (sin precios - vienen de las tiendas)
const PLANS_METADATA = [
  {
    productId: "com.animatedsticker.aistickers.coins_10",
    getPlanName(stickerCount) {
      const names = {
        10: 'Starter Pack',
        25: 'Basic Pack',
        60: 'Plus Pack',
        150: 'Pro Pack',
        400: 'VIP Pack'
      };
      return names[stickerCount] || 'Custom Pack';
    },
    features: ["10 imágenes con IA", "Acceso a todos los modelos"],
    isActive: true,
    tier: "starter"
  },
  {
    productId: "com.animatedsticker.aistickers.basic_25",
    getPlanName(stickerCount) {
      const names = {
        10: 'Starter Pack',
        25: 'Basic Pack',
        60: 'Plus Pack',
        150: 'Pro Pack',
        400: 'VIP Pack'
      };
      return names[stickerCount] || 'Custom Pack';
    },
    description: "25 StickerDollars - Para usuarios regulares",
    stickerCount: 25,
    features: ["25 imágenes con IA", "Mejor valor"],
    isActive: true,
    tier: "basic"
  },
  {
    productId: "com.animatedsticker.aistickers.plus_60",
    name: "Plus Pack",
    description: "60 StickerDollars - El más popular",
    stickerCount: 60,
    features: ["60 imágenes con IA", "Máximo ahorro"],
    isActive: true,
    tier: "plus"
  },
  {
    productId: "com.animatedsticker.aistickers.pro_150",
    name: "Pro Pack",
    description: "150 StickerDollars - Para creadores",
    stickerCount: 150,
    features: ["150 imágenes con IA", "Mejor precio por imagen"],
    isActive: true,
    tier: "pro"
  },
  {
    productId: "com.animatedsticker.aistickers.vip_400",
    name: "VIP Pack",
    description: "400 StickerDollars - Para profesionales",
    stickerCount: 400,
    features: ["400 imágenes con IA", "Precio más bajo por imagen"],
    isActive: true,
    tier: "vip"
  }
];

export class PlanService {
  
  /**
   * Obtiene todos los planes disponibles
   * @param {string} platform - 'android' | 'ios' | 'all'
   * @returns {Object} Lista de planes y product IDs
   */
  static getPlans(platform = 'all') {
    console.log(`📋 [PlanService] Getting plans for platform: ${platform}`);
    
    let productIds = [];
    
    switch (platform) {
      case 'android':
        productIds = GOOGLE_PLAY_PRODUCTS;
        break;
      case 'ios':
        productIds = APP_STORE_PRODUCTS;
        break;
      case 'all':
      default:
        productIds = [...GOOGLE_PLAY_PRODUCTS, ...APP_STORE_PRODUCTS];
        break;
    }
    
    // Filtrar metadatos por product IDs activos para esta plataforma
    const platformSuffix = platform === 'ios' ? '.ios.' : '.';
    const plans = PLANS_METADATA.filter(plan => {
      if (platform === 'android') {
        return !plan.productId.includes('.ios.');
      }
      if (platform === 'ios') {
        return plan.productId.includes('.ios.');
      }
      return true; // 'all' - incluir todos
    }).map(plan => ({
      ...plan,
      // Para iOS, devolver el ID con .ios.
      productId: platform === 'ios' 
        ? plan.productId.replace('com.animatedsticker.aistickers.', 'com.animatedsticker.aistickers.ios.')
        : plan.productId
    }));
    
    return {
      success: true,
      plans,
      productIds: platform === 'ios' 
        ? APP_STORE_PRODUCTS 
        : (platform === 'android' ? GOOGLE_PLAY_PRODUCTS : [...GOOGLE_PLAY_PRODUCTS, ...APP_STORE_PRODUCTS]),
      updatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Obtiene un plan específico por productId
   * @param {string} productId
   * @returns {Object|null}
   */
  static getPlanByProductId(productId) {
    // Normalizar ID (quitar .ios. si existe para buscar)
    const normalizedId = productId.replace('.ios.', '.');
    return PLANS_METADATA.find(plan => plan.productId === normalizedId) || null;
  }
  
  /**
   * Obtiene cantidad de stickers por productId
   * @param {string} productId
   * @returns {number}
   */
  static getStickerCount(productId) {
    const plan = this.getPlanByProductId(productId);
    return plan ? plan.stickerCount : 0;
  }
  
  /**
   * Obtiene nombre del plan por productId
   * @param {string} productId
   * @returns {string|null}
   */
  static getPlanName(productId) {
    const plan = this.getPlanByProductId(productId);
    return plan ? plan.name : null;
  }
  
  /**
   * Obtiene precio sugerido del plan por productId
   * @param {string} productId
   * @returns {number}
   */
  static getPlanPrice(productId) {
    // Precios sugeridos (el precio real viene de Google Play)
    const prices = {
      'com.animatedsticker.aistickers.coins_10': 2.99,
      'com.animatedsticker.aistickers.basic_25': 6.99,
      'com.animatedsticker.aistickers.plus_60': 12.99,
      'com.animatedsticker.aistickers.pro_150': 29.99,
      'com.animatedsticker.aistickers.vip_400': 69.99
    };
    const normalizedId = productId.replace('.ios.', '.');
    return prices[normalizedId] || 0;
  }
  
  /**
   * Verifica si un productId es válido
   * @param {string} productId
   * @returns {boolean}
   */
  static isValidProductId(productId) {
    const allProducts = [...GOOGLE_PLAY_PRODUCTS, ...APP_STORE_PRODUCTS];
    return allProducts.includes(productId);
  }
  
  /**
   * Obtiene product IDs por plataforma
   * @param {string} platform - 'android' | 'ios'
   * @returns {string[]}
   */
  static getProductIds(platform) {
    if (platform === 'android') return GOOGLE_PLAY_PRODUCTS;
    if (platform === 'ios') return APP_STORE_PRODUCTS;
    return [...GOOGLE_PLAY_PRODUCTS, ...APP_STORE_PRODUCTS];
  }
}
