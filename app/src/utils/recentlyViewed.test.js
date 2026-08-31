import { describe, expect, it, beforeEach } from 'vitest';
import { readRecentlyViewed, pushRecentlyViewed, clearRecentlyViewed } from './recentlyViewed';

describe('recentlyViewed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty list when nothing was stored', () => {
    expect(readRecentlyViewed()).toEqual([]);
  });

  it('pushes a normalized product snapshot', () => {
    const list = pushRecentlyViewed({
      _id: 'p1',
      name: 'Aura Phone',
      brand: 'Aura',
      category: 'Mobiles',
      price: '19999',
      rating: '4.5',
      images: ['/img-1.jpg', '/img-2.jpg'],
    });

    expect(list).toHaveLength(1);
    const snapshot = list[0];
    expect(snapshot).toMatchObject({
      id: 'p1',
      title: 'Aura Phone',
      price: 19999,
      rating: 4.5,
      image: '/img-1.jpg',
    });
    expect(snapshot.viewedAt).toBeTypeOf('number');
    expect(readRecentlyViewed()).toHaveLength(1);
  });

  it('falls back to defaults for missing snapshot fields', () => {
    const [snapshot] = pushRecentlyViewed({ id: 'p2' });
    expect(snapshot.title).toBe('Untitled product');
    expect(snapshot.brand).toBe('Aura');
    expect(snapshot.category).toBe('General');
    expect(snapshot.price).toBe(0);
    expect(snapshot.deliveryTime).toBe('3-5 days');
    expect(snapshot.image).toContain('placehold.co');
  });

  it('ignores products without an id', () => {
    const list = pushRecentlyViewed({ title: 'no id here' });
    expect(list).toEqual([]);
    expect(readRecentlyViewed()).toEqual([]);
  });

  it('deduplicates by id and moves the newest view to the front', () => {
    pushRecentlyViewed({ id: 'p1', title: 'First' });
    pushRecentlyViewed({ id: 'p2', title: 'Second' });
    const list = pushRecentlyViewed({ id: 'p1', title: 'First again' });

    expect(list.map((entry) => entry.id)).toEqual(['p1', 'p2']);
    expect(list[0].title).toBe('First again');
  });

  it('caps the stored list at 12 items', () => {
    for (let i = 0; i < 15; i += 1) {
      pushRecentlyViewed({ id: `p${i}` });
    }
    const list = readRecentlyViewed();
    expect(list).toHaveLength(12);
    expect(list[0].id).toBe('p14');
    expect(list[11].id).toBe('p3');
  });

  it('returns the existing list when storage writes fail', () => {
    pushRecentlyViewed({ id: 'p1' });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const list = pushRecentlyViewed({ id: 'p2' });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
    setItemSpy.mockRestore();
  });

  it('returns an empty list for corrupt stored payloads instead of throwing', () => {
    window.localStorage.setItem('aura_recently_viewed_products', '{not-json');
    expect(readRecentlyViewed()).toEqual([]);
  });

  it('drops stored entries without ids and caps on read', () => {
    const junk = [{ title: 'no id' }, { id: 'ok-1' }];
    window.localStorage.setItem('aura_recently_viewed_products', JSON.stringify(junk));
    expect(readRecentlyViewed().map((entry) => entry.id)).toEqual(['ok-1']);
  });

  it('clears the stored list', () => {
    pushRecentlyViewed({ id: 'p1' });
    clearRecentlyViewed();
    expect(readRecentlyViewed()).toEqual([]);
  });
});
