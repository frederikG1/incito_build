import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1300 } });
await p.goto('file:///Users/frederikgronbaek/Documents/Incitio_attempt/.data/out/superbrugsen-ai.html');
await p.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 20000 }).catch(()=>{});
console.log(await p.evaluate(() => {
  const tile = document.querySelector('.page .tile');
  const r = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
  const img = tile.querySelector('img');
  const ir = img.getBoundingClientRect();
  const s = Math.min(ir.width/img.naturalWidth, ir.height/img.naturalHeight);
  return JSON.stringify({
    tile: r(tile), media: r(tile.querySelector('.tile__media')),
    price: r(tile.querySelector('.price')), info: r(tile.querySelector('.tile__info')),
    tags: r(tile.querySelector('.tile__tags')),
    imgBox: r(img), imgNat: [img.naturalWidth, img.naturalHeight],
    paintedH: Math.round(img.naturalHeight * s),
    fillOfMedia: (img.naturalHeight * s / tile.querySelector('.tile__media').getBoundingClientRect().height).toFixed(2),
  }, null, 1);
}));
await b.close();
