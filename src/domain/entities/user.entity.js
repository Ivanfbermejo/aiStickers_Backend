/**
 * User Entity - Core business object
 * Contains user data and business rules
 */
export class User {
  constructor({ id, email, name, googleId, createdAt, updatedAt }) {
    this.id = id;
    this.email = email;
    this.name = name;
    this.googleId = googleId;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    
    this.validate();
  }
  
  validate() {
    if (!this.email || !this.email.includes('@')) {
      throw new Error('Invalid email address');
    }
    if (!this.id) {
      throw new Error('User ID is required');
    }
  }
  
  updateName(name) {
    this.name = name;
    this.updatedAt = new Date().toISOString();
  }
  
  static fromGoogleProfile(googleProfile) {
    return new User({
      id: googleProfile.email, // Use email as primary identifier
      email: googleProfile.email,
      name: googleProfile.name,
      googleId: googleProfile.sub
    });
  }
}
