/**
 * Cost Service
 * Determines the server-side StickerDollar cost of an operation.
 * Clients never decide the amount; any amount supplied by a caller is
 * validated against this authoritative catalog.
 */
export class CostService {
  constructor() {
    this.catalog = new Map([
      ['generation:image_sticker', 1],
      ['generation:animated_sticker', 1],
      ['generation:img2vid', 1]
    ]);
  }

  getCost(productId) {
    if (this.catalog.has(productId)) {
      return this.catalog.get(productId);
    }
    throw new Error(`No server-side cost defined for productId: ${productId}`);
  }
}
