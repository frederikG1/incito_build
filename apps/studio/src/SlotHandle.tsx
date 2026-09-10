import { useState } from 'react';
import { useStudio } from './state.js';

/**
 * The drag overlay on one slot.
 *
 * Rendered through `PageView`'s `slotDecorator`, which the print render
 * never passes — so the editor gets handles and drop targets and the
 * PDF gets none of it, from the same components.
 *
 * Native HTML5 drag and drop rather than a library: the whole
 * interaction is "pick up a tile, drop it on another", the payload is
 * one string, and a drag library would be a dependency and a second
 * pointer model for no gain.
 */
export interface SlotHandleProps {
  pageId: string;
  slotId: string;
}

/** `pageId::slotId` — the address of one placement in the document. */
function address(pageId: string, slotId: string): string {
  return `${pageId}::${slotId}`;
}

function parse(value: string): { pageId: string; slotId: string } | null {
  const [pageId, slotId] = value.split('::');
  return pageId && slotId ? { pageId, slotId } : null;
}

const MIME = 'application/x-incitio-slot';

export function SlotHandle({ pageId, slotId }: SlotHandleProps) {
  const swapPlacements = useStudio((s) => s.swapPlacements);
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`handle${over ? ' handle--over' : ''}${dragging ? ' handle--dragging' : ''}`}
      draggable
      onDragStart={(event) => {
        setDragging(true);
        event.dataTransfer.setData(MIME, address(pageId, slotId));
        // Some browsers refuse a drag that carries no text/plain.
        event.dataTransfer.setData('text/plain', address(pageId, slotId));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => { setDragging(false); setOver(false); }}
      onDragOver={(event) => {
        // Without preventDefault the browser refuses the drop entirely,
        // and the tile just springs back with no explanation.
        if (!event.dataTransfer.types.includes(MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const from = parse(event.dataTransfer.getData(MIME));
        if (!from) return;
        swapPlacements(from, { pageId, slotId });
      }}
    >
      <span className="handle__grip" aria-hidden="true">⠿</span>
    </div>
  );
}
