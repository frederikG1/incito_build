import type { PageTemplate, TemplateSlot } from '@incitio/schema';

/**
 * A slot's on-page aspect ratio. Grid cells are square only when the page
 * aspect happens to equal cols/rows, so the page shape has to enter the
 * calculation — otherwise every aspect-fit score on a portrait page is
 * wrong by the same systematic factor.
 */
export function slotAspect(slot: TemplateSlot, template: PageTemplate, pageAspect: number): number {
  const { cols, rows } = template.grid;
  return ((slot.w * rows) / (slot.h * cols)) * pageAspect;
}

/** Fraction of the page this slot covers. Drives "is this a big tile". */
export function slotArea(slot: TemplateSlot, template: PageTemplate): number {
  return (slot.w * slot.h) / (template.grid.cols * template.grid.rows);
}

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Slot rectangle in page-relative percentages, gutters already subtracted.
 * The renderer consumes this directly, so gutter maths lives here once
 * rather than in CSS where it would drift from the solver's view of size.
 */
export function slotRect(slot: TemplateSlot, template: PageTemplate): Rect {
  const { cols, rows, gutter } = template.grid;
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  // Gutter is expressed in cell-widths; halve it so adjacent tiles each
  // give up the same amount and the visual gap equals one full gutter.
  const gx = (gutter * cellW) / 2;
  const gy = (gutter * cellW) / 2;

  return {
    left: slot.x * cellW + gx,
    top: slot.y * cellH + gy,
    width: slot.w * cellW - gx * 2,
    height: slot.h * cellH - gy * 2,
  };
}

/** True when two slots overlap — used to validate mined templates. */
export function slotsOverlap(a: TemplateSlot, b: TemplateSlot): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function validateTemplate(template: PageTemplate): string[] {
  const errors: string[] = [];
  const { cols, rows } = template.grid;

  for (const slot of template.slots) {
    if (slot.x + slot.w > cols || slot.y + slot.h > rows) {
      errors.push(`slot ${slot.id} extends outside the ${cols}x${rows} grid`);
    }
    for (const target of slot.promotesTo) {
      if (!template.slots.some((s) => s.id === target)) {
        errors.push(`slot ${slot.id} promotes to unknown slot ${target}`);
      }
    }
  }
  for (let i = 0; i < template.slots.length; i += 1) {
    for (let j = i + 1; j < template.slots.length; j += 1) {
      const a = template.slots[i];
      const b = template.slots[j];
      if (a && b && slotsOverlap(a, b)) errors.push(`slots ${a.id} and ${b.id} overlap`);
    }
  }
  const ids = new Set<string>();
  for (const slot of template.slots) {
    if (ids.has(slot.id)) errors.push(`duplicate slot id ${slot.id}`);
    ids.add(slot.id);
  }
  return errors;
}
