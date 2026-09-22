import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAND_HEADER, KEY_HEADER, createApp, Store } from '../index.js';

/**
 * The key an editor pastes into the studio, checked where it is read.
 *
 * `/api/brand/layout` is the route that asks for the image key FIRST,
 * before a directory, a body or anything else — so what it answers
 * says exactly which key the server found, with no network call and
 * nothing spent.
 */
describe('the image-model key', () => {
  let app: ReturnType<typeof createApp>;
  const env = { ...process.env };

  const ask = (headers: Record<string, string>) => app.request('/api/brand/layout', {
    method: 'POST',
    headers: { [BRAND_HEADER]: 'netto', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ feed: 'x' }),
  });

  const said = async (response: Response) => (await response.json()) as { error: string };

  beforeEach(() => {
    app = createApp(new Store(':memory:'));
    delete process.env['GEMINI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => { process.env = { ...env }; });

  it('refuses when neither the server nor the browser has one', async () => {
    const response = await ask({});
    expect(response.status).toBe(503);
    expect((await said(response)).error).toMatch(/billedmodellen/);
  });

  it('accepts the one the browser sent, with no key on the server', async () => {
    const response = await ask({ [KEY_HEADER]: 'AIzaSyTESTTESTTESTTESTTESTTESTTEST' });
    // Past the image-model guard — it now stops at the NEXT key, which
    // is the reading model's and is nobody's business but the server's.
    expect((await said(response)).error).toMatch(/læser layoutet/);
  });

  it('ignores a header that is not shaped like a key', async () => {
    const response = await ask({ [KEY_HEADER]: 'nope' });
    expect((await said(response)).error).toMatch(/billedmodellen/);
  });

  it("falls back to the server's own key when the browser sends none", async () => {
    process.env['GEMINI_API_KEY'] = 'AIzaSyFROMTHEENVIRONMENTFILE';
    expect((await said(await ask({}))).error).toMatch(/læser layoutet/);
  });
});
