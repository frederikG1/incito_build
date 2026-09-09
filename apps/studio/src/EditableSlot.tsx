import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useStudio } from './state.js';

export interface EditableSlotProps {
  pageId: string;
  slotId: string;
  canPromote: boolean;
}

/**
 * Transparent overlay that makes one slot draggable and droppable.
 *
 * It sits above the tile rather than wrapping it so the rendered catalog
 * markup is identical in the editor and in the final output — the editing
 * affordances are additive, and stripping them cannot change the layout.
 */
export function EditableSlot({ pageId, slotId, canPromote }: EditableSlotProps) {
  const id = `${pageId}::${slotId}`;
  const promote = useStudio((s) => s.promotePlacement);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setDropRef}
      className={`slot-overlay${isOver ? ' slot-overlay--over' : ''}${isDragging ? ' slot-overlay--dragging' : ''}`}
    >
      <button
        ref={setDragRef}
        className="slot-overlay__handle"
        title="Træk for at bytte plads"
        {...listeners}
        {...attributes}
      >
        ⠿
      </button>
      {canPromote && (
        <button
          className="slot-overlay__promote"
          title="Gør større"
          onClick={(event) => {
            event.stopPropagation();
            promote({ pageId, slotId });
          }}
        >
          ⤢
        </button>
      )}
    </div>
  );
}
