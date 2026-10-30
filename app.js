/* Pré-Caixa · assistente pré-caixa do mercado (PWA)
   Tudo fica no próprio celular (localStorage). Nenhum dado sai do aparelho, exceto:
   - o código de barras enviado ao catálogo aberto Open Food Facts, para achar o nome;
   - o que você mesmo ligar em Opções > Integrações. */
(function () {
  'use strict';
  var VERSION = '1.1.0';
  var $ = function (s) { return document.querySelector(s); };
  var reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- storage ---------------- */
  var KEY = 'precaixa:v1:';
  var storageOk = true;
  try { localStorage.setItem(KEY + 'probe', '1'); localStorage.removeItem(KEY + 'probe'); } catch (e) { storageOk = false; }
  function readStore(name, fallback) {
    try { var raw = localStorage.getItem(KEY + name); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function writeStore(name, value) {
    try { localStorage.setItem(KEY + name, JSON.stringify(value)); return true; }
    catch (e) { storageOk = false; renderStorageWarn(); return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  var DEFAULTS = { store: '', budget: null, beep: true, catalog: true, priceUrl: '', installDismissed: false, cameraId: '', zoom: 0 };
  function cleanSettings(s) {
    s = Object.assign({}, DEFAULTS, s && typeof s === 'object' ? s : {});
    if (typeof s.store !== 'string') s.store = '';
    if (!(num(s.budget, 0) > 0)) s.budget = null;
    if (typeof s.priceUrl !== 'string') s.priceUrl = '';
    delete s.visionUrl;
    s.beep = s.beep !== false; s.catalog = s.catalog !== false; s.installDismissed = !!s.installDismissed;
    if (typeof s.cameraId !== 'string') s.cameraId = '';
    s.zoom = num(s.zoom, 0); if (!(s.zoom >= 1 && s.zoom <= 3)) s.zoom = 0;
    return s;
  }
  function cleanTrip(t) {
    var base = { cart: [], startedAt: Date.now(), seq: 0 };
    if (!t || typeof t !== 'object' || !Array.isArray(t.cart)) return base;
    var cart = t.cart.filter(function (l) { return l && typeof l === 'object' && num(l.price, -1) >= 0; }).map(function (l) {
      return {
        id: String(l.id || uid()), seq: Math.max(0, Math.round(num(l.seq, 0))),
        code: typeof l.code === 'string' ? l.code : '', name: typeof l.name === 'string' ? l.name : '',
        unit: l.unit === 'kg' ? 'kg' : 'un', price: Math.round(l.price),
        qty: Math.max(1, Math.round(num(l.qty, 1))), grams: Math.max(1, Math.round(num(l.grams, 1000))),
        scale: !!l.scale, at: num(l.at, Date.now())
      };
    });
    var seq = Math.round(num(t.seq, 0));
    cart.forEach(function (l) { if (l.seq > seq) seq = l.seq; });
    return { cart: cart, startedAt: num(t.startedAt, Date.now()), seq: seq };
  }
  function cleanMemory(m) { return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
  function cleanHistory(h) {
    return Array.isArray(h) ? h.filter(function (x) { return x && num(x.total, -1) >= 0 && num(x.at, 0) > 0; }).slice(0, 60) : [];
  }

  var settings = cleanSettings(readStore('settings', {}));
  var trip = cleanTrip(readStore('trip', null));
  var memory = cleanMemory(readStore('memory', {}));
  var history = cleanHistory(readStore('history', []));

  function saveTrip() { writeStore('trip', trip); }
  function saveSettings() { writeStore('settings', settings); }
  function saveMemory() { writeStore('memory', memory); }
  function saveHistory() { writeStore('history', history); }

  var persisted = false;
  function checkPersist(ask) {
    try {
      if (!navigator.storage || !navigator.storage.persisted) return;
      navigator.storage.persisted().then(function (p) {
        if (p || !ask || !navigator.storage.persist) return p;
        return navigator.storage.persist();
      }).then(function (p) { persisted = !!p; renderDataInfo(); }, function () {});
    } catch (e) {}
  }

  /* ---------------- money, codes, dates ---------------- */
  var nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  function money(c) { return nf2.format((c || 0) / 100); }
  function brl(c) { return 'R$ ' + money(c); }
  function kg(g) { return nf3.format((g || 0) / 1000); }
  function lineTotal(l) { return l.unit === 'kg' ? Math.round(l.price * l.grams / 1000) : l.price * l.qty; }
  function cartTotal(cart) { var s = 0; for (var i = 0; i < cart.length; i++) s += lineTotal(cart[i]); return s; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function digitsToInt(str, max) {
    var s = String(str || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, max);
    return s ? parseInt(s, 10) : null;
  }
  function caretEnd(input) { try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) {} }
  function toCents(p) {
    if (typeof p === 'string') {
      var t = p.replace(/[^\d,.]/g, '');
      if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
      p = parseFloat(t);
    }
    return typeof p === 'number' && isFinite(p) && p > 0 && p < 100000 ? Math.round(p * 100) : null;
  }

  function gtinValid(c) {
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(c)) return false;
    var s = 0;
    for (var i = c.length - 2, w = 3; i >= 0; i--, w = 4 - w) s += (c.charCodeAt(i) - 48) * w;
    return (10 - s % 10) % 10 === c.charCodeAt(c.length - 1) - 48;
  }
  function normCode(raw) {
    var c = String(raw || '').trim().replace(/\s+/g, '');
    if (/^\d+$/.test(c)) {
      if (c.length === 12 && gtinValid(c)) c = '0' + c;
      else if (c.length === 14 && c.charAt(0) === '0' && gtinValid(c)) c = c.slice(1);
    }
    return c.slice(0, 48);
  }
  // Etiqueta de balança: EAN-13 que começa com 2 e traz o total nos 5 dígitos antes do verificador.
  function scaleOf(c) {
    if (!/^2\d{12}$/.test(c) || !gtinValid(c)) return null;
    return { key: 'balanca:' + c.slice(1, 7), cents: parseInt(c.slice(7, 12), 10) };
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dmy(ts) { var d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function hm(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function whenText(ts) {
    var now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= day0) return 'hoje às ' + hm(ts);
    if (ts >= day0 - 864e5) return 'ontem';
    var d = new Date(ts); return 'em ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  }
  function flat(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
  function sameStore(a, b) { return flat(a) === flat(b); }
  function displayName(l) { return l.name || (l.scale ? 'Item de balança' : l.code ? 'Produto ' + l.code : 'Item sem nome'); }
  function calcText(l) {
    if (l.unit === 'kg') return kg(l.grams) + ' kg x ' + money(l.price) + '/kg';
    return (l.scale ? 'balança · ' : '') + l.qty + ' un x ' + money(l.price);
  }
  function span(cls, text) { var s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }
  function setRich(node, before, strong) {
    node.textContent = before;
    if (strong) { var b = document.createElement('b'); b.textContent = strong; node.appendChild(b); }
  }
  function validUrl(u) { return /^https:\/\/\S+$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u); }

  /* ---------------- main screen ---------------- */
  var el = {
    top: $('#top'), tag: $('#tag'), tagCount: $('#tagCount'), tagInt: $('#tagInt'), tagDec: $('#tagDec'), tagSpoken: $('#tagSpoken'),
    budget: $('#budgetBtn'), meter: $('#meterFill'), budgetL: $('#budgetL'), budgetR: $('#budgetR'),
    lines: $('#lines'), cols: $('#rCols'), empty: $('#rEmpty'), foot: $('#rFoot'), footCount: $('#footCount'), footTotal: $('#footTotal'),
    rDate: $('#rDate'), rStore: $('#rStore'), storageWarn: $('#storageWarn'), scanTotal: $('#scanTotal'), tagLabel: $('#tagLabel')
  };

  // Faixas do orçamento: amarelo até 75%, laranja até 90%, vermelho até o limite, vermelho listrado depois.
  var LEVEL_RANK = { none: 0, ok: 0, near: 1, close: 2, over: 3 };
  var shownLevel = null;
  function budgetLevel(total, b) {
    if (!b) return 'none';
    var r = total / b;
    return r > 1 ? 'over' : r >= 0.9 ? 'close' : r >= 0.75 ? 'near' : 'ok';
  }
  function renderTotals(bump, alert) {
    var total = cartTotal(trip.cart), n = trip.cart.length, b = settings.budget;
    var s = money(total), i = s.lastIndexOf(',');
    el.tagInt.textContent = s.slice(0, i);
    el.tagDec.textContent = s.slice(i);
    el.tagCount.textContent = plural(n, 'item', 'itens');
    var lvl = budgetLevel(total, b), pct = b ? Math.floor(total / b * 100) : 0;
    el.tag.dataset.level = lvl; el.scanTotal.dataset.level = lvl; el.budget.dataset.state = lvl;
    el.tagLabel.textContent = lvl === 'near' ? 'Atenção · ' + pct + '% do orçamento'
      : lvl === 'close' ? (total === b ? 'No limite do orçamento' : 'Quase no limite · ' + pct + '%')
      : lvl === 'over' ? 'Passou do orçamento' : 'Total no carrinho';
    var spoken = 'Total no carrinho: ' + brl(total) + ', ' + plural(n, 'item', 'itens');
    if (!b) {
      el.meter.style.width = '0%';
      el.budgetL.textContent = 'Sem orçamento'; el.budgetR.textContent = 'Definir limite';
      el.scanTotal.textContent = brl(total) + ' · ' + plural(n, 'item', 'itens');
    } else {
      el.meter.style.width = Math.min(100, total / b * 100).toFixed(1) + '%';
      setRich(el.budgetL, 'Orçamento ', brl(b));
      if (total > b) {
        setRich(el.budgetR, 'Passou ', brl(total - b));
        el.scanTotal.textContent = brl(total) + ' · passou ' + brl(total - b);
        spoken += '. Passou do orçamento em ' + brl(total - b);
      } else {
        setRich(el.budgetR, 'Faltam ', brl(b - total));
        el.scanTotal.textContent = brl(total) + ' · faltam ' + brl(b - total);
        spoken += '. Faltam ' + brl(b - total) + ' para o orçamento';
      }
    }
    el.tagSpoken.textContent = spoken;
    el.footCount.textContent = String(n);
    el.footTotal.textContent = money(total);
    if (bump && !reduceMotion) { el.tag.classList.remove('bump'); void el.tag.offsetWidth; el.tag.classList.add('bump'); }
    if (alert && shownLevel !== null && LEVEL_RANK[lvl] > LEVEL_RANK[shownLevel]) budgetAlert(lvl, total, b);
    else if (shownLevel !== null && LEVEL_RANK[lvl] < LEVEL_RANK[shownLevel] && !ba.root.hidden) hideBudgetAlert();
    shownLevel = lvl;
  }

  var ba = { root: $('#budgetAlert'), text: $('#budgetAlertText') }, baTimer = 0;
  function budgetAlert(level, total, b) {
    ba.text.textContent = level === 'over' ? 'Passou do orçamento em ' + brl(total - b) + '.'
      : level === 'close' ? (total === b ? 'Você chegou ao limite do orçamento.' : 'Quase no limite: faltam só ' + brl(b - total) + '.')
      : 'Atenção: já foi ' + Math.floor(total / b * 100) + '% do orçamento. Faltam ' + brl(b - total) + '.';
    ba.root.dataset.level = level;
    // Na tela principal o aviso aparece logo abaixo do total; no leitor, abaixo da barra de cima.
    ba.root.style.top = scanner.open ? '' : Math.round(el.top.getBoundingClientRect().bottom + 6) + 'px';
    ba.root.hidden = false;
    requestAnimationFrame(function () { ba.root.classList.add('show'); });
    clearTimeout(baTimer); baTimer = setTimeout(hideBudgetAlert, 5000);
    alertTone(level);
    if (!reduceMotion) {
      [el.tag, el.scanTotal].forEach(function (n) { n.classList.remove('alarm'); void n.offsetWidth; n.classList.add('alarm'); });
    }
  }
  function hideBudgetAlert() {
    clearTimeout(baTimer);
    ba.root.classList.remove('show');
    setTimeout(function () { if (!ba.root.classList.contains('show')) ba.root.hidden = true; }, 220);
  }
  ba.root.addEventListener('click', hideBudgetAlert);
  [el.tag, el.scanTotal].forEach(function (n) {
    n.addEventListener('animationend', function (e) { if (e.animationName === 'bump' || e.animationName === 'alarm') n.classList.remove('bump', 'alarm'); });
  });

  function renderCart(flashId) {
    var ol = el.lines, has = trip.cart.length > 0;
    ol.textContent = '';
    el.empty.hidden = has; el.cols.hidden = !has; el.foot.hidden = !has;
    trip.cart.forEach(function (l) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'line'; b.dataset.id = l.id;
      var lt = lineTotal(l);
      b.append(span('seq', String(l.seq).padStart(3, '0')), span('desc', displayName(l)), span('calc', calcText(l)), span('sub', money(lt)));
      b.setAttribute('aria-label', displayName(l) + ', ' + (l.unit === 'kg' ? kg(l.grams) + ' quilo a ' + brl(l.price) + ' o quilo' : l.qty + ' a ' + brl(l.price)) + ', total ' + brl(lt) + '. Toque para editar.');
      if (l.id === flashId) b.classList.add('flash');
      li.appendChild(b); ol.appendChild(li);
    });
  }

  function renderHead() {
    var ts = trip.cart.length ? trip.startedAt : Date.now();
    el.rDate.textContent = dmy(ts) + ' ' + hm(ts);
    el.rStore.textContent = settings.store || 'Informar mercado';
  }

  function renderAll(flashId, bump, alert) {
    renderTotals(bump, alert); renderCart(flashId); renderHead();
    if (flashId && !scanner.open) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function renderStorageWarn() { el.storageWarn.hidden = storageOk; }

  el.lines.addEventListener('click', function (e) {
    var b = e.target.closest('button.line');
    if (b) openEdit(b.dataset.id);
  });
  window.addEventListener('scroll', function () { el.top.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });

  /* ---------------- panels ---------------- */
  var openPanelEl = null, returnFocus = null;
  function updateLock() {
    document.documentElement.classList.toggle('locked', !!(openPanelEl || scanner.open));
    document.documentElement.classList.toggle('panel-open', !!openPanelEl);
  }
  function openPanel(panel, focusEl) {
    if (openPanelEl && openPanelEl !== panel) closePanel(true);
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.hidden = false; openPanelEl = panel; updateLock();
    var body = panel.querySelector('.p-body'); if (body) body.scrollTop = 0;
    requestAnimationFrame(function () { panel.classList.add('open'); });
    if (focusEl) { try { focusEl.focus({ preventScroll: true }); } catch (e) {} }
  }
  function closePanel(instant) {
    var panel = openPanelEl; if (!panel) return;
    openPanelEl = null;
    panel.classList.remove('open');
    var hide = function () { if (openPanelEl !== panel) panel.hidden = true; };
    if (instant || reduceMotion) hide(); else setTimeout(hide, 180);
    var resume = null;
    if (panel === ip.root) { if (draft && draft.fromScanner) resume = draft.code || ''; discardDraft(); }
    updateLock();
    if (resume !== null && scanner.open) { resumeScanner(resume); returnFocus = null; return; }
    if (returnFocus && document.contains(returnFocus) && !returnFocus.closest('.panel')) { try { returnFocus.focus({ preventScroll: true }); } catch (e) {} }
    returnFocus = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (openPanelEl) { e.preventDefault(); closePanel(); }
    else if (scanner.open) { e.preventDefault(); closeScanner(); }
  });

  /* ---------------- toast ---------------- */
  var tt = { root: $('#toast'), msg: $('#toastMsg'), undo: $('#toastUndo') };
  var toastTimer = 0, toastUndo = null;
  function toast(msg, undo, label) {
    clearTimeout(toastTimer);
    tt.msg.textContent = msg; toastUndo = undo || null; tt.undo.hidden = !undo;
    tt.undo.textContent = label || 'Desfazer';
    tt.root.hidden = false;
    requestAnimationFrame(function () { tt.root.classList.add('show'); });
    toastTimer = setTimeout(hideToast, undo ? 6000 : 3200);
  }
  function hideToast() {
    clearTimeout(toastTimer); toastUndo = null;
    tt.root.classList.remove('show');
    setTimeout(function () { if (!tt.root.classList.contains('show')) tt.root.hidden = true; }, 220);
  }
  tt.undo.addEventListener('click', function () { var f = toastUndo; hideToast(); if (f) f(); });

  function snapshot() { return JSON.parse(JSON.stringify({ cart: trip.cart, seq: trip.seq, startedAt: trip.startedAt })); }
  function restore(s, msg) {
    trip.cart = s.cart; trip.seq = s.seq; trip.startedAt = s.startedAt;
    saveTrip(); renderAll(null, true); toast(msg || 'Desfeito.');
  }

  /* ---------------- sound + touch feedback ---------------- */
  var actx = null;
  function primeAudio() {
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function beep() {
    try { if (navigator.vibrate) navigator.vibrate(35); } catch (e) {}
    if (!settings.beep || !actx) return;
    try {
      if (actx.state === 'suspended') actx.resume();
      var t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 2700;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.13);
    } catch (e) {}
  }
  // Aviso do orçamento: vibra e toca notas descendo, mais longas quanto mais perto do limite.
  function alertTone(level) {
    var pattern = level === 'over' ? [180, 90, 180, 90, 260] : level === 'close' ? [120, 80, 120] : [90];
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
    if (!settings.beep || !actx) return;
    try {
      if (actx.state === 'suspended') actx.resume();
      var notes = level === 'over' ? [880, 660, 440] : level === 'close' ? [880, 660] : [740];
      notes.forEach(function (f, i) {
        var t = actx.currentTime + i * 0.17, o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.16);
      });
    } catch (e) {}
  }

  /* ---------------- barcode decoding ---------------- */
  // Motores: ZXing-C++ em WebAssembly (Android e iPhone) e, quando existe, o leitor nativo do Android.
  // O ZXing antigo em JavaScript só é carregado se o WebAssembly falhar.
  var FORMATS_WASM = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF14'];
  var FORMATS_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'];
  var dec = { wasm: null, wasmState: 'idle', wasmReady: null, native: null, js: null, jsState: 'idle' };

  (function initNative() {
    try {
      if (!('BarcodeDetector' in window)) return;
      window.BarcodeDetector.getSupportedFormats().then(function (sup) {
        var f = FORMATS_NATIVE.filter(function (x) { return sup.indexOf(x) >= 0; });
        if (f.indexOf('ean_13') >= 0) dec.native = new window.BarcodeDetector({ formats: f });
      }, function () {});
    } catch (e) {}
  })();

  function initWasm() {
    if (dec.wasmReady) return dec.wasmReady;
    var Z = window.ZXingWASM;
    if (!Z || !Z.prepareZXingModule || typeof WebAssembly !== 'object') {
      dec.wasmState = 'failed'; loadJsEngine();
      return (dec.wasmReady = Promise.resolve(false));
    }
    dec.wasmState = 'loading';
    var wasmUrl = new URL('vendor/zxing_reader-3.1.5.wasm', document.baseURI).href;
    dec.wasmReady = Promise.resolve().then(function () {
      return Z.prepareZXingModule({
        overrides: { locateFile: function (path, prefix) { return /\.wasm$/.test(path) ? wasmUrl : prefix + path; } },
        fireImmediately: true
      });
    }).then(function () { dec.wasm = Z; dec.wasmState = 'ready'; return true; },
      function () { dec.wasmState = 'failed'; loadJsEngine(); return false; });
    return dec.wasmReady;
  }
  function loadJsEngine() {
    if (dec.jsState !== 'idle') return;
    dec.jsState = 'loading';
    var s = document.createElement('script');
    s.src = 'vendor/zxing-library-0.21.3.min.js';
    s.onload = function () { dec.js = window.ZXing && window.ZXing.MultiFormatReader ? window.ZXing : null; dec.jsState = dec.js ? 'ready' : 'failed'; };
    s.onerror = function () { dec.jsState = 'failed'; };
    document.head.appendChild(s);
  }
  function anyEngine() { return !!(dec.wasm || dec.native || dec.js); }
  function engineName() {
    return [dec.native ? 'nativo' : '', dec.wasm ? 'zxing-cpp' : '', !dec.wasm && dec.js ? 'zxing-js' : ''].filter(Boolean).join(' + ') || 'carregando';
  }

  function fmtKey(f) { return String(f || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // UPC-E (8 dígitos) vira UPC-A (12), que é como o produto aparece nos catálogos.
  function upceToUpca(t) {
    if (!/^[01]\d{7}$/.test(t)) return t;
    var ns = t[0], d = t.slice(1, 7), ck = t[7], last = d[5], body;
    if (last <= '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4];
    else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4];
    else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4];
    else body = d.slice(0, 5) + '0000' + last;
    return ns + body + ck;
  }
  function acceptCode(text, fmt) {
    var t = String(text || '').trim(), f = fmtKey(fmt);
    if (f === 'upce') t = upceToUpca(t);
    if (!/^\d{8,14}$/.test(t)) return null;
    if (f === 'itf' || f === 'itf14') return t.length === 14 && gtinValid(t) ? t : null;
    if (f === 'ean13' || f === 'ean8' || f === 'upca' || f === 'upce') return gtinValid(t) ? t : null;
    return null;
  }
  function pickNative(list) {
    var order = ['ean_13', 'upc_a', 'ean_8', 'upc_e', 'itf'];
    list = (list || []).slice().sort(function (a, b) { return order.indexOf(a.format) - order.indexOf(b.format); });
    for (var i = 0; i < list.length; i++) { var ok = acceptCode(list[i].rawValue, list[i].format); if (ok) return { code: ok, strong: false, by: 'nativo' }; }
    return null;
  }

  function wasmRead(img, extra) {
    if (!dec.wasm) return Promise.resolve(null);
    var opts = { formats: FORMATS_WASM, maxNumberOfSymbols: 1, tryInvert: false, tryRotate: false, tryDownscale: true, tryHarder: false };
    for (var k in extra) opts[k] = extra[k];
    return dec.wasm.readBarcodes(img, opts).then(function (res) {
      for (var i = 0; i < (res || []).length; i++) {
        var r = res[i];
        if (r.isValid === false) continue;
        var ok = acceptCode(r.text, r.format);
        if (ok) return { code: ok, strong: (r.lineCount || 0) >= 5, by: 'zxing-cpp' };
      }
      return null;
    }, function () { return null; });
  }

  var jsReaders = {};
  function jsRead(img) {
    var Z = dec.js;
    if (!Z) return null;
    var reader = jsReaders.r;
    if (!reader) {
      var F = Z.BarcodeFormat, hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      reader = jsReaders.r = new Z.MultiFormatReader(); reader.setHints(hints);
    }
    var w = img.width, h = img.height, px = img.data, lum = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    var src = new Z.RGBLuminanceSource(lum, w, h), bins = [Z.HybridBinarizer, Z.GlobalHistogramBinarizer];
    for (var b = 0; b < bins.length; b++) {
      try {
        var r = reader.decodeWithState(new Z.BinaryBitmap(new bins[b](src)));
        var ok = acceptCode(r.getText(), Z.BarcodeFormat[r.getBarcodeFormat()]);
        if (ok) return { code: ok, strong: false, by: 'zxing-js' };
      } catch (e) { /* nada nesta tentativa */ }
      try { reader.reset(); } catch (e) {}
    }
    return null;
  }

  // Reforço para código desfocado ou pequeno: tons de cinza, média de 2 linhas (tira ruído sem
  // borrar as barras, que são verticais) e realce de contraste só na horizontal. up = 2 dobra a largura.
  function barsBoost(img, up, K, R) {
    var src = img.data, w = img.width, h = img.height, h2 = h >> 1, W = w * up;
    var out = new Uint8ClampedArray(W * h2 * 4), row = new Float32Array(w), acc = new Float64Array(w + 1), x, X;
    for (var y = 0; y < h2; y++) {
      var a = 2 * y * w * 4, b = a + w * 4;
      for (x = 0; x < w; x++) {
        var i = a + x * 4, j = b + x * 4;
        row[x] = (src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29 + src[j] * 77 + src[j + 1] * 150 + src[j + 2] * 29) / 512;
      }
      acc[0] = 0; for (x = 0; x < w; x++) acc[x + 1] = acc[x] + row[x];
      for (X = 0; X < W; X++) {
        var fx = up === 1 ? X : (X + 0.5) / up - 0.5, x0 = fx <= 0 ? 0 : Math.floor(fx), t = fx - x0;
        if (x0 >= w - 1) { x0 = w - 1; t = 0; }
        var v = t ? row[x0] * (1 - t) + row[x0 + 1] * t : row[x0];
        var c = Math.round(fx), lo = c - R < 0 ? 0 : c - R, hi = c + R + 1 > w ? w : c + R + 1;
        var g = v + K * (v - (acc[hi] - acc[lo]) / (hi - lo)), o = (y * W + X) * 4;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
      }
    }
    return new ImageData(out, W, h2);
  }
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        if (!img.naturalWidth) { URL.revokeObjectURL(url); reject(new Error('empty')); return; }
        resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    }).catch(function () {
      if (!window.createImageBitmap) throw new Error('no image');
      return createImageBitmap(file).then(function (b) {
        return { src: b, w: b.width, h: b.height, close: function () { try { b.close(); } catch (e) {} } };
      });
    });
  }
  function drawTo(img, opt) {
    var crop = opt.crop || 1, rot = opt.rot || 0;
    var cw = img.w * crop, ch = img.h * crop, cx = (img.w - cw) / 2, cy = (img.h - ch) / 2;
    var scale = Math.min(1, opt.max / Math.max(cw, ch));
    var sw = Math.max(1, Math.round(cw * scale)), sh = Math.max(1, Math.round(ch * scale));
    var rad = rot * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    var W = Math.round(sw * cos + sh * sin), H = Math.round(sw * sin + sh * cos);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.translate(W / 2, H / 2); g.rotate(rad);
    g.drawImage(img.src, cx, cy, cw, ch, -sw / 2, -sh / 2, sw, sh);
    return c;
  }
  function canvasData(c) { return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); }

  // Foto parada: várias tentativas, da mais barata para a mais cara.
  function findBarcode(img, isStale) {
    var tryNative = dec.native ? dec.native.detect(img.src).then(pickNative, function () { return null; }) : Promise.resolve(null);
    return Promise.all([tryNative, initWasm()]).then(function (r) {
      if (r[0]) return r[0].code;
      var plan = [
        { max: 1600, o: { tryHarder: true, tryRotate: true } },
        { max: 1600, boost: 'reforco' },
        { max: 1600, crop: 0.5, o: { tryHarder: true, tryRotate: true } },
        { max: 1600, boost: 'nitido' },
        { max: 1100, crop: 0.5, boost: 'ampliada' },
        { max: 1600, rot: 90, boost: 'reforco' },
        { max: 1600, boost: 'forte' },
        { max: 2400, o: { tryHarder: true, tryRotate: true } },
        { max: 1400, rot: 20 }, { max: 1400, rot: -20 }
      ];
      var i = 0;
      function step() {
        if (i >= plan.length || isStale()) return null;
        var p = plan[i++];
        return pause().then(function () {
          if (isStale()) return null;
          var data = canvasData(drawTo(img, p));
          if (!dec.wasm) { var h = jsRead(data); return h ? h.code : step(); }
          var bb = p.boost && BOOST[p.boost], input = bb ? barsBoost(data, bb[0], bb[1], bb[2]) : data;
          return wasmRead(input, p.o || { tryHarder: true }).then(function (h) { return h ? h.code : step(); });
        });
      }
      return step();
    });
  }


  /* ---------------- name and price lookups ---------------- */
  function fetchJson(url, opts, ms, outer) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms || 6000);
    var onOuter = function () { ctl.abort(); };
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter); }
    return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).finally(function () { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter); });
  }

  // Catálogos abertos (Open Food Facts e irmãos). Devolve o nome, '' se não achou, null se falhou a conexão.
  var CATALOGS = ['https://world.openfoodfacts.org', 'https://world.openbeautyfacts.org', 'https://world.openproductsfacts.org'];
  var catalogCache = {};
  function productName(p) {
    var name = String(p.product_name_pt || p.product_name || p.generic_name_pt || p.generic_name || '').replace(/\s+/g, ' ').trim();
    var brand = String(p.brands || '').split(',')[0].trim();
    var qty = String(p.quantity || '').replace(/\s+/g, ' ').trim();
    if (brand && flat(name).indexOf(flat(brand)) < 0) name = name ? name + ' ' + brand : brand;
    if (qty && name && qty.length <= 16 && flat(name).indexOf(flat(qty)) < 0) name += ' ' + qty;
    return name.slice(0, 80);
  }
  function catalogName(code) {
    if (!/^\d{8,14}$/.test(code) || /^2\d{12}$/.test(code)) return Promise.resolve('');
    if (catalogCache[code]) return Promise.resolve(catalogCache[code]);
    var fields = 'product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity';
    function one(base) {
      return fetchJson(base + '/api/v2/product/' + code + '.json?fields=' + fields, { credentials: 'omit', mode: 'cors' }, 6500)
        .then(function (j) { return j && j.status === 1 && j.product ? productName(j.product) : ''; }, function () { return null; });
    }
    return one(CATALOGS[0]).then(function (n) {
      if (n) return n;
      return Promise.all([one(CATALOGS[1]), one(CATALOGS[2])]).then(function (r) {
        if (r[0] || r[1]) return r[0] || r[1];
        return n === null && r[0] === null && r[1] === null ? null : '';
      });
    }).then(function (n) { if (n) catalogCache[code] = n; return n; });
  }

  function normalizeRemote(o) {
    if (Array.isArray(o)) o = o[0];
    var r = { name: '', cents: null, perKg: false, code: '', obs: '' };
    if (!o || typeof o !== 'object') return r;
    var name = o.nome != null ? o.nome : o.name != null ? o.name : o.descricao != null ? o.descricao : o.description;
    if (typeof name === 'string') r.name = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    r.cents = toCents(o.preco != null ? o.preco : o.price != null ? o.price : o.valor);
    r.perKg = o.preco_por_kg === true || o.por_kg === true || o.perKg === true;
    var c = String(o.codigo != null ? o.codigo : o.ean != null ? o.ean : '').replace(/\D/g, '');
    if (gtinValid(c)) r.code = normCode(c);
    var obs = o.observacao != null ? o.observacao : o.obs;
    if (typeof obs === 'string') r.obs = obs.replace(/\s+/g, ' ').trim().slice(0, 80);
    return r;
  }
  function priceUrlFor(code) {
    var base = (settings.priceUrl || '').trim();
    if (!base || !validUrl(base)) return '';
    try {
      if (base.indexOf('{ean}') >= 0) return base.split('{ean}').join(encodeURIComponent(code)).split('{mercado}').join(encodeURIComponent(settings.store || ''));
      var u = new URL(base);
      u.searchParams.set('ean', code);
      if (settings.store) u.searchParams.set('mercado', settings.store);
      return u.toString();
    } catch (e) { return ''; }
  }
  function priceApi(code) {
    var url = priceUrlFor(code);
    if (!url) return Promise.resolve(null);
    return fetchJson(url, { credentials: 'omit', mode: 'cors' }, 7000).then(normalizeRemote, function () { return null; });
  }

  /* ---------------- item panel ---------------- */
  var ip = {
    root: $('#itemPanel'), title: $('#itemTitle'), close: $('#itemClose'), save: $('#itemSave'),
    thumbImg: $('#thumbImg'), thumbIcon: $('#thumbIcon'), status: $('#scanStatus'), statusText: $('#scanStatusText'), note: $('#scanNote'),
    busyBar: $('#busyBar'), retake: $('#retake'),
    priceLabel: $('#priceLabel'), unitSeg: $('#unitSeg'), unitUn: $('#unitUn'), unitKg: $('#unitKg'),
    price: $('#priceInput'), perKg: $('#perKg'), hint: $('#priceHint'), hintText: $('#priceHintText'), hintUse: $('#priceHintUse'), obs: $('#obs'),
    qtyField: $('#qtyField'), qty: $('#qtyInput'), minus: $('#qtyMinus'), plus: $('#qtyPlus'),
    kgField: $('#kgField'), grams: $('#gramsInput'), chips: $('#kgChips'),
    name: $('#nameInput'), code: $('#codeInput'), lineCalc: $('#lineCalc'), after: $('#afterCalc'),
    submit: $('#itemSubmit'), remove: $('#itemRemove')
  };
  var cam = $('#cam');
  var draft = null;
  // quem manda no preço quando duas fontes respondem
  var RANK = { digitado: 6, balanca: 5, api: 4, carrinho: 2, memoria: 1 };

  function makeDraft(mode) {
    return {
      mode: mode, lineId: null, existingId: null, fromScanner: false,
      code: '', codeFrom: '', scale: null, lastTyped: '',
      name: '', nameFrom: '', nameTouched: false,
      price: null, priceFrom: '', priceTouched: false, altPrice: null,
      unit: 'un', unitUser: false, qty: 1, grams: 1000,
      kind: 'idle', status: '', note: '', memNote: '', obs: '',
      url: '', token: 0, priceFocused: false,
      lookingCatalog: false, lookingApi: false, catalogResult: ''
    };
  }
  function setStatus(d, kind, status, note) { d.kind = kind; d.status = status; d.note = note || ''; }
  function setPrice(c, from) { draft.price = c; draft.priceFrom = from; ip.price.value = c == null ? '' : money(c); }
  function setName(n, from) { draft.name = n || ''; draft.nameFrom = from; ip.name.value = draft.name; }

  function fillInputs() {
    var d = draft;
    ip.price.value = d.price == null ? '' : money(d.price);
    ip.qty.value = String(d.qty || 1);
    ip.grams.value = d.grams ? kg(d.grams) : '';
    ip.name.value = d.name;
    ip.code.value = d.code;
  }

  function draftLineTotal(d) {
    if (d.price == null) return null;
    if (d.unit === 'kg') return d.grams > 0 ? Math.round(d.price * d.grams / 1000) : null;
    return d.qty >= 1 ? d.price * d.qty : null;
  }
  function mergedLine(l, d) {
    var m = Object.assign({}, l, { price: d.price });
    if (l.unit === 'kg') m.grams = l.grams + d.grams; else m.qty = Math.min(999, l.qty + d.qty);
    return m;
  }
  function projectedTotal(d, lt) {
    var base = cartTotal(trip.cart);
    if (d.mode === 'new') return base + lt;
    var id = d.mode === 'more' ? d.existingId : d.lineId;
    var l = trip.cart.find(function (x) { return x.id === id; });
    if (!l) return base + lt;
    if (d.mode === 'edit') return base - lineTotal(l) + lt;
    return base - lineTotal(l) + lineTotal(mergedLine(l, d));
  }

  function renderDraft() {
    var d = draft; if (!d) return;
    ip.title.textContent = d.mode === 'edit' ? 'Editar item' : d.mode === 'more' ? 'Mais deste item' : 'Novo item';
    if (d.url) { if (ip.thumbImg.getAttribute('src') !== d.url) ip.thumbImg.src = d.url; ip.thumbImg.hidden = false; ip.thumbIcon.hidden = true; }
    else { ip.thumbImg.hidden = true; ip.thumbImg.removeAttribute('src'); ip.thumbIcon.hidden = false; }
    ip.status.dataset.kind = d.kind;
    ip.statusText.textContent = d.status;
    ip.note.textContent = d.note; ip.note.hidden = !d.note;
    ip.busyBar.hidden = !(d.lookingCatalog || d.lookingApi);
    ip.retake.hidden = d.mode === 'edit' || !!d.code;
    var isKg = d.unit === 'kg';
    ip.unitSeg.hidden = !!d.scale || d.mode === 'more';
    ip.unitUn.setAttribute('aria-pressed', String(!isKg));
    ip.unitKg.setAttribute('aria-pressed', String(isKg));
    ip.perKg.hidden = !isKg;
    ip.priceLabel.textContent = d.scale ? 'Valor da etiqueta' : isKg ? 'Preço por kg' : 'Preço';
    ip.qtyField.hidden = isKg; ip.kgField.hidden = !isKg;
    var alt = d.altPrice && d.altPrice.cents !== d.price ? d.altPrice : null;
    ip.hint.hidden = !alt;
    if (alt) ip.hintText.textContent = 'Sistema do mercado: ' + brl(alt.cents) + (isKg ? '/kg' : '');
    ip.obs.hidden = !d.obs; ip.obs.textContent = d.obs || '';
    ip.remove.hidden = d.mode !== 'edit';
    renderCalc();
  }

  function renderCalc() {
    var d = draft; if (!d) return;
    var lt = draftLineTotal(d), valid = lt != null && d.price > 0;
    var verb = d.mode === 'edit' ? 'Salvar' : d.mode === 'more' ? 'Somar' : 'Adicionar';
    ip.after.textContent = '';
    if (!valid) {
      ip.lineCalc.textContent = !(d.price > 0) ? 'Digite o preço para ver quanto fica.' : d.unit === 'kg' ? 'Informe o peso.' : 'Informe a quantidade.';
    } else {
      ip.lineCalc.textContent = (d.unit === 'kg' ? kg(d.grams) + ' kg × ' + brl(d.price) + '/kg' : d.qty + ' × ' + brl(d.price)) + ' = ' + brl(lt);
      var pt = projectedTotal(d, lt), b = settings.budget;
      ip.after.append('Carrinho fica ' + brl(pt));
      if (b) {
        var s = document.createElement('span');
        if (pt > b) { s.className = 'over'; s.textContent = ' · passa ' + brl(pt - b) + ' do orçamento'; }
        else { var lv = budgetLevel(pt, b); s.className = lv === 'close' ? 'over' : lv === 'near' ? 'warn' : 'ok'; s.textContent = ' · faltam ' + brl(b - pt); }
        ip.after.appendChild(s);
      }
    }
    ip.submit.disabled = !valid; ip.save.disabled = !valid;
    ip.submit.textContent = valid ? verb + ' · ' + brl(lt) : verb;
    ip.save.textContent = verb;
  }

  function discardDraft() {
    var d = draft; if (!d) return;
    d.token++;
    if (d.url) { var u = d.url; setTimeout(function () { URL.revokeObjectURL(u); }, 400); }
    draft = null;
  }

  function openNew() { draft = makeDraft('new'); fillInputs(); renderDraft(); }
  function openManual(fromScanner, focusEl) {
    openNew();
    draft.fromScanner = !!fromScanner;
    setStatus(draft, 'idle', fromScanner ? 'Digite o código ou o preço' : 'Sem código lido', 'Digite o preço que está na etiqueta.');
    renderDraft();
    openPanel(ip.root, focusEl || ip.price);
  }
  function openEdit(id) {
    var l = trip.cart.find(function (x) { return x.id === id; }); if (!l) return;
    draft = makeDraft('edit');
    Object.assign(draft, {
      lineId: id, code: l.code, scale: l.scale ? (scaleOf(l.code) || { key: '', cents: l.price }) : null,
      name: l.name, nameTouched: true, price: l.price, priceTouched: true, priceFrom: 'digitado', unit: l.unit, unitUser: true,
      qty: l.qty, grams: l.grams
    });
    setStatus(draft, 'idle', 'Item ' + String(l.seq).padStart(3, '0'), 'Adicionado ' + whenText(l.at) + '.');
    fillInputs(); renderDraft();
    openPanel(ip.root, ip.title);
  }

  function finishNote(d) {
    if (d.lookingCatalog || d.lookingApi) { d.note = 'Buscando o nome do produto…'; return; }
    var alt = d.altPrice && d.altPrice.cents !== d.price ? d.altPrice : null, pf = d.priceFrom;
    if (alt) d.note = 'O sistema do mercado mostra outro valor. Veja qual vale.';
    else if (pf === 'api') d.note = 'Preço do sistema do mercado.';
    else if (pf === 'balanca') d.note = 'Valor tirado do código da balança. Confira com o impresso.';
    else if (pf === 'memoria') d.note = d.memNote || 'Preço salvo antes. Confira na etiqueta.';
    else if (pf === 'carrinho' || pf === 'digitado') { /* mantém */ }
    else if (d.name && d.nameFrom !== 'digitado') d.note = 'Nome encontrado. Digite o preço da etiqueta.';
    else if (d.code && d.catalogResult === 'missing') d.note = 'Este código não está no catálogo. Digite nome e preço.';
    else if (d.code && d.catalogResult === 'error') d.note = 'Sem internet para buscar o nome. Digite o preço da etiqueta.';
    else d.note = 'Digite o preço da etiqueta.';
  }

  function applyRemote(d, r, src) {
    if (!r) return;
    if (!d.code && r.code) {
      var res = applyCode(r.code, src);
      if (res === 'cart' || res === 'known') return;
    }
    if (r.name && !d.nameTouched && (!d.name || d.nameFrom === 'catalogo')) setName(r.name, src);
    if (r.perKg && !d.unitUser && !d.scale && d.mode === 'new') { d.unit = 'kg'; if (!d.grams) d.grams = 1000; ip.grams.value = kg(d.grams); }
    if (r.cents) {
      var cur = d.priceTouched ? RANK.digitado : (RANK[d.priceFrom] || 0);
      if (d.price == null || RANK[src] >= cur) { setPrice(r.cents, src); if (d.altPrice && d.altPrice.cents === r.cents) d.altPrice = null; }
      else if (r.cents !== d.price) d.altPrice = { cents: r.cents, src: src };
    }
    if (r.obs) d.obs = r.obs;
  }

  function startLookups(d, code, wantName, wantPrice) {
    var stale = function () { return draft !== d || d.code !== code; };
    var doName = wantName && settings.catalog && !scaleOf(code);
    var doApi = wantPrice && !!priceUrlFor(code);
    if (doName) {
      d.lookingCatalog = true;
      catalogName(code).then(function (n) {
        if (stale()) return;
        d.lookingCatalog = false;
        d.catalogResult = n === null ? 'error' : n ? 'found' : 'missing';
        if (n && !d.nameTouched && !d.name) setName(n, 'catalogo');
        afterLookup(d);
      });
    }
    if (doApi) {
      d.lookingApi = true;
      priceApi(code).then(function (r) {
        if (stale()) return;
        d.lookingApi = false;
        applyRemote(d, r, 'api');
        afterLookup(d);
      });
    }
    afterLookup(d);
  }
  function afterLookup(d) {
    if (draft !== d) return;
    finishNote(d); renderDraft();
  }
  // Produto sem preço conhecido: o campo de preço já fica pronto para digitar.
  function focusPriceIfMissing(d) {
    if (draft !== d || d.priceFocused || d.price > 0 || d.mode === 'edit') return;
    d.priceFocused = true;
    try { ip.price.focus({ preventScroll: true }); } catch (e) {}
  }

  function applyCode(raw, from) {
    var d = draft, code = normCode(raw);
    d.code = code; d.codeFrom = from; d.altPrice = null; d.catalogResult = '';
    if (from !== 'digitado') ip.code.value = code;
    var existing = d.mode === 'new' ? trip.cart.find(function (l) { return l.code && l.code === code; }) : null;
    if (existing) {
      d.mode = 'more'; d.existingId = existing.id; d.unit = existing.unit;
      d.scale = existing.scale ? scaleOf(code) : null;
      if (!d.priceTouched) setPrice(existing.price, 'carrinho');
      if (!d.nameTouched) setName(existing.name, 'carrinho');
      d.qty = 1; ip.qty.value = '1';
      if (existing.unit === 'kg') { d.grams = 1000; ip.grams.value = kg(1000); }
      setStatus(d, 'ok', 'Já está no carrinho', 'Tem ' + (existing.unit === 'kg' ? kg(existing.grams) + ' kg' : plural(existing.qty, 'unidade', 'unidades')) + '. Escolha quantas somar.');
      if (!existing.scale && priceUrlFor(code)) startLookups(d, code, false, true); else renderDraft();
      return 'cart';
    }
    var sc = scaleOf(code);
    if (sc) {
      d.scale = sc; d.unit = 'un'; d.qty = 1; ip.qty.value = '1';
      if (!d.priceTouched && sc.cents > 0) setPrice(sc.cents, 'balanca');
      var sm = memory[sc.key];
      if (sm && sm.n && !d.nameTouched) setName(sm.n, 'memoria');
      setStatus(d, 'ok', 'Etiqueta de balança', '');
      afterLookup(d);
      return sm && sm.n ? 'known' : 'scale';
    }
    var m = memory[code];
    if (m && m.p > 0) {
      if (!d.nameTouched && m.n) setName(m.n, 'memoria');
      if (!d.priceTouched) setPrice(m.p, 'memoria');
      if (!d.unitUser) d.unit = m.u === 'kg' ? 'kg' : 'un';
      var other = m.s && settings.store && !sameStore(m.s, settings.store);
      d.memNote = 'Preço salvo ' + whenText(m.t) + (m.s ? ' (' + m.s + ')' : '') + '. ' + (other ? 'Aqui pode ser outro valor: confira na etiqueta.' : 'Confira na etiqueta.');
      setStatus(d, 'ok', 'Código ' + code, '');
      startLookups(d, code, !m.n, true);
      return 'known';
    }
    setStatus(d, 'ok', 'Código ' + code, '');
    startLookups(d, code, !(d.nameTouched && d.name), true);
    return 'new';
  }

  function handlePhoto(d, file) {
    var token = ++d.token;
    var stale = function () { return draft !== d || d.token !== token; };
    if (d.url) URL.revokeObjectURL(d.url);
    d.url = URL.createObjectURL(file);
    setStatus(d, 'busy', 'Procurando o código…', '');
    renderDraft();
    var img = null;
    loadImage(file).then(function (im) {
      img = im;
      return stale() ? null : findBarcode(img, stale);
    }, function () { return null; }).then(function (hit) {
      if (img) { img.close(); img = null; }
      if (stale()) return;
      if (hit) { beep(); applyCode(hit, 'foto'); focusPriceIfMissing(d); return; }
      setStatus(d, 'warn', anyEngine() ? 'Não achei o código de barras' : 'Leitor de código indisponível',
        'Tente mais perto, sem reflexo, ou digite o código.');
      renderDraft();
    }).catch(function () {
      if (img) { img.close(); img = null; }
      if (stale()) return;
      setStatus(d, 'warn', 'Não consegui ler a foto', 'Tente outra foto ou digite o código.');
      renderDraft();
    });
  }

  function learn(d, name) {
    if (!d.code) return;
    var now = Date.now();
    if (d.scale) {
      if (name && d.scale.key) { memory[d.scale.key] = { n: name, t: now, s: settings.store || '' }; saveMemory(); }
      return;
    }
    var prev = memory[d.code];
    memory[d.code] = { n: name || (prev && prev.n) || '', p: d.price, u: d.unit, t: now, s: settings.store || '' };
    var keys = Object.keys(memory);
    if (keys.length > 4000) {
      keys.sort(function (a, b) { return (memory[a].t || 0) - (memory[b].t || 0); });
      keys.slice(0, keys.length - 4000).forEach(function (k) { delete memory[k]; });
    }
    saveMemory();
  }

  var askedPersist = false;
  function commitDraft() {
    var d = draft; if (!d) return;
    var lt = draftLineTotal(d);
    if (lt == null || !(d.price > 0)) return;
    var before = snapshot(), name = (d.name || '').trim(), flashId = null, msg = '', i = -1, l;
    if (d.mode === 'more') {
      i = trip.cart.findIndex(function (x) { return x.id === d.existingId; });
      if (i < 0) d.mode = 'new';
    }
    if (d.mode === 'new') {
      if (!trip.cart.length) trip.startedAt = Date.now();
      trip.seq += 1;
      l = { id: uid(), seq: trip.seq, code: d.code, name: name, unit: d.unit, price: d.price,
        qty: d.unit === 'un' ? d.qty : 1, grams: d.unit === 'kg' ? d.grams : 1000, scale: !!d.scale, at: Date.now() };
      trip.cart.unshift(l); flashId = l.id;
      msg = displayName(l) + ' · ' + brl(lineTotal(l));
    } else if (d.mode === 'more') {
      var m = mergedLine(trip.cart[i], d);
      if (name) m.name = name;
      m.at = Date.now();
      trip.cart.splice(i, 1); trip.cart.unshift(m); flashId = m.id;
      msg = displayName(m) + ': agora ' + (m.unit === 'kg' ? kg(m.grams) + ' kg' : m.qty + ' un.');
    } else {
      i = trip.cart.findIndex(function (x) { return x.id === d.lineId; });
      if (i < 0) { closePanel(); return; }
      l = trip.cart[i];
      l.name = name; l.price = d.price; l.unit = d.unit; l.code = d.code;
      if (d.unit === 'kg') l.grams = d.grams; else l.qty = d.qty;
      flashId = l.id; msg = 'Item atualizado: ' + brl(lineTotal(l));
    }
    learn(d, name);
    saveTrip();
    if (!askedPersist) { askedPersist = true; checkPersist(true); }
    closePanel();
    renderAll(flashId, true, true);
    toast(msg, function () { restore(before); });
  }

  /* inputs */
  ip.price.addEventListener('input', function () {
    if (!draft) return;
    var c = digitsToInt(ip.price.value, 7);
    draft.price = c; draft.priceTouched = true; draft.priceFrom = 'digitado';
    if (draft.note && !draft.lookingApi && draft.mode !== 'more') draft.note = '';
    ip.price.value = c == null ? '' : money(c); caretEnd(ip.price);
    renderDraft();
  });
  ip.price.addEventListener('focus', function () { setTimeout(function () { caretEnd(ip.price); }, 0); });
  ip.qty.addEventListener('input', function () {
    if (!draft) return;
    var n = digitsToInt(ip.qty.value, 3);
    draft.qty = n || 0; ip.qty.value = n ? String(n) : '';
    renderCalc();
  });
  ip.qty.addEventListener('blur', function () { if (draft && !draft.qty) { draft.qty = 1; ip.qty.value = '1'; renderCalc(); } });
  ip.minus.addEventListener('click', function () { if (!draft) return; draft.qty = Math.max(1, (draft.qty || 1) - 1); ip.qty.value = String(draft.qty); renderCalc(); });
  ip.plus.addEventListener('click', function () { if (!draft) return; draft.qty = Math.min(999, (draft.qty || 0) + 1); ip.qty.value = String(draft.qty); renderCalc(); });
  ip.grams.addEventListener('input', function () {
    if (!draft) return;
    var g = digitsToInt(ip.grams.value, 5);
    draft.grams = g || 0; ip.grams.value = g ? kg(g) : ''; caretEnd(ip.grams);
    renderCalc();
  });
  ip.chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-g]'); if (!b || !draft) return;
    draft.grams = parseInt(b.dataset.g, 10); ip.grams.value = kg(draft.grams); renderCalc();
  });
  function setUnit(u) {
    if (!draft) return;
    draft.unit = u; draft.unitUser = true;
    if (u === 'kg' && !draft.grams) { draft.grams = 1000; ip.grams.value = kg(1000); }
    if (u === 'un' && !draft.qty) { draft.qty = 1; ip.qty.value = '1'; }
    renderDraft();
  }
  ip.unitUn.addEventListener('click', function () { setUnit('un'); });
  ip.unitKg.addEventListener('click', function () { setUnit('kg'); });
  ip.name.addEventListener('input', function () { if (!draft) return; draft.name = ip.name.value.slice(0, 80); draft.nameTouched = true; draft.nameFrom = 'digitado'; });
  ip.name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ip.name.blur(); } });
  function typedCode(finished) {
    if (!draft) return;
    var v = ip.code.value.replace(/\D/g, '').slice(0, 32);
    if (v !== ip.code.value) ip.code.value = v;
    draft.code = v; draft.codeFrom = 'digitado';
    var n = normCode(v);
    // 13 e 14 dígitos já são o código inteiro; 8 e 12 só valem quando a pessoa sai do campo.
    var complete = v.length === 13 || v.length === 14 || (finished && (v.length === 8 || v.length === 12));
    if (!complete || !gtinValid(n) || draft.lastTyped === n) return;
    draft.lastTyped = n;
    if (draft.mode === 'edit') { draft.code = n; return; }
    applyCode(n, 'digitado');
    if (draft.price > 0) { try { ip.save.focus({ preventScroll: true }); } catch (e) {} }
    else { draft.priceFocused = false; focusPriceIfMissing(draft); }
  }
  ip.code.addEventListener('input', function () { typedCode(false); });
  ip.code.addEventListener('change', function () { typedCode(true); });
  ip.hintUse.addEventListener('click', function () {
    if (!draft || !draft.altPrice) return;
    setPrice(draft.altPrice.cents, draft.altPrice.src); draft.priceTouched = true; draft.altPrice = null;
    draft.note = 'Valor trocado. Confira com a etiqueta.';
    renderDraft();
  });
  ip.submit.addEventListener('click', commitDraft);
  ip.save.addEventListener('click', commitDraft);
  ip.close.addEventListener('click', function () { closePanel(); });
  ip.remove.addEventListener('click', function () {
    var d = draft; if (!d) return;
    var i = trip.cart.findIndex(function (x) { return x.id === d.lineId; }); if (i < 0) return;
    var before = snapshot(), l = trip.cart.splice(i, 1)[0];
    saveTrip(); closePanel(); renderAll(null, true);
    toast('Removido: ' + displayName(l), function () { restore(before); });
  });

  /* photos (fallback do leitor e foto da etiqueta) */
  function keyOpensCamera(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primeAudio(); cam.click(); }
  }
  [ip.retake, $('#scanPhoto')].forEach(function (lbl) {
    lbl.addEventListener('click', primeAudio);
    lbl.addEventListener('keydown', keyOpensCamera);
  });
  cam.addEventListener('change', function () {
    var file = cam.files && cam.files[0];
    cam.value = '';
    if (!file) return;
    var inPanel = draft && openPanelEl === ip.root && draft.mode !== 'edit';
    if (!inPanel) {
      if (scanner.open) pauseScanner();
      openNew(); draft.fromScanner = scanner.open;
      openPanel(ip.root, ip.title);
    }
    handlePhoto(draft, file);
  });

  /* ---------------- live scanner ---------------- */
  var sc = {
    root: $('#scanner'), video: $('#scanVideo'), frame: $('#scanFrame'), msg: $('#scanMsg'), mid: $('#scanMid'), ring: $('#focusRing'),
    close: $('#scanClose'), torch: $('#scanTorch'), zoom: $('#scanZoom'), cam: $('#scanCam'), camText: $('#scanCamText'), type: $('#scanType')
  };
  var scanner = {
    open: false, paused: false, stream: null, track: null, caps: {}, timer: 0, session: 0, frame: 0, busy: false, busySince: 0, gap: 30,
    votes: {}, votesAt: 0, cooldown: { code: '', until: 0 }, since: 0, seenAt: 0, hint: 0, seenT: 0,
    torchOn: false, zooms: [], zoom: 1, cams: [], camId: '', switched: false, diag: '',
    canvas: document.createElement('canvas'), ctx: null
  };
  var MSG_AIM = 'Aponte para o código de barras';
  function setScanMsg(text, isErr) { sc.msg.textContent = text; sc.msg.classList.toggle('err', !!isErr); }

  function canLive() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function openScanner() {
    primeAudio();
    initWasm();
    if (!canLive()) { cam.click(); return; }
    scanner.open = true; scanner.paused = false;
    sc.root.hidden = false;
    document.documentElement.classList.add('scanning'); updateLock();
    renderTotals();
    keepAwake(true);
    try { sc.close.focus({ preventScroll: true }); } catch (e) {}
    startCamera();
  }
  function closeScanner() {
    scanner.open = false; scanner.paused = false;
    stopCamera();
    keepAwake(false);
    sc.root.hidden = true;
    document.documentElement.classList.remove('scanning'); updateLock();
    renderAll();
    try { $('#scanBtn').focus({ preventScroll: true }); } catch (e) {}
  }
  function running() { return scanner.open && !scanner.paused && !!scanner.stream; }
  function pauseScanner() { scanner.paused = true; clearTimeout(scanner.timer); }
  function resumeScanner(code) {
    scanner.cooldown = { code: code || '', until: Date.now() + 3000 };
    scanner.votes = {}; scanner.paused = false;
    scanner.since = Date.now(); scanner.hint = 0;
    sc.frame.classList.remove('hit', 'seen');
    if (!scanner.stream) startCamera();
    else { setScanMsg('Aponte para o próximo código'); loop(); }
  }
  function stopCamera() {
    scanner.session++;
    clearTimeout(scanner.timer);
    scanner.busy = false;
    if (scanner.stream) scanner.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    scanner.stream = null; scanner.track = null; scanner.torchOn = false;
    sc.torch.setAttribute('aria-pressed', 'false');
    try { sc.video.srcObject = null; } catch (e) {}
  }

  // Abre a câmera: a escolhida antes pela pessoa, senão a traseira padrão; no Android troca para a
  // principal ("camera2 0", a que tem flash) se o navegador abriu outra lente.
  function startCamera(forceId) {
    stopCamera();
    var mine = scanner.session, wantId = forceId || settings.cameraId || '';
    setScanMsg('Abrindo a câmera…');
    var size = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    var tries = [];
    if (wantId) tries.push(Object.assign({ deviceId: { exact: wantId } }, size));
    tries.push(Object.assign({ facingMode: { ideal: 'environment' } }, size));
    tries.push({ facingMode: { ideal: 'environment' } });
    (function attempt(i) {
      navigator.mediaDevices.getUserMedia({ audio: false, video: tries[i] }).then(function (stream) {
        if (mine !== scanner.session || !scanner.open || document.hidden) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        attachStream(stream, mine, !!tries[i].deviceId);
      }, function (e) {
        if (mine !== scanner.session) return;
        var n = e && e.name;
        if (i + 1 < tries.length && n !== 'NotAllowedError' && n !== 'SecurityError') {
          if (i === 0 && wantId && wantId === settings.cameraId) { settings.cameraId = ''; saveSettings(); }
          attempt(i + 1);
        } else cameraError(e);
      });
    })(0);
  }
  function attachStream(stream, mine, chosen) {
    scanner.stream = stream; scanner.track = stream.getVideoTracks()[0] || null;
    sc.video.srcObject = stream;
    var p = sc.video.play(); if (p && p.catch) p.catch(function () {});
    var st = {};
    try { st = scanner.track && scanner.track.getSettings ? scanner.track.getSettings() : {}; } catch (e) {}
    scanner.camId = st.deviceId || '';
    setupTrack();
    initWasm().then(function () { if (mine === scanner.session) renderScanInfo(); });
    scanner.since = Date.now(); scanner.hint = 0; scanner.frame = 0;
    setScanMsg(MSG_AIM);
    loop();
    listCameras().then(function (cams) {
      if (mine !== scanner.session) return;
      scanner.cams = cams;
      if (!chosen && !scanner.switched && !scanner.caps.torch) {
        var main = cams.filter(function (c) { return /camera2 0\b/.test(c.label); })[0];
        if (main && main.deviceId !== scanner.camId) { scanner.switched = true; settings.cameraId = main.deviceId; saveSettings(); startCamera(main.deviceId); return; }
      }
      renderScanInfo();
    });
  }
  function camIndex(label) { var m = /camera2 (\d+)/i.exec(label || ''); return m ? +m[1] : 999; }
  function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var cams = list.filter(function (d) { return d.kind === 'videoinput' && d.deviceId; });
      var back = cams.filter(function (d) { return /back|rear|traseir|environment/i.test(d.label) && !/front|frontal|facetime/i.test(d.label); });
      if (!back.length) back = cams.filter(function (d) { return d.label && !/front|frontal|facetime|user/i.test(d.label); });
      return back.map(function (d, i) { return { deviceId: d.deviceId, label: d.label, i: i }; })
        .sort(function (a, b) { return (camIndex(a.label) - camIndex(b.label)) || (a.i - b.i); });
    }, function () { return []; });
  }
  function cameraError(e) {
    var n = e && e.name;
    setScanMsg(n === 'NotAllowedError' || n === 'SecurityError'
      ? 'Sem permissão para usar a câmera. Libere a câmera para este app nas configurações do celular, ou use Foto.'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'Não encontrei a câmera. Use Foto ou Digitar código.'
      : n === 'NotReadableError' ? 'A câmera está em uso por outro app. Feche-o e tente de novo.'
      : 'Não consegui abrir a câmera. Use Foto ou Digitar código.', true);
  }
  function setupTrack() {
    var t = scanner.track, caps = {};
    try { caps = t && t.getCapabilities ? t.getCapabilities() || {} : {}; } catch (e) { caps = {}; }
    scanner.caps = caps;
    sc.torch.hidden = !caps.torch;
    if (t && caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
      t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
    }
    // Zoom moderado deixa segurar o celular mais longe, onde a lente consegue focar.
    var z = caps.zoom;
    scanner.zooms = z && z.max >= 1.4 ? [1, 1.5, 2, 3].filter(function (v) { return v >= (z.min || 1) - 0.01 && v <= z.max + 0.01; }) : [];
    sc.zoom.hidden = scanner.zooms.length < 2;
    scanner.zoom = 1;
    if (scanner.zooms.length > 1) {
      var want = settings.zoom > 0 ? settings.zoom : (isIOS ? 2 : 1.5);
      if (scanner.zooms.indexOf(want) < 0) want = scanner.zooms.filter(function (v) { return v <= want; }).pop() || 1;
      setZoom(want);
    }
  }
  function zoomText(v) { return String(v).replace('.', ',') + '×'; }
  function setZoom(v) {
    var t = scanner.track; if (!t) return;
    t.applyConstraints({ advanced: [{ zoom: v }] }).then(function () {
      if (scanner.track !== t) return;
      scanner.zoom = v; sc.zoom.textContent = zoomText(v);
      sc.zoom.setAttribute('aria-label', 'Zoom ' + zoomText(v) + '. Toque para trocar.');
      renderScanInfo();
    }, function () { sc.zoom.hidden = true; });
  }
  sc.torch.addEventListener('click', function () {
    var t = scanner.track; if (!t) return;
    var on = !scanner.torchOn;
    t.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      scanner.torchOn = on; sc.torch.setAttribute('aria-pressed', String(on));
    }, function () { sc.torch.hidden = true; });
  });
  sc.zoom.addEventListener('click', function () {
    var z = scanner.zooms; if (z.length < 2) return;
    var next = z[(z.indexOf(scanner.zoom) + 1) % z.length];
    settings.zoom = next; saveSettings();
    setZoom(next);
  });
  sc.cam.addEventListener('click', function () {
    var cams = scanner.cams; if (cams.length < 2) return;
    var i = cams.findIndex(function (c) { return c.deviceId === scanner.camId; });
    var next = cams[(i + 1) % cams.length];
    settings.cameraId = next.deviceId; saveSettings();
    scanner.switched = true;
    startCamera(next.deviceId);
  });
  function renderScanInfo() {
    var cams = scanner.cams, i = cams.findIndex(function (c) { return c.deviceId === scanner.camId; });
    sc.cam.hidden = cams.length < 2;
    sc.camText.textContent = 'Lente ' + (i >= 0 ? i + 1 : 1) + '/' + cams.length;
    var st = {};
    try { st = scanner.track && scanner.track.getSettings ? scanner.track.getSettings() : {}; } catch (e) {}
    scanner.diag = 'Leitor: ' + engineName() +
      ' · câmera: ' + (i >= 0 && cams[i].label ? cams[i].label : 'traseira') +
      (st.width ? ' · ' + st.width + '×' + st.height : '') +
      (scanner.zoom > 1 ? ' · zoom ' + zoomText(scanner.zoom) : '') +
      (scanner.caps.focusMode ? ' · foco: ' + scanner.caps.focusMode.join('/') : '');
  }

  // Toque na imagem: foca de novo naquele ponto (onde o navegador permite).
  sc.mid.addEventListener('click', function (e) {
    if (e.target.closest('button')) return;
    var t = scanner.track; if (!t) return;
    var r = sc.video.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    sc.ring.style.left = x + 'px'; sc.ring.style.top = y + 'px';
    sc.ring.hidden = false; sc.ring.classList.remove('go'); void sc.ring.offsetWidth; sc.ring.classList.add('go');
    clearTimeout(sc.ring._t); sc.ring._t = setTimeout(function () { sc.ring.hidden = true; }, 800);
    var caps = scanner.caps || {}, modes = caps.focusMode || [], sup = {}, c = {};
    try { sup = navigator.mediaDevices.getSupportedConstraints() || {}; } catch (x2) {}
    if (sup.pointsOfInterest) c.pointsOfInterest = [{ x: Math.min(1, Math.max(0, x / r.width)), y: Math.min(1, Math.max(0, y / r.height)) }];
    if (modes.indexOf('single-shot') >= 0) c.focusMode = 'single-shot';
    else if (modes.indexOf('continuous') >= 0) c.focusMode = 'continuous';
    if (!c.focusMode && !c.pointsOfInterest) return;
    t.applyConstraints({ advanced: [c] }).then(function () {
      if (c.focusMode !== 'single-shot') return;
      setTimeout(function () { if (scanner.track === t) t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); }, 1800);
    }, function () {});
  });

  // Região do vídeo, em pixels do vídeo. Estreita: a faixa da moldura (com folga), na largura toda da tela.
  // Larga: tudo o que aparece na tela, para código grande, girado ou fora do centro.
  function cropRect(wide) {
    var v = sc.video, vw = v.videoWidth, vh = v.videoHeight;
    var vr = v.getBoundingClientRect(), fr = sc.frame.getBoundingClientRect();
    var s = Math.max(vr.width / vw, vr.height / vh);
    var offX = (vr.width - vw * s) / 2, offY = (vr.height - vh * s) / 2;
    var x = -offX / s, w = vr.width / s, y, h;
    if (wide) { y = -offY / s; h = vr.height / s; }
    else { var my = fr.height * 0.45; y = (fr.top - vr.top - my - offY) / s; h = (fr.height + 2 * my) / s; }
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    if (!(w > 20 && h > 20)) return { x: 0, y: 0, w: vw, h: vh };
    return { x: x, y: y, w: w, h: h };
  }
  function frameData(r, maxW) {
    var c = scanner.canvas, k = Math.min(1, maxW / Math.max(r.w, r.h));
    var w = Math.max(1, Math.round(r.w * k)), h = Math.max(1, Math.round(r.h * k));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    var g = scanner.ctx || (scanner.ctx = c.getContext('2d', { willReadFrequently: true }));
    g.drawImage(sc.video, r.x, r.y, r.w, r.h, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  }

  // Cada tentativa usa um jeito de ler; o leitor nativo do Android entra em quadros alternados.
  // faixa: imagem crua da faixa da moldura · reforco/nitido/forte: realce contra desfoque (do leve ao forte)
  // ampliada: dobra a largura para código pequeno · tela: a tela toda, aceitando código girado.
  var PLAN = ['faixa', 'reforco', 'faixa', 'nitido', 'faixa', 'ampliada', 'faixa', 'forte', 'tela'];
  var BOOST = { reforco: [1, 4, 3], nitido: [1, 8, 2], forte: [1, 8, 3], ampliada: [2, 1.5, 2] };
  function tagged(p, by) { return p.then(function (h) { if (h) h.by = by; return h; }); }
  function tick() {
    var v = sc.video;
    if (v.readyState < 2 || !v.videoWidth) return Promise.resolve(null);
    var n = scanner.frame++;
    if (dec.native && (n % 2 === 0 || !(dec.wasm || dec.js))) {
      return dec.native.detect(v).then(pickNative, function () { return null; });
    }
    var step = PLAN[(dec.native ? n >> 1 : n) % PLAN.length];
    if (dec.wasm) {
      if (step === 'tela') return tagged(wasmRead(frameData(cropRect(true), 1280), { tryHarder: true, tryRotate: true }), step);
      var img = frameData(cropRect(false), 1280);
      if (step === 'faixa') return tagged(wasmRead(img, null), step);
      var b = BOOST[step];
      return tagged(wasmRead(barsBoost(img, b[0], b[1], b[2]), { tryHarder: true, tryDownscale: false }), step);
    }
    if (dec.js) return Promise.resolve(jsRead(frameData(cropRect(step === 'tela'), 960)));
    return Promise.resolve(null);
  }
  function loop() {
    clearTimeout(scanner.timer);
    if (!running()) return;
    scanner.timer = setTimeout(runTick, scanner.gap);
  }
  function runTick() {
    if (!running()) return;
    if (scanner.busy && performance.now() - scanner.busySince < 1500) { loop(); return; }
    scanner.busy = true; scanner.busySince = performance.now();
    var session = scanner.session, t0 = scanner.busySince;
    tick().then(function (hit) {
      scanner.busy = false;
      if (session !== scanner.session || !running()) return;
      scanner.gap = Math.max(12, 45 - (performance.now() - t0));
      if (hit && onCandidate(hit)) return;
      updateHint();
      loop();
    }, function () { scanner.busy = false; loop(); });
  }
  var SOLID = { nativo: 1, faixa: 1, tela: 1, 'zxing-js': 1 };
  function onCandidate(hit) {
    var code = normCode(hit.code), now = Date.now();
    if (scanner.cooldown.code === code && now < scanner.cooldown.until) return false;
    scanner.seenAt = now;
    if (now - (scanner.votesAt || 0) > 1600) scanner.votes = {};
    scanner.votesAt = now;
    var votes = scanner.votes, v = votes[code] || (votes[code] = { n: 0, solid: 0, ways: {}, k: 0 });
    var solid = !!SOLID[hit.by];
    v.n++; if (solid) v.solid++;
    if (!v.ways[hit.by]) { v.ways[hit.by] = 1; v.k++; }
    var rival = Object.keys(votes).length > 1;
    var ok = (solid && hit.strong) || v.solid >= 2 || (!rival && (v.k >= 2 || v.n >= 3));
    if (!ok) {
      sc.frame.classList.add('seen');
      clearTimeout(scanner.seenT);
      scanner.seenT = setTimeout(function () { sc.frame.classList.remove('seen'); }, 500);
      if (scanner.hint !== -1) { scanner.hint = -1; setScanMsg('Segure firme…'); }
      return false;
    }
    scanner.votes = {};
    confirmCode(code, hit.by);
    return true;
  }
  function updateHint() {
    var idle = Date.now() - Math.max(scanner.since, scanner.seenAt);
    var h = idle > 12000 ? 2 : idle > 6000 ? 1 : 0;
    if (h === scanner.hint) return;
    scanner.hint = h;
    setScanMsg(h === 2
      ? (scanner.caps.torch ? 'Pouca luz ou reflexo? Ligue a lanterna, toque na imagem para focar ou use Digitar código.'
        : 'Reflexo ou pouca luz? Incline um pouco o produto, toque na imagem para focar ou use Digitar código.')
      : h === 1 ? 'Segure a um palmo do produto (uns 15 a 20 cm), com o código dentro da moldura.' : MSG_AIM);
  }
  function confirmCode(code, by) {
    pauseScanner();
    beep();
    scanner.lastBy = by || '';
    sc.frame.classList.remove('seen'); sc.frame.classList.add('hit');
    setScanMsg('Código lido');
    var shot = grabFrame();
    setTimeout(function () { sc.frame.classList.remove('hit'); }, 600);
    openNew(); draft.fromScanner = true;
    var d = draft;
    openPanel(ip.root, ip.title);
    applyCode(code, 'camera');
    focusPriceIfMissing(d);
    shot.then(function (blob) {
      if (draft !== d || !blob || d.url) return;
      d.url = URL.createObjectURL(blob);
      renderDraft();
    });
  }
  function grabFrame() {
    return new Promise(function (resolve) {
      var v = sc.video;
      if (!v.videoWidth) { resolve(null); return; }
      var k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      var c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { resolve(null); return; }
      if (!c.toBlob) { resolve(null); return; }
      c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.85);
    });
  }

  // Tela acesa enquanto o leitor está aberto.
  var wake = null;
  function keepAwake(on) {
    try {
      if (on) {
        if (wake || !navigator.wakeLock || document.hidden) return;
        navigator.wakeLock.request('screen').then(function (w) {
          if (!scanner.open) { w.release().catch(function () {}); return; }
          wake = w; w.addEventListener('release', function () { if (wake === w) wake = null; });
        }, function () {});
      } else if (wake) { var w2 = wake; wake = null; w2.release().catch(function () {}); }
    } catch (e) {}
  }

  sc.close.addEventListener('click', closeScanner);
  sc.type.addEventListener('click', function () { pauseScanner(); openManual(true, ip.code); });
  $('#scanBtn').addEventListener('click', openScanner);
  $('#typeBtn').addEventListener('click', function () { openManual(false); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (scanner.stream) stopCamera(); return; }
    if (scanner.open) keepAwake(true);
    if (scanner.open && !scanner.paused && !scanner.stream) startCamera();
    if (!trip.cart.length) renderHead();
  });
  window.addEventListener('pagehide', function () { if (scanner.stream) stopCamera(); });

  /* ---------------- options ---------------- */
  var mp = {
    root: $('#menuPanel'), title: $('#menuTitle'), close: $('#menuClose'), install: $('#menuInstall'),
    store: $('#storeInput'), budget: $('#budgetInput'), budgetClear: $('#budgetClear'), budgetChips: $('#budgetChips'), diag: $('#diagInfo'),
    beep: $('#beepToggle'), catalog: $('#catalogToggle'),
    newTrip: $('#newTrip'), newConfirm: $('#newConfirm'), newSummary: $('#newSummary'), newYes: $('#newYes'), newNo: $('#newNo'),
    hist: $('#histList'), histEmpty: $('#histEmpty'), monthSum: $('#monthSum'),
    dataInfo: $('#dataInfo'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'), importFile: $('#importFile'),
    importConfirm: $('#importConfirm'), importSummary: $('#importSummary'), importYes: $('#importYes'), importNo: $('#importNo'),
    memClear: $('#memClear'), memConfirm: $('#memConfirm'), memYes: $('#memYes'), memNo: $('#memNo'),
    priceUrl: $('#priceUrlInput'), integrationMsg: $('#integrationMsg')
  };
  function renderHistory() {
    mp.hist.textContent = '';
    mp.histEmpty.hidden = history.length > 0;
    history.slice(0, 20).forEach(function (h) {
      var li = document.createElement('li');
      li.append(span('h-when', dmy(h.at).slice(0, 5)), span('h-where', (h.store || 'Mercado') + ' · ' + plural(h.lines || 0, 'item', 'itens')), span('h-total', brl(h.total)));
      mp.hist.appendChild(li);
    });
    var now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var month = history.filter(function (h) { return h.at >= m0; });
    mp.monthSum.hidden = !month.length;
    if (month.length) {
      var monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(now);
      mp.monthSum.textContent = 'Em ' + monthName + ': ' + brl(month.reduce(function (s, h) { return s + h.total; }, 0)) + ' em ' + plural(month.length, 'compra guardada', 'compras guardadas') + '.';
    }
  }
  function renderDataInfo() {
    var prices = Object.keys(memory).filter(function (k) { return k.indexOf('balanca:') !== 0; }).length;
    mp.dataInfo.textContent = 'Tudo fica guardado neste celular: ' + plural(trip.cart.length, 'item', 'itens') + ' no carrinho, ' +
      plural(prices, 'preço salvo', 'preços salvos') + ' e ' + plural(history.length, 'compra', 'compras') + ' no histórico.' +
      (persisted ? ' O celular marcou estes dados como permanentes.' : '') + ' Versão ' + VERSION + '.';
    mp.memClear.hidden = !Object.keys(memory).length;
    mp.diag.textContent = scanner.diag || ('Leitor: ' + engineName() + '. Abra o leitor uma vez para ver a câmera usada.');
  }
  function fillMenu() {
    mp.store.value = settings.store;
    mp.budget.value = settings.budget ? money(settings.budget) : '';
    mp.beep.checked = !!settings.beep; mp.catalog.checked = !!settings.catalog;
    mp.priceUrl.value = settings.priceUrl;
    mp.integrationMsg.hidden = true;
    mp.newConfirm.hidden = true; mp.memConfirm.hidden = true; mp.importConfirm.hidden = true;
    mp.newTrip.disabled = !trip.cart.length;
    mp.install.hidden = !installEvt;
    renderHistory(); renderDataInfo();
  }
  function openMenu(focusEl) { fillMenu(); openPanel(mp.root, focusEl || mp.title); }
  $('#menuBtn').addEventListener('click', function () { openMenu(); });
  el.budget.addEventListener('click', function () { openMenu(mp.budget); });
  el.rStore.addEventListener('click', function () { openMenu(mp.store); });
  mp.close.addEventListener('click', function () { closePanel(); });
  mp.store.addEventListener('input', function () { settings.store = mp.store.value.slice(0, 40); saveSettings(); renderHead(); });
  mp.store.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); mp.store.blur(); } });
  mp.budget.addEventListener('input', function () {
    var c = digitsToInt(mp.budget.value, 7);
    settings.budget = c || null; mp.budget.value = c ? money(c) : ''; caretEnd(mp.budget);
    saveSettings(); renderTotals();
  });
  mp.budgetClear.addEventListener('click', function () { settings.budget = null; mp.budget.value = ''; saveSettings(); renderTotals(); });
  mp.budgetChips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    settings.budget = parseInt(b.dataset.v, 10); mp.budget.value = money(settings.budget); saveSettings(); renderTotals();
  });
  mp.beep.addEventListener('change', function () { settings.beep = mp.beep.checked; saveSettings(); if (settings.beep) { primeAudio(); beep(); } });
  mp.catalog.addEventListener('change', function () { settings.catalog = mp.catalog.checked; saveSettings(); });
  function saveUrl(input, key, label) {
    var v = input.value.trim();
    if (v && !validUrl(v)) {
      mp.integrationMsg.textContent = label + ': use um endereço que comece com https://';
      mp.integrationMsg.hidden = false; return;
    }
    settings[key] = v; saveSettings();
    mp.integrationMsg.textContent = v ? label + ' ligada.' : label + ' desligada.';
    mp.integrationMsg.hidden = false;
  }
  mp.priceUrl.addEventListener('change', function () { saveUrl(mp.priceUrl, 'priceUrl', 'Tabela de preços'); });

  mp.newTrip.addEventListener('click', function () {
    mp.newSummary.textContent = 'Guardar ' + plural(trip.cart.length, 'item', 'itens') + ' (' + brl(cartTotal(trip.cart)) + ') no histórico e zerar o carrinho?';
    mp.newConfirm.hidden = false; mp.newYes.focus();
  });
  mp.newNo.addEventListener('click', function () { mp.newConfirm.hidden = true; mp.newTrip.focus(); });
  mp.newYes.addEventListener('click', function () {
    var before = snapshot(), had = trip.cart.length > 0;
    if (had) {
      history.unshift({ at: trip.startedAt, end: Date.now(), store: settings.store || '', total: cartTotal(trip.cart), lines: trip.cart.length });
      history = history.slice(0, 60); saveHistory();
    }
    trip.cart = []; trip.seq = 0; trip.startedAt = Date.now(); saveTrip();
    closePanel(); renderAll(null, true);
    toast('Carrinho zerado. A compra anterior foi para o histórico.', function () {
      if (had) { history.shift(); saveHistory(); }
      restore(before, 'Compra recuperada.');
    });
  });
  mp.memClear.addEventListener('click', function () { mp.memConfirm.hidden = false; mp.memYes.focus(); });
  mp.memNo.addEventListener('click', function () { mp.memConfirm.hidden = true; mp.memClear.focus(); });
  mp.memYes.addEventListener('click', function () {
    memory = {}; saveMemory(); mp.memConfirm.hidden = true; renderDataInfo(); toast('Preços salvos apagados.');
  });

  // backup
  mp.exportBtn.addEventListener('click', function () {
    var data = { app: 'pre-caixa', v: 1, exportedAt: new Date().toISOString(), settings: settings, trip: trip, memory: memory, history: history };
    var name = 'pre-caixa-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var file = null;
    try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Backup do Pré-Caixa' }).catch(function () {});
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
  var pendingImport = null;
  mp.importBtn.addEventListener('click', function () { mp.importFile.click(); });
  mp.importFile.addEventListener('change', function () {
    var f = mp.importFile.files && mp.importFile.files[0];
    mp.importFile.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      var data = JSON.parse(txt);
      if (!data || data.app !== 'pre-caixa') throw new Error('formato');
      pendingImport = data;
      var t = cleanTrip(data.trip), m = cleanMemory(data.memory), h = cleanHistory(data.history);
      mp.importSummary.textContent = 'Backup de ' + (data.exportedAt ? dmy(Date.parse(data.exportedAt)) : 'data desconhecida') + ': ' +
        plural(t.cart.length, 'item', 'itens') + ' no carrinho, ' + plural(Object.keys(m).length, 'preço', 'preços') + ' e ' + plural(h.length, 'compra', 'compras') +
        '. Substituir o que está neste celular?';
      mp.importConfirm.hidden = false; mp.importYes.focus();
    }).catch(function () { toast('Este arquivo não é um backup do Pré-Caixa.'); });
  });
  mp.importNo.addEventListener('click', function () { pendingImport = null; mp.importConfirm.hidden = true; });
  mp.importYes.addEventListener('click', function () {
    var data = pendingImport; if (!data) return;
    settings = cleanSettings(data.settings); trip = cleanTrip(data.trip); memory = cleanMemory(data.memory); history = cleanHistory(data.history);
    saveSettings(); saveTrip(); saveMemory(); saveHistory();
    pendingImport = null; mp.importConfirm.hidden = true;
    fillMenu(); renderAll(null, true); toast('Backup restaurado.');
  });

  /* ---------------- install ---------------- */
  var installEvt = null;
  var standalone = !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var inst = { box: $('#installBox'), text: $('#installText'), btn: $('#installBtn'), later: $('#installLater') };
  function renderInstall() {
    mp.install.hidden = !installEvt;
    if (standalone || settings.installDismissed) { inst.box.hidden = true; return; }
    if (installEvt) {
      inst.text.textContent = 'Instale o Pré-Caixa: ele abre direto da tela inicial, funciona sem sinal e guarda tudo neste celular.';
      inst.btn.hidden = false; inst.later.textContent = 'Agora não';
    } else if (isIOS) {
      inst.text.textContent = 'Para instalar no iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início". Use sempre pelo ícone.';
      inst.btn.hidden = true; inst.later.textContent = 'Entendi';
    } else { inst.box.hidden = true; return; }
    inst.box.hidden = false;
  }
  function promptInstall() {
    if (!installEvt) return;
    var e = installEvt;
    e.prompt();
    (e.userChoice || Promise.resolve({})).then(function (c) {
      if (c && c.outcome === 'accepted') { installEvt = null; renderInstall(); }
    });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener('appinstalled', function () { installEvt = null; settings.installDismissed = true; saveSettings(); renderInstall(); toast('Pré-Caixa instalado.'); });
  inst.btn.addEventListener('click', promptInstall);
  mp.install.addEventListener('click', promptInstall);
  inst.later.addEventListener('click', function () { settings.installDismissed = true; saveSettings(); renderInstall(); });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    var swHadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!swHadController) { swHadController = true; return; }
      if (scanner.open || openPanelEl) toast('Versão nova do app pronta.', function () { location.reload(); }, 'Atualizar');
      else location.reload();
    });
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ---------------- start ---------------- */
  renderAll(); renderStorageWarn(); renderInstall();
  checkPersist(standalone);
})();
