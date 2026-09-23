import { useLayoutEffect, useRef, useState } from 'react';
import { slotAssignmentOrder } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { useStudio } from './state.js';
import { gridRects } from './LayoutEditor.js';

type Rect = { x: number; y: number; w: number; h: number };

/** Two boxes that share an edge, near enough, along most of it. */
function besides(a: Rect, b: Rect): boolean {
  const near = 0.045;
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const sideBySide = (Math.abs(a.x + a.w - b.x) < near || Math.abs(b.x + b.w - a.x) < near)
    && overlapY > Math.min(a.h, b.h) * 0.6;
  const stacked = (Math.abs(a.y + a.h - b.y) < near || Math.abs(b.y + b.h - a.y) < near)
    && overlapX > Math.min(a.w, b.w) * 0.6;
  return sideBySide || stacked;
}

/**
 * Said on the tile when it holds more products than it has room for.
 *
 * Four packshots in a ninth of the page come out as four stamps, however
 * well they are arranged — the arrangement scales to the cell. The fix is
 * a bigger cell, and there are three ways to get one, each a click:
 * make this the page's big cell, take the empty cell beside it, or shape
 * the page by hand.
 */
export function Crowded({ pageId, slotId, offerId }: { pageId: string; slotId: string; offerId: string }) {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const probe = useRef<HTMLSpanElement>(null);
  /*
   * The cell's share of the page, measured as drawn — the grid's own
   * numbers leave out the heading above it and overstate every cell.
   */
  const [area, setArea] = useState(1);
  useLayoutEffect(() => {
    const cell = probe.current?.closest('.slot')?.getBoundingClientRect();
    const sheet = probe.current?.closest('.page')?.getBoundingClientRect();
    if (!cell || !sheet || sheet.width === 0) return;
    setArea((cell.width * cell.height) / (sheet.width * sheet.height));
  });
  const document = s.document;
  const brand = s.brand;
  const page = document?.pages.find((entry) => entry.id === pageId);
  const offer = document?.offers.find((entry) => entry.id === offerId);
  const template = page && brand
    ? document?.templates.find((t) => t.id === page.templateId) ?? resolveTemplate(brand, page.templateId)
    : undefined;
  if (!page || !offer || !template || !brand) return null;

  const products = Math.max(offer.imagePack.length, offer.members.length, 1);
  const crowded = (products >= 3 && area < 0.13) || (products === 2 && area < 0.07);
  if (!crowded) return <span ref={probe} hidden />;

  const lead = slotAssignmentOrder(template)[0]?.id === slotId;
  const filled = new Set(page.placements.map((placement) => placement.slotId));
  const empties = template.slots.filter((slot) => !filled.has(slot.id));

  function takeNeighbour() {
    setOpen(false);
    // Every cell in a box first, measured off the page as drawn.
    s.ownLayout(pageId, gridRects(pageId, template!));
    const fresh = useStudio.getState();
    const current = fresh.document?.pages.find((entry) => entry.id === pageId);
    const owned = fresh.document?.templates.find((t) => t.id === current?.templateId);
    const mine = owned?.slots.find((slot) => slot.id === slotId)?.rect;
    const taken = new Set(current?.placements.map((placement) => placement.slotId));
    const beside = owned?.slots.find((slot) => !taken.has(slot.id) && slot.rect && mine && besides(mine, slot.rect));
    if (!beside) {
      useStudio.setState({ error: 'Der er intet tomt felt lige ved siden af — brug "Rediger layout" og træk flisen større' });
      return;
    }
    fresh.mergeCells(pageId, slotId, beside.id);
  }

  return (
    <div
      className="crowd"
      ref={probe as unknown as React.RefObject<HTMLDivElement>}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button className="crowd__chip" onClick={() => setOpen(!open)} title="Flisen er for lille til så mange varer">
        {products} varer på lidt plads ▾
      </button>
      {open && (
        <div className="crowd__menu">
          <button disabled={lead} onClick={() => { setOpen(false); s.focusOffer(pageId, offerId); }}>
            Gør den til sidens store flise
            <em>{lead ? 'den er allerede den største' : 'bytter plads med sidens største flise'}</em>
          </button>
          {empties.length > 0 && (
            <button onClick={takeNeighbour}>
              Brug det tomme felt ved siden af
              <em>de to felter bliver ét</em>
            </button>
          )}
          <button onClick={() => { setOpen(false); s.setLayoutEdit(pageId); }}>
            Rediger layout
            <em>træk flisen præcis så stor du vil</em>
          </button>
        </div>
      )}
    </div>
  );
}
