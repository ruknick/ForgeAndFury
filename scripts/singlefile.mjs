// Inlines the demo build's CSS and JS into dist-demo/relic-clash.html (one self-contained file).
import fs from 'node:fs';
import path from 'node:path';

const dir = 'dist-demo';
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, f) => `<style>\n${fs.readFileSync(path.join(dir, f), 'utf8')}\n</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, f) => {
  const js = fs.readFileSync(path.join(dir, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});
html = html.replace('<meta name="description"', '<meta name="description"');
fs.writeFileSync(path.join(dir, 'relic-clash.html'), html);
console.log(`dist-demo/relic-clash.html ${(html.length / 1024).toFixed(0)} KB`);
