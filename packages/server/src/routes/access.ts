import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { findBrand, listBrands } from '@incitio/brands';
import { CACHED, cachedImage } from '@incitio/decor';
import { SESSION_COOKIE, SESSION_MS } from '../auth.js';
import { BRAND_HEADER, type Scope, chainBrand } from '../http.js';
import type { RouteContext } from '../index.js';

/** Hvem spørger: session, login, kædelisten og kæden en forespørgsel gælder. */
export function accessRoutes(app: Hono<Scope>, ctx: RouteContext) {
  const { store, options, auth, throttle } = ctx;
  /*
   * Who is asking, read once per request: the session cookie the studio
   * carries, or a bearer token for a script. Unknown or expired reads as
   * signed out — the routes below decide whether that matters.
   */
  app.use('/api/*', async (c, next) => {
    const bearer = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    const token = bearer ?? getCookie(c, SESSION_COOKIE) ?? '';
    c.set('user', auth === 'on' && token ? store.accounts.session(token) : null);
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  /** Whether sign-in is on, and who is signed in. The studio asks this first. */
  app.get('/api/auth/me', (c) => c.json({ auth, user: c.get('user') }));

  app.post('/api/auth/login', async (c) => {
    if (auth !== 'on') return c.json({ error: 'login er slået fra på denne server' }, 404);
    const parsed = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(500) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'skriv e-mail og adgangskode' }, 422);
    const { email, password } = parsed.data;
    const client = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'lokal';
    const keys = [`email:${email.toLowerCase()}`, `client:${client}`];
    if (throttle.blocked(...keys)) return c.json({ error: 'for mange forsøg — prøv igen om et kvarter' }, 429);
    const session = store.accounts.login(email, password);
    if (!session) {
      throttle.failed(...keys);
      return c.json({ error: 'forkert e-mail eller adgangskode' }, 401);
    }
    throttle.cleared(...keys);
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.production === true,
      path: '/api',
      maxAge: Math.floor(SESSION_MS / 1000),
    });
    return c.json({ user: session.user, expiresAt: session.expiresAt });
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) store.accounts.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/api' });
    return c.json({ ok: true });
  });

  /*
   * The chain's product photographs, through this server's disk cache —
   * see `cachedImage`. The studio's service worker (`image-sw.js`) sends
   * every request for the image service here, so the service is asked
   * once per picture and size, not once per tile per reload. Only the
   * hosts `CACHED` names; anything else is refused, not fetched.
   */
  app.get('/api/images', async (c) => {
    const url = c.req.query('u') ?? '';
    if (!CACHED.test(url)) return c.json({ error: 'not an image service this server caches' }, 400);
    const image = await cachedImage(url);
    if (!image) return c.body(null, 404, { 'cache-control': 'no-store' });
    return c.body(new Uint8Array(image.bytes), 200, {
      'content-type': image.mimeType,
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  /** The chains this deployment serves. The only unscoped route. */
  app.get('/api/brands', (c) => {
    if (auth === 'off') return c.json({ brands: listBrands() });
    const user = c.get('user');
    if (!user) return c.json({ error: 'log ind' }, 401);
    // Only the chains this person works for — the others are not theirs to see.
    const mine = new Set(user.brands.map((m) => m.brandId));
    return c.json({ brands: listBrands().filter((brand) => mine.has(brand.id)) });
  });

  /*
   * Everything below is scoped to one chain.
   *
   * Resolved here, once, and stashed on the context. A route that wants
   * the brand takes it from the context; a route cannot accidentally
   * trust a brand id out of the body, because it never sees one.
   */
  app.use('/api/brand/*', async (c, next) => {
    const id = c.req.header(BRAND_HEADER) ?? '';
    if (auth === 'on') {
      const user = c.get('user');
      if (!user) return c.json({ error: 'log ind' }, 401);
      // The header names the chain; the membership is what allows it.
      if (!user.brands.some((m) => m.brandId === id)) return c.json({ error: 'ikke din kæde' }, 403);
    }
    const definition = findBrand(id);
    if (!definition) {
      return c.json(
        { error: 'ukendt kæde', detail: `Sæt ${BRAND_HEADER} til en af: ${listBrands().map((b) => b.id).join(', ')}` },
        403,
      );
    }
    // With the chain's own rules and designs folded in, so every route that
    // renders — the PDF included — draws what the studio shows.
    c.set('brand', chainBrand(store, definition, options.defaultDesigns));
    await next();
  });
}
