import { useState } from "react";
import { useStudio, useStudioPick } from "../state.js";
import { DesignButton } from "../DesignMenu.js";
import { SaveSection } from "../Weekly.js";
import { FillPageButton } from "../FillPage.js";
import { usePopover } from "../popover.js";

/**
 * Put a whole-sheet picture into the book here.
 *
 * Under each sheet rather than in a toolbar: where the page goes is the
 * decision being made, and the button sits at the seam.
 */

export function InsertImage({ at }: { at: number }) {
  const addImagePage = useStudio((s) => s.addImagePage);
  const busy = useStudio((s) => Boolean(s.busy));

  return (
    <label
      className={`insert${busy ? " insert--busy" : ""}`}
      title="Læg en billedside ind her"
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) await addImagePage(at, file);
        }}
      />
      <span>+ Tilføj billedside</span>
    </label>
  );
}

/**
 * The page's rarer errands, behind ⋯.
 *
 * Only what belongs to this one page. Order, inserting sections and
 * deleting are the overview's work (drag, ＋, ×) and Slet side already
 * sits in the bar, so repeating them here was a second, slower door.
 */
function PageMore({ pageId, offers }: { pageId: string; offers: boolean }) {
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false));
  const [saving, setSaving] = useState(false);
  const removePage = useStudio((s) => s.removePage);
  const clearPage = useStudio((s) => s.clearPage);

  return (
    <div className="more">
      <button
        onClick={() => { setOpen(!open); setSaving(false); }}
        aria-expanded={open}
        aria-label="Flere handlinger for siden"
        title="Gem som sektion, tøm eller slet siden"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="more__away" onPointerDown={() => setOpen(false)} />
          <div className="more__menu" onClick={() => setOpen(false)}>
            {saving ? (
              <SaveSection pageId={pageId} onDone={() => { setSaving(false); setOpen(false); }} />
            ) : (
              <button onClick={(event) => { event.stopPropagation(); setSaving(true); }}>
                ☆ Gem som sektion…
              </button>
            )}
            {/* Out of the bar, like Slet: emptying a page is not an everyday click. */}
            {offers && (
              <button onClick={() => clearPage(pageId)} title="Varerne går tilbage på listen; designet bliver — ⌘Z fortryder">
                Tøm siden for varer
              </button>
            )}
            {/* Out of the bar: a red word beside everyday buttons invites the wrong click. */}
            <button className="more__drop" onClick={() => removePage(pageId)} title="⌘Z fortryder">
              ✕ Slet siden
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Stil alle varer op", asked once before it runs.
 *
 * It is an AI call on every tile of the page — it takes a while and it
 * changes what is there. Not a warning: a short "this is what happens"
 * with the go button on it, anchored to the button that opened it.
 */
function StandUp({ pageId }: { pageId: string }) {
  const [asking, setAsking] = useState(false);
  const busy = useStudio((s) => Boolean(s.busy));
  const ready = useStudio((s) => s.decorReady);
  const standUp = useStudio((s) => s.standUpClusters);
  const tiles = useStudio((s) => s.document?.pages.find((p) => p.id === pageId)?.placements.length ?? 0);

  usePopover(asking, () => setAsking(false));

  return (
    <div className="more">
      <button
        className="pagebar__pics pagebar__model"
        title={ready ? "AI stiller varerne i alle sidens fliser pænt op" : "AI-hjælpen er slået fra på denne maskine"}
        disabled={busy || !ready}
        aria-expanded={asking}
        onClick={() => setAsking(!asking)}
      >
        <span aria-hidden="true">✦</span> Stil alle varer op
      </button>
      {asking && (
        <>
          <div className="more__away" onPointerDown={() => setAsking(false)} />
          <div className="aiask" role="dialog" aria-label="Stil alle varer op med AI">
            <b className="aiask__title"><span aria-hidden="true">✦</span> Stil varerne op med AI?</b>
            <p className="aiask__say">
              AI finder varerne i billederne på sidens {tiles} {tiles === 1 ? "flise" : "fliser"} og
              stiller dem pænt op. Det kan tage et minut.
            </p>
            <div className="aiask__does">
              <button className="aiask__no" onClick={() => setAsking(false)}>Annuller</button>
              <button
                className="aiask__go"
                autoFocus
                onClick={() => { setAsking(false); void standUp(pageId); }}
              >
                Ja, stil dem op
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The tools for the page in view — one bar, pinned over the column.
 *
 * Every sheet used to carry its own copy: twelve pages, twelve rows of
 * the same six buttons, plus a strip of picture chips under each. The
 * column read as toolbars with pages between them. Now the bar belongs
 * to the page you are on (the one in view, or the one you clicked) and
 * stays put while you scroll, saying which page it is acting on.
 */
export function PageTools() {
  const s = useStudioPick(
    'activePageId', 'addCell', 'addNote', 'brand', 'clearPage', 'document', 'layoutEditPageId',
    'openPageId', 'removePageImage', 'selectDecor', 'selectedDecorId', 'setActivePage', 'setLayoutEdit',
    'togglePanel'
  );
  const pageId = s.activePageId ?? s.openPageId;
  const document = s.document;
  const index = document?.pages.findIndex((entry) => entry.id === pageId) ?? -1;
  const page = index >= 0 ? document!.pages[index]! : null;
  if (!page || page.kind === "image") return null;

  const editing = s.layoutEditPageId === page.id;
  const pictured = page.placements.some((placement) => {
    const offer = document!.offers.find((entry) => entry.id === placement.offerId);
    return Boolean(offer && (offer.imageUrl || offer.imagePack.length > 0));
  });

  return (
    <div className="tools pagebar" role="toolbar" aria-label={`Side ${index + 1}`}>
      {/* Which page it acts on is said once, in the header's pager — and by the dark number on the sheet. */}
      <div className="tools__group">
        <button
          className={`pagebar__pics${page.background ? " is-on" : ""}`}
          title="Billeder på siden, baggrund og kædens billedbibliotek"
          onClick={() => { s.setActivePage(page.id); s.togglePanel("stemning"); }}
        >
          {page.background && (
            <i
              className="pagebar__bgthumb"
              aria-hidden="true"
              style={{ backgroundImage: `url("${page.background.imageUrl}")` }}
            />
          )}
          {page.background ? "Baggrund og billeder" : "+ Baggrund og billeder"}
        </button>
        <button
          className={`pagebar__pics${editing ? " is-editing" : ""}`}
          title="Træk i pladserne for at gøre dem større, mindre eller flytte dem (Esc er færdig)"
          onClick={() => s.setLayoutEdit(editing ? null : page.id)}
        >
          {editing ? "Færdig" : "Rediger layout"}
        </button>
        {editing && (
          <button
            className="pagebar__pics"
            title="En ny, tom plads midt på siden"
            onClick={() => s.addCell(page.id, { x: 0.3, y: 0.4, w: 0.4, h: 0.25 })}
          >
            + Plads
          </button>
        )}
        {page.kind === "offers" && <FillPageButton pageId={page.id} />}
        <button
          className="pagebar__pics"
          title="Læg en tekst på siden — flyt den med musen, skriv den i panelet til højre"
          onClick={() => s.addNote(page.id)}
        >
          + Tekst
        </button>
      </div>
      {/* How the products on this page look: the design they are drawn in, one press from the page. */}
      {page.kind === "offers" && (s.brand?.offerDesigns.length ?? 0) > 0 && (
        <div className="tools__group">
          <DesignButton
            scope={{ kind: "page", pageId: page.id }}
            className="pagebar__pics pagebar__design"
            title="Hvilket varedesign sidens varer tegnes i — og ret det"
          >
            Varedesign: <b>{page.design?.tag ?? s.brand?.designTag ?? "kædens"}</b> ▾
          </DesignButton>
        </div>
      )}
      {pictured && <StandUp pageId={page.id} />}

      {/* The page's pictures, as chips in the same bar — only when it has any. */}
      {page.decorations.length > 0 && (
        <div className="tools__pics">
          {page.decorations.map((decor) => (
            <div className={s.selectedDecorId === decor.id ? "pic is-held" : "pic"} key={decor.id}>
              {/*
               * Takes the picture in hand: it is painted behind the grid,
               * so on a full page there is nothing to grab. Armed, it is
               * lifted over the tiles and takes the pointer.
               */}
              <button
                className="pic__hold"
                title={s.selectedDecorId === decor.id
                  ? "Slip billedet — så lægger det sig bag varerne igen"
                  : `${decor.subject || "Eget billede"} — tag det i hånden, så kan det trækkes på siden`}
                onClick={() => s.selectDecor(s.selectedDecorId === decor.id ? null : decor.id)}
              >
                <img src={decor.imageUrl} alt="" />
              </button>
              <button className="pic__drop" title="Tag billedet af siden" onClick={() => s.removePageImage(page.id, decor.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="tools__gap" />
      <PageMore pageId={page.id} offers={page.kind === "offers"} />
    </div>
  );
}
