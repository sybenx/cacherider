// Sharing a page: the phone's own share icon beside its title, and a panel with the link as a QR code (for someone
// beside you), Send link (the share sheet) and Copy link. A link is always the real site's, and carries only what's on
// the page by choice: never the rider's location. The QR encoder (vendor/qrcodegen.mjs) loads when a panel first opens.
import { html, icon, esc } from './ui.js';

export const SITE = 'https://cacherider.com/';
/** The link to a page of the app, at the real site whichever copy it's opened from. */
export const siteLink = hash => SITE + (hash ? '#/' + hash.replace(/^#?\/?/, '') : '');

// The platform's own glyph: the box and arrow on Apple's, the three dots elsewhere (Android's, and Google Maps').
const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
export const shareIcon = (size = 20) => icon(apple ? 'shareup' : 'share', size);

/** The button: `{ url, title, lines }` for the panel, carried on it. */
export const shareButton = (share, label = 'Share') =>
  html`<button type="button" class="btn btn-ghost sharebtn" data-share="${JSON.stringify(share)}">${shareIcon(20)}<span>${label}</span></button>`;

/** Shown on the page, not behind a button (the About page's 'Share Cache Rider'): the code, what it opens, and Send
 *  link. A tap on the code opens it large, in the panel. The code is drawn once the page is up (`fillQRs`). */
export const shareBlock = (share, label = 'Send link') => html`<div class="shareblock" data-qr="${share.url}">
  <button type="button" class="sb-qr" data-share="${JSON.stringify(share)}" aria-label="Show the code larger"></button>
  <div class="sb-side"><b>${share.title}</b>${share.lines.map(l => html`<span>${l}</span>`)}<button type="button" class="btn btn-secondary sb-send" data-send="${JSON.stringify(share)}">${shareIcon(18)}<span>${typeof navigator.share === 'function' ? label : 'Copy link'}</span></button></div></div>`;
export async function fillQRs(root) {
  for (const b of root.querySelectorAll('[data-qr]')) { try { b.querySelector('.sb-qr').innerHTML = await qrSvg(b.dataset.qr); } catch { b.querySelector('.sb-qr').hidden = true; } }
}

let qrMod = null;
const loadQR = () => (qrMod ??= import('../vendor/qrcodegen.mjs').then(m => m.default));
/** A link as a QR code in SVG: black on white whatever the theme (a camera reads dark on light), four modules of margin. */
export async function qrSvg(text) {
  const q = await loadQR(), c = q.QrCode.encodeText(text, q.QrCode.Ecc.MEDIUM), n = c.size + 8;
  let d = '';
  for (let y = 0; y < c.size; y++) for (let x = 0; x < c.size; x++) if (c.getModule(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code for this link"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

let dlg = null;
/** The panel: it appears (no slide), and goes with its close button, a tap outside it, Escape, or the page changing. */
export async function openShare({ url, title, lines = [], also = [] }) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'sharedlg';
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    addEventListener('hashchange', () => dlg.open && dlg.close());
  }
  const send = typeof navigator.share === 'function';
  dlg.innerHTML = `<div class="sd-top"><h2>${esc(title)}</h2><button type="button" class="btn btn-ghost btn-icon sd-close" aria-label="Close">${icon('close', 22).s}</button></div>
    <div class="sd-qr"></div>
    ${lines.length ? `<div class="sd-lines">${lines.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
    <div class="sd-acts">${send ? `<button type="button" class="btn btn-primary sd-send">${shareIcon(18).s}Send link</button>` : ''}<button type="button" class="btn ${send ? 'btn-secondary' : 'btn-primary'} sd-copy">${icon('copy', 18).s}<span>Copy link</span></button></div>
    <input class="sd-url" readonly value="${esc(url)}" aria-label="The link" hidden>
    ${also.map((a, k) => `<button type="button" class="btn btn-ghost sd-also" data-k="${k}">${esc(a.label)}</button>`).join('')}`;
  for (const b of dlg.querySelectorAll('.sd-also')) b.onclick = () => { dlg.close(); also[+b.dataset.k].act(); };
  dlg.querySelector('.sd-close').onclick = () => dlg.close();
  const sb = dlg.querySelector('.sd-send');
  if (sb) sb.onclick = () => navigator.share({ title, url }).catch(() => {});
  const cb = dlg.querySelector('.sd-copy');
  cb.onclick = async () => {
    try { await navigator.clipboard.writeText(url); cb.querySelector('span').textContent = 'Copied'; }
    catch { const u = dlg.querySelector('.sd-url'); u.hidden = false; u.select(); }   // no clipboard: the link, selected, to copy by hand
  };
  if (!dlg.open) dlg.showModal();
  try { dlg.querySelector('.sd-qr').innerHTML = await qrSvg(url); } catch { /* offline before it was ever loaded: the link still goes */ }
}

document.addEventListener('click', async e => {
  const s = e.target.closest('[data-send]');
  if (s) {   // straight to the share sheet, or the link copied where there's none
    e.preventDefault();
    const { url, title } = JSON.parse(s.dataset.send);
    if (typeof navigator.share === 'function') return navigator.share({ title, url }).catch(() => {});
    try { await navigator.clipboard.writeText(url); s.querySelector('span').textContent = 'Copied'; } catch { openShare(JSON.parse(s.dataset.send)); }
    return;
  }
  const b = e.target.closest('[data-share]');
  if (!b) return;
  e.preventDefault();
  try { openShare(JSON.parse(b.dataset.share)); } catch { /* a malformed payload: nothing to share */ }
});
