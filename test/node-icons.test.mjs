import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cases = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  // The first lifecycle state is a start state, which has no default sigil.
  lifecycle: ['agent-run.lifecycle.json', 'states', 3],
};
for (const [mode, [example, collection, index = 0]] of Object.entries(cases)) {
  test(`${mode}: icon overrides and hiding preserve all non-icon output`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-icons-'));
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples', example)));
      const firstId = spec[collection][0].id;
      const input = path.join(dir, 'input.json');
      const output = path.join(dir, 'output.html');
      const render = () => {
        fs.writeFileSync(input, JSON.stringify(spec));
        const result = spawnSync(process.execPath, [path.join(root, `renderers/${mode}/render-${mode}.mjs`), input, output], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return fs.readFileSync(output, 'utf8');
      };
      // Scope every match to the first node's own <g> block: a document with
      // several nodes has several sigils, and only this node's icon changes
      // from one render to the next.
      const nodeBlock = (html) => {
        const start = html.indexOf(`id="node-${firstId}"`);
        assert.ok(start >= 0, `node "${firstId}" not found in rendered output`);
        const openTag = html.lastIndexOf('<g ', start);
        // The node's own <g> may contain nested <g> elements (icons,
        // markers), so its closing </g> is found by depth, not by the
        // first </g> after start.
        const tagRe = /<g[ >]|<\/g>/g;
        tagRe.lastIndex = openTag;
        let depth = 0;
        let close = -1;
        for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
          if (m[0] === '</g>') {
            depth -= 1;
            if (depth === 0) { close = m.index; break; }
          } else {
            depth += 1;
          }
        }
        assert.ok(close >= 0, `unbalanced <g> for node "${firstId}"`);
        return html.slice(openTag, close + 4);
      };
      const sigil = /<g aria-hidden="true" data-semantic-sigil="[^"]+"[^>]*>[\s\S]*?<\/g>/;
      const baseline = render();
      const oldBlock = nodeBlock(baseline);
      const old = oldBlock.match(sigil)?.[0];
      assert.ok(old);
      // geometry.test.mjs covers the full shared icon catalog. Every renderer
      // still proves override/hiding, unchanged non-icon output, brand
      // coexistence and schema rejection through its real entrypoint.
      for (const icon of ['calendar', 'none']) {
        spec[collection][index].icon = icon;
        const html = render();
        const block = nodeBlock(html);
        if (icon === 'none') {
          assert.equal(html.replace(block, block.replace(old, '')), baseline.replace(oldBlock, oldBlock.replace(old, '')));
        } else {
          const current = block.match(sigil)?.[0];
          assert.ok(current.includes(`data-semantic-sigil="${icon}"`));
          assert.equal(current.match(/class="([^"]+)"/)[1], old.match(/class="([^"]+)"/)[1]);
          assert.equal(html.replace(current, ''), baseline.replace(old, ''));
        }
      }
      delete spec[collection][index].icon;
      spec[collection][index].brand = 'openai';
      const branded = render();
      const brandedBlock = nodeBlock(branded);
      const brandedSigil = brandedBlock.match(sigil)?.[0] ?? '';
      for (const icon of ['calendar', 'none']) {
        spec[collection][index].icon = icon;
        const html = render();
        const block = nodeBlock(html);
        assert.match(block, /data-brand-mark="openai"/);
        const currentSigil = block.match(sigil)?.[0] ?? '';
        assert.equal(
          html.replace(block, block.replace(currentSigil, '')),
          branded.replace(brandedBlock, brandedBlock.replace(brandedSigil, '')),
        );
      }
      spec[collection][index].icon = '<svg onload="alert(1)">';
      fs.writeFileSync(input, JSON.stringify(spec));
      const rejected = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'validate', mode, input, '--json'], { encoding: 'utf8' });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /icon/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
