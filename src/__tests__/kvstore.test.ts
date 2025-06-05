import { KVStore } from '../kvstore/KVStore';

describe('KVStore', () => {
  let store: KVStore;

  beforeEach(() => {
    store = new KVStore();
  });

  test('should set and get a value', () => {
    store.set('key1', 'value1');
    expect(store.get('key1')).toBe('value1');
  });

  test('should return null for a non-existent key', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  test('should overwrite an existing value', () => {
    store.set('key1', 'value1');
    store.set('key1', 'newValue');
    expect(store.get('key1')).toBe('newValue');
  });

  test('should delete a key and return its value', () => {
    store.set('key1', 'value1');
    expect(store.del('key1')).toBe('value1');
    expect(store.get('key1')).toBeNull();
  });

  test('should return null when deleting a non-existent key', () => {
    expect(store.del('nonexistent')).toBeNull();
  });

  test('should append to an existing key', () => {
    store.set('key1', 'hello');
    store.append('key1', 'world');
    expect(store.get('key1')).toBe('helloworld');
  });

  test('should append to a non-existent key (creating it)', () => {
    store.append('key2', 'new');
    expect(store.get('key2')).toBe('new');
  });

  test('should return the correct string length for an existing key', () => {
    store.set('key1', 'abcde');
    expect(store.strlen('key1')).toBe(5);
  });

  test('should return 0 for strlen on a non-existent key', () => {
    expect(store.strlen('nonexistent')).toBe(0);
  });
});