import { useStudio } from './state.js';

/**
 * The chain's own pictures, as a drawer.
 *
 * Balloons, birthday flags, a paper texture — the things a chain puts
 * on its pages that are not products and that no feed will ever carry.
 * Uploaded once and kept, because the alternative is what the studio
 * did before: the bytes went to disk, nothing recorded that they had,
 * and a picture could only be reached again through a document that
 * already pointed at it. Upload a background, press undo, and it was
 * gone.
 *
 * Scoped to the chain, structurally — see `uploadStore`, where the
 * files live under the chain's own folder, and the `uploads` table,
 * where the rows carry a `brand_id` like every other row here.
 *
 * Two buttons per picture rather than a drag. Where a picture lands is
 * the decision being made — under the whole sheet, or pinned in a
 * corner at a quarter of its width — and those are different enough
 * that a drop which landed it and then asked would be asking too late.
 */
export function Pictures() {
  const uploads = useStudio((s) => s.uploads);
  const activePageId = useStudio((s) => s.activePageId);
  const place = useStudio((s) => s.placeFromLibrary);
  const add = useStudio((s) => s.addToLibrary);
  const remove = useStudio((s) => s.removeFromLibrary);
  const busy = useStudio((s) => Boolean(s.busy));
  const addPageBackground = useStudio((s) => s.addPageBackground);
  const addPageImage = useStudio((s) => s.addPageImage);
  const at = useStudio((s) => s.document?.pages.findIndex((page) => page.id === activePageId) ?? -1);

  /* A file straight from the computer onto this page — the one-step way,
     for a picture that is only for this avis. */
  const upload = (onto: (pageId: string, file: File) => Promise<void>) => (
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file && activePageId) await onto(activePageId, file);
    }
  );

  return (
    <>
      {activePageId && at >= 0 && (
        <div className="pics__here">
          <b>Til side {at + 1}</b>
          <div className="pics__uploads">
            <label className={`pics__up${busy ? ' pics__add--busy' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy}
                onChange={upload(addPageBackground)} />
              <span>Upload baggrund<em>under hele siden</em></span>
            </label>
            <label className={`pics__up${busy ? ' pics__add--busy' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy}
                onChange={upload(addPageImage)} />
              <span>Upload billede<em>oven på siden</em></span>
            </label>
          </div>
        </div>
      )}

      <label className={`pics__add${busy ? ' pics__add--busy' : ''}`}>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          disabled={busy}
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            // One after another: each is an upload, and the drawer
            // should fill in the order they were picked.
            for (const file of files) await add(file);
          }}
        />
        <span>+ Læg billeder i biblioteket</span>
      </label>

      {uploads.length === 0 ? (
        <p className="library__empty">
          Ingen billeder endnu. Læg kædens egne ind — balloner, flag, mønstre — så
          ligger de her til næste avis.
        </p>
      ) : (
        <ul className="pics">
          {uploads.map((picture) => (
            <li className="pic-card" key={picture.ref}>
              <span className="pic-card__shot">
                <img src={picture.ref} alt="" loading="lazy" />
              </span>
              <span className="pic-card__name" title={picture.name}>{picture.name}</span>
              <span className="pic-card__does">
                {/* Disabled rather than hidden with no page chosen:
                    the reason a button does nothing should be visible
                    before it is pressed. */}
                <button
                  disabled={!activePageId}
                  title={activePageId
                    ? 'Læg det under hele arket'
                    : 'Klik på en side først'}
                  onClick={() => {
                    if (activePageId) place(activePageId, picture.ref, 'baggrund');
                  }}
                >Baggrund</button>
                <button
                  disabled={!activePageId}
                  title={activePageId
                    ? 'Læg det oven på siden, i et hjørne'
                    : 'Klik på en side først'}
                  onClick={() => {
                    if (activePageId) place(activePageId, picture.ref, 'på siden');
                  }}
                >På siden</button>
                <button
                  className="pic-card__drop"
                  title="Tag det ud af biblioteket — sider der bruger det beholder det"
                  onClick={() => void remove(picture.ref)}
                >×</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
