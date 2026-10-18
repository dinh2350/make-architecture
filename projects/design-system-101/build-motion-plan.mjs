import fs from 'node:fs';

const [, , specPath, motionHtmlPath, outPath] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const html = fs.readFileSync(motionHtmlPath, 'utf8');

const SECTION_DURATION = 5.0;
const INTRO_DURATION = 5.0;
const OUTRO_DURATION = 5.0;
const TRANSITION = 0.4;
const CAMERA_PAD = 30;
const NODE_DUR = 0.4;
const EDGE_DUR = 0.5;

// Pull each boundary's real rendered box straight from the delivered SVG —
// more reliable than re-deriving it from component positions ourselves.
const frameRe = /data-composition-frame-label="([^"]*)" x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g;
const boxByLabel = new Map();
for (const m of html.matchAll(frameRe)) {
  boxByLabel.set(m[1], { x: Number(m[2]), y: Number(m[3]), width: Number(m[4]), height: Number(m[5]) });
}

const viewBoxMatch = html.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
const fullRect = { x: 0, y: 0, width: Number(viewBoxMatch[1]), height: Number(viewBoxMatch[2]) };

const edgesByFrom = new Map();
for (const conn of spec.connections || []) {
  if (!edgesByFrom.has(conn.from)) edgesByFrom.set(conn.from, []);
  edgesByFrom.get(conn.from).push(conn);
}

const boundaries = [...spec.boundaries].sort((a, b) => {
  const na = parseInt(a.label.match(/^(\d+)\./)?.[1] ?? '0', 10);
  const nb = parseInt(b.label.match(/^(\d+)\./)?.[1] ?? '0', 10);
  return na - nb;
});

function round(n) { return Math.round(n * 100) / 100; }

const nodes = {};
const edges = {};
const camera = [];
const report = [];

// Shot 0: the whole diagram, before anything zooms in.
camera.push({ holdFrom: 0, holdTo: round(INTRO_DURATION - TRANSITION), rect: fullRect });
report.push({ label: '(intro — full diagram)', start: 0, end: INTRO_DURATION });

boundaries.forEach((b, sectionIndex) => {
  const sectionStart = INTRO_DURATION + sectionIndex * SECTION_DURATION;
  const contentBudget = SECTION_DURATION - TRANSITION - NODE_DUR - 0.3; // leave a hold before the cut
  const hubEdges = edgesByFrom.get(b.wraps[0]) || [];
  let itemCount = hubEdges.length ? 1 + hubEdges.length * 2 + (b.wraps.length - 1 - hubEdges.length) : b.wraps.length;
  const stagger = Math.max(0.05, Math.min(0.15, contentBudget / Math.max(1, itemCount - 1)));

  if (hubEdges.length) {
    const hubId = b.wraps[0];
    nodes[hubId] = { at: round(sectionStart), duration: NODE_DUR };
    let latest = sectionStart + NODE_DUR;
    hubEdges.forEach((edge, i) => {
      const edgeAt = sectionStart + NODE_DUR + i * stagger;
      edges[edge.id] = { at: round(edgeAt), duration: EDGE_DUR };
      const leafAt = edgeAt + EDGE_DUR;
      nodes[edge.to] = { at: round(leafAt), duration: NODE_DUR };
      latest = Math.max(latest, leafAt + NODE_DUR);
    });
    const rest = b.wraps.slice(1 + hubEdges.length);
    rest.forEach((id, i) => {
      const at = latest + 0.15 + i * stagger;
      nodes[id] = { at: round(at), duration: NODE_DUR };
    });
  } else {
    b.wraps.forEach((id, i) => {
      nodes[id] = { at: round(sectionStart + i * stagger), duration: NODE_DUR };
    });
  }

  const box = boxByLabel.get(b.label);
  camera.push({
    holdFrom: round(sectionStart),
    holdTo: round(sectionStart + SECTION_DURATION - TRANSITION),
    rect: {
      x: round(box.x - CAMERA_PAD),
      y: round(box.y - CAMERA_PAD),
      width: round(box.width + CAMERA_PAD * 2),
      height: round(box.height + CAMERA_PAD * 2),
    },
  });
  report.push({ label: b.label, start: sectionStart, end: sectionStart + SECTION_DURATION });
});

const outroStart = INTRO_DURATION + boundaries.length * SECTION_DURATION;
const totalDuration = outroStart + OUTRO_DURATION;

// Shot 11: zoom back out to the whole, now fully-drawn diagram.
camera.push({ holdFrom: round(outroStart), holdTo: round(totalDuration), rect: fullRect });
report.push({ label: '(outro — full diagram)', start: outroStart, end: totalDuration });

nodes['road-bar'] = { at: 0, duration: 0.3 };
nodes['road-mascot-top'] = { at: 0, duration: 0.3 };
nodes['road-mascot-bottom'] = { at: round(INTRO_DURATION + (boundaries.length - 1) * SECTION_DURATION), duration: 0.5 };

const plan = {
  outputWidth: 1280,
  outputHeight: 720,
  duration: Math.round((totalDuration + 0.6) * 1000),
  reveal: { nodeDuration: NODE_DUR, edgeDuration: EDGE_DUR, nodes, edges },
  camera,
};

fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
console.log('Section timing (5.0s intro + 5.0s per section + 5.0s outro):');
for (const r of report) console.log(`  ${r.start.toFixed(1)}s - ${r.end.toFixed(1)}s  ${r.label}`);
console.log(`Total video duration: ${totalDuration.toFixed(1)}s`);
