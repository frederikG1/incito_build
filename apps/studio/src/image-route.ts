/**
 * The chain's product photographs, only ever through the API's cache.
 *
 * Republica wrote to ask why our key fetched 60–200.000 pictures a day:
 * the studio asked its image service for every picture on every reload.
 * Now every address of that service is rewritten to `/api/images`, which
 * fetches each picture once per machine (`cachedImage` in @incitio/decor).
 *
 * Rewritten where the browser is told to load it — an image's `src`, a
 * `style` (attribute, `setProperty` or, after the fact, any other way),
 * HTML set as text, `fetch` — rather than at each of the dozens
 * of places the studio and the renderer draw a photograph, because the
 * addresses also stand in saved avis, and in Incito markup built as text,
 * and must stay the service's own there. Installed when this module is
 * imported, before anything is drawn.
 *
 * `image-sw.js` is the net under it: a service worker sends whatever this
 * misses (a stylesheet's `url()`, say) the same way. Not the only layer,
 * because a browser that cannot run one — Claude's own preview pane —
 * would otherwise fetch straight from the service.
 */
const SERVICE = /^https:\/\/imageservice\d*\.republica\.dk\//;
/** The same addresses inside CSS or HTML text; stops at a quote, a bracket or an escaped quote. */
const IN_TEXT = /https:\/\/imageservice\d*\.republica\.dk\/(?:(?!&quot;|&#39;|&#34;)[^\s"'()<>\\])+/g;

/** `url` through the API's cache when it is the image service's, else unchanged. */
export function viaCache(url: string): string {
  return SERVICE.test(url) ? `/api/images?u=${encodeURIComponent(url)}` : url;
}

/** Every image-service address in a piece of CSS or HTML, through the cache. */
export function viaCacheIn(text: string): string {
  if (!text.includes('republica.dk')) return text;
  // An address inside HTML has its `&` written `&amp;`.
  return text.replace(IN_TEXT, (url) => viaCache(url.replace(/&amp;/g, '&')).replace(/&/g, '&amp;'));
}

function wrapSetter(
  proto: object, name: string, rewrite: (value: unknown) => unknown,
): void {
  let owner: object | null = proto;
  while (owner && !Object.getOwnPropertyDescriptor(owner, name)) owner = Object.getPrototypeOf(owner);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name);
  if (!owner || !descriptor?.set) return;
  const set = descriptor.set;
  Object.defineProperty(owner, name, {
    ...descriptor,
    set(this: unknown, value: unknown) { set.call(this, rewrite(value)); },
  });
}

const asText = (rewrite: (text: string) => string) => (value: unknown) =>
  (typeof value === 'string' ? rewrite(value) : value);

function install(): void {
  if (typeof window === 'undefined' || (window as { __incitioImages?: true }).__incitioImages) return;
  (window as { __incitioImages?: true }).__incitioImages = true;

  wrapSetter(HTMLImageElement.prototype, 'src', asText(viaCache));
  wrapSetter(Element.prototype, 'innerHTML', asText(viaCacheIn));
  wrapSetter(Element.prototype, 'outerHTML', asText(viaCacheIn));

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const key = name.toLowerCase();
    const next = key === 'src' || key === 'href' ? viaCache(String(value))
      : key === 'style' || key === 'srcset' ? viaCacheIn(String(value))
        : value;
    setAttribute.call(this, name, next);
  };

  const insertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (this: Element, where: InsertPosition, html: string) {
    insertAdjacentHTML.call(this, where, viaCacheIn(html));
  };

  const style = document.documentElement.style;
  wrapSetter(style, 'cssText', asText(viaCacheIn));
  const declarations = Object.getPrototypeOf(style) as CSSStyleDeclaration;
  const setProperty = declarations.setProperty;
  declarations.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string) {
    setProperty.call(this, name, value == null ? value : viaCacheIn(String(value)), priority);
  };

  /*
   * `element.style.backgroundImage = …` — how React writes an inline
   * style — cannot be caught on a prototype: Chrome answers those names
   * on each declaration itself. A style attribute that changed is put
   * right here instead, in the microtask after the change and so before
   * the browser next works out styles, which is when it fetches.
   */
  const restyle = (element: Element): void => {
    const text = element.getAttribute('style');
    if (!text || !text.includes('republica.dk')) return;
    const routed = viaCacheIn(text);
    if (routed !== text) setAttribute.call(element, 'style', routed);
  };
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') restyle(change.target as Element);
      // React styles an element before it is inserted, where no attribute change is seen.
      for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue;
        restyle(node);
        node.querySelectorAll('[style*="republica.dk"]').forEach(restyle);
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });

  const fetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!SERVICE.test(url)) return fetch(input, init);
    return fetch(viaCache(url), typeof input === 'object' && !(input instanceof URL) ? { method: input.method, ...init } : init);
  };
}

install();

/**
 * Whether the service worker controls this page as well. Registered here;
 * resolves `false` when the browser cannot run one or it did not take over
 * within a few seconds. Pictures go through the cache either way.
 */
export const imagesRouted: Promise<boolean> = (async () => {
  const workers = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (!workers) return false;
  try {
    await workers.register('/image-sw.js');
  } catch {
    return false;
  }
  if (workers.controller) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(Boolean(workers.controller)), 5_000);
    workers.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
})();
