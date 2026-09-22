import { describe, expect, it } from 'vitest';
import { DKK_PER_USD, RATES, priceOf, saidPrice } from '../price.js';

describe('priceOf', () => {
  it('bills a lite model at the lite rate, not the flash one', () => {
    // The trap the longest-match rule exists for: "gemini-3.5-flash-lite"
    // contains "flash", and billed as one it comes out six times too dear.
    const lite = priceOf('gemini-3.5-flash-lite', 1_000_000, 1_000_000)!;
    const flash = priceOf('gemini-3.8-flash', 1_000_000, 1_000_000)!;
    expect(lite).toBeCloseTo((0.10 + 0.40) * DKK_PER_USD, 6);
    expect(flash).toBeCloseTo((0.30 + 2.50) * DKK_PER_USD, 6);
    expect(lite).toBeLessThan(flash);
  });

  it('charges input and output apart', () => {
    // Forty numbers out of six pictures is almost all input, and a
    // total priced at the output rate would be wrong by an order of
    // magnitude.
    const mostlyIn = priceOf('gemini-3.8-flash', 1_000_000, 0)!;
    const mostlyOut = priceOf('gemini-3.8-flash', 0, 1_000_000)!;
    expect(mostlyOut / mostlyIn).toBeCloseTo(2.50 / 0.30, 6);
  });

  it('knows the Anthropic sizes too', () => {
    expect(priceOf('claude-opus-5', 1_000_000, 0)).toBeCloseTo(5 * DKK_PER_USD, 6);
    expect(priceOf('claude-haiku-4-5-20251001', 1_000_000, 0)).toBeCloseTo(1 * DKK_PER_USD, 6);
  });

  it('gives no price rather than a guessed one', () => {
    // A number in kroner that was invented looks exactly like one that
    // was measured, which is the whole reason this returns null.
    expect(priceOf('en-model-ingen-har-hørt-om', 1000, 1000)).toBeNull();
    expect(priceOf(null, 1000, 1000)).toBeNull();
  });

  it('is case-blind, the way model ids are written', () => {
    expect(priceOf('GEMINI-3.8-FLASH', 1_000_000, 0))
      .toBe(priceOf('gemini-3.8-flash', 1_000_000, 0));
  });

  it('prices a real placing call at something believable', () => {
    // 3.9k tokens on a flash-lite model, measured in the studio.
    const dkk = priceOf('gemini-3.5-flash-lite', 3_500, 400)!;
    expect(dkk).toBeGreaterThan(0);
    expect(dkk).toBeLessThan(0.05);
  });
});

describe('saidPrice', () => {
  it('counts in øre below a krone, because 0,00 kr. says nothing', () => {
    expect(saidPrice(0.34)).toBe('≈ 34 øre');
    expect(saidPrice(0.015)).toBe('≈ 2 øre');
  });

  it('says so in words when it is under an øre', () => {
    // "0 øre" reads as free. It is cheap, which is not the same thing.
    expect(saidPrice(0.0004)).toBe('under 1 øre');
  });

  it('uses kroner with a Danish comma once there are any', () => {
    expect(saidPrice(1.5)).toBe('≈ 1,50 kr.');
    expect(saidPrice(12.345)).toBe('≈ 12,35 kr.');
  });
});

describe('the rate table', () => {
  it('never charges more for input than for output', () => {
    for (const entry of RATES) {
      expect(entry.rate.out, entry.match).toBeGreaterThanOrEqual(entry.rate.in);
    }
  });
});
