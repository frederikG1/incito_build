import type { DesignLayer, DesignParagraph, LayerType, OfferDesign } from '@incitio/schema';

/**
 * Designs made by hand, not only copied in from the CMS.
 *
 * A new design starts as what nearly every chain's design is: the
 * picture on top, the words bottom-left, the price bottom-right. A new
 * field starts where that kind of field usually stands, with the
 * paragraphs the CMS would give it — so it shows something the moment
 * it is added, and copies back to the CMS in the CMS's own words.
 */

const PRICE = '{% format_price path:"offerPrice", thousand:".", postfix:",-" %}';

const para = (id: string, text: string, extra: Partial<DesignParagraph> = {}): DesignParagraph => ({
  id, text_content: text, text_level: 'h1', ...extra,
});

/** Where a new field of each kind stands, and what it says. Shares of the cell. */
const STARTS: Partial<Record<LayerType, { box: [number, number, number, number]; paragraphs: (id: string) => DesignParagraph[] }>> = {
  offer_image: { box: [0, 0, 1, 0.72], paragraphs: () => [] },
  offer_bg_image: { box: [0, 0, 1, 1], paragraphs: () => [] },
  offer_text: {
    box: [0, 0.72, 0.6, 1],
    paragraphs: (id) => [
      para(`${id}-1`, '{{offerName}}', { text_size: 12, text_weight: 'bold', text_align: 'left' }),
      para(`${id}-2`, '{{ offerDescription | truncatewords: 10, "" }}', { text_size: 10, text_level: 'body', text_align: 'left' }),
    ],
  },
  offer_price: {
    box: [0.6, 0.72, 1, 1],
    paragraphs: (id) => [para(`${id}-1`, PRICE, { text_max_size: 44, text_weight: 'bold', text_align: 'right' })],
  },
  offer_savings: {
    box: [0.68, 0.5, 1, 0.7],
    paragraphs: (id) => [para(`${id}-1`, 'SPAR {% format_price path:"offerSavings" thousand:".", postfix:",-" %}', {
      text_size: 14, text_weight: 'bold', text_align: 'center', text_color: 'rgb(255,255,255)',
    })],
  },
  offer_membership_price: {
    box: [0.6, 0.72, 1, 1],
    paragraphs: (id) => [para(`${id}-1`, '{% format_price path:"offerMembershipPrice", thousand:".", postfix:",-" %}', {
      text_max_size: 44, text_weight: 'bold', text_align: 'right',
    })],
  },
  offer_relative_savings: {
    box: [0.7, 0, 1, 0.3],
    paragraphs: (id) => [para(`${id}-1`, '{{offerRelativeSavings}}', { text_size: 18, text_weight: 'bold', text_align: 'center' })],
  },
  offer_logos: { box: [0.85, 0, 1, 0.5], paragraphs: () => [] },
};

const label = (n: 1 | 2 | 3, kind: 'Custom' | 'Comment') => (id: string) => [
  para(`${id}-1`, `{% if offer${kind}Label${n} %}{{ offer${kind}Label${n} }}{% endif %}`, { text_size: 12, text_align: 'center' }),
];

function startOf(type: LayerType) {
  const known = STARTS[type];
  if (known) return known;
  const custom = /^offer_(custom|comment)_label_([123])$/.exec(type);
  if (custom) {
    return {
      box: [0, 0, 0.28, 0.28] as [number, number, number, number],
      paragraphs: label(Number(custom[2]) as 1 | 2 | 3, custom[1] === 'custom' ? 'Custom' : 'Comment'),
    };
  }
  return { box: [0.1, 0.1, 0.5, 0.4] as [number, number, number, number], paragraphs: () => [] };
}

/** An id no field in the design has: the CMS numbers them. */
function nextId(layers: DesignLayer[]): number {
  return layers.reduce((most, layer) => Math.max(most, typeof layer.id === 'number' ? layer.id : Number(layer.id) || 0), 0) + 1;
}

export function newLayer(type: LayerType, layers: DesignLayer[]): DesignLayer {
  const id = nextId(layers);
  const start = startOf(type);
  const [x1, y1, x2, y2] = start.box;
  return { id, type, name: null, x1, y1, x2, y2, flexy: 'auto', paragraphs: start.paragraphs(String(id)) };
}

/**
 * Put a new field into a design. The CMS lists the top field first, so
 * a background goes last (under everything) and anything else first.
 */
export function addLayer(design: OfferDesign, type: LayerType): { design: OfferDesign; layer: DesignLayer } {
  const layer = newLayer(type, design.layers);
  const layers = type === 'offer_bg_image' ? [...design.layers, layer] : [layer, ...design.layers];
  return { design: { ...design, layers }, layer };
}

/** A field and every field grouped under it. */
export function removeLayer(design: OfferDesign, id: string): OfferDesign {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of design.layers) {
      if (layer.parent_id != null && gone.has(String(layer.parent_id)) && !gone.has(String(layer.id))) {
        gone.add(String(layer.id));
        grew = true;
      }
    }
  }
  return { ...design, layers: design.layers.filter((layer) => !gone.has(String(layer.id))) };
}

export function blankDesign(id: string, tag: string): OfferDesign {
  let design: OfferDesign = { id, tag, type: 'offer', offer_priority: 'b', offer_type: null, layers: [] };
  // Bottom to top as the CMS lists them reversed: picture, words, price.
  for (const type of ['offer_image', 'offer_text', 'offer_price'] as const) design = addLayer(design, type).design;
  return design;
}

/** A tag nobody uses yet: "Nyt design", "Nyt design 2", … */
export function freeTag(designs: OfferDesign[], base = 'Nyt design'): string {
  const taken = new Set(designs.map((d) => d.tag));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
