/* =========================================================
   GUDANG — Shared app shell (nav, toast, icons, helpers)
   ========================================================= */

const Icons = {
  search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 011-1h3M4 16v3a1 1 0 001 1h3M20 8V5a1 1 0 00-1-1h-3M20 16v3a1 1 0 01-1 1h-3M3 12h18" stroke-dasharray="0"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M20 6L9 17l-5-5"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  empty: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8M3 8l9 5 9-5" opacity="0.4"/></svg>`,
};

function renderBottomNav(active) {
  const items = [
    { id: 'beranda', href: 'index.html', label: 'Beranda', icon: Icons.home },
    { id: 'import', href: 'import.html', label: 'Import', icon: Icons.upload },
    { id: 'rak', href: 'rak.html', label: 'Rak', icon: Icons.grid },
  ];
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = items
    .map(
      (it) => `<a class="nav-item ${it.id === active ? 'active' : ''}" href="${it.href}">${it.icon}<span>${it.label}</span></a>`
    )
    .join('');
  document.body.appendChild(nav);
}

let toastTimer = null;
function showToast(message, type = 'default') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.className = 'toast show' + (type !== 'default' ? ` toast--${type}` : '');
  const icon = type === 'success' ? Icons.check : type === 'error' ? Icons.x : '';
  el.innerHTML = `${icon}<span>${message}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relativeTime(isoStr) {
  if (!isoStr) return 'belum pernah';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} jam lalu`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} hari lalu`;
}

/** Fuzzy-ish scoring: exact prefix > substring > loose char sequence match */
function searchScore(query, text) {
  if (!text) return -1;
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  // loose sequence match (typo-tolerant): all chars of q appear in order in t
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : -1;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/**
 * Global scan capture — biar scanner fisik Zebra bisa dipakai TANPA perlu
 * tap ke field dulu.
 *
 * Kenapa gak cukup dengerin keydown di document: Android (DataWedge)
 * biasanya nyuntik hasil scan lewat mekanisme "IME text commit" ke field
 * yang sedang FOKUS — bukan event keyboard biasa. Kalau gak ada field yang
 * fokus, hasil scan gak ketangkep sama sekali.
 *
 * Solusinya: bikin 1 input tersembunyi (di luar layar, gak kelihatan) yang
 * SELALU otomatis fokus setiap kali user lagi tidak sengaja mengetik di
 * field lain. Field asli (search box, kode rak, dst) tetap bisa dipakai
 * normal — begitu user tap ke situ, field tersembunyi ini "mengalah" dan
 * gak ganggu. Begitu user tap keluar lagi / gak ngapa-ngapain, fokus balik
 * otomatis ke field tersembunyi, siap nangkep scan kapan saja.
 *
 * Hasil scan langsung dikosongkan dari field tersembunyi SEBELUM diteruskan
 * ke callback, jadi scan berikutnya tidak menumpuk/tercampur.
 */
function initGlobalScanCapture(onScanComplete) {
  const hidden = document.createElement('input');
  hidden.type = 'text';
  hidden.setAttribute('autocomplete', 'off');
  hidden.setAttribute('aria-hidden', 'true');
  hidden.setAttribute('inputmode', 'none'); // cegah keyboard virtual muncul walau fokus programatik
  hidden.tabIndex = -1;
  Object.assign(hidden.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(hidden);

  const isRealField = (el) => el && el !== hidden && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

  const refocusIfIdle = () => {
    if (!isRealField(document.activeElement)) {
      hidden.focus({ preventScroll: true });
    }
  };

  refocusIfIdle();
  document.addEventListener('focusout', () => setTimeout(refocusIfIdle, 30));
  document.addEventListener('click', (e) => {
    if (!isRealField(e.target)) setTimeout(refocusIfIdle, 30);
  });

  const submitScan = () => {
    const scanned = hidden.value;
    hidden.value = ''; // dikosongkan LEBIH DULU, sebelum diproses — biar tidak numpuk
    if (scanned.trim()) onScanComplete(scanned);
  };

  hidden.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitScan();
    }
  });

  // Jaga-jaga kalau device tidak selalu mengirim Enter di akhir scan —
  // auto-submit setelah jeda singkat tanpa ketikan baru.
  let idleTimer = null;
  hidden.addEventListener('input', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(submitScan, 400);
  });
}
