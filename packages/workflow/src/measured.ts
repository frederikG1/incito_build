/*
 * The measured half of the checks: what the rendered pages are doing
 * wrong. DOM only — no imports but types and two numbers — because it
 * runs in two browsers: the studio's, against the pages on screen, and
 * the server's Chromium, against the avis rendered for publishing (see
 * `packages/server/src/print.ts`, which bundles this file into the page).
 */
import type { CatalogDocument, Offer } from '@incitio/schema';
import type { Finding } from './stop.js';
import { bySeverity, isCrowded } from './sort.js';

/** How far apart two products' drawn sizes may be before a cluster is said to be out of proportion. */
export const OUT_OF_PROPORTION = 2.2;


/** A rectangle, as the browser hands one over. */
interface Box { left: number; top: number; right: number; bottom: number }

/** The visible artwork inside an `object-fit: contain` box. */
function painted(img: HTMLImageElement): Box {
  const r = img.getBoundingClientRect();
  // A `cover` image fills its box and is cropped to it by design, so
  // the box IS the painted area.
  if (getComputedStyle(img).objectFit === 'cover') return r;
  if (!img.naturalWidth || !img.naturalHeight) return r;
  const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  return {
    left: r.left + (r.width - w) / 2,
    right: r.right - (r.width - w) / 2,
    top: r.top + (r.height - h) / 2,
    bottom: r.bottom - (r.height - h) / 2,
  };
}

function over(a: Box, b: Box): { wide: number; high: number } {
  return {
    wide: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    high: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}

/** Which product a node belongs to, and what that product is called. */
function ownerOf(node: Element): { offerId: string | null; name: string } {
  const slot = node.closest('[data-offer-id]') as HTMLElement | null;
  const tile = node.closest('.tile');
  const name = tile?.querySelector('.tile__name')?.textContent?.trim() ?? '';
  return { offerId: slot?.dataset['offerId'] ?? null, name };
}

const WORDS = '.tile__name, .tile__description, .tile__quantity, .tile__meta, .tile__brand';

/**
 * The products standing under a text on the page.
 *
 * A section read off a printed page keeps the page's own words — the
 * long Änglamark paragraph, a campaign line — and the cells beside and
 * under them. Dealt into, those cells put a product behind a paragraph.
 * A quarter of the cell covered is enough: that is a price or a picture
 * under type. Measured, because a text box's height is only known once
 * it is set.
 */
export function coveredByText(pageEl: Element): { offerId: string; text: string }[] {
  const notes = [...pageEl.querySelectorAll('.page__note')]
    .map((note) => ({ box: note.getBoundingClientRect(), text: (note.textContent ?? '').trim() }))
    .filter((note) => note.box.width > 0 && note.box.height > 0 && note.text.length > 0);
  const out: { offerId: string; text: string }[] = [];
  for (const slot of pageEl.querySelectorAll<HTMLElement>('.slot[data-offer-id]')) {
    const cell = slot.getBoundingClientRect();
    const area = cell.width * cell.height;
    if (area <= 0) continue;
    for (const note of notes) {
      const w = Math.min(cell.right, note.box.right) - Math.max(cell.left, note.box.left);
      const h = Math.min(cell.bottom, note.box.bottom) - Math.max(cell.top, note.box.top);
      if (w > 0 && h > 0 && (w * h) / area >= 0.25) {
        out.push({ offerId: slot.dataset['offerId']!, text: note.text });
        break;
      }
    }
  }
  return out;
}

/**
 * What the rendered pages are doing wrong, measured.
 *
 * The same rules `npm run check` runs in Chromium, run against the
 * pages already on screen — because they are the same pages. A checker
 * that lives in a terminal is a checker somebody runs on Friday; this
 * is the same measurement standing next to the sheet it is about.
 *
 * Takes the root to read from so it can be pointed at a fragment in a
 * test as easily as at the studio.
 */
export function measureFindings(
  root: ParentNode,
  pageIds: string[],
  /*
   * The clusters nobody has positioned — no model run, no hand
   * correction. Their sizes are whatever `object-fit: contain` made
   * of the photographs, and that is worth saying; a cluster somebody
   * DID place is theirs and gets left alone.
   */
  untouched: Set<string> = new Set(),
  /*
   * How many products each placed tile shows, for the ones nobody has
   * said "behold som den er" to — see `Crowded`. The cell's share of
   * the page is only known once it is drawn, so this check lives here.
   */
  crowding: Map<string, { products: number; name: string }> = new Map(),
): Finding[] {
  const found: Finding[] = [];
  const sheets = [...root.querySelectorAll('.page')];

  sheets.forEach((el, index) => {
    const number = index + 1;
    const at = {
      pageId: (el as HTMLElement).dataset['pageId'] ?? pageIds[index] ?? null,
      pageNumber: number,
    };
    const bounds = el.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;

    // A product under one of the page's own texts.
    for (const { offerId, text } of coveredByText(el)) {
      found.push({
        id: `${at.pageId}:${offerId}:under-tekst`,
        kind: 'tekst',
        said: `Side ${number}: teksten «${text.slice(0, 32)}${text.length > 32 ? '…' : ''}» ligger hen over ${crowding.get(offerId)?.name ?? 'en vare'}`,
        ...at,
        offerId,
        weight: 'stop',
      });
    }

    // Several products in a cell too small to show them.
    for (const node of el.querySelectorAll<HTMLElement>('.slot[data-offer-id]')) {
      const offerId = node.dataset['offerId']!;
      const tile = crowding.get(offerId);
      if (!tile || tile.products < 2) continue;
      const cell = node.getBoundingClientRect();
      const area = (cell.width * cell.height) / (bounds.width * bounds.height);
      if (!isCrowded(tile.products, area)) continue;
      found.push({
        id: `${at.pageId}:${offerId}:lidt-plads`,
        kind: 'plads',
        said: `Side ${number}: ${tile.products} varer på lidt plads i ${tile.name}`,
        ...at,
        offerId,
        weight: 'se',
      });
    }

    /*
     * Artwork past the paper's edge.
     *
     * Always a defect and always cut off in print — as opposed to
     * artwork past its own CELL, which is the design: every tile's
     * picture is licensed to overrun its cell, and measuring that
     * would report the look of the chain as a fault. See the same
     * split in `scripts/check-render.ts`.
     */
    for (const node of el.querySelectorAll('.tile__media img')) {
      const img = node as HTMLImageElement;
      if (!img.naturalWidth) continue;
      const a = painted(img);
      const off = Math.max(
        bounds.left - a.left, a.right - bounds.right,
        bounds.top - a.top, a.bottom - bounds.bottom,
      );
      if (off > 1) {
        const who = ownerOf(img);
        found.push({
          id: `${at.pageId}:${who.offerId}:ud-over-arket`,
          kind: 'ark',
          said: `Side ${number}: ${who.name || 'en vare'} rager ${Math.round(off)}px ud over arket`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    /*
     * A product painted over somebody's words.
     *
     * The rule the overrun exists to respect, stated as the only thing
     * that can be measured. The words print on top, so a collision is
     * never a disappearance — it is a product name read through a
     * photograph, which is worse, because it looks deliberate.
     */
    const type = [...el.querySelectorAll(WORDS)]
      .map((word) => ({ word, box: word.getBoundingClientRect() }))
      .filter((entry) => entry.box.width > 1 && entry.box.height > 1);

    for (const node of el.querySelectorAll('.tile__media img')) {
      const img = node as HTMLImageElement;
      if (!img.naturalWidth) continue;
      const a = painted(img);
      for (const { word, box } of type) {
        const hit = over(a, box);
        // A pixel of touching is rounding; a third of a line is ink.
        if (hit.wide > 1 && hit.high > Math.min(4, box.height / 3)) {
          const who = ownerOf(img);
          found.push({
            id: `${at.pageId}:${who.offerId}:over-teksten`,
            kind: 'ark',
            said: `Side ${number}: et billede dækker `
              + `"${(word.textContent ?? '').trim().slice(0, 28)}"`,
            ...at,
            offerId: who.offerId,
            weight: 'stop',
          });
          break;
        }
      }
    }

    /*
     * The price mark is SUPPOSED to overlap the product. It must never
     * overlap the product's NAME, which is the one thing a shopper has
     * to be able to read next to the number.
     */
    for (const tile of el.querySelectorAll('.tile')) {
      const mark = tile.querySelector('.price');
      const label = tile.querySelector('.tile__name');
      if (!mark || !label) continue;
      const hit = over(mark.getBoundingClientRect(), label.getBoundingClientRect());
      if (hit.wide > 0 && hit.high > 0) {
        const who = ownerOf(tile);
        found.push({
          id: `${at.pageId}:${who.offerId}:pris-over-navn`,
          kind: 'pris',
          said: `Side ${number}: prisen dækker navnet på ${who.name || 'en vare'}`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    // Half a line of type, and half a promo chip.
    for (const words of el.querySelectorAll('.tile__words')) {
      const past = words.scrollHeight - words.clientHeight;
      if (past > 2) {
        const who = ownerOf(words);
        found.push({
          id: `${at.pageId}:${who.offerId}:tekst-klippet`,
          kind: 'tekst',
          said: `Side ${number}: teksten er klippet af på ${who.name || 'en vare'} (${past}px)`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }
    for (const tags of el.querySelectorAll('.tile__tags')) {
      if (tags.scrollHeight - tags.clientHeight > 2) {
        const who = ownerOf(tags);
        found.push({
          id: `${at.pageId}:${who.offerId}:maerke-klippet`,
          kind: 'tekst',
          said: `Side ${number}: et mærke er klippet af på ${who.name || 'en vare'}`,
          ...at,
          offerId: who.offerId,
          weight: 'se',
        });
      }
    }

    /*
     * A text block past the foot of its own tile prints its last line
     * across the offer below it. The block no longer clips — the price
     * mark lives in it and leans out of it — so this is the guard that
     * replaced the clip.
     */
    for (const info of el.querySelectorAll('.tile__info')) {
      const tile = info.closest('.tile');
      if (!tile) continue;
      const past = info.getBoundingClientRect().bottom - tile.getBoundingClientRect().bottom;
      if (past > 2) {
        const who = ownerOf(info);
        found.push({
          id: `${at.pageId}:${who.offerId}:tekst-under-flisen`,
          kind: 'tekst',
          said: `Side ${number}: teksten løber ${Math.round(past)}px ud under ${who.name || 'flisen'}`,
          ...at,
          offerId: who.offerId,
          weight: 'stop',
        });
      }
    }

    /*
     * Two products of one cluster standing on top of each other.
     *
     * `reviewCluster` says this about an arrangement the moment it is
     * read — and then the editor drags something and nobody asks
     * again. Measured off the drawn cutouts it is true of the tile as
     * it stands, which is the only version that gets printed.
     */
    for (const tile of el.querySelectorAll('.tile')) {
      const pack = [...tile.querySelectorAll('.tile__pack img')] as HTMLImageElement[];
      if (pack.length < 2) continue;
      const boxes = pack.filter((img) => img.naturalWidth).map(painted);

      /*
       * A pack whose sizes are the photographs' own.
       *
       * Only for a tile NOBODY has positioned — see `untouched`. Left
       * to the stylesheet, every product in a cluster gets one equal
       * grid track and `object-fit: contain` fits it to that box, so
       * what decides how big a product looks is the shape of the
       * photograph and nothing else. In a wide cell the heights bind
       * and a nearly square packshot comes out three times as wide as
       * the cartons beside it; in a narrow one the widths bind and a
       * flat pack comes out a third of their height. Both read as a
       * statement about the products, and neither is one.
       *
       * Said once per tile, not once per product: the answer is the
       * same for all of them — stand the cluster up, or size them by
       * hand — and four lines saying it would push the rest of the
       * list off the screen.
       *
       * Never for a cluster a model or a person has placed. There the
       * sizes were chosen, honest differences are the point, and
       * `reviewCluster` already says so when they go out of
       * proportion.
       */
      const who = ownerOf(tile);
      if (who.offerId && untouched.has(who.offerId) && boxes.length > 1) {
        const areas = boxes.map((box) => (box.right - box.left) * (box.bottom - box.top));
        const spread = Math.max(...areas) / Math.max(1, Math.min(...areas));
        if (spread > OUT_OF_PROPORTION * OUT_OF_PROPORTION) {
          found.push({
            id: `${at.pageId}:${who.offerId}:pakkestørrelser`,
            kind: 'klynge',
            said: `Side ${number}: varerne i ${who.name || 'klyngen'} er `
              + `${spread.toFixed(1)}× fra hinanden i størrelse — sat efter fotografierne,`
              + ' ikke efter varerne',
            ...at,
            offerId: who.offerId,
            weight: 'se',
          });
        }
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const hit = over(boxes[i]!, boxes[j]!);
          if (hit.wide <= 0 || hit.high <= 0) continue;
          const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);
          const smaller = Math.min(area(boxes[i]!), area(boxes[j]!));
          const share = smaller > 0 ? (hit.wide * hit.high) / smaller : 0;
          // The same threshold `reviewCluster` uses: products in a
          // composed group are meant to overlap a little.
          if (share > 0.15) {
            found.push({
              id: `${at.pageId}:${who.offerId}:klynge-${i}-${j}`,
              kind: 'klynge',
              said: `Side ${number}: vare ${i + 1} dækker ${Math.round(share * 100)} % `
                + `af vare ${j + 1} i ${who.name || 'klyngen'}`,
              ...at,
              offerId: who.offerId,
              weight: 'se',
            });
          }
        }
      }
    }
  });

  /*
   * One finding per id. The same tile can trip the same rule against
   * several words, and a list that says it four times is a list nobody
   * reads to the bottom of.
   */
  const once = new Map<string, Finding>();
  for (const finding of found) if (!once.has(finding.id)) once.set(finding.id, finding);
  return [...once.values()].sort(bySeverity);
}


/**
 * What `measureFindings` needs to know besides the drawn pages, read off
 * the document — so the studio and the server ask the same question.
 *
 * `untouched`: clusters nobody has positioned (no pack corrections), whose
 * sizes are whatever the stylesheet made of the photographs. `crowding`:
 * how many products each tile shows, for tiles nobody has said "behold
 * som den er" to.
 */
export function measureInputs(document: CatalogDocument | null): {
  untouched: Set<string>;
  crowding: Map<string, { products: number; name: string }>;
} {
  const placements = (document?.pages ?? []).flatMap((page) => page.placements);
  const untouched = new Set(placements
    .filter((placement) => Object.keys(placement.overrides.pack ?? {}).length === 0)
    .map((placement) => placement.offerId));
  const byId = new Map((document?.offers ?? []).map((offer) => [offer.id, offer]));
  const crowding = new Map(placements
    .filter((placement) => !placement.overrides.crowdOk)
    .map((placement) => byId.get(placement.offerId))
    .filter((offer): offer is Offer => Boolean(offer))
    .map((offer) => [offer.id, { products: Math.max(offer.imagePack.length, offer.members.length, 1), name: offer.name }] as const));
  return { untouched, crowding };
}
