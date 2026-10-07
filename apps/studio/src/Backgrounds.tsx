import { useState, type DragEvent } from 'react';
import type { CatalogPage } from '@incitio/schema';
import { useStudio } from './state.js';
import styles from './Backgrounds.module.css';

/** A picture from the chain's library, dragged — onto a page card, or onto the open sheet. */
export const PICTURE_MIME = 'application/x-incitio-picture';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** The image files among what was dropped. */
export function droppedImages(event: DragEvent): File[] {
  return [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
}

/** Whether a drag carries something that can become a background. */
export function carriesPicture(event: DragEvent): 'file' | 'library' | null {
  const types = event.dataTransfer.types;
  if (types.includes(PICTURE_MIME)) return 'library';
  if (types.includes('Files')) return 'file';
  return null;
}

/**
 * Backgrounds for the whole avis, from the overview.
 *
 * The chain's library as a strip of pages-to-be — each picture shown the
 * way it will lie under a sheet — over the avis itself. Pick pages, then
 * a picture; or drag a picture onto a page; or drop a file from the
 * computer onto one. Choosing what every page is printed on is a job
 * done across the book, not inside one page's drawer, and this is where
 * the book is.
 */
export function BackgroundDock({ pages, picked, setPicked, onClose }: {
  pages: CatalogPage[];
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  onClose: () => void;
}) {
  const uploads = useStudio((s) => s.uploads);
  const busy = useStudio((s) => Boolean(s.busy));
  const backgroundPages = useStudio((s) => s.backgroundPages);
  const uploadBackground = useStudio((s) => s.uploadBackground);
  const addToLibrary = useStudio((s) => s.addToLibrary);
  const [nudge, setNudge] = useState(false);

  const offerPages = pages.filter((page) => page.kind !== 'image');
  const chosen = [...picked];
  const uses = new Map<string, number>();
  for (const page of offerPages) {
    const url = page.background?.imageUrl;
    if (url) uses.set(url, (uses.get(url) ?? 0) + 1);
  }
  // Pictures already under a page that never went through the library still belong in the strip.
  const library = [
    ...uploads.map((u) => ({ ref: u.ref, name: u.name.replace(/\.[a-z0-9]+$/i, '') })),
    ...[...uses.keys()].filter((url) => !uploads.some((u) => u.ref === url)).map((url) => ({
      ref: url, name: offerPages.find((p) => p.background?.imageUrl === url)?.background?.subject || 'Baggrund',
    })),
  ];

  const apply = (ref: string | null) => {
    if (chosen.length === 0) {
      setNudge(true);
      window.setTimeout(() => setNudge(false), 1200);
      return;
    }
    void backgroundPages(chosen, ref);
  };

  const n = chosen.length;
  return (
    <section className={styles.dock} aria-label="Baggrunde">
      <header className={styles.head}>
        <div>
          <h3>Baggrunde</h3>
          <p className={`${styles.say}${nudge ? ` ${styles.nudge}` : ''}`} aria-live="polite">
            {n === 0
              ? 'Klik de sider, der skal have samme baggrund — eller træk et billede hen på en side.'
              : `${n} ${n === 1 ? 'side' : 'sider'} valgt — klik den baggrund, de skal have.`}
          </p>
        </div>
        <div className={styles.pick} role="group" aria-label="Vælg sider">
          <button onClick={() => setPicked(new Set(offerPages.map((p) => p.id)))}>Alle sider</button>
          <button onClick={() => setPicked(new Set(offerPages.filter((p) => !p.background).map((p) => p.id)))}>Sider uden baggrund</button>
          <button disabled={n === 0} onClick={() => setPicked(new Set())}>Fravælg</button>
        </div>
        <button className={styles.close} onClick={onClose}>Færdig</button>
      </header>

      <ul className={styles.strip}>
        <li>
          <label className={`${styles.tile} ${styles.upload}${busy ? ` ${styles.busy}` : ''}`} title="Læg billeder fra computeren i kædens bibliotek — og under de valgte sider">
            <input
              type="file"
              accept={ACCEPT}
              multiple
              disabled={busy}
              onChange={async (event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length === 0) return;
                // The first one goes under the chosen pages; the rest wait in the library.
                if (n > 0) await uploadBackground(chosen, files[0]!);
                else await addToLibrary(files[0]!);
                for (const file of files.slice(1)) await addToLibrary(file);
              }}
            />
            <span className={styles.plus} aria-hidden="true">+</span>
            <span className={styles.tileName}>Fra computeren</span>
          </label>
        </li>
        <li>
          <button className={`${styles.tile} ${styles.none}`} onClick={() => apply(null)} title="Tag baggrunden af de valgte sider">
            <span className={styles.tileName}>Ingen baggrund</span>
          </button>
        </li>
        {library.map((picture) => (
          <li key={picture.ref}>
            <button
              className={styles.tile}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PICTURE_MIME, picture.ref);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => apply(picture.ref)}
              title={n ? `Læg ${picture.name} under ${n} ${n === 1 ? 'side' : 'sider'}` : `${picture.name} — vælg sider, eller træk den hen på en side`}
            >
              <span className={styles.shot} style={{ backgroundImage: `url("${picture.ref}")` }} />
              <span className={styles.tileName}>{picture.name}</span>
              {uses.get(picture.ref) ? <span className={styles.uses}>{uses.get(picture.ref)} {uses.get(picture.ref) === 1 ? 'side' : 'sider'}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
