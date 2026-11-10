'use strict';
/* 全頁式「書卷 → 章 → 節」選擇器
   Picker.open(opts) 回傳 Promise：選好得到 {b, c, v}（v 可能是 null＝整章），取消得到 null
   opts.mode   'jump'（跳到經節）| 'start'（範圍起點）| 'end'（範圍迄點）
   opts.min    {b,c,v}：比它早的書卷／章／節變淡不能點（選迄點時用）
   opts.cur    {b,c,v}：目前位置，用灰底標示
   opts.startBook  直接從這一卷的「選章」開始（選迄點時用） */
const Picker = (() => {
  let el = null, st = null, resolveFn = null, closing = false, result = null, fallback = 0;
  const MODE = {
    jump: { book: '選取書卷 Book', chap: '選取章 Chapter', verse: '選取節 Verse' },
    start: { book: '起點 Start · Book', chap: '起點 Start · Chapter', verse: '起點 Start · Verse' },
    end: { book: '迄點 End · Book', chap: '迄點 End · Chapter', verse: '迄點 End · Verse' }
  };
  const e = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const lastChap = b => BOOKS[b][2];
  const vcount = (b, c) => BOOK_VC[b][c - 1];

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'picker'; el.className = 'picker'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="pk-bar">
        <button class="pk-icon pk-back" type="button" aria-label="返回上一層">←</button>
        <div class="pk-title"><span class="pk-t"></span><span class="pk-s"></span></div>
        <button class="pk-icon pk-close" type="button" aria-label="關閉">✕</button>
      </div><div class="pk-body"></div>`;
    document.body.appendChild(el);
    el.querySelector('.pk-back').onclick = back;
    el.querySelector('.pk-close').onclick = () => close(null);
    el.querySelector('.pk-body').onclick = onClick;
    window.addEventListener('popstate', onPop);
  }

  function open(opts) {
    ensure();
    if (resolveFn) finish(null);
    st = { mode: opts.mode || 'jump', min: opts.min || null, cur: opts.cur || null, step: 'book', b: null, c: null };
    if (opts.startBook != null) goBook(opts.startBook, true);
    el.hidden = false;
    document.body.classList.add('pk-open');
    try { history.pushState({ picker: 1 }, ''); } catch (err) { }
    render();
    return new Promise(r => { resolveFn = r; });
  }
  function goBook(b) {
    st.b = b;
    if (lastChap(b) === 1) { st.c = 1; st.step = 'verse'; } else { st.c = null; st.step = 'chap'; }
  }
  function back() {
    if (st.step === 'verse' && lastChap(st.b) > 1) { st.step = 'chap'; render(); return; }
    if (st.step === 'verse' || st.step === 'chap') { st.step = 'book'; render(); return; }
    close(null);
  }
  function close(res) {
    if (!resolveFn || closing) return;
    closing = true; result = res;
    clearTimeout(fallback);
    fallback = setTimeout(() => { if (closing) finish(result); }, 400);  // 萬一瀏覽器沒有回應「上一頁」
    try { history.back(); } catch (err) { finish(result); }
  }
  function finish(res) {
    closing = false; clearTimeout(fallback);
    if (el) el.hidden = true;
    document.body.classList.remove('pk-open');
    const r = resolveFn; resolveFn = null;
    if (r) r(res);
  }
  function onPop() {
    if (closing) { finish(result); return; }
    if (!resolveFn) return;
    // 手機的「返回」鍵：回上一層；已在第一層就直接關閉（這一筆瀏覽紀錄已被返回鍵用掉）
    if (st.step === 'book') { finish(null); return; }
    back();
    try { history.pushState({ picker: 1 }, ''); } catch (err) { }
  }

  // 比較：a 在 b 之前回傳負數
  const before = (b, c, v) => {
    const m = st.min; if (!m) return false;
    if (b !== m.b) return b < m.b;
    if (c == null) return false;
    if (c !== m.c) return c < m.c;
    if (v == null) return false;
    return v < m.v;
  };

  function render() {
    const { mode, step, b, c, min, cur } = st;
    const T = MODE[mode];
    const body = el.querySelector('.pk-body');
    let title = T.book, sub = '', html = '', quick = '';
    if (mode === 'end' && min) sub = `起點 from ${BOOK_EN[min.b]} ${min.c}:${min.v}`;
    if (step === 'book') {
      html = '<div class="pk-grid pk-books">' + BOOKS.map(([ab], i) => {
        const dis = before(i, null, null);
        const cls = ['pk-cell', 'cat-' + BOOK_CAT[i], dis ? 'dis' : '', min && i === min.b ? 'mark' : '', cur && i === cur.b ? 'cur' : ''].join(' ');
        return `<button type="button" class="${cls}" ${dis ? 'disabled' : `data-b="${i}"`} aria-label="${e(BOOKS[i][1])}">
          <span class="pk-en">${e(BOOK_EN[i])}</span><span class="pk-zh">${e(ab)}</span></button>`;
      }).join('') + '</div>';
    } else if (step === 'chap') {
      title = `${BOOKS[b][1]} ${BOOK_EN_NAME[b]}`;
      sub = T.chap + (sub ? '　' + sub : '');
      html = '<div class="pk-grid pk-chaps">' + Array.from({ length: lastChap(b) }, (_, i) => {
        const ch = i + 1, dis = before(b, ch, null);
        const isStart = min && b === min.b && ch === min.c;
        const cls = ['pk-cell', dis ? 'dis' : '', isStart ? 'mark' : '', cur && b === cur.b && ch === cur.c ? 'cur' : ''].join(' ');
        return `<button type="button" class="${cls}" ${dis ? 'disabled' : `data-c="${ch}"`} aria-label="第 ${ch} 章，${vcount(b, ch)} 節">
          ${isStart ? '<span class="pk-tag">起</span>' : ''}<span class="pk-num">${ch}</span><small>${vcount(b, ch)}</small></button>`;
      }).join('') + '</div>';
      if (mode === 'end') quick = `<button type="button" class="btn ghost" data-q="book">到本卷結束 End of book（${lastChap(b)}:${vcount(b, lastChap(b))}）</button>`;
    } else {
      title = `${BOOKS[b][1]} ${c}`;
      sub = T.verse + (sub ? '　' + sub : '');
      html = '<div class="pk-grid pk-verses">' + Array.from({ length: vcount(b, c) }, (_, i) => {
        const v = i + 1, dis = before(b, c, v);
        const isStart = min && b === min.b && c === min.c && v === min.v;
        const cls = ['pk-cell', dis ? 'dis' : '', isStart ? 'mark' : '', cur && b === cur.b && c === cur.c && v === cur.v ? 'cur' : ''].join(' ');
        return `<button type="button" class="${cls}" ${dis ? 'disabled' : `data-v="${v}"`} aria-label="第 ${v} 節">
          ${isStart ? '<span class="pk-tag">起</span>' : ''}<span class="pk-num">${v}</span></button>`;
      }).join('') + '</div>';
      if (mode === 'jump') quick = `<button type="button" class="btn ghost" data-q="chapter">讀整章 Whole chapter</button>`;
      if (mode === 'end') {
        quick = `<button type="button" class="btn ghost" data-q="chapter">到本章結束 End of chapter（${c}:${vcount(b, c)}）</button>`;
        if (c < lastChap(b)) quick += `<button type="button" class="btn ghost" data-q="book">到本卷結束 End of book（${lastChap(b)}:${vcount(b, lastChap(b))}）</button>`;
      }
    }
    el.querySelector('.pk-t').textContent = title;
    el.querySelector('.pk-s').textContent = sub;
    body.innerHTML = html + (quick ? `<div class="pk-quick">${quick}</div>` : '');
    body.scrollTop = 0;
    // 章、節很多時，把目前位置或起點捲進畫面
    const focus = body.querySelector('.cur') || body.querySelector('.mark');
    if (focus && step !== 'book') focus.scrollIntoView({ block: 'center' });
  }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.b != null) { goBook(+t.dataset.b); render(); return; }
    if (t.dataset.c != null) { st.c = +t.dataset.c; st.step = 'verse'; render(); return; }
    if (t.dataset.v != null) { close({ b: st.b, c: st.c, v: +t.dataset.v }); return; }
    if (t.dataset.q === 'chapter') {
      close(st.mode === 'jump' ? { b: st.b, c: st.c, v: null } : { b: st.b, c: st.c, v: vcount(st.b, st.c) });
      return;
    }
    if (t.dataset.q === 'book') { const lc = lastChap(st.b); close({ b: st.b, c: lc, v: vcount(st.b, lc) }); }
  }

  return { open, isOpen: () => !!resolveFn };
})();
