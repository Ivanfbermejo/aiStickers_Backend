const store = new Map();

module.exports = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      store.delete(key);
      return null;
    }

    return entry.value;
  },

  set(key, value, ttlSeconds) {
    const expiry = Date.now() + ttlSeconds * 1000;
    store.set(key, { value, expiry });
  }
};
