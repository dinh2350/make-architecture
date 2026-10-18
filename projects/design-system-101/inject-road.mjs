import fs from 'node:fs';

const [, , specPath, htmlPath] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const html = fs.readFileSync(htmlPath, 'utf8');

const comps = new Map(spec.components.map((c) => [c.id, c]));
function bbox(ids) {
  const xs0 = ids.map((i) => comps.get(i).pos[0]);
  const xs1 = ids.map((i) => comps.get(i).pos[0] + comps.get(i).size[0]);
  const ys0 = ids.map((i) => comps.get(i).pos[1]);
  const ys1 = ids.map((i) => comps.get(i).pos[1] + comps.get(i).size[1]);
  return { x0: Math.min(...xs0), x1: Math.max(...xs1), y0: Math.min(...ys0), y1: Math.max(...ys1) };
}

const boxes = spec.boundaries.map((b) => bbox(b.wraps));
const half = boxes.length / 2;
const left = boxes.slice(0, half);
const right = boxes.slice(half);

const leftRight = Math.max(...left.map((b) => b.x1));
const rightLeft = Math.min(...right.map((b) => b.x0));
const barCx = (leftRight + rightLeft) / 2;
const barW = 16;
const barX = barCx - barW / 2;

const pairMidY = left.map((l, i) => {
  const r = right[i];
  const lc = (l.y0 + l.y1) / 2;
  const rc = (r.y0 + r.y1) / 2;
  return (lc + rc) / 2;
});

const overallTop = Math.min(...left.map((b) => b.y0), ...right.map((b) => b.y0));
const overallBottom = Math.max(...left.map((b) => b.y1), ...right.map((b) => b.y1));

function toDataUri(path) {
  const buf = fs.readFileSync(path);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const LOGOS_DIR = '/Users/devinnguyen/Documents/project/archify/archify/assets/logos';
// mascot-desk-person.png carries a ~90px stub of the road's own pole above
// the character's head (baked into the crop); trimmed.png drops that stub
// so this overlay's own bar is the only pole drawn, with a clean edge where
// the character starts instead of two mismatched greys side by side.
const browserW = 58;
const browserH = Math.round(browserW * 217 / 235);
const deskW = 52;
const deskH = Math.round(deskW * 207 / 150);

const browserTopY = 10;
const barTop = browserTopY + browserH - 6;
const deskTopY = overallBottom + 24;
const barBottom = deskTopY + 10;

const arrows = pairMidY.map((midY) => `
        <text x="${barX - 10}" y="${midY + 5}" text-anchor="end" font-size="16" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="3" paint-order="stroke" font-family="monospace">&#10094;</text>
        <text x="${barX + barW + 10}" y="${midY + 5}" text-anchor="start" font-size="16" font-weight="700" fill="#0f172a" stroke="#f8fafc" stroke-width="3" paint-order="stroke" font-family="monospace">&#10095;</text>`).join('');

const overlay = `
        <!-- Road overlay: decorative, not a semantic relationship -->
        <g data-graph-role="decoration" aria-hidden="true">
          <rect x="${barX}" y="${barTop}" width="${barW}" height="${barBottom - barTop}" rx="8" fill="#94a3b8" opacity="0.9"/>
          <line x1="${barCx}" y1="${barTop + 4}" x2="${barCx}" y2="${barBottom - 4}" stroke="#0f172a" stroke-width="3" stroke-dasharray="10,8" stroke-linecap="round"/>
          ${arrows}
          <image href="${toDataUri(`${LOGOS_DIR}/mascot-browser.png`)}" x="${barCx - browserW / 2}" y="${browserTopY}" width="${browserW}" height="${browserH}"/>
          <image href="${toDataUri(new URL('./mascot-desk-person-trimmed.png', import.meta.url))}" x="${barCx - deskW / 2}" y="${deskTopY}" width="${deskW}" height="${deskH}"/>
        </g>
`;

const marker = '        <!-- Legend -->';
if (!html.includes(marker)) throw new Error('legend marker not found; check template');
const updated = html.replace(marker, `${marker}\n${overlay}`);
fs.writeFileSync(htmlPath, updated);
console.log('injected road overlay: barCx=', barCx, 'barTop=', barTop, 'barBottom=', barBottom);
