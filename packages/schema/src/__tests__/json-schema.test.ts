import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Offer, OfferFeed, toJsonSchema } from '../index.js';

describe('toJsonSchema', () => {
  it('describes the parsed shape: defaults are required, optionals are not, nullables admit null', () => {
    const S = z.object({ a: z.string().min(1), b: z.number().int().default(1), c: z.string().optional(), d: z.number().nullable() });
    expect(toJsonSchema(S, 'S')).toMatchObject({
      type: 'object',
      required: ['a', 'b', 'd'],
      properties: {
        a: { type: 'string', minLength: 1 },
        b: { type: 'integer', default: 1 },
        d: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    });
  });

  it('puts named schemas in $defs once and carries docs', () => {
    const names = new Map([[Offer as z.ZodTypeAny, 'Offer']]);
    const json = toJsonSchema(OfferFeed, 'OfferFeed', { names, docs: { Offer: { price: 'What the customer pays.' } } });
    expect((json['properties'] as Record<string, unknown>)['offers']).toEqual({ type: 'array', items: { $ref: '#/$defs/Offer' } });
    const offer = (json['$defs'] as Record<string, { properties: Record<string, { description?: string }> }>)['Offer']!;
    expect(offer.properties['price']!.description).toBe('What the customer pays.');
  });
});
