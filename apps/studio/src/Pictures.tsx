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

  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
  const onPage = activePageId && at >= 0;

  return (
    <>
      <header className="pp__head">
        <h2>Billeder og baggrund</h2>
        {onPage && <span className="pp__page">Side {at + 1}</span>}
      </header>

      {onPage && (
        <section className="pp__sec">
          <h3 className="pp__title">Fra computeren</h3>
          <div className="pp__uploads">
            <label className={`pp__up${busy ? ' is-busy' : ''}`}>
              <input type="file" accept={ACCEPT} disabled={busy} onChange={upload(addPageBackground)} />
              <span className="pp__glyph pp__glyph--bg" aria-hidden="true" />
              <span className="pp__uptext"><b>Baggrund</b><em>Fylder hele siden, bag varerne</em></span>
            </label>
            <label className={`pp__up${busy ? ' is-busy' : ''}`}>
              <input type="file" accept={ACCEPT} disabled={busy} onChange={upload(addPageImage)} />
              <span className="pp__glyph pp__glyph--pin" aria-hidden="true" />
              <span className="pp__uptext"><b>Billede</b><em>Ligger oven på siden — flyt det bagefter</em></span>
            </label>
          </div>
        </section>
      )}

      <section className="pp__sec">
        <div className="pp__row">
          <h3 className="pp__title">
            Kædens bibliotek{uploads.length > 0 && <span className="pp__count">{uploads.length}</span>}
          </h3>
          <label className={`pp__add${busy ? ' is-busy' : ''}`}>
            <input
              type="file"
              accept={`${ACCEPT},image/svg+xml`}
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
            <span>+ Tilføj billeder</span>
          </label>
        </div>

        {uploads.length === 0 ? (
          <p className="pp__empty">
            Ingen billeder endnu. Læg kædens egne ind — balloner, flag, mønstre — så
            ligger de her til næste avis.
          </p>
        ) : (
          <ul className="pp__grid">
            {uploads.map((picture) => (
              <li className="pp__card" key={picture.ref}>
                <span className="pp__shot">
                  <img src={picture.ref} alt="" loading="lazy" />
                  <button
                    className="pp__drop"
                    title="Tag det ud af biblioteket — sider der bruger det beholder det"
                    aria-label={`Fjern ${picture.name}`}
                    onClick={() => void remove(picture.ref)}
                  >×</button>
                </span>
                <span className="pp__name" title={picture.name}>{picture.name}</span>
                {/* Disabled rather than hidden with no page chosen:
                    the reason a button does nothing should be visible
                    before it is pressed. */}
                <span className="pp__does">
                  <button
                    disabled={!activePageId}
                    title={activePageId ? 'Læg det under hele siden' : 'Klik på en side først'}
                    onClick={() => { if (activePageId) place(activePageId, picture.ref, 'baggrund'); }}
                  >Baggrund</button>
                  <button
                    disabled={!activePageId}
                    title={activePageId ? 'Læg det oven på siden, i et hjørne' : 'Klik på en side først'}
                    onClick={() => { if (activePageId) place(activePageId, picture.ref, 'på siden'); }}
                  >På siden</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
