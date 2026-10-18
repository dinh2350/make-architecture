import { ChromeVisualBrowser, findChrome } from '/Users/devinnguyen/Documents/project/archify/archify/bin/visual-check.mjs';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const [, , htmlPath, planPath, outPath, fpsArg] = process.argv;
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const fps = Number(fpsArg) || 30;

const executable = findChrome();
const browser = new ChromeVisualBrowser(executable);
const sessionId = await browser.sessionPromise;

await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1100, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);

const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
await browser.cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
await loaded;

async function evalJs(expression, awaitPromise = false, timeoutMs = 15000) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  }, sessionId, timeoutMs);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'evaluation failed');
  }
  return response.result?.value;
}

for (let attempt = 0; attempt < 100; attempt += 1) {
  const ready = await evalJs('!!(window.Archify && Archify.motion && Archify.motion.canRecord())');
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const canRecord = await evalJs('!!(window.Archify && Archify.motion && Archify.motion.canRecord())');
if (!canRecord) throw new Error('Archify.motion.canRecord() is false');

const options = {
  fps,
  outputWidth: plan.outputWidth,
  outputHeight: plan.outputHeight,
  duration: plan.duration,
  reveal: plan.reveal,
  camera: plan.camera,
};
const optionsJson = JSON.stringify(options);
const script = `(async function () {
  try {
    var blob = await Archify.motion.recordWebm(${optionsJson});
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var binary = '';
    for (var offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
    }
    return { ok: true, type: blob.type, size: blob.size, base64: btoa(binary) };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
})()`;

const recordTimeoutMs = plan.duration + 15000;
const payload = await evalJs(script, true, recordTimeoutMs);
if (!payload?.ok) throw new Error(`recording failed: ${payload?.error}`);

fs.writeFileSync(outPath, Buffer.from(payload.base64, 'base64'));
console.log('wrote', outPath, payload.size, 'bytes', payload.type);
await browser.close();
