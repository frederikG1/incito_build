/**
 * How many pages the file the editor just handed in actually has.
 *
 * Read in the browser, from the bytes, before anything is uploaded —
 * the panel has to be able to say "af 30 sider" the moment the file
 * lands, and a round trip to ask the server how long its own upload is
 * would be a second copy of a 13MB file for one integer.
 *
 * Counted by pdf.js rather than by looking for `/Type /Page` in the
 * bytes. Modern PDFs keep their page tree in compressed object streams,
 * so the page objects are not in the file as text at all: the same
 * 30-page leaflet this was written against counts as 138 that way, and
 * a page count that is wrong by a factor of four is worse than none —
 * it is a run that asks for pages the file does not have.
 */

/** The pdf.js surface used here. Typed structurally; see `PdfjsLike`. */
interface Pdfjs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<{ numPages: number }>;
  };
}

let loading: Promise<Pdfjs> | null = null;

/**
 * pdf.js, loaded once and only when a PDF is actually handed in.
 *
 * Dynamic because it is the heaviest thing in this app by a wide margin
 * and most sessions never upload a PDF: a static import would put it in
 * the bundle every editor downloads to move a price two millimetres.
 */
async function library(): Promise<Pdfjs> {
  loading ??= (async () => {
    const api = await import('pdfjs-dist') as unknown as Pdfjs;
    /*
     * The worker is resolved through Vite rather than named by a path.
     *
     * `new URL(..., import.meta.url)` is what lets the bundler see the
     * file and emit it beside the app; a bare string works in dev and
     * 404s in a build, which is the worst of the two failures because
     * it only shows up after deploying.
     */
    api.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    return api;
  })();
  return loading;
}

/**
 * The page count, or `null` when the file cannot be read as a PDF.
 *
 * Null rather than a throw, and never fatal: a file pdf.js cannot open
 * is still a file the editor may want to send — the server rasterises
 * with its own copy of pdf.js and may well manage it — so what is lost
 * here is the count, not the reference.
 */
export async function countPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const api = await library();
    // A copy: pdf.js TRANSFERS the array it is given to its worker, and
    // the caller still has to base64 these very bytes for the upload.
    const doc = await api.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    return doc.numPages > 0 ? doc.numPages : null;
  } catch {
    return null;
  }
}
