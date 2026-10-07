import { ImagePage, PageView, incitoSlotOf } from "@incitio/renderer";
import { resolveTemplate } from "@incitio/brands";
import { useStudio, useStudioPick } from "../state.js";
import { TileEditor } from "../TileEditor.js";
import { EmptyCells } from "../EmptyCells.js";
import { LayoutEditor } from "../LayoutEditor.js";
import { PageTextEditor } from "../PageTextEditor.js";
import { Comparison } from "../Reproduce.js";
import { OFFER_MIME, droppedOffers } from "../Tray.js";
import { useState, type DragEvent } from "react";
import { PICTURE_MIME, carriesPicture, droppedImages } from "../Backgrounds.js";
import bg from "../Backgrounds.module.css";
import type { CatalogPage, Offer } from "@incitio/schema";

/** One page of the avis on the canvas, with everything that edits it. */
export function Sheet({ page, offers }: { page: CatalogPage; offers: Map<string, Offer> }) {
  const s = useStudioPick(
    'activePageId', 'addPageImage', 'brand', 'document', 'endGesture', 'fillSlot', 'ghosts',
    'layoutEditPageId', 'librarySelection', 'moveIncito', 'movePage', 'removePage', 'replaceImagePage',
    'reproductions', 'select', 'selectIncito', 'selectNote', 'selectedDecorId', 'selectedIncito',
    'selectedNoteId', 'selectedOfferId', 'selectedPart', 'setActivePage', 'setPageSubtitle',
    'setPageTitle', 'updateNote', 'updatePageImage', 'backgroundPages', 'uploadBackground', 'placeFromLibrary'
  );
  // A picture over the sheet: the top half lays it under the page, the bottom half on it.
  const [dropTo, setDropTo] = useState<"bg" | "pic" | null>(null);
  const halfOf = (event: DragEvent<HTMLElement>): "bg" | "pic" => {
    const paper = event.currentTarget.querySelector(".sheet__paper")?.getBoundingClientRect();
    return paper && event.clientY > paper.top + paper.height / 2 ? "pic" : "bg";
  };
  const document = s.document!;
  const index = document.pages.findIndex((entry) => entry.id === page.id);
  const brand = s.brand!;
  if (page.kind === "image") {
    return (
      <div className="sheet" key={page.id}>
        <div className="sheet__bar sheet__bar--image">
          <span className="sheet__kind">Billedside</span>
          <span className="sheet__said">
            {page.background?.subject || "uden navn"}
          </span>
          <div className="sheet__does">
            <label className="sheet__image" title="Skift billedet">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) await s.replaceImagePage(page.id, file);
                }}
              />
              <span>Skift</span>
            </label>
            <div className="sheet__order">
              <button
                title="Tidligere i avisen"
                onClick={() => s.movePage(page.id, -1)}
                disabled={index === 0}
              >
                ↑
              </button>
              <button
                title="Senere i avisen"
                onClick={() => s.movePage(page.id, 1)}
                disabled={index === document.pages.length - 1}
              >
                ↓
              </button>
            </div>
            <button
              className="sheet__drop"
              title="Slet siden (⌘Z fortryder)"
              onClick={() => s.removePage(page.id)}
            >
              ×
            </button>
          </div>
        </div>
        <ImagePage
          page={page}
          brand={brand}
          pageIndex={index}
          pageNumber={index + 1}
        />
      </div>
    );
  }
  // Resolved within this chain's own set — a template id from
  // another chain simply does not exist here.
  // The chain's own layouts, then any the document brought
  // with it — a page rebuilt from a reference sits on a grid
  // nobody drew for the chain. See `CatalogDocument.templates`.
  const template =
    resolveTemplate(brand, page.templateId) ??
    document.templates.find((t) => t.id === page.templateId);
  if (!template) {
    return (
      <div className="sheet" key={page.id}>
        <div className="page page--error">
          Ukendt skabelon: {page.templateId}
        </div>
      </div>
    );
  }
  // How this page was read, when it was rebuilt from one. A
  // page from the plain draft simply has none.
  const run = s.reproductions.find((r) => r.pageId === page.id);

  return (
    /*
     * A picture can simply be dropped on the sheet.
     *
     * The button in the bar is the discoverable route; this is
     * the one a designer with a folder open actually uses.
     * `preventDefault` on dragover is what makes a drop land
     * at all — without it the browser navigates away from the
     * editor and opens the JPEG.
     */
    <div
      /*
       * The page under the pointer becomes the page products
       * land on. The library's own picker still overrides it
       * — this is the default, not the decision.
       */
      className={`sheet${s.activePageId === page.id ? " sheet--active" : ""}`}
      key={page.id}
      onPointerDownCapture={() => s.setActivePage(page.id)}
      onDragOver={(event) => {
        if (!carriesPicture(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const half = halfOf(event);
        if (half !== dropTo) setDropTo(half);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTo(null);
      }}
      onDrop={async (event) => {
        const kind = carriesPicture(event);
        setDropTo(null);
        if (!kind) return;
        event.preventDefault();
        const half = halfOf(event);
        if (kind === "library") {
          const ref = event.dataTransfer.getData(PICTURE_MIME);
          if (half === "bg") await s.backgroundPages([page.id], ref);
          else s.placeFromLibrary(page.id, ref, "på siden");
          return;
        }
        const [file] = droppedImages(event);
        if (!file) return;
        if (half === "bg") await s.uploadBackground([page.id], file);
        else await s.addPageImage(page.id, file);
      }}
    >
      {run && <Comparison run={run} />}
      {/*
       * The page's shape, in one pill above the sheet.
       *
       * What the page is called and where it sits moved up
       * into the header — see `PageHead`. What is left here
       * is what it IS: how many offers, in which layout,
       * what it is printed on. Order, image pages and
       * removal are rarer and sit behind ⋯; nothing the
       * old bar held is gone.
       */}
      {/*
        * What the page SAYS, right above it: its number, the
        * heading and the theme line. They sat in the header,
        * far from the sheet they are printed on.
        */}
      <div className="pagehead">
        <span className="pagehead__no">Side {index + 1}</span>
        <input
          className="pagehead__title"
          value={page.title}
          placeholder="Overskrift"
          onChange={(event) => s.setPageTitle(page.id, event.target.value)}
        />
        <input
          className="pagehead__theme"
          value={page.subtitle}
          placeholder="Underoverskrift (valgfri)"
          onChange={(event) => s.setPageSubtitle(page.id, event.target.value)}
        />
      </div>
      <div className="sheet__paper">
      <PageView
        page={page}
        template={template}
        brand={brand}
        offers={offers}
        pageIndex={index}
        pageNumber={index + 1}
        selectedOfferId={s.selectedOfferId}
        selectedPart={s.selectedPart}
        onSelectOffer={s.select}
        selectedIncitoBlock={s.selectedIncito?.pageId === page.id ? s.selectedIncito.path : null}
        onSelectIncitoBlock={(path) => s.selectIncito(page.id, path)}
        onMoveIncitoBlock={(path, at, gesture) => s.moveIncito(page.id, path, { ...at, absolute: true }, gesture)}
        onScaleIncitoBlock={(path, by) => s.moveIncito(page.id, path, { scaleBy: by })}
        onIncitoMoveEnd={s.endGesture}
        incitoDropType={OFFER_MIME}
        onDropOnIncitoOffer={(viewId, event) => {
          const dragged = event.dataTransfer?.getData(OFFER_MIME);
          if (!dragged || !page.incito) return;
          // The cell that offer stands in — by the publication's record, or by its own id.
          const slotId = incitoSlotOf(page, viewId);
          if (slotId) void s.fillSlot(page.id, slotId, droppedOffers(dragged, s.librarySelection));
        }}
        /* The composed pictures the page's clusters were
         stood up from, each laid over its own tile — see
         `Ghost`. The answer to "did it use my picture?",
         drawn rather than described. */
        ghosts={s.ghosts.filter((entry) => entry.shown)}
        /* The chain's own pictures are dragged like anything
         else on the page; the sliders beside them stay for
         the two things a drag cannot say. */
        onMoveDecor={(decorId, offset, gesture) =>
          s.updatePageImage(
            page.id,
            decorId,
            { offsetX: offset.x, offsetY: offset.y },
            gesture,
          )
        }
        onDecorMoveEnd={s.endGesture}
        selectedDecorId={s.selectedDecorId}
        selectedNoteId={s.selectedNoteId}
        onSelectNote={s.selectNote}
        onMoveNote={(noteId, at, gesture) => s.updateNote(page.id, noteId, at, gesture)}
        onNoteMoveEnd={s.endGesture}
        /* The heading and the theme line are moved on the
         page like everything else; the fields in the bar
         above stay for typing the words. */
        textDecorator={(part) => (
          <PageTextEditor pageId={page.id} part={part} />
        )}
        slotDecorator={(slotId) => {
          const placement = page.placements.find(
            (p) => p.slotId === slotId,
          );
          return (
            <TileEditor
              pageId={page.id}
              slotId={slotId}
              {...(placement ? { offerId: placement.offerId } : {})}
            />
          );
        }}
      />
      {s.layoutEditPageId === page.id
        ? <LayoutEditor page={page} template={template} />
        : <EmptyCells page={page} template={template} />}
      {dropTo && (
        <div className={bg.zones} aria-hidden="true">
          <div className={`${bg.zone}${dropTo === "bg" ? ` ${bg.zoneOn}` : ""}`}>
            <b>Som baggrund</b>
            <span>Under hele siden, bag varerne</span>
          </div>
          <div className={`${bg.zone}${dropTo === "pic" ? ` ${bg.zoneOn}` : ""}`}>
            <b>Som billede på siden</b>
            <span>Oven på — flyt det bagefter</span>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
