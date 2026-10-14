// Browser regressions for the static (Vercel-only) deployment. No Python server.
// Install test-only dependencies OUTSIDE the deployment/repository:
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
// node tools/test-vercel.mjs
// Override TEST_DEPS or CHROMIUM_EXECUTABLE when using your own installation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(resolve(process.env.TEST_DEPS || '/tmp/maxs-fpv-browser-tests', 'package.json'));
const { chromium: playwright } = require('playwright-core');
const { default: chromium, inflate, setupLambdaEnvironment } = await import(require.resolve('@sparticuz/chromium'));
// The npm binary includes NSS/NSPR for minimal Linux containers too. Extract
// these to the OS temp directory; no browser binaries enter the repository.
if (process.platform === 'linux' && !process.env.CHROMIUM_EXECUTABLE) {
  const bundledLibs = await inflate(fileURLToPath(new URL('../bin/al2023.tar.br', pathToFileURL(require.resolve('@sparticuz/chromium')))));
  setupLambdaEnvironment(resolve(bundledLibs, 'lib'));
}
const root = fileURLToPath(new URL('../public/', import.meta.url));
const harness = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script></head><body style="margin:0"><canvas id="game" width="800" height="600" style="width:800px;height:600px"></canvas></body></html>`;
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://test').pathname;
  if (path === '/__harness.html') { res.setHeader('Content-Type', 'text/html'); res.end(harness); return; }
  if (path === '/__sandbox.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<iframe src="/__harness.html" sandbox="allow-scripts allow-same-origin" width="820" height="620"></iframe>');
    return;
  }
  // Same static API shims as vercel.json, deliberately no /ws or /api/poll.
  const local = /^\/api\/(health|rooms|characters)$/.test(path) ? path + '.json' : path;
  const file = resolve(root, '.' + (local === '/' ? '/index.html' : local));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || await chromium.executablePath(),
  args: chromium.args.filter((arg) => !arg.includes('disable-web-security')),
  headless: true,
});
const errors = [];
const requests = [];
async function page(context) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.error('BROWSER:', m.text()); });
  p.on('request', (r) => requests.push(r.url()));
  await p.goto(origin + '/__harness.html');
  return p;
}
async function setup(p, role, code) {
  await p.evaluate(async ({ role, code }) => {
    const { RelayHostNet, RelayNet } = await import('/js/relay.js');
    window.messages = [];
    window.welcomes = [];
    window.netErrors = [];
    window.net = new (role === 'host' ? RelayHostNet : RelayNet)({
      onWelcome: (m) => welcomes.push(m),
      onMessage: (m) => messages.push(m),
      onError: (m) => netErrors.push(m),
    }, { code });
    await net.connect('', { code });
  }, { role, code });
}
async function join(p, name, code = '') {
  await p.evaluate(({ name, code }) => net.join(name, 'assault', 'mp18', false, 0, '', false, 'somme', '', code), { name, code });
  await p.waitForFunction(() => net.id !== null, { timeout: 15000 });
}
async function chatBetween(sender, receiver, message) {
  await sender.evaluate((s) => net.chat(s), message);
  try { await receiver.waitForFunction((s) => messages.some((m) => m.t === 'chat' && m.m === s), message, { timeout: 5000 }); }
  catch (e) {
    console.error('SENDER', await sender.evaluate(() => ({ id: net.id, connected: net.connected, guests: [...(net._guestSids || [])], messages, netErrors })));
    console.error('RECEIVER', await receiver.evaluate(() => ({ id: net.id, connected: net.connected, guests: [...(net._guestSids || [])], messages, netErrors })));
    throw e;
  }
}
try {
  const context = await browser.newContext();
  // Reject all external services; disable WebSocket, as on a restrictive preview.
  await context.addInitScript(() => { window.WebSocket = class { constructor() { throw new Error('WebSocket disabled by test'); } }; });
  await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const host = await page(context);
  const guest = await page(context);
  await setup(host, 'host', '12345678');
  await join(host, 'Host');
  await setup(guest, 'guest', '12345678');
  await join(guest, 'Guest', '12345678');
  await guest.waitForFunction(() => net._lastState?.ps?.length === 2);
  assert.equal(await host.evaluate(() => net.status().humans), 2);
  await chatBetween(guest, host, 'guest-to-host');
  await chatBetween(host, guest, 'host-to-guest');
  // Authoritative input: a guest turn must arrive in the host's roster.
  const guestId = await guest.evaluate(() => net.id);
  await guest.evaluate(() => {
    const me = net._lastState.ps.find((p) => p.i === net.id);
    net.send({ t: 'input', p: me.p, r: [123, 0], s: {} });
  });
  await host.waitForFunction((id) => net._lastState?.ps.some((p) => p.i === id && Math.abs(p.y - 123) < 1), guestId);
  console.log('PASS: static browser engine, two-player welcome/state/input/chat with WebSocket disabled');
  // Host commands used to be silently discarded by RelayHost.command().
  // Check actual authority-side ammo/reload and effect delivery for both seats.
  for (const actor of [host, guest]) {
    await actor.waitForFunction(() => net._lastMe?.mag > 0);
    const before = await actor.evaluate(() => net._lastMe.mag);
    await actor.evaluate(() => net.send({ t: 'fire', d: [0, 1, 0] }));
    await actor.waitForFunction((mag) => net._lastMe.mag === mag - 1, before);
    await actor.evaluate(() => net.reload());
    await actor.waitForFunction(() => net._lastMe.reloading === 1);
    const actorId = await actor.evaluate(() => net.id);
    await actor.evaluate(() => net.ability({ x: 0, y: 0, z: 1 }));
    await (actor === host ? guest : host).waitForFunction((id) => messages.some((m) => m.t === 'fx' && m.fx?.by === id), actorId);
  }
  console.log('PASS: host AND guest fire/reload/abilities are processed by the authoritative engine');


  // A second room must never receive the first room's guest or frames.
  const other = await page(context);
  await setup(other, 'host', '87654321');
  await join(other, 'Other host');
  await chatBetween(guest, host, 'isolation-probe');
  await other.waitForFunction(() => net._lastState?.ps.length === 1);
  assert.equal(await other.evaluate(() => messages.some((m) => m.m === 'isolation-probe')), false);
  assert.equal(await other.evaluate(() => net.status().humans), 1);
  console.log('PASS: simultaneous rooms remain isolated');

  // Real WebRTC handshake across separate browser contexts: BroadcastChannel
  // cannot cross these contexts, so a successful exchange proves the P2P path.
  const remoteContext = await browser.newContext();
  await remoteContext.addInitScript(() => { window.WebSocket = class { constructor() { throw new Error('WebSocket disabled by test'); } }; });
  await remoteContext.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const remote = await page(remoteContext);
  await setup(remote, 'guest', '12345678');
  const invite = await host.evaluate(() => net.createInvite());
  const answer = await remote.evaluate(async (code) => (await net.acceptInvite(code)).answer, invite);
  assert.equal(await remote.evaluate(() => net.peers), 0, 'an unanswered invite is not a connected peer');
  await host.evaluate((code) => net.acceptAnswer(code), answer);
  await remote.waitForFunction(() => net.peers === 1);
  assert.equal(await host.evaluate(() => net.channel.peerCount), 1);
  await join(remote, 'Remote', '12345678');
  await remote.waitForFunction(() => net._lastState?.ps.length === 3);
  await chatBetween(remote, host, 'real-webrtc-guest');
  await chatBetween(host, remote, 'real-webrtc-host');
  console.log('PASS: real WebRTC invite/answer, open-channel acknowledgement, join/state/chat across isolated contexts');

  // Closed/invalid invites fail explicitly instead of hanging or claiming success.
  await remote.evaluate(async () => {
    const { Peer, parseCode, packCode } = await import('/js/p2p.js');
    const peer = new Peer();
    const waiting = peer.waitForOpen(1000).then(() => false, () => true);
    peer.close();
    if (!await waiting) throw new Error('Closed peer resolved as open');
    const malformed = await packCode('TFi1.', { v: 1, id: 'abc', room: 'wrong', sdp: { type: 'offer', sdp: 'v=0' } });
    try { await parseCode(malformed); throw new Error('Accepted invalid invite'); }
    catch (e) { if (e.message === 'Accepted invalid invite') throw e; }
    const timeoutPeer = new Peer();
    try { await timeoutPeer.waitForOpen(30); throw new Error('Accepted unopened channel'); }
    catch (e) { if (!e.message.includes('timed out')) throw e; }
    if (!timeoutPeer.closed) throw new Error('Timed-out peer leaked');
  });
  console.log('PASS: invalid codes, connection timeouts and peer cleanup');

  await remote.evaluate(() => net.close());
  await host.waitForFunction(() => net.channel.peerCount === 0);
  await host.waitForFunction(() => net.status().humans === 2);
  console.log('PASS: guest departure cleans up the host seat and data channel');
  // Same-browser friends may pair by invite too. This gives them both wires;
  // chat (and therefore shots/abilities) must not execute twice.
  const localInvite = await host.evaluate(() => net.createInvite());
  const localAnswer = await guest.evaluate(async (code) => (await net.acceptInvite(code)).answer, localInvite);
  await host.evaluate((code) => net.acceptAnswer(code), localAnswer);
  for (const p of [host, guest]) {
    await p.evaluate(() => {
      const channel = net.channel;
      const receive = channel._receive.bind(channel);
      window.duplicateReceipts = 0;
      channel._receive = (packet) => {
        if (packet?.text?.includes('two-wires')) duplicateReceipts++;
        receive(packet);
      };
    });
  }
  await chatBetween(guest, host, 'one-packet-two-wires');
  await chatBetween(host, guest, 'reply-over-two-wires');
  await host.waitForFunction(() => duplicateReceipts >= 2);
  await guest.waitForFunction(() => duplicateReceipts >= 2);
  assert.equal(await host.evaluate(() => messages.filter((m) => m.m === 'one-packet-two-wires').length), 1);
  assert.equal(await guest.evaluate(() => messages.filter((m) => m.m === 'reply-over-two-wires').length), 1);
  console.log('PASS: BroadcastChannel + WebRTC duplicate packets execute only once');

  // The menu can create a channel before its match exists. Joining must retry
  // through engine startup rather than losing the very first join forever.
  const waitingHost = await page(context);
  await waitingHost.evaluate(async () => {
    const { openRoomChannel } = await import('/js/relay.js');
    window.menuChannel = await openRoomChannel('11223344');
  });
  const waitingGuest = await page(context);
  await setup(waitingGuest, 'guest', '11223344');
  await waitingGuest.evaluate(() => net.join('Early guest', 'assault', 'mp18', false, 0, '', false, 'somme', '', '11223344'));
  await waitingHost.evaluate(async () => {
    const { RelayHostNet } = await import('/js/relay.js');
    window.net = new RelayHostNet({}, { code: '11223344' });
    await net.connect('', { channel: menuChannel });
    net.join('Late host', 'assault', 'mp18', false, 0, '', false, 'somme');
  });
  await waitingGuest.waitForFunction(() => net.id !== null);
  assert.equal(await waitingHost.evaluate(() => net.status().humans), 2);
  console.log('PASS: menu-created channel adoption and joining during host startup');
  await waitingHost.evaluate(() => net.close());
  await waitingGuest.waitForFunction(() => !net.connected && netErrors.length > 0);
  console.log('PASS: leaving as host immediately notifies guests');


  const sandboxPage = await page(context);
  await sandboxPage.goto(origin + '/__sandbox.html');
  const frame = sandboxPage.frames().find((f) => f !== sandboxPage.mainFrame());
  await frame.waitForLoadState();
  await frame.evaluate(async () => {
    const { Controls } = await import('/js/controls.js');
    const config = await (await fetch('/shared/weapons.json')).json();
    window.controls = new Controls(document.querySelector('canvas'), null, config.combat, {});
    controls.enabled = true;
    window.modes = [];
    controls.onLookMode = (mode) => modes.push(mode);
    controls.onFireDown = () => { window.fired = true; };
    controls.onReload = () => { window.reloaded = true; };
    controls.onAbilityDown = () => { window.charged = true; };
    controls.onAbilityCancel = () => { window.cancelled = true; };
  });
  await frame.locator('canvas').click({ position: { x: 400, y: 300 } });
  await frame.waitForFunction(() => controls.cursorLook && controls.lockUnavailable);
  await frame.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.right - 1, clientY: r.top + r.height / 2, bubbles: true }));
    controls._cursorLook(1);
    if (controls.yaw < 100) throw new Error('No edge steering');
    c.dispatchEvent(new MouseEvent('mouseleave'));
    const yaw = controls.yaw;
    controls._cursorLook(1);
    if (controls.yaw !== yaw) throw new Error('Steering stuck after mouseleave');
    c.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: -5, buttons: 1, bubbles: true }));
    if (controls.yaw <= yaw || controls.pitch <= 0) throw new Error('No drag aim');
    c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    if (!fired || !reloaded || !charged || !controls.mouse.right || !controls.keys.has('Space') || !controls.keys.has('ShiftLeft')) throw new Error('Fallback lost combat controls');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    if (controls.canLook || controls.mouse.left || controls.mouse.right || controls.keys.size || !cancelled) throw new Error('Esc did not release input');
    controls._lockFailed();
    if (controls.canLook) throw new Error('Late pointerlockerror reactivated look after Esc');
    controls.requestLock();
    if (!controls.cursorLook) throw new Error('Cannot resume cursor look');
    controls.keys.add('ArrowLeft');
    const priorYaw = controls.yaw;
    controls._arrowLook(0.1);
    if (controls.yaw === priorYaw) throw new Error('Arrow look failed');
    window.dispatchEvent(new Event('blur'));
    if (controls.canLook || controls.mouse.right || controls.keys.size) throw new Error('Blur left input active');
    if (modes.filter((mode) => mode === 'unavailable').length !== 1) throw new Error('Repeated refusal hints');
  });
  console.log('PASS: actual sandbox pointer-lock refusal, edge/drag aim, combat input, Esc/resume/blur and late errors');

  const lockedPage = await page(context);
  await lockedPage.evaluate(async () => {
    const { Controls } = await import('/js/controls.js');
    window.controls = new Controls(document.querySelector('canvas'), null, {}, {});
    controls.enabled = true;
    controls.requestLock();
    if (controls.lockUnavailable || controls.canLook) throw new Error('Async entry misclassified as a lock refusal');
  });
  await lockedPage.locator('canvas').click();
  await lockedPage.waitForFunction(() => controls.locked);
  await lockedPage.mouse.move(440, 330);
  assert.equal(await lockedPage.evaluate(() => controls.cursorLook), false);
  await lockedPage.keyboard.press('Escape');
  await lockedPage.waitForFunction(() => !controls.canLook && !document.pointerLockElement);
  console.log('PASS: normal pointer lock remains the preferred mode and Esc releases it');

  assert.deepEqual(await host.evaluate(() => netErrors), []);
  assert.deepEqual(await guest.evaluate(() => netErrors), []);
  assert.deepEqual(errors, []);
  assert.equal(requests.some((url) => /\/api\/poll|\/ws(?:$|\?)/.test(url)), false);
  assert.equal(requests.some((url) => !url.startsWith(origin)), false);
  console.log('PASS: no external service, WebSocket, long-poll requests or uncaught browser errors');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
