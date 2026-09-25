import { describe, expect, it } from 'vitest';
import { packSizeOf, readPackSize, splitLabelPrice } from '../offer.js';

describe('reading a pack size out of the chain’s own prose', () => {
  it('takes the size and leaves the price alone', () => {
    // The trap: every one of these carries a second number in the same
    // shape, and it is a price per unit.
    expect(readPackSize('Begrænset parti. Min. 225 g. Kg-pris maks. 200,00. Frit valg.'))
      .toMatchObject({ value: 225, unit: 'g' });
    expect(readPackSize('Begrænset parti. Min. 810 g. Kg-pris maks. 97,53. 1 stk.'))
      .toMatchObject({ value: 810, unit: 'g' });
    expect(readPackSize('Dybfrost. 465 ml. Literpris 96,77. Frit valg. 1 stk.'))
      .toMatchObject({ value: 465, unit: 'ml' });
  });

  it('takes the lower bound of a range, like every other range here', () => {
    expect(readPackSize('200-240 g. Kg-pris maks. 150,00.')).toMatchObject({ value: 200 });
    expect(readPackSize('Ugens køb. 100-150 cl. Literpris maks. 11,00 + pant.'))
      .toMatchObject({ value: 1000, unit: 'ml' });
  });

  it('converts to one lump, so two products can be compared', () => {
    expect(readPackSize('1 kg 1000 g. Kg-pris 125,00.')).toMatchObject({ value: 1000 });
    expect(readPackSize('Flere varianter. 1,5 l + pant.')).toMatchObject({ value: 1500 });
  });

  it('says nothing when the sentence says nothing', () => {
    expect(readPackSize('Danmark, kl. I. Stk.-pris 12,00. 1 stk.')).toBeNull();
    expect(readPackSize('Flere varianter. Frit valg.')).toBeNull();
    expect(readPackSize('')).toBeNull();
  });

  it('prefers the feed’s own field, and never offers "1 stk."', () => {
    expect(packSizeOf({ quantity: { size: 500, unit: 'g' }, description: '225 g' }))
      .toBe('500 g');
    expect(packSizeOf({ quantity: { size: null, unit: 'pcs' }, description: '465 ml. Literpris 96,77.' }))
      .toBe('465 ml');
    expect(packSizeOf({ quantity: { size: null, unit: 'pcs' }, description: 'Frit valg. 1 stk.' }))
      .toBeNull();
  });
});

describe('a price still attached to its name', () => {
  it('reads a label broken at the comma', () => {
    expect(splitLabelPrice('Spangsberg is\n, DKK 32')).toEqual({ name: 'Spangsberg is', price: 32, currency: 'DKK' });
    expect(splitLabelPrice('Xtra! kyllingebryst med lage \n, DKK 32')?.name).toBe('Xtra! kyllingebryst med lage');
  });

  it('keeps commas inside the name, and reads decimals and thousands', () => {
    expect(splitLabelPrice('Coop koteletter, skinkeschnitzler eller stegeflæsk, DKK 39')?.name)
      .toBe('Coop koteletter, skinkeschnitzler eller stegeflæsk');
    expect(splitLabelPrice('Kaffe, DKK 12,95')?.price).toBe(12.95);
    expect(splitLabelPrice('Kaffe, DKK 12.95')?.price).toBe(12.95);
    expect(splitLabelPrice('Robotstøvsuger, DKK 1.295')?.price).toBe(1295);
  });

  it('is nothing for a plain product name', () => {
    expect(splitLabelPrice('Udvalgt Fiskars til køkkenet*')).toBeNull();
    expect(splitLabelPrice('Pepsi Max, 1,5 l')).toBeNull();
  });
});
