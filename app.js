'use strict';
/* KJV Bible 1611 — 主程式（英王欽定本，Pure Cambridge Edition） */

const DATA = 'data/';   // 每卷一個 JSON：[{v:[經文...], h:{節:標題}}, ...]
// 真人朗讀錄音（何綉圓、吳嘉雄朗讀，信望愛資訊中心，FDL 授權）
// 經文中 ⟨ ⟩ 是 KJV 原本印成斜體的補充字
const fmtVerse = t => esc(t).replace(/⟨/g, '<i>').replace(/⟩/g, '</i>');
const plain = t => String(t || '').replace(/[⟨⟩]/g, '').replace(/¶\s*/g, '');  // 複製、朗讀、搜尋用（去掉斜體記號與段落符號 ¶）
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 本機儲存（失敗也不影響使用） ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('tb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tb:' + k, JSON.stringify(v)); } catch (e) { } }
};
const settings = Object.assign({ fs: 19, theme: 'auto', voice: 'fable', ttsVoice: '', rate: 1 }, store.get('settings', {}));
if (!settings.v2) { if (settings.voice === 'ai') settings.voice = 'fable'; settings.v2 = 1; }  // 舊設定改成預設用 Fable
function saveSettings() { store.set('settings', settings); applySettings(); }
function applySettings() {
  document.documentElement.style.setProperty('--fs', settings.fs + 'px');
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
applySettings();

/* ---------- IndexedDB：存已下載的章 ---------- */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res) => {
    try {
      const r = indexedDB.open('taigi-bible', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('ch');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return dbP;
}
async function idbGet(key) {
  const d = await db(); if (!d) return undefined;
  return new Promise(res => { try { const q = d.transaction('ch').objectStore('ch').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } });
}
async function idbPut(key, val) {
  const d = await db(); if (!d) return;
  return new Promise(res => { try { const t = d.transaction('ch', 'readwrite'); t.objectStore('ch').put(val, key); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } });
}
async function idbKeys() {
  const d = await db(); if (!d) return [];
  return new Promise(res => { try { const q = d.transaction('ch').objectStore('ch').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); } catch (e) { res([]); } });
}

/* ---------- 取經文（app 內附的資料檔，一卷一個） ---------- */
const bookMem = new Map();
async function getBook(b) {
  if (bookMem.has(b)) return bookMem.get(b);
  let data = await idbGet(`bk:${b}`);
  if (!data) {
    try {
      const r = await fetch(`${DATA}${String(b + 1).padStart(2, '0')}.json`);
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch (e) { throw new Error(navigator.onLine ? '讀取經文失敗，請稍後再試。 Could not load the text.' : '這一卷還沒下載過，需要網路。 This book needs a connection the first time.'); }
    await idbPut(`bk:${b}`, data);
  }
  bookMem.set(b, data);
  return data;
}
// 回傳 [[節, 經文], ...]（保留舊介面：第一個參數不用）
async function getChapter(_script, b, c) {
  const bk = await getBook(b);
  const ch = bk[c - 1];
  if (!ch) throw new Error('沒有這一章 No such chapter');
  return ch.v.map((t, i) => [i + 1, t]);
}
// 詩篇標題、119 篇的希伯來字母小標題：{節: 文字}
function getHeads(b, c) { const bk = bookMem.get(b); return (bk && bk[c - 1] && bk[c - 1].h) || {}; }

/* ---------- 書卷、經節解析 ---------- */
const abbrIndex = new Map();
BOOKS.forEach(([ab, full], i) => { abbrIndex.set(ab, i); abbrIndex.set(full, i); });
// 常見別寫
[['約壹', 62], ['約貳', 63], ['約參', 64], ['啓', 65], ['啟示', 65], ['詩篇', 18]].forEach(([k, i]) => abbrIndex.set(k, i));

function findBook(s) {
  s = s.trim();
  if (abbrIndex.has(s)) return abbrIndex.get(s);
  return -1;
}
// 解析「提後 3:14-4:5」「約3:16」「詩 23」「提後 3:14~16」
function parseRef(input) {
  let s = (input || '').trim().replace(/[：﹕]/g, ':').replace(/[～〜~－—–]/g, '-').replace(/\s+/g, ' ');
  if (!s) return { err: '請輸入經節，例如：約 3:16' };
  const m = s.match(/^(.+?)\s*(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?$/);
  if (!m) return { err: '看不懂這個經節格式，例：約 3:16 或 提後 3:14-4:5' };
  const b = findBook(m[1].replace(/\s/g, ''));
  if (b < 0) return { err: `找不到書卷「${m[1].trim()}」，請用和合本縮寫，例如：創、約、提後。` };
  const c1 = +m[2], v1 = m[3] ? +m[3] : null;
  let c2 = c1, v2 = null;
  if (m[4]) {
    if (m[5]) { c2 = +m[4]; v2 = +m[5]; }
    else if (v1 != null) { v2 = +m[4]; }
    else { c2 = +m[4]; }
  }
  const [ab, full, n] = BOOKS[b];
  for (const c of [c1, c2]) if (c < 1 || c > n) return { err: `${full}只有 ${n} 章。` };
  if (c2 < c1 || (c2 === c1 && v1 != null && v2 != null && v2 < v1)) return { err: '範圍的結尾在開頭之前，請檢查。' };
  return { b, c1, v1, c2, v2, isRange: !!m[4] };
}
const refLabel = (b, c, v) => `${BOOK_EN[b]} ${c}${v ? ':' + v : ''}`;

/* ---------- 小提示 ---------- */
let toastT;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- 真人錄音的每節時間表 ---------- */
// 空白節、或整節只是註記「(Ha̍p-pēng tī téng-chat)＝併在上一節」「(Ū ê pán-pún…)＝有的抄本有這節」→ 不朗讀
const isNoteVerse = t => !t || !t.trim();
const timingMem = new Map();
async function getTimings(b, c) {
  if (!MyRec.has(b)) return null;
  const key = `${b}:${c}`;
  if (timingMem.has(key)) return timingMem.get(key);
  const arr = MyRec.tm[b + 1][c - 1], m = new Map();
  if (arr) for (let i = 0; i * 2 + 1 < arr.length; i++) {
    const s0 = arr[2 * i], e0 = arr[2 * i + 1];
    if (s0 >= 0 && e0 > s0) m.set(i + 1, { start: s0 / 100, end: e0 / 100 });
  }
  timingMem.set(key, m);
  return m;
}

/* ---------- AI 朗讀錄音（Kokoro 英式男聲 Fable，放在 kjvpce/audio-ot、audio-nt） ---------- */
const FABLE_BASE = { ot: '/audio-ot/', nt: '/audio-nt/' };
const FABLE_CACHE = 'fable-v1';
const fableUrl = (b, c, ext) => `${FABLE_BASE[b < 39 ? 'ot' : 'nt']}${String(b + 1).padStart(2, '0')}/${String(c).padStart(3, '0')}${ext}`;
const fableMem = new Map();
async function getFableTimings(b, c) {
  const key = `ft:${b}:${c}`;
  if (fableMem.has(key)) return fableMem.get(key);
  let raw = await idbGet(key);
  if (!raw) {
    try {
      const r = await fetch(fableUrl(b, c, '.json'));
      if (!r.ok) throw new Error(r.status);
      raw = await r.json(); await idbPut(key, raw);
    } catch (e) { return null; }
  }
  const m = new Map();
  for (const [v, st, en] of raw.verses || []) if (en > st) m.set(v, { start: st, end: en });
  fableMem.set(key, m);
  return m;
}
// 這一卷用哪一種聲音：fable（預設）、real（自己匯入的 Scourby）、ai（手機內建）
function voiceFor(b) {
  if (settings.voice === 'ai') return 'ai';
  if (settings.voice === 'real' && MyRec.has(b)) return 'real';
  return 'fable';
}

/* ---------- 我的錄音：使用者自己匯入、只存在這台裝置（不會上傳） ---------- */
const APP_VER = 'k8';
const MyRec = {
  books: new Set(), urls: new Map(), tm: null, ready: null, where: new Map(),
  CACHE: 'myrec-v1', key: b => `myrec/${String(b + 1).padStart(2, '0')}.opus`,
  async dir() { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('myrec', { create: true }); },
  init() {
    return this.ready || (this.ready = (async () => {
      try {
        const d = await this.dir();
        for await (const [name, h] of d.entries()) {
          const m = /^(\d\d)\.opus$/.exec(name);
          if (m && (await h.getFile()).size > 0) { this.books.add(+m[1] - 1); this.where.set(+m[1] - 1, 'opfs'); }
        }
      } catch (e) { }
      try {
        const c = await caches.open(this.CACHE);
        for (const req of await c.keys()) { const m = /myrec\/(\d\d)\.opus$/.exec(req.url); if (m && !this.books.has(+m[1] - 1)) { this.books.add(+m[1] - 1); this.where.set(+m[1] - 1, 'cache'); } }
      } catch (e) { }
      try { this.tm = await idbGet('rec:tm'); } catch (e) { }
    })());
  },
  // 這台裝置能不能用「檔案系統」存（大部分 Chrome 可以）；不行就改存在 Cache
  async canOpfs() {
    try {
      const d = await this.dir();
      const fh = await d.getFileHandle('_test', { create: true });
      const w = await fh.createWritable(); await w.write(new Blob(['ok'])); await w.close();
      await d.removeEntry('_test');
      return true;
    } catch (e) { return false; }
  },
  has(b) { return this.books.has(b) && !!(this.tm && this.tm[b + 1]); },
  count() { let n = 0; for (const b of this.books) if (this.has(b)) n++; return n; },
  async url(b) {
    if (this.urls.has(b)) return this.urls.get(b);
    let f;
    if (this.where.get(b) === 'cache') {
      const r = await (await caches.open(this.CACHE)).match(this.key(b));
      if (!r) throw new Error('找不到錄音');
      f = await r.blob();
    } else {
      const d = await this.dir();
      f = await (await d.getFileHandle(`${String(b + 1).padStart(2, '0')}.opus`)).getFile();
    }
    const u = URL.createObjectURL(f); this.urls.set(b, u); return u;
  },
  // 讀 zip（不用解壓到記憶體：「儲存」模式直接切片；壓縮過的逐檔解壓）
  async unzip(file, progress) {
    const u32 = (dv, o) => dv.getUint32(o, true), u16 = (dv, o) => dv.getUint16(o, true);
    if (progress) progress({ stage: `讀取 zip 目錄… Reading zip（${(file.size / 1048576).toFixed(0)} MB）` });
    const tailLen = Math.min(file.size, 66000);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let eo = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eo = i; break; }
    if (eo < 0) throw new Error(`${file.name} 不是 zip 檔 Not a zip file`);
    const count = u16(tail, eo + 10), cdSize = u32(tail, eo + 12), cdOff = u32(tail, eo + 16);
    if (cdOff === 0xffffffff) throw new Error('zip 檔太大（超過 4 GB）');
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('zip 檔格式錯誤 Bad zip');
      const method = u16(cd, p + 10), csize = u32(cd, p + 20), nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), lho = u32(cd, p + 42);
      const name = new TextDecoder().decode(new Uint8Array(cd.buffer, p + 46, nlen)).split('/').pop();
      p += 46 + nlen + xlen + clen;
      if (!name || !(/^\d{1,2}\.(opus|ogg)$/i.test(name) || /\.json$/i.test(name))) continue;
      const lh = new DataView(await file.slice(lho, lho + 30).arrayBuffer());
      const start = lho + 30 + u16(lh, 26) + u16(lh, 28);
      out.push({ name, method, start, csize });
    }
    if (progress) progress({ stage: `zip 裡找到 ${out.length} 個可用檔案 Found ${out.length} files` });
    const files = [];
    for (const [i, e] of out.entries()) {
      const raw = file.slice(e.start, e.start + e.csize);
      if (e.method === 0) files.push(new File([raw], e.name));
      else if (e.method === 8 && window.DecompressionStream) {
        if (progress) progress({ unzip: true, k: i + 1, n: out.length, name: e.name });
        files.push(new File([await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()], e.name));
      } else throw new Error(`${e.name}：不支援的壓縮方式 Unsupported zip compression`);
    }
    return files;
  },
  async importFiles(files, progress) {
    let list = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') list.push(...await this.unzip(f, progress));
      else list.push(f);
    }
    const js = list.filter(f => /\.json$/i.test(f.name));
    for (const f of js) {
      const data = JSON.parse(await f.text());
      if (!data || !data.kjv_timings) throw new Error(`${f.name} 不是時間表檔 Not a timings file`);
      this.tm = Object.assign(this.tm || {}, data.b); await idbPut('rec:tm', this.tm); timingMem.clear();
    }
    const au = list.filter(f => /^\d{1,2}\.(opus|ogg)$/i.test(f.name));
    if (!js.length && !au.length) throw new Error('沒有可用的檔案（需要 01.opus～66.opus 和 kjv_timings.json）');
    try { if (navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
    try {
      const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const need = au.reduce((n, f) => n + f.size, 0);
      if (est && est.quota && est.quota - est.usage < need * 1.05) throw new Error(`手機可用空間不足：需要 ${(need / 1048576).toFixed(0)} MB，網站可用 ${((est.quota - est.usage) / 1048576).toFixed(0)} MB`);
    } catch (e) { if (/空間不足/.test(e.message)) throw e; }
    if (progress) progress({ stage: '檢查儲存方式… Checking storage' });
    const useOpfs = await this.canOpfs();
    const cache = useOpfs ? null : await caches.open(this.CACHE);
    const d = useOpfs ? await this.dir() : null;
    const total = au.reduce((n, f) => n + f.size, 0) || 1;
    let k = 0, done = 0;
    const CH = 4 * 1024 * 1024;
    for (const f of au) {
      const b = parseInt(f.name, 10) - 1;
      if (!(b >= 0 && b < 66)) { done += f.size; continue; }
      const name = `${String(b + 1).padStart(2, '0')}.opus`;
      if (useOpfs) {
        const fh = await d.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        for (let off = 0; off < f.size; off += CH) {
          await w.write(f.slice(off, off + CH));
          const n = Math.min(CH, f.size - off); done += n;
          if (progress) progress({ k: k + 1, n: au.length, name: f.name, done, total });
        }
        await w.close();
        this.where.set(b, 'opfs');
      } else {
        if (progress) progress({ k: k + 1, n: au.length, name: f.name, done, total });
        await cache.put(this.key(b), new Response(f, { headers: { 'Content-Type': 'audio/ogg' } }));
        done += f.size;
        if (progress) progress({ k: k + 1, n: au.length, name: f.name, done, total });
        this.where.set(b, 'cache');
      }
      if (this.urls.has(b)) { URL.revokeObjectURL(this.urls.get(b)); this.urls.delete(b); }
      this.books.add(b); k++;
    }
    return { audio: k, timings: js.length };
  },
  async clear() {
    try { const root = await navigator.storage.getDirectory(); await root.removeEntry('myrec', { recursive: true }); } catch (e) { }
    try { await caches.delete(this.CACHE); } catch (e) { }
    this.where.clear();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear(); this.books.clear(); this.tm = null; timingMem.clear();
    await idbPut('rec:tm', null);
  }
};
MyRec.init();
const realAudio = new Audio();
realAudio.preload = 'auto';

/* ---------- 語音播放器 ---------- */
const audioCache = new Map(); // 本次開啟期間已載入的語音
const player = {
  queue: [], idx: 0, audio: null, paused: false, active: false, token: 0, watch: 0, segEnd: 0, realFailed: new Set(),
  chapters: [], chIdx: 0, chTotal: 0,
  async start(items, label, chapters) {
    this.stop(true);
    this.chapters = chapters || []; this.chIdx = 0; this.chTotal = this.chapters.length;
    if (!items.length && !this.chapters.length) return;
    this.queue = items; this.idx = 0; this.active = true; this.paused = false; this.label = label;
    $('#player').hidden = false;
    if (!items.length) { if (!(await this.loadNextChapter())) return; }
    this.playCurrent();
  },
  // 長時間播放（整卷、整本）：一章一章載入
  async loadNextChapter() {
    const tk = this.token;
    while (this.chIdx < this.chapters.length) {
      const [b, c, from, to] = this.chapters[this.chIdx++];
      try {
        const ch = await getChapter('cl', b, c);
        if (tk !== this.token) return false;
        const vs = ch.filter(([v, t]) => !isNoteVerse(t) && (from == null || v >= from) && (to == null || v <= to));
        if (vs.length) { this.queue = vs.map(([v]) => ({ b, c, v })); this.idx = 0; return true; }
      } catch (e) { if (tk === this.token) { toast(e.message); this.stop(); } return false; }
    }
    this.stop(); return false;
  },
  async playCurrent() {
    const tk = ++this.token;
    const it = this.queue[this.idx];
    if (!it) { this.stop(); return; }
    updatePlayerUI('準備中… Loading');
    markPlaying(it);
    let text;
    try {
      const ch = await getChapter('cl', it.b, it.c);
      const row = ch.find(r => r[0] === it.v);
      text = row ? row[1] : '';
    } catch (e) { if (tk === this.token) { toast(e.message); this.stop(); } return; }
    if (tk !== this.token) return;
    if (isNoteVerse(text)) { if (this.queue.length === 1) { toast('這一節是註記（或併在上一節），沒有單獨的朗讀。'); this.stop(); } else this.next(); return; }
    await MyRec.init();
    let mode = voiceFor(it.b);
    if (mode === 'real' && !this.realFailed.has(`real:${it.b}:${it.c}`)) {
      const tm = await getTimings(it.b, it.c);
      const seg = tm && tm.get(it.v);
      let url = null;
      if (seg) { try { url = await MyRec.url(it.b); } catch (e) { this.realFailed.add(`real:${it.b}:${it.c}`); } }
      if (tk !== this.token) return;
      if (seg && url) { this.playReal(it, seg, tm, tk, url, 'real'); return; }
      mode = 'fable';  // 這一節沒有錄音 → 改用 Fable
    }
    if (mode === 'fable' && !this.realFailed.has(`fable:${it.b}:${it.c}`)) {
      const tm = await getFableTimings(it.b, it.c);
      if (tk !== this.token) return;
      const seg = tm && tm.get(it.v);
      if (seg) { this.playReal(it, seg, tm, tk, new URL(fableUrl(it.b, it.c, '.m4a'), location.href).href, 'fable'); return; }
    }
    if (!text) { this.next(); return; }
    if (this.audio === realAudio) { try { realAudio.pause(); } catch (e) { } }
    const a = getAudio(text);
    this.audio = a;
    a.onended = () => { if (tk === this.token) this.next(); };
    a.onerror = () => {
      if (tk !== this.token) return;
      audioCache.delete(text);
      toast('這台裝置沒有可用的英文語音。 No English voice is available on this device.');
      this.stop();
    };
    a.onplaying = () => { if (tk === this.token) updatePlayerUI('朗讀中 Reading'); };
    try { a.currentTime = 0; } catch (e) { }
    if (!this.paused) a.play().catch(err => { if (tk === this.token && err.name !== 'AbortError') { updatePlayerUI('請按「繼續」 Tap Resume'); this.paused = true; $('#playerPause').textContent = '繼續 Resume'; } });
    // 預先載入下一節
    const nx = this.queue[this.idx + 1];
    if (!nx && this.chIdx < this.chapters.length) { const [nb, nc] = this.chapters[this.chIdx]; getChapter('cl', nb, nc).catch(() => { }); }

  },
  playReal(it, seg, tm, tk, url, mode) {
    const label = mode === 'fable' ? '朗讀中 Reading（Fable）' : '朗讀中 Reading（Scourby）';
    const a = realAudio;
    if (this.audio && this.audio !== a) { try { this.audio.pause(); } catch (e) { } }
    this.audio = a;
    const same = a.src === url;
    const contiguous = same && !a.paused && Math.abs(a.currentTime - seg.start) < 0.8;
    if (!same) a.src = url;
    this.segEnd = seg.end;
    a.onended = () => { if (tk === this.token) this.finishReal(tk); };
    a.onerror = () => {
      if (tk !== this.token) return;
      this.realFailed.add(`${mode}:${it.b}:${it.c}`);  // 錄音讀不到 → 這一章改用別的聲音
      this.playCurrent();
    };
    a.onplaying = () => { if (tk === this.token) updatePlayerUI(label); };
    if (!contiguous) {
      const seek = () => { try { a.currentTime = seg.start; } catch (e) { } };
      if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, { once: true });
    }
    if (!this.paused) a.play().catch(err => { if (tk === this.token && err.name !== 'AbortError') { updatePlayerUI('請按「繼續」 Tap Resume'); this.paused = true; $('#playerPause').textContent = '繼續 Resume'; } });
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (tk !== this.token) { clearInterval(this.watch); return; }
      if (a.readyState < 1 || a.seeking || a.currentTime < this.segEnd - 0.03) return;
      // 下一節在同一章、緊接著 → 不停頓，直接接著唸
      const nx = this.queue[this.idx + 1];
      const ns = nx && nx.b === it.b && nx.c === it.c ? tm.get(nx.v) : null;
      if (ns && ns.start - this.segEnd < 1.0 && ns.start >= this.segEnd - 1.0) {
        this.idx++; this.segEnd = ns.end; markPlaying(nx); updatePlayerUI(this.paused ? '已暫停 Paused' : label);
        it = nx;
        return;
      }
      this.finishReal(tk);
    }, 40);
    // 預先載入下一章的時間表
    if (this.idx + 1 >= this.queue.length && this.chIdx < this.chapters.length) {
      const [nb, nc] = this.chapters[this.chIdx]; getChapter('cl', nb, nc).catch(() => { });
      if (mode === 'fable') getFableTimings(nb, nc);
    }
  },
  finishReal(tk) {
    if (tk !== this.token) return;
    clearInterval(this.watch);
    const nx = this.queue[this.idx + 1];
    const cur = this.queue[this.idx];
    if (!(nx && cur && nx.b === cur.b && nx.c === cur.c)) { try { realAudio.pause(); } catch (e) { } }
    this.next();
  },
  async next() {
    this.idx++;
    if (this.idx < this.queue.length) return this.playCurrent();
    if (this.chIdx < this.chapters.length) { if (await this.loadNextChapter()) this.playCurrent(); return; }
    this.stop();
  },
  togglePause() {
    if (!this.active) return;
    this.paused = !this.paused;
    $('#playerPause').textContent = this.paused ? '繼續 Resume' : '暫停 Pause';
    if (this.audio) { if (this.paused) this.audio.pause(); else this.audio.play().catch(() => { }); }
    updatePlayerUI(this.paused ? '已暫停 Paused' : '朗讀中 Reading');
  },
  stop(silent) {
    this.token++;
    clearInterval(this.watch);
    if (this.audio) { try { this.audio.pause(); } catch (e) { } this.audio.onended = this.audio.onerror = this.audio.onplaying = null; }
    this.audio = null; this.active = false; this.queue = []; this.paused = false; this.chapters = []; this.chIdx = this.chTotal = 0;
    $('#playerPause').textContent = '暫停 Pause';
    if (!silent) $('#player').hidden = true;
    markPlaying(null);
  },
  current() { return this.active ? this.queue[this.idx] : null; }
};
/* 英文 AI 語音：用手機／電腦內建的語音合成（不需網路服務） */
function pickVoice() {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const en = vs.filter(v => /^en/i.test(v.lang));
  return en.find(v => v.voiceURI === settings.ttsVoice) || en.find(v => /en-US/i.test(v.lang) && /google/i.test(v.name))
    || en.find(v => /en-GB/i.test(v.lang)) || en.find(v => /en-US/i.test(v.lang)) || en[0] || null;
}
if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }
// 長句切成小段念（部分瀏覽器念超過 15 秒會自己停）
function speechChunks(text) {
  const parts = plain(text).match(/[^.;:!?]+[.;:!?]*\s*/g) || [plain(text)];
  const out = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1] + p).length < 160) out[out.length - 1] += p; else out.push(p);
  }
  return out.map(x => x.trim()).filter(Boolean);
}
// 模仿 <audio> 的小物件，讓播放器不用大改
class SpeechClip {
  constructor(text) { this.text = text; this.paused = true; this.onended = this.onerror = this.onplaying = null; this.currentTime = 0; this.readyState = 4; }
  play() {
    if (!window.speechSynthesis) { setTimeout(() => this.onerror && this.onerror(), 0); return Promise.resolve(); }
    speechSynthesis.cancel();
    this.paused = false; const myRun = this.run = (this.run || 0) + 1;
    const chunks = speechChunks(this.text), voice = pickVoice();
    if (!chunks.length) { setTimeout(() => this.onended && this.onended(), 0); return Promise.resolve(); }
    chunks.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
      u.rate = settings.rate || 1;
      if (i === 0) u.onstart = () => { if (this.run === myRun && this.onplaying) this.onplaying(); };
      if (i === chunks.length - 1) u.onend = () => { if (this.run === myRun && !this.paused) { this.paused = true; this.onended && this.onended(); } };
      u.onerror = ev => { if (this.run === myRun && !this.paused && !/interrupted|canceled/.test(ev.error || '')) { this.paused = true; this.onerror && this.onerror(); } };
      speechSynthesis.speak(u);
    });
    return Promise.resolve();
  }
  pause() { this.paused = true; this.run = (this.run || 0) + 1; try { speechSynthesis.cancel(); } catch (e) { } }
}
function getAudio(text) { return new SpeechClip(text); }
function updatePlayerUI(status) {
  const it = player.current();
  if (!it) return;
  const total = player.queue.length;
  const long = player.chTotal > 1;
  $('#playerLabel').textContent = refLabel(it.b, it.c, it.v) + (!long && total > 1 ? `（${player.idx + 1}/${total}）` : '');
  $('#playerStatus').textContent = (long ? `${player.label}・${player.chIdx}/${player.chTotal}　` : '') + (status || '');
}
function markPlaying(it) {
  document.querySelectorAll('.verse.playing').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll('.play.on').forEach(el => { el.classList.remove('on'); el.textContent = '▶'; });
  if (!it) return;
  // 若目前畫面不是這一章，就換過去
  if (currentView.name !== 'chapter') return; // 使用者在別的頁面，就不打擾
  if (currentView.b !== it.b || currentView.c !== it.c) {
    location.hash = `#/c/${it.b}/${it.c}`;
    return; // 畫面換好後 renderChapter 會再標示
  }
  const el = document.getElementById('v' + it.v);
  if (el) {
    el.classList.add('playing');
    const btn = el.querySelector('.play'); if (btn) { btn.classList.add('on'); btn.textContent = '■'; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
$('#playerPause').onclick = () => player.togglePause();
$('#playerStop').onclick = () => player.stop();

async function buildRange(r) {
  const items = [];
  for (let c = r.c1; c <= r.c2; c++) {
    const ch = await getChapter('cl', r.b, c);
    const maxV = ch.length ? ch[ch.length - 1][0] : 0;
    const from = (c === r.c1 && r.v1) ? r.v1 : 1;
    let to = maxV;
    if (c === r.c2 && r.v2 != null) to = r.v2;
    else if (c === r.c2 && !r.isRange && r.v1) to = r.v1; // 單節
    if (from > maxV) throw new Error(`${BOOK_EN_NAME[r.b]} ${c} 只有 ${maxV} 節 (verses)。`);
    if (to > maxV) throw new Error(`${BOOK_EN_NAME[r.b]} ${c} 只有 ${maxV} 節 (verses)。`);
    for (const [v, t] of ch) if (v >= from && v <= to && !isNoteVerse(t)) items.push({ b: r.b, c, v });
  }
  return items;
}
async function playRange(text, errEl) {
  const r = parseRef(text);
  if (r.err) { errEl ? (errEl.textContent = r.err) : toast(r.err); return; }
  if (!r.isRange && r.v1 == null) { r.isRange = true; } // 整章
  try {
    const items = await buildRange(r);
    if (errEl) errEl.textContent = '';
    store.set('lastRange', text);
    if (items.length) location.hash = `#/c/${items[0].b}/${items[0].c}`;
    player.start(items, text);
  } catch (e) { errEl ? (errEl.textContent = e.message) : toast(e.message); }
}

function chapterList(fromBook, toBook) {
  const list = [];
  for (let b = fromBook; b < toBook; b++) for (let c = 1; c <= BOOKS[b][2]; c++) list.push([b, c]);
  return list;
}
function playBooks(fromBook, toBook, label) { location.hash = `#/c/${fromBook}/1`; player.start([], label, chapterList(fromBook, toBook)); }

/* 讓讀經頁的書卷列剛好貼在上排標題下面（上排高度會因提示文字而變） */
(() => {
  const tb = document.querySelector('.topbar');
  const set = () => document.documentElement.style.setProperty('--tb', tb.offsetHeight + 'px');
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(tb); else window.addEventListener('resize', set);
})();

/* 首頁書卷格：太長的全名縮小字體，英文只在空格換行、不切斷單字 */
function fitBookNames() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px';
  document.body.appendChild(probe);
  document.querySelectorAll('.hb .nm, .hb .fz').forEach(el => {
    el.style.fontSize = '';
    const room = el.parentElement.clientWidth - 6;
    const parts = el.classList.contains('nm') ? el.textContent.split(' ') : [el.textContent];
    let f = parseFloat(getComputedStyle(el).fontSize);
    const widest = () => { probe.style.fontSize = f + 'px'; return Math.max(...parts.map(w => { probe.textContent = w; return probe.offsetWidth; })); };
    while (f > 7 && widest() > room) f -= 0.5;
    el.style.fontSize = f + 'px';
  });
  probe.remove();
}
let fitTimer = 0;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (currentView.name === 'home') fitBookNames(); }, 150); });

/* ---------- 跳到經節（全頁選擇器） ---------- */
async function openJump(cur) {
  const r = await Picker.open({ mode: 'jump', cur });
  if (!r) return;
  const h = `#/c/${r.b}/${r.c}${r.v ? '/' + r.v : ''}`;
  if (location.hash === h) route(); else location.hash = h;
}

/* ---------- 範圍朗讀：起點、迄點 ---------- */
const cmpRef = (a, b) => (a.b - b.b) || (a.c - b.c) || (a.v - b.v);
const refText = r => `${BOOK_EN[r.b]} ${r.c}:${r.v}`;
function rangeLabel(s, e) {
  if (s.b !== e.b) return `${refText(s)}－${refText(e)}`;
  if (s.c !== e.c) return `${refText(s)}-${e.c}:${e.v}`;
  return s.v === e.v ? refText(s) : `${refText(s)}-${e.v}`;
}
function rangeChapters(s, e) {
  const list = [];
  for (let b = s.b; b <= e.b; b++) {
    const c1 = b === s.b ? s.c : 1, c2 = b === e.b ? e.c : BOOKS[b][2];
    for (let c = c1; c <= c2; c++) list.push([b, c, b === s.b && c === s.c ? s.v : null, b === e.b && c === e.c ? e.v : null]);
  }
  return list;
}
function rangeVerseCount(s, e) {
  let n = 0;
  for (const [b, c, from, to] of rangeChapters(s, e)) n += (to ?? BOOK_VC[b][c - 1]) - (from ?? 1) + 1;
  return n;
}
function setupRangeBox() {
  const rg = store.get('range', { s: null, e: null });
  const draw = () => {
    const set = (el, lbl, r) => {
      el.classList.toggle('empty', !r);
      el.innerHTML = `<span class="lbl">${lbl}</span><small>${r ? esc(refText(r)) : '請選擇 Choose'}</small>`;
    };
    set($('#rStart'), '起 From', rg.s); set($('#rEnd'), '迄 To', rg.e);
    const ok = rg.s && rg.e;
    const btn = $('#rangePlay');
    btn.disabled = !ok;
    btn.textContent = ok ? `▶ 朗讀 Read（${rangeVerseCount(rg.s, rg.e)} 節 verses）` : '▶ 朗讀 Read';
    store.set('range', rg);
  };
  draw();
  $('#rStart').onclick = async () => {
    const r = await Picker.open({ mode: 'start', cur: rg.s });
    if (!r) return;
    rg.s = r;
    const warn = $('#rangeWarn');
    if (rg.e && cmpRef(rg.e, rg.s) < 0) {
      warn.textContent = `起點改到 ${refText(rg.s)}，比原本的迄點 ${refText(rg.e)} 還後面，所以迄點已清除，請重選。`;
      rg.e = null;
    } else if (warn) warn.textContent = '';
    draw();
  };
  $('#rEnd').onclick = async () => {
    if (!rg.s) { toast('請先選起點 Choose start first'); return; }
    const r = await Picker.open({ mode: 'end', min: rg.s, startBook: rg.e ? rg.e.b : rg.s.b, cur: rg.e });
    if (!r) return;
    rg.e = r; $('#rangeWarn').textContent = '';
    draw();
  };
  $('#rangePlay').onclick = () => {
    if (!rg.s || !rg.e) return;
    location.hash = `#/c/${rg.s.b}/${rg.s.c}`;
    player.start([], rangeLabel(rg.s, rg.e), rangeChapters(rg.s, rg.e));
  };
}

/* ---------- 書籤、上次位置 ---------- */
const getBookmarks = () => store.get('bookmarks', []);
const isBookmarked = (b, c, v) => getBookmarks().some(x => x.b === b && x.c === c && x.v === v);
function toggleBookmark(b, c, v) {
  let bm = getBookmarks();
  if (isBookmarked(b, c, v)) { bm = bm.filter(x => !(x.b === b && x.c === c && x.v === v)); toast(`已移除書籤 Removed ${refLabel(b, c, v)}`); }
  else { bm.unshift({ b, c, v, t: Date.now() }); toast(`已加入書籤 Bookmarked ${refLabel(b, c, v)}`); }
  store.set('bookmarks', bm);
  return isBookmarked(b, c, v);
}

/* ---------- 畫面 ---------- */
let currentView = { name: '' };
const view = () => $('#view');

function renderHome() {
  currentView = { name: 'home' };
  const last = store.get('last', null);
  const grid = (from, to) => BOOKS.slice(from, to).map(([ab, full], k) => {
    const i = from + k;
    return `<a href="#/b/${i}" class="hb cat-${BOOK_CAT[i]}"><span class="en">${BOOK_EN[i]}</span><span class="zh">${ab}</span>` +
      `<span class="nm" lang="en">${BOOK_EN_NAME[i]}</span><span class="fz">${full}</span></a>`;
  }).join('');
  view().innerHTML = `
    <div class="box">
      <button class="btn wide" id="jumpBtn" type="button">跳到經節 Go to verse ›</button>
    </div>
    <div class="box">
      <div class="muted" style="font-size:14px;margin-bottom:6px">範圍朗讀 Range reading（可跨章、跨卷）</div>
      <div class="pick">
        <button class="pickbtn" id="rStart" type="button"></button>
        <button class="pickbtn" id="rEnd" type="button"></button>
      </div>
      <div id="rangeWarn" class="err" style="margin:0 0 8px"></div>
      <button class="btn wide" id="rangePlay" type="button"></button>
    </div>
    <div class="box">
      <div class="muted" style="font-size:14px;margin-bottom:6px">連續播放 Continuous play</div>
      <div class="row play3">
        <button class="btn ghost" type="button" data-play="all">▶ 全本 All</button>
        <button class="btn ghost" type="button" data-play="ot">▶ 舊約 OT</button>
        <button class="btn ghost" type="button" data-play="nt">▶ 新約 NT</button>
      </div>
      <div class="muted" style="font-size:13px;margin-top:6px">要播某一卷：點書卷後按「▶ 播放整卷」。 To play one book, open it and tap ▶.</div>
    </div>
    ${last ? `<p><a href="#/c/${last.b}/${last.c}">繼續閱讀 Continue：${esc(BOOK_EN_NAME[last.b])} ${last.c}｜${esc(BOOKS[last.b][1])}</a></p>` : ''}
    <h2>舊約 Old Testament（39）</h2><div class="hgrid">${grid(0, OT_COUNT)}</div>
    <h2>新約 New Testament（27）</h2><div class="hgrid">${grid(OT_COUNT, 66)}</div>
    <footer class="about">經文 Text：King James Version (1611), Pure Cambridge Edition（公版 Public domain）<br>AI 朗讀 Voice：Kokoro（bm_fable，Apache 2.0）</footer>`;
  $('#jumpBtn').onclick = () => openJump(last ? { b: last.b, c: last.c } : null);
  fitBookNames();
  setupRangeBox();
  view().querySelectorAll('[data-play]').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.play;
    if (k === 'all') playBooks(0, 66, 'Bible 全本');
    else if (k === 'ot') playBooks(0, OT_COUNT, 'OT 舊約');
    else playBooks(OT_COUNT, 66, 'NT 新約');
  });
}

function renderBook(b) {
  currentView = { name: 'book', b };
  const [ab, full, n] = BOOKS[b];
  let links = '';
  for (let c = 1; c <= n; c++) links += `<a href="#/c/${b}/${c}">${c}</a>`;
  view().innerHTML = `<h1>${esc(BOOK_EN_NAME[b])}<span class="h1zh">${esc(full)}</span></h1>
    <div class="chap-tools"><button class="btn" id="playBook" type="button">▶ 播放整卷 Play book（${n}）</button></div>
    <div class="grid chapters">${links}</div>`;
  $('#playBook').onclick = () => playBooks(b, b + 1, BOOK_EN_NAME[b]);
  setupBookDownload(b);
}
async function bookCachedCount(b) {
  try {
    const cache = await caches.open(FABLE_CACHE);
    let n = 0;
    for (let c = 1; c <= BOOKS[b][2]; c++) if (await cache.match(new URL(fableUrl(b, c, '.m4a'), location.href).href)) n++;
    return n;
  } catch (e) { return 0; }
}
async function setupBookDownload(b) {
  if (!('caches' in window)) return;
  const n = BOOKS[b][2];
  const box = document.createElement('div');
  box.className = 'box'; box.style.marginTop = '16px';
  box.innerHTML = `<div>離線收聽 Offline：已下載 <b id="bkN">…</b> / ${n} 章 Fable 朗讀</div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="bkDl" type="button">下載這卷 Download</button><span id="bkMsg" class="muted" style="font-size:14px"></span></div>
    <div class="progress"><div id="bkBar"></div></div>`;
  view().appendChild(box);
  const show = k => { const el = $('#bkN'); if (el) el.textContent = k; const bar = $('#bkBar'); if (bar) bar.style.width = Math.round(k / n * 100) + '%'; };
  const me = currentView;
  const k0 = await bookCachedCount(b);
  if (currentView !== me) return;
  show(k0);
  $('#bkDl').onclick = async () => {
    const btn = $('#bkDl'); btn.disabled = true; btn.textContent = '下載中… Downloading';
    const cache = await caches.open(FABLE_CACHE);
    let k = 0, fail = 0;
    for (let c = 1; c <= n; c++) {
      try {
        const u = new URL(fableUrl(b, c, '.m4a'), location.href).href;
        if (!(await cache.match(u))) {
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) throw new Error(r.status);
          await cache.put(u, r);
        }
        if (!(await getFableTimings(b, c))) throw new Error('timings');
        k++;
      } catch (e) { fail++; }
      if (currentView.name === 'book' && currentView.b === b) show(k);
    }
    const msg = fail ? `有 ${fail} 章下載失敗，可再按一次補下載。` : '下載完成，沒網路也能聽這一卷。 Saved for offline.';
    toast(msg, 4000);
    if (currentView.name === 'book' && currentView.b === b) { const bt = $('#bkDl'); bt.disabled = false; bt.textContent = '下載這卷 Download'; $('#bkMsg').textContent = msg; }
  };
}
async function renderChapter(b, c, v) {
  currentView = { name: 'chapter', b, c };
  const [ab, full, n] = BOOKS[b];
  store.set('last', { b, c });
  view().innerHTML = `
    <div class="subbar" id="subbar">
      <button class="sb-title" id="chapTitle" type="button" aria-label="選擇書卷、章、節">
        <span class="sb-zh"><h1>${esc(BOOK_EN_NAME[b])} ${c}</h1><span class="caret">▾</span></span>
        <span class="sb-en">${esc(full)} 第 ${c} 章</span>
      </button>
      <button class="sb-nav" id="sbPrev" type="button" aria-label="上一章"${prevChap(b, c) ? '' : ' disabled'}>‹</button>
      <button class="sb-nav" id="sbNext" type="button" aria-label="下一章"${nextChap(b, c) ? '' : ' disabled'}>›</button>
    </div>
    <div class="chap-tools">
      <button class="btn" id="playAll" type="button">▶ 播放 Play</button>
      <a class="btn ghost" href="#/b/${b}" style="text-decoration:none">選章 Chapters</a>
    </div>
    <ol class="verses" id="verses"><li class="muted">載入中… Loading</li></ol>
    <div class="chap-nav">
      ${prevChap(b, c) ? `<a class="btn ghost" style="text-decoration:none" href="#/c/${prevChap(b, c).join('/')}">‹ 上一章 Prev</a>` : '<span></span>'}
      ${nextChap(b, c) ? `<a class="btn ghost" style="text-decoration:none" href="#/c/${nextChap(b, c).join('/')}">Next 下一章 ›</a>` : '<span></span>'}
    </div>`;
  $('#chapTitle').onclick = () => openJump({ b, c });
  $('#sbPrev').onclick = () => { const p = prevChap(b, c); if (p) location.hash = `#/c/${p[0]}/${p[1]}`; };
  $('#sbNext').onclick = () => { const n2 = nextChap(b, c); if (n2) location.hash = `#/c/${n2[0]}/${n2[1]}`; };
  $('#playAll').onclick = async () => {
    try { const items = await buildRange({ b, c1: c, c2: c, v1: null, v2: null, isRange: true }); player.start(items, refLabel(b, c)); }
    catch (e) { toast(e.message); }
  };
  let data;
  try { data = await getChapter(null, b, c); }
  catch (e) { if (currentView.b === b && currentView.c === c) $('#verses').innerHTML = `<li class="err">${esc(e.message)}</li>`; return; }
  if (currentView.name !== 'chapter' || currentView.b !== b || currentView.c !== c) return;
  const heads = getHeads(b, c);
  $('#verses').innerHTML = data.map(([n2, t]) => (heads[n2] ? `<li class="vhead">${fmtVerse(heads[n2])}</li>` : '') + `
    <li class="verse${v === n2 ? ' hl' : ''}" id="v${n2}">
      <button class="play" type="button" data-v="${n2}" aria-label="朗讀第 ${n2} 節">▶</button>
      <div class="vtext"><span class="vnum">${n2}</span>${fmtVerse(t)}</div>
      <button class="star${isBookmarked(b, c, n2) ? ' on' : ''}" type="button" data-v="${n2}" aria-label="書籤">${isBookmarked(b, c, n2) ? '★' : '☆'}</button>
    </li>`).join('');
  setupSelection(b, c, data);
  $('#verses').onclick = e => {
    if (Date.now() < sel.suppressUntil) return;
    const row = e.target.closest('.verse');
    if (sel.active) { if (row) toggleSel(+row.id.slice(1)); return; }
    const p = e.target.closest('.play'), s = e.target.closest('.star');
    if (p) {
      const vv = +p.dataset.v, cur = player.current();
      if (cur && cur.b === b && cur.c === c && cur.v === vv && player.queue.length === 1) { player.stop(); return; }
      player.start([{ b, c, v: vv }], refLabel(b, c, vv));
    } else if (s) {
      const on = toggleBookmark(b, c, +s.dataset.v);
      s.classList.toggle('on', on); s.textContent = on ? '★' : '☆';
    }
  };
  const cur = player.current();
  if (cur && cur.b === b && cur.c === c) markPlaying(cur);
  else if (v) { const el = document.getElementById('v' + v); if (el) el.scrollIntoView({ block: 'center' }); }
  else if (!restoreScroll()) window.scrollTo(0, 0);
  backPending = false;
}
function topVisibleVerse() {
  const els = document.querySelectorAll('.verse');
  const sb = document.getElementById('subbar');
  const lim = sb ? sb.getBoundingClientRect().bottom : 70;
  for (const el of els) if (el.getBoundingClientRect().bottom > lim + 4) return el.id.slice(1);
  return null;
}
function prevChap(b, c) { if (c > 1) return [b, c - 1]; if (b > 0) return [b - 1, BOOKS[b - 1][2]]; return null; }
function nextChap(b, c) { if (c < BOOKS[b][2]) return [b, c + 1]; if (b < 65) return [b + 1, 1]; return null; }

/* 選取經節、複製：長按進入選取，點其他節可加選／取消，按「複製」複製到剪貼簿 */
const sel = { active: false, b: -1, c: -1, set: new Set(), data: [], suppressUntil: 0 };
function setupSelection(b, c, data) {
  clearSelection();
  sel.b = b; sel.c = c; sel.data = data;
  const list = $('#verses');
  let timer = 0, sx = 0, sy = 0, longFired = false;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.verse');
    if (!row || sel.active || e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = 0; sel.active = true; longFired = true; sel.suppressUntil = Date.now() + 1500;
      toggleSel(+row.id.slice(1));
      if (navigator.vibrate) try { navigator.vibrate(30); } catch (err) { }
    }, 500);
  });
  list.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => list.addEventListener(t, () => {
    cancel();
    if (longFired) { longFired = false; sel.suppressUntil = Date.now() + 150; }  // 放開手指後緊接的那一下點擊不算
  }));
  list.addEventListener('contextmenu', e => { if (e.target.closest('.verse')) e.preventDefault(); });
}
function toggleSel(v) {
  const row = document.getElementById('v' + v);
  if (!row) return;
  if (sel.set.has(v)) sel.set.delete(v); else sel.set.add(v);
  row.classList.toggle('sel', sel.set.has(v));
  if (!sel.set.size) { clearSelection(); return; }
  sel.active = true;
  const btn = $('#copyBtn'); btn.hidden = false; btn.textContent = `複製 Copy（${sel.set.size}）`;

  updateHint();
}
function clearSelection() {
  sel.active = false; sel.set.clear();
  document.querySelectorAll('.verse.sel').forEach(el => el.classList.remove('sel'));
  const btn = $('#copyBtn'); if (btn) btn.hidden = true;
  updateHint();
}
// 標題下的小字提示：只在讀經頁顯示
function updateHint() {
  const h = document.getElementById('hint');
  if (!h) return;
  h.hidden = currentView.name !== 'chapter';
  h.textContent = sel.active ? '點其他經節可加選 Tap more verses' : '長按經節可複製 Long-press to copy';
}
// 格式：經文 經文 ... 經文 John 3:16-17,20 (KJV)
function selectionText() {
  const rows = sel.data.filter(([v]) => sel.set.has(v));
  const order = sel.data.map(([v]) => v);
  const groups = [];
  for (const [v, t] of rows) {
    const g = groups[groups.length - 1];
    if (g && order.indexOf(v) === order.indexOf(g.last) + 1) { g.last = v; g.texts.push(plain(t)); }
    else groups.push({ first: v, last: v, texts: [plain(t)] });
  }
  const text = groups.map(g => g.texts.join(' ')).join(' ... ');
  const ref = groups.map(g => `${g.first}${g.last !== g.first ? '-' + g.last : ''}`).join(',');
  return `${text} ${BOOK_EN_NAME[sel.b]} ${sel.c}:${ref} (KJV)`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
$('#copyBtn').onclick = async () => {
  if (!sel.set.size) return;
  const n = sel.set.size, text = selectionText();
  clearSelection();
  toast(await copyText(text) ? `已複製 ${n} 節 Copied` : '無法複製 Copy failed');
};

/* 搜尋 */
const TOTAL_CHAPTERS = BOOKS.reduce((s, x) => s + x[2], 0);
async function countDownloaded() {
  const keys = await idbKeys();
  return keys.filter(k => /^bk:/.test(String(k))).length;   // 已存的卷數（共 66）
}
async function renderSearch(q) {
  const me = currentView = { name: 'search' };
  const scope = store.get('searchScope', 'all');
  view().innerHTML = `
    <button class="btn ghost back" id="backBtn" type="button">‹ 返回 Back</button>
    <h1>搜尋經文 Search</h1>
    <div class="box">
      <form id="sForm" class="row" autocomplete="off">
        <input id="sInput" type="search" placeholder="例 e.g. shepherd、love one another" value="${esc(q || '')}" aria-label="搜尋字詞">
        <select id="sScope" aria-label="範圍">
          <option value="all"${scope === 'all' ? ' selected' : ''}>全部 All</option>
          <option value="ot"${scope === 'ot' ? ' selected' : ''}>舊約 OT</option>
          <option value="nt"${scope === 'nt' ? ' selected' : ''}>新約 NT</option>
        </select>
        <button class="btn" type="submit">搜尋 Go</button>
      </form>
      <div class="muted" style="font-size:13px;margin-top:6px">不分大小寫。 Not case-sensitive.</div>
      <div id="sNote" class="muted" style="font-size:14px;margin-top:6px"></div>
    </div>
    <div id="sCount" class="muted"></div>
    <ul class="results" id="sRes"></ul>`;
  $('#sForm').onsubmit = e => { e.preventDefault(); store.set('searchScope', $('#sScope').value); location.hash = '#/search/' + encodeURIComponent($('#sInput').value.trim()); };
  const n = await countDownloaded();
  if (currentView !== me) return;
  if (n < 66) {
    $('#sNote').innerHTML = `搜尋整本聖經時會先下載全部經文（約 4 MB），第一次需要網路。 The full text (about 4 MB) loads on the first search.`;
  }
  if (!q) { $('#sInput').focus(); return; }
  await doSearch(q, scope);
}
async function doSearch(q, scope) {
  const fq = foldText(q).trim();
  if (!fq) return;
  $('#sCount').textContent = '搜尋中… Searching';
  const results = [];
  const range = scope === 'ot' ? [0, OT_COUNT] : scope === 'nt' ? [OT_COUNT, 66] : [0, 66];
  for (let b = range[0]; b < range[1]; b++) {
    let bk;
    try { bk = await getBook(b); } catch (e) { $('#sCount').textContent = e.message; return; }
    bk.forEach((ch, ci) => ch.v.forEach((t, vi) => { if (foldText(plain(t)).includes(fq)) results.push({ b, c: ci + 1, v: vi + 1, t }); }));
  }
  $('#sCount').textContent = `找到 ${results.length} 節 Found` + (results.length > 300 ? '（只列出前 300 節 first 300 shown）' : '');
  $('#sRes').innerHTML = results.slice(0, 300).map(r =>
    `<li><a href="#/c/${r.b}/${r.c}/${r.v}"><span class="ref">${esc(refLabel(r.b, r.c, r.v))}</span>${highlight(plain(r.t), fq)}</a></li>`).join('');
}
function highlight(t, fq) {
  // 以「去聲調後」的位置找出原文對應區段
  const map = []; let folded = '';
  const nfd = t.normalize('NFD');
  for (let i = 0; i < nfd.length; i++) {
    const ch = nfd[i];
    let f = ch.replace(/[̀-ͯ͘]/, '').replace('ⁿ', 'n').replace('-', ' ').toLowerCase();
    if (/\s/.test(f) && /\s$/.test(folded)) f = '';
    for (const x of f) { folded += x; map.push(i); }
  }
  const at = folded.indexOf(fq);
  if (at < 0) return esc(t);
  const s = map[at], e = (map[at + fq.length - 1] ?? nfd.length - 1) + 1;
  let e2 = e; while (e2 < nfd.length && /[̀-ͯ͘]/.test(nfd[e2])) e2++;
  return esc(nfd.slice(0, s).normalize('NFC')) + '<mark>' + esc(nfd.slice(s, e2).normalize('NFC')) + '</mark>' + esc(nfd.slice(e2).normalize('NFC'));
}

/* 書籤 */
async function renderBookmarks() {
  currentView = { name: 'bookmarks' };
  const bm = getBookmarks();
  view().innerHTML = `<button class="btn ghost back" id="backBtn" type="button">‹ 返回 Back</button>
    <h1>書籤 Bookmarks</h1>${bm.length ? '' : '<p class="muted">還沒有書籤。在經節右邊按 ☆ 就能加入。<br>No bookmarks yet. Tap ☆ beside a verse.</p>'}<ul class="results" id="bmList"></ul>`;
  const list = $('#bmList');
  for (const x of bm) {
    let t = '';
    try { const ch = await getChapter(null, x.b, x.c); const r = ch.find(y => y[0] === x.v); t = r ? r[1] : ''; } catch (e) { }
    const li = document.createElement('li');
    li.innerHTML = `<button class="rm" type="button" aria-label="移除">✕</button><a href="#/c/${x.b}/${x.c}/${x.v}"><span class="ref">${esc(refLabel(x.b, x.c, x.v))}</span>${fmtVerse(t)}</a>`;
    li.querySelector('.rm').onclick = () => { toggleBookmark(x.b, x.c, x.v); li.remove(); };
    list.appendChild(li);
  }
}

/* 設定 */
let dlRunning = false;
let recNote = '';  // 匯入結果（重畫設定頁後仍顯示）
async function renderSettings() {
  const me = currentView = { name: 'settings' };
  const n = await countDownloaded();
  await MyRec.init();
  if (currentView !== me) return;
  const rc = MyRec.count();
  view().innerHTML = `
    <button class="btn ghost back" id="backBtn" type="button">‹ 返回 Back</button>
    <h1>設定 Settings</h1>
    <div class="box">
      <div style="margin-bottom:8px">字體大小 Text size：<b id="fsVal">${settings.fs}</b> px</div>
      <div class="row"><button class="btn ghost" id="fsDown" type="button">A−</button><button class="btn ghost" id="fsUp" type="button">A+</button></div>
      <p class="vtext" style="margin:10px 0 0">For God so loved the world, that he gave his only begotten Son.</p>
    </div>
    <div class="box">
      <div style="margin-bottom:8px">我的錄音 My recordings：<b id="recN">${rc}</b> / 66 卷 books</div>
      <div class="muted" style="font-size:13px;margin-bottom:10px">選一個 zip 檔（裡面有 01.opus～66.opus 和 kjv_timings.json），或直接選這 67 個檔案。檔案只存在這台裝置，不會上傳。<br>Choose one zip file (or the 67 files). They stay on this device only.</div>
      <div class="row"><button class="btn" id="recImport" type="button">匯入 Import</button>${rc ? '<button class="btn ghost" id="recClear" type="button">移除 Remove</button>' : ''}</div>
      <input type="file" id="recFile" multiple accept=".zip,.opus,.ogg,.json,application/zip,audio/ogg,application/json" hidden>
      <div class="progress"><div id="recBar" style="width:${Math.round(rc / 66 * 100)}%"></div></div>
      <div id="recMsg" class="muted" style="font-size:14px;margin-top:6px">${esc(recNote)}</div>
    </div>
    <div class="box">
      <div style="margin-bottom:8px">朗讀聲音 Voice</div>
      <div class="seg" id="voiceSeg" style="margin-bottom:6px">
        <button type="button" data-voice="fable" class="${settings.voice === 'fable' ? 'on' : ''}">Fable</button>
        <button type="button" data-voice="real" class="${settings.voice === 'real' ? 'on' : ''}">Scourby</button>
        <button type="button" data-voice="ai" class="${settings.voice === 'ai' ? 'on' : ''}">手機 Device</button>
      </div>
      <div class="muted" style="font-size:13px;margin-bottom:10px">Fable：AI 英式男聲，預先錄好，需要網路或先下載該卷。<br>Scourby：真人朗讀，${rc ? `已匯入 ${rc} 卷。` : '需要先在上面「我的錄音」匯入。'}沒有錄音的地方改用 Fable。<br>手機：用手機內建語音，不需網路。</div>
      <div class="muted" style="font-size:13px;margin-bottom:6px">手機語音的聲音 Device voice：</div>
      <select id="voiceSel" style="width:100%"></select>
      <div style="margin:12px 0 8px">速度 Speed：<b id="rateVal">${settings.rate}</b>×</div>
      <div class="seg" id="rateSeg">${[0.8, 0.9, 1, 1.1, 1.25].map(r => `<button type="button" data-r="${r}" class="${settings.rate === r ? 'on' : ''}">${r}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn ghost" id="voiceTest" type="button">▶ 試聽 Test</button></div>
      <div class="muted" style="font-size:13px;margin-top:6px">手機語音可選的聲音依裝置而不同。 Device voices vary by phone.</div>
    </div>
    <div class="box">
      <div style="margin-bottom:8px">外觀 Theme</div>
      <div class="seg" id="themeSeg">
        <button type="button" data-t="auto" class="${settings.theme === 'auto' ? 'on' : ''}">跟手機 Auto</button>
        <button type="button" data-t="light" class="${settings.theme === 'light' ? 'on' : ''}">淺色 Light</button>
        <button type="button" data-t="dark" class="${settings.theme === 'dark' ? 'on' : ''}">深色 Dark</button>
      </div>
    </div>
    <div class="box">
      <div>離線經文 Offline text：<b id="nBk">${n}</b> / 66 卷 books</div>
      <div class="muted" style="font-size:14px;margin:6px 0 10px">讀過的書卷會自動存下來；按下面按鈕可一次存全本（約 4 MB）。<br>Books you open are saved automatically. Save all for offline use (about 4 MB).</div>
      <button class="btn" id="dlAll" type="button"${dlRunning ? ' disabled' : ''}>${dlRunning ? '下載中… Saving' : '下載全本 Save all'}</button>
      <div class="progress"><div id="dlBar" style="width:${Math.round(n / 66 * 100)}%"></div></div>
      <div id="dlMsg" class="muted" style="font-size:14px;margin-top:6px"></div>
    </div>
    <footer class="about">經文 Text：King James Version (1611), Pure Cambridge Edition（公版 Public domain）<br>AI 朗讀 Voice：Kokoro（bm_fable，Apache 2.0）<br>版本 Version ${APP_VER}</footer>`;
  const setFs = d => { settings.fs = Math.min(32, Math.max(14, settings.fs + d)); saveSettings(); $('#fsVal').textContent = settings.fs; };
  $('#fsDown').onclick = () => setFs(-1);
  $('#fsUp').onclick = () => setFs(+1);
  $('#themeSeg').querySelectorAll('button').forEach(btn => btn.onclick = () => {
    settings.theme = btn.dataset.t; saveSettings();
    $('#themeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
  });
  $('#dlAll').onclick = downloadAll;
  const fillVoices = () => {
    const vs = ((window.speechSynthesis && speechSynthesis.getVoices()) || []).filter(v => /^en/i.test(v.lang));
    const cur = pickVoice();
    const sel = $('#voiceSel'); if (!sel) return;
    sel.innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}"${cur && cur.voiceURI === v.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')
      : '<option value="">（找不到英文語音 No English voice found）</option>';
  };
  fillVoices();
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', fillVoices);
  $('#voiceSel').onchange = e => { settings.ttsVoice = e.target.value; saveSettings(); player.stop(); };
  $('#rateSeg').querySelectorAll('button').forEach(btn => btn.onclick = () => {
    settings.rate = +btn.dataset.r; saveSettings(); $('#rateVal').textContent = settings.rate;
    $('#rateSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
  });
  if ($('#voiceSeg')) $('#voiceSeg').querySelectorAll('button').forEach(btn => btn.onclick = () => {
    settings.voice = btn.dataset.voice; saveSettings(); player.stop();
    $('#voiceSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
  });
  $('#recImport').onclick = () => {
    $('#recMsg').textContent = '選好檔案後按「選取」。檔案如果在雲端硬碟，手機會先下載，可能要等幾分鐘才會開始匯入。';
    $('#recFile').click();
  };
  $('#recFile').onchange = async e => {
    const files = e.target.files; if (!files || !files.length) return;
    const btn = $('#recImport'); btn.disabled = true; btn.textContent = '匯入中… Importing';
    const bar = $('#recBar'), msg = $('#recMsg');
    bar.style.width = '0%'; bar.parentElement.classList.add('busy');
    const MB = x => (x / 1048576).toFixed(0);
    const sz = [...files].reduce((n, f) => n + f.size, 0);
    msg.textContent = files.length === 1 ? `已選：${files[0].name}（${MB(sz)} MB），開始匯入…` : `已選 ${files.length} 個檔案（${MB(sz)} MB），開始匯入…`;
    try {
      const r = await MyRec.importFiles(files, p => {
        if (p.stage) { msg.textContent = p.stage; return; }
        if (p.unzip) { msg.textContent = `解壓縮中 Unzipping　第 ${p.k} / ${p.n} 個：${p.name}`; return; }
        bar.style.width = (p.done / p.total * 100).toFixed(1) + '%';
        msg.textContent = `匯入中 ${Math.floor(p.done / p.total * 100)}%（${MB(p.done)} / ${MB(p.total)} MB）　第 ${p.k} / ${p.n} 個：${p.name}　請勿離開這一頁`;
      });
      settings.voice = 'real'; saveSettings();
      recNote = `✔ 匯入完成：錄音 ${r.audio} 個、時間表 ${r.timings} 個。 Imported.`;
    } catch (err) { recNote = `✘ 匯入失敗 Import failed：${err.name && err.name !== 'Error' ? err.name + '：' : ''}${err.message || err}`; }
    if (currentView === me) renderSettings();
  };
  if ($('#recClear')) $('#recClear').onclick = async () => {
    if (!confirm('移除這台裝置上的所有錄音？ Remove all recordings from this device?')) return;
    player.stop(); await MyRec.clear(); settings.voice = 'fable'; saveSettings(); renderSettings();
  };
  $('#voiceTest').onclick = () => { player.stop(); getAudio('The LORD is my shepherd; I shall not want.').play(); };
}
async function downloadAll() {
  if (dlRunning) return;
  dlRunning = true;
  const btn = $('#dlAll'); if (btn) { btn.disabled = true; btn.textContent = '下載中… Saving'; }
  let done = 0, failed = 0;
  const upd = () => {
    const bar = $('#dlBar'); if (bar) bar.style.width = Math.round(done / 66 * 100) + '%';
    const m = $('#dlMsg'); if (m) m.textContent = `${done} / 66` + (failed ? `，失敗 failed ${failed}` : '');
    const nb = $('#nBk'); if (nb) nb.textContent = done;
  };
  for (let b = 0; b < 66; b++) {
    try { await getBook(b); if (b !== (currentView.b ?? -1)) bookMem.delete(b); done++; } catch (e) { failed++; }
    upd();
  }
  dlRunning = false;
  const b2 = $('#dlAll'); if (b2) { b2.disabled = false; b2.textContent = '下載全本 Save all'; }
  toast(failed ? `有 ${failed} 卷失敗，請再按一次。 ${failed} failed, tap again.` : '全本已存好，可離線閱讀。 Saved for offline use.', 5000);
}

/* ---------- 路由 ---------- */
function route() {
  clearSelection();
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/');
  try {
    if (p[0] === 'b' && BOOKS[+p[1]]) return renderBook(+p[1]);
    if (p[0] === 'c' && BOOKS[+p[1]]) {
      const b = +p[1], c = Math.min(Math.max(1, +p[2] || 1), BOOKS[b][2]);
      return renderChapter(b, c, p[3] ? +p[3] : null);
    }
    if (p[0] === 'search') return renderSearch(p[1] ? decodeURIComponent(p.slice(1).join('/')) : '');
    if (p[0] === 'bookmarks') return renderBookmarks();
    if (p[0] === 'settings') return renderSettings();
    return renderHome();
  } finally {
    updateHint();
    if (p[0] !== 'c' && !restoreScroll()) window.scrollTo(0, 0);
  }
}
// 「返回」：回到進入設定／搜尋／書籤之前的畫面，並捲回原來的位置
const scrollMem = {};
let lastMainHash = '#/', backPending = false;
const isAux = h => /^#\/(settings|search|bookmarks|check)/.test(h);
function restoreScroll() {
  if (!backPending) return false;
  backPending = false;
  const y = scrollMem[location.hash || '#/'];
  if (y == null) return false;
  requestAnimationFrame(() => window.scrollTo(0, y));
  return true;
}
document.addEventListener('click', e => {
  if (!e.target.closest('#backBtn')) return;
  backPending = true;
  location.hash = /^#\/check/.test(location.hash) ? '#/settings' : lastMainHash;
});
let curY = 0, curHash = location.hash || '#/', routing = false;
window.addEventListener('scroll', () => { if (!routing && (location.hash || '#/') === curHash) curY = window.scrollY; }, { passive: true });
window.addEventListener('hashchange', e => {
  const old = new URL(e.oldURL).hash || '#/';
  scrollMem[old] = curY;
  curHash = location.hash || '#/'; curY = 0;
  routing = true; setTimeout(() => { routing = false; curY = window.scrollY; }, 600);
  if (!isAux(old)) lastMainHash = old;
  route();
});
route();

/* ---------- 離線支援 ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { });
}
