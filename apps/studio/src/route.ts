import { useStudio, type StudioState, type StudioView } from './state.js';

/**
 * Where you are, in the address bar.
 *
 * `#/<chain>` is the chain's front page; `#/<chain>/<avis>/<screen>` a
 * screen of one avis, and `/<page>` after `side` one page of it.
 * `#/<chain>/varedesigns` is the chain's designs, `/<design>` one of them. So a
 * reload comes back on the screen it left, the back button goes back,
 * and "side 20 i uge 40" is a link you can send.
 *
 * A hash, not a path: the studio is one file, and nothing in front of
 * it has to know about its screens.
 */

export interface Route {
  brandId: string | null;
  docId: string | null;
  view: StudioView | null;
  pageId: string | null;
  /** The design open on `varedesigns`; absent elsewhere. */
  designId?: string | null;
}

/** The chain's own pages, addressed without an avis. */
const CHAIN_SCREEN = 'varedesigns';

/** Screens of an open avis. The front page needs no avis and has no word here. */
const SCREENS: readonly StudioView[] = ['bog', 'side', 'udgaver', 'varer', 'pladser', 'live', 'godkend'];

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts[1] === CHAIN_SCREEN) {
    return { brandId: parts[0]!, docId: null, view: 'varedesigns', pageId: null, designId: parts[2] ?? null };
  }
  const [brandId = null, docId = null, said = null, pageId = null] = parts;
  const view = said && (SCREENS as readonly string[]).includes(said) ? said as StudioView : null;
  return {
    brandId,
    docId,
    view: docId ? (view ?? 'bog') : brandId ? 'hjem' : null,
    pageId: view === 'side' ? pageId : null,
  };
}

export function formatRoute(route: Route): string {
  if (!route.brandId) return '';
  const parts = [route.brandId];
  if (route.view === 'varedesigns') {
    parts.push(CHAIN_SCREEN);
    if (route.designId) parts.push(route.designId);
  } else if (route.docId && route.view && route.view !== 'hjem') {
    parts.push(route.docId, route.view);
    if (route.view === 'side' && route.pageId) parts.push(route.pageId);
  }
  return `#/${parts.map(encodeURIComponent).join('/')}`;
}

/** The route the studio is showing now. */
export function routeOf(s: Pick<StudioState, 'brandId' | 'brand' | 'document' | 'variantBase' | 'view' | 'openPageId' | 'designEditing'>): Route {
  const document = s.variantBase ?? s.document;
  if (s.view === 'varedesigns') {
    return { brandId: s.brand ? s.brandId : null, docId: null, view: 'varedesigns', pageId: null, designId: s.designEditing };
  }
  return {
    brandId: s.brand ? s.brandId : null,
    docId: document?.id ?? null,
    view: s.view,
    pageId: s.view === 'side' ? s.openPageId : null,
  };
}

/** Take the studio to a route: the chain, the avis, then the screen. */
async function go(route: Route) {
  const s = () => useStudio.getState();
  if (route.brandId && s().brandId !== route.brandId) {
    if (!s().brands.some((brand) => brand.id === route.brandId)) return;
    await s().signInAs(route.brandId);
  }
  if (route.view === 'varedesigns') {
    // Gone since the link was made: the list, not an empty editor.
    const id = route.designId && s().brand?.offerDesigns.some((d) => d.id === route.designId) ? route.designId : null;
    if (s().view !== 'varedesigns') s().setDesignsOpen(true, { designId: id });
    else s().setDesignEditing(id);
    return;
  }
  if (!route.docId) {
    if (route.view === 'hjem') s().openHome();
    return;
  }
  if ((s().variantBase ?? s().document)?.id !== route.docId) await s().openCatalogue(route.docId);
  if ((s().variantBase ?? s().document)?.id !== route.docId) return;
  const document = s().variantBase ?? s().document!;
  switch (route.view) {
    case 'side':
      s().openPage(route.pageId && document.pages.some((page) => page.id === route.pageId) ? route.pageId : null);
      break;
    case 'udgaver': s().openEditions(); break;
    case 'varer': s().openGoods(); break;
    case 'pladser': case 'live': case 'godkend': s().openBoard(route.view); break;
    default: if (s().view !== 'bog') s().openPage(null);
  }
}

/**
 * Start the studio from the address, and keep the address after it.
 *
 * A change of avis or screen is a new history entry; scrolling from
 * page to page inside one is not — the back button should leave the
 * page view, not walk back through every page you scrolled past.
 */
export function startRouting(): () => void {
  let applying = true;
  let shown = routeOf(useStudio.getState());

  const follow = async (route: Route) => {
    applying = true;
    try { await go(route); } finally {
      applying = false;
      shown = routeOf(useStudio.getState());
      write(shown, true);
    }
  };

  const write = (route: Route, replace: boolean) => {
    const hash = formatRoute(route);
    if (!hash || hash === window.location.hash) return;
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
  };

  const unsubscribe = useStudio.subscribe((state) => {
    if (applying || state.busy === 'Skifter kæde…') return;
    const now = routeOf(state);
    if (!now.brandId) return;
    // Opening a design is a step the back button takes back, as opening an avis is.
    const sameScreen = now.brandId === shown.brandId && now.docId === shown.docId && now.view === shown.view
      && (now.designId ?? null) === (shown.designId ?? null);
    if (sameScreen && now.pageId === shown.pageId) return;
    write(now, sameScreen);
    shown = now;
  });

  const onPop = () => { void follow(parseRoute(window.location.hash)); };
  window.addEventListener('popstate', onPop);

  const asked = parseRoute(window.location.hash);
  void (async () => {
    await useStudio.getState().start(asked.brandId);
    await follow(asked.brandId ? asked : routeOf(useStudio.getState()));
  })();

  return () => {
    unsubscribe();
    window.removeEventListener('popstate', onPop);
  };
}
