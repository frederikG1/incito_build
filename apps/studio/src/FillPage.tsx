import { useState } from 'react';
import { measureRoom, readPageBoxes, type Room } from './fill.js';
import { useStudio, useStudioPick } from './state.js';
import { usePopover } from './popover.js';

/**
 * "Fyld siden ud": what is empty on the page, and the two ways to use it.
 *
 * Measured when it is opened, off the page as drawn — the same boxes
 * the choice is then made from, so what it says is what it does.
 */
export function FillPageButton({ pageId }: { pageId: string }) {
  const s = useStudioPick('emptySlots', 'fillEmptySlots', 'fillPage');
  const [room, setRoom] = useState<Room | null | 'closed'>('closed');
  const [empty, setEmpty] = useState(0);
  const open = room !== 'closed';
  usePopover(open, () => setRoom('closed'));

  const measure = () => {
    setEmpty(s.emptySlots(pageId).length);
    const drawn = readPageBoxes(pageId);
    setRoom(drawn ? measureRoom(drawn.cells.map((cell) => cell.box), drawn.obstacles) : null);
  };

  const free = room && room !== 'closed' ? Math.round(room.free * 100) : 0;
  const more = room && room !== 'closed' ? room.rows * room.perRow : 0;

  return (
    <div className="fillpage">
      <button
        className="pagebar__pics"
        onClick={() => (open ? setRoom('closed') : measure())}
        title="Brug den tomme plads på siden — større fliser eller flere varer"
      >
        Fyld siden ud
      </button>
      {open && (
        <>
          <div className="gallery__away" onPointerDown={() => setRoom('closed')} />
          <div className="fillpage__card">
            {empty > 0 && (
              <>
                <p><b>{empty}</b> {empty === 1 ? 'plads står' : 'pladser står'} tom{empty === 1 ? '' : 'me'} på siden.</p>
                <button className="go" onClick={() => { s.fillEmptySlots(pageId); setRoom('closed'); }}>
                  Fyld {empty === 1 ? 'pladsen' : `de ${empty} pladser`} med ikke placerede varer
                </button>
              </>
            )}
            {free < 4 ? (
              empty === 0 && <p>Siden er fyldt — der er ingen tom plads under varerne.</p>
            ) : (
              <>
                <p><b>{free} %</b> af siden står tom under varerne.</p>
                <button className={empty > 0 ? 'thin' : 'go'} onClick={() => { s.fillPage(pageId, 'grow'); setRoom('closed'); }}>
                  Gør fliserne større
                </button>
                <button
                  className="thin"
                  disabled={more === 0}
                  onClick={() => { s.fillPage(pageId, 'more'); setRoom('closed'); }}
                  title={more === 0 ? 'Der er ikke plads til en hel række mere' : undefined}
                >
                  {more > 0 ? `Tilføj ${more} ikke ${more === 1 ? 'placeret vare' : 'placerede varer'}` : 'Ikke plads til flere varer'}
                </button>
                <p className="fillpage__hint">Varerne tages blandt de ikke placerede, efter sidens afdeling. ⌘Z fortryder.</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
