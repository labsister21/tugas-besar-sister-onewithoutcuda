export class KVStore {
  private store: Record<string, string> = {};

  set(key: string, value: string) {
    this.store[key] = value;
  }

  get(key: string): string {
    return this.store[key] || '';
  }

  del(key: string): string {
    const val = this.store[key];
    delete this.store[key];
    return val || '';
  }

  append(key: string, value: string) {
    this.store[key] = (this.store[key] || '') + value;
  }

  strlen(key: string): number {
    return (this.store[key] || '').length;
  }
}
