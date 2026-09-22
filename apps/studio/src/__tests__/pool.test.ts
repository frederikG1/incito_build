import { describe, expect, it } from 'vitest';
import { pool } from '../pool.js';

const tick = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

describe('pool', () => {
  it('runs several at a time and never more than the limit', async () => {
    let running = 0;
    let peak = 0;
    await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(5);
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it('answers in the order they went in, not the order they finished', async () => {
    const done = await pool([30, 5, 20, 1], 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(done.map((entry) => (entry.ok ? entry.value : null))).toEqual([30, 5, 20, 1]);
  });

  it('keeps going when one of them throws, and says which', async () => {
    const done = await pool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('nej');
      return n;
    });
    expect(done.map((entry) => entry.ok)).toEqual([true, false, true]);
    expect(done[1]!.ok === false && (done[1]!.error as Error).message).toBe('nej');
  });

  it('counts the finished ones as they land', async () => {
    const seen: number[] = [];
    await pool([1, 2, 3], 2, async () => tick(1), (finished) => seen.push(finished));
    expect(seen).toEqual([1, 2, 3]);
  });

  it('is a no-op on an empty list', async () => {
    expect(await pool([], 4, async () => 1)).toEqual([]);
  });
});
