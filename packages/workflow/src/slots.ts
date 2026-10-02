import { pagedSheet } from '@incitio/renderer';
import { slotAssignmentOrder, type CatalogPage, type PageTemplate, type TemplateSlot } from '@incitio/schema';

/** Slots this template has that no placement is sitting in. */
export function freeSlots(page: CatalogPage, template: PageTemplate): TemplateSlot[] {
  const taken = new Set(page.placements.map((placement) => placement.slotId));
  /*
   * On a page picture a cell nobody has filled still shows the product
   * printed there — it is not empty. Only a cell whose printed product
   * was taken off the page is.
   */
  const sheet = pagedSheet(page.incito);
  if (sheet) for (const slot of template.slots) if (!sheet.printed?.[slot.id]) taken.add(slot.id);
  // A page printed as published with no offers at all — a cover, a banner — has no cells to fill.
  if (page.exact && page.incito && page.placements.length === 0) return [];
  // Assignment order, so the first product added lands in the most
  // prominent empty cell rather than in whichever one was declared first.
  return slotAssignmentOrder(template).filter((slot) => !taken.has(slot.id));
}
