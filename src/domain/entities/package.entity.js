/**
 * Package Entity - Core business object
 * Represents a sticker package/collection in the system
 */
export class Package {
  constructor({ 
    id, 
    userId, 
    name, 
    author,
    icon,
    description,
    isPublic = false,
    stickerCount = 0,
    category,
    tags = [],
    createdAt, 
    updatedAt 
  }) {
    this.id = id;
    this.userId = userId;
    this.name = name;
    this.author = author;
    this.icon = icon;
    this.description = description;
    this.isPublic = isPublic;
    this.stickerCount = stickerCount;
    this.category = category;
    this.tags = tags;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    
    this.validate();
  }
  
  validate() {
    if (!this.id) {
      throw new Error('Package ID is required');
    }
    if (!this.userId) {
      throw new Error('User ID is required');
    }
    if (!this.name || this.name.trim().length === 0) {
      throw new Error('Package name is required');
    }
    if (this.name.length > 100) {
      throw new Error('Package name must be less than 100 characters');
    }
  }
  
  updateName(name) {
    if (!name || name.trim().length === 0) {
      throw new Error('Package name cannot be empty');
    }
    this.name = name.trim();
    this.updatedAt = new Date().toISOString();
  }
  
  updateDescription(description) {
    this.description = description;
    this.updatedAt = new Date().toISOString();
  }
  
  updateIcon(icon) {
    this.icon = icon;
    this.updatedAt = new Date().toISOString();
  }
  
  setAuthor(author) {
    this.author = author;
    this.updatedAt = new Date().toISOString();
  }
  
  incrementStickerCount() {
    this.stickerCount++;
    this.updatedAt = new Date().toISOString();
  }
  
  decrementStickerCount() {
    if (this.stickerCount > 0) {
      this.stickerCount--;
    }
    this.updatedAt = new Date().toISOString();
  }
  
  setStickerCount(count) {
    this.stickerCount = Math.max(0, count);
    this.updatedAt = new Date().toISOString();
  }
  
  togglePublic() {
    this.isPublic = !this.isPublic;
    this.updatedAt = new Date().toISOString();
    return this.isPublic;
  }
  
  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.updatedAt = new Date().toISOString();
    }
  }
  
  removeTag(tag) {
    this.tags = this.tags.filter(t => t !== tag);
    this.updatedAt = new Date().toISOString();
  }
  
  setCategory(category) {
    this.category = category;
    this.updatedAt = new Date().toISOString();
  }
  
  static create({ userId, name, author, icon, description, category, isPublic = false }) {
    return new Package({
      id: `pkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      name: name || 'New Package',
      author: author || 'Unknown',
      icon: icon || null,
      description: description || '',
      category: category || 'general',
      isPublic,
      stickerCount: 0,
      tags: []
    });
  }
}
