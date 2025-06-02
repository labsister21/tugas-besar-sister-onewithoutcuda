export class KVStore {
  private store: Record<string, string> = {};

  set(key: string, value: string) {
    this.store[key] = value;
  }

  get(key: string): string | null {
    return this.store.hasOwnProperty(key) ? this.store[key] : null;
  }

  del(key: string): string | null {
    if (this.store.hasOwnProperty(key)) {
      const val = this.store[key];
      delete this.store[key];
      return val;
    }
    return null;
  }

  append(key: string, value: string) {
    this.store[key] = (this.store[key] || '') + value;
  }

  strlen(key: string): number {
    return (this.store[key] || '').length;
  }
}
