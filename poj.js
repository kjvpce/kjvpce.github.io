// 白話字 (POJ) → 台羅 (Tâi-lô) 轉換，供台語語音合成使用
const TONE_MARKS = /[́̀̂̄̍̆̌]/;

function pojSylToTL(syl) {
  let s = syl.normalize('NFD');
  const m = s.match(TONE_MARKS);
  const tone = m ? m[0] : '';
  if (tone) s = s.replace(TONE_MARKS, '');
  s = s.replace(/o͘/g, 'oo').replace(/O͘/g, 'Oo').replace(/[̀͘-ͯ]/g, '');
  const cap = /^[A-Z]/.test(s);
  const allCap = s.length > 1 && s === s.toUpperCase() && /[A-Z]/.test(s);
  let t = s.toLowerCase();
  t = t.replace(/^chh/, 'tsh').replace(/^ch/, 'ts');
  t = t.replace(/oa/g, 'ua').replace(/oe/g, 'ue');
  t = t.replace(/ⁿ/g, 'nn');
  t = t.replace(/ek$/, 'ik').replace(/eng$/, 'ing').replace(/ekh$/, 'ikh');
  if (tone) {
    let idx = t.indexOf('a');
    if (idx < 0) idx = t.indexOf('oo');
    if (idx < 0) idx = t.indexOf('e');
    if (idx < 0) idx = t.indexOf('o');
    if (idx < 0) idx = Math.max(t.lastIndexOf('i'), t.lastIndexOf('u'));
    if (idx < 0) idx = t.indexOf('m');
    if (idx < 0) idx = t.indexOf('n');
    if (idx >= 0) t = t.slice(0, idx + 1) + tone + t.slice(idx + 1);
  }
  if (allCap) t = t.toUpperCase();
  else if (cap) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.normalize('NFC');
}

function pojToTL(text) {
  return text.normalize('NFD').replace(/[A-Za-z̀-ͯ͘ⁿ]+/g, w => pojSylToTL(w)).normalize('NFC');
}

// 搜尋用：去掉聲調、連字號、大小寫
function foldText(text) {
  return text.normalize('NFD')
    .replace(/[̀-ͯ͘]/g, '')
    .replace(/ⁿ/g, 'n')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

if (typeof module !== 'undefined') module.exports = { pojToTL, pojSylToTL, foldText };
