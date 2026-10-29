// Bundles index.html + style.css + scripts into one self-contained page body
// for publishing as a claude.ai artifact (the host adds doctype/head/body).
//   node scripts/build-artifact.js [out]   (default: dist/horsey.html)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'horsey.html'));

let html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fitMeta = (html.match(/<meta name="claude:viewport-fit-sides"[^>]*>/) || [''])[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);

const page = `${title}\n${fitMeta}\n<style>\n${read('style.css')}\n</style>\n${body.trim()}\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(page.length / 1024).toFixed(1)} KiB)`);
