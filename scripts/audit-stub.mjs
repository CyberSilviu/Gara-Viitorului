// Stub-uri DOM / canvas / fetch pentru a construi scena (modulele reale) in Node — folosit de audit-coliziuni.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public') + '/';
globalThis.fetch = async (u) => {
  const f = PUB + String(u).replace(/^\.?\//, '').replace(/^\/?/, '');
  if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + u); } };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};
const mkCtx = () => new Proxy({}, { get(t, k) {
  if (k in t) return t[k];
  if (k === 'measureText') return () => ({ width: 10 });
  if (k === 'getImageData' || k === 'createImageData') return (a, b, w, h) => ({ data: new Uint8ClampedArray(4 * Math.max(1, (w || a || 1) * (h || b || 1))) });
  if (/Gradient|Pattern/.test(k)) return () => ({ addColorStop() {} });
  return () => {};
}, set(t, k, v) { t[k] = v; return true; } });
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.style = { setProperty() {} }; this.children = []; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; this.width = 0; this.height = 0; this.dataset = {}; this._c = null; }
  getContext() { return this._c ||= mkCtx(); } appendChild(c) { this.children.push(c); return c; } addEventListener() {} removeEventListener() {} setAttribute() {} remove() {} querySelector() { return null; } querySelectorAll() { return []; }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (n, t) => new El(t), getElementById: () => new El('div'), querySelector: () => null, querySelectorAll: () => [], body: new El('body'), addEventListener() {} };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.devicePixelRatio = 1;
