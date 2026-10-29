/* Pré-Caixa · assistente pré-caixa do mercado (PWA)
   Tudo fica no próprio celular (localStorage). Nenhum dado sai do aparelho, exceto:
   - o código de barras enviado ao catálogo aberto Open Food Facts, para achar o nome;
   - o que você mesmo ligar em Opções > Integrações. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
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

  var DEFAULTS = { store: '', budget: null, beep: true, catalog: true, priceUrl: '', visionUrl: '', installDismissed: false };
  function cleanSettings(s) {
    s = Object.assign({}, DEFAULTS, s && typeof s === 'object' ? s : {});
    if (typeof s.store !== 'string') s.store = '';
    if (!(num(s.budget, 0) > 0)) s.budget = null;
    ['priceUrl', 'visionUrl'].forEach(function (k) { if (typeof s[k] !== 'string') s[k] = ''; });
    s.beep = s.beep !== false; s.catalog = s.catalog !== false; s.installDismissed = !!s.installDismissed;
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
    rDate: $('#rDate'), rStore: $('#rStore'), storageWarn: $('#storageWarn'), scanTotal: $('#scanTotal')
  };

  function renderTotals(bump) {
    var total = cartTotal(trip.cart), n = trip.cart.length;
    var s = money(total), i = s.lastIndexOf(',');
    el.tagInt.textContent = s.slice(0, i);
    el.tagDec.textContent = s.slice(i);
    el.tagCount.textContent = plural(n, 'item', 'itens');
    el.tagSpoken.textContent = 'Total no carrinho: ' + brl(total) + ', ' + plural(n, 'item', 'itens');
    el.scanTotal.textContent = brl(total) + ' · ' + plural(n, 'item', 'itens');
    var b = settings.budget;
    if (!b) {
      el.budget.dataset.state = 'none'; el.meter.style.width = '0%';
      el.budgetL.textContent = 'Sem orçamento'; el.budgetR.textContent = 'Definir limite';
    } else {
      var ratio = total / b;
      el.budget.dataset.state = ratio > 1 ? 'over' : ratio >= 0.85 ? 'warn' : 'ok';
      el.meter.style.width = Math.min(100, ratio * 100).toFixed(1) + '%';
      setRich(el.budgetL, 'Orçamento ', brl(b));
      if (total > b) setRich(el.budgetR, 'Passou ', brl(total - b));
      else setRich(el.budgetR, 'Faltam ', brl(b - total));
    }
    el.footCount.textContent = String(n);
    el.footTotal.textContent = money(total);
    if (bump && !reduceMotion) { el.tag.classList.remove('bump'); void el.tag.offsetWidth; el.tag.classList.add('bump'); }
  }

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

  function renderAll(flashId, bump) {
    renderTotals(bump); renderCart(flashId); renderHead();
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
  function toast(msg, undo) {
    clearTimeout(toastTimer);
    tt.msg.textContent = msg; toastUndo = undo || null; tt.undo.hidden = !undo;
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

  /* ---------------- barcode decoding ---------------- */
  var nativeDet = null;
  (function () {
    try {
      if (!('BarcodeDetector' in window)) return;
      var want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];
      window.BarcodeDetector.getSupportedFormats().then(function (sup) {
        var f = want.filter(function (x) { return sup.indexOf(x) >= 0; });
        if (f.indexOf('ean_13') >= 0) nativeDet = new window.BarcodeDetector({ formats: f });
      }, function () {});
    } catch (e) {}
  })();

  function acceptCode(text, fmt) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (fmt === 'itf') return /^\d{14}$/.test(t) && gtinValid(t) ? t : null;
    if (fmt === 'ean_13' || fmt === 'ean_8' || fmt === 'upc_a' || fmt === 'upc_e') return /^\d{6,14}$/.test(t) ? t : null;
    if (fmt === 'code_128') return t.length >= 4 && t.length <= 48 ? t : null;
    return null;
  }
  function pickNative(list) {
    var order = ['ean_13', 'upc_a', 'ean_8', 'upc_e', 'itf', 'code_128'];
    list = (list || []).slice().sort(function (a, b) { return order.indexOf(a.format) - order.indexOf(b.format); });
    for (var i = 0; i < list.length; i++) { var ok = acceptCode(list[i].rawValue, list[i].format); if (ok) return ok; }
    return null;
  }

  var readers = {};
  function zxReader(Z, hard) {
    var k = hard ? 'hard' : 'fast';
    if (readers[k]) return readers[k];
    var F = Z.BarcodeFormat, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.ITF]);
    if (hard) hints.set(Z.DecodeHintType.TRY_HARDER, true);
    var r = new Z.MultiFormatReader(); r.setHints(hints);
    return (readers[k] = r);
  }
  function zxDecode(Z, reader, canvas, onlyBin) {
    var w = canvas.width, h = canvas.height;
    var px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    var lum = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    var src = new Z.RGBLuminanceSource(lum, w, h);
    var bins = onlyBin ? [onlyBin] : [Z.HybridBinarizer, Z.GlobalHistogramBinarizer];
    for (var k = 0; k < bins.length; k++) {
      try {
        var r = reader.decodeWithState(new Z.BinaryBitmap(new bins[k](src)));
        var ok = acceptCode(r.getText(), String(Z.BarcodeFormat[r.getBarcodeFormat()] || '').toLowerCase());
        if (ok) return ok;
      } catch (e) { /* nada nesta tentativa */ }
      try { reader.reset(); } catch (e) {}
    }
    return null;
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
  function findBarcode(img, isStale) {
    var tryNative = nativeDet ? nativeDet.detect(img.src).then(pickNative, function () { return null; }) : Promise.resolve(null);
    return tryNative.then(function (hit) {
      if (hit) return hit;
      var Z = window.ZXing;
      if (!Z || !Z.MultiFormatReader) return null;
      var reader = zxReader(Z, true);
      var plan = [
        { max: 1280 }, { max: 1280, rot: 90 }, { max: 1920 }, { max: 1920, rot: 90 },
        { max: 1400, crop: 0.5 }, { max: 1400, crop: 0.5, rot: 90 }, { max: 1280, rot: 25 }, { max: 1280, rot: -25 }
      ];
      var i = 0;
      function step() {
        if (i >= plan.length || isStale()) return null;
        var p = plan[i++];
        return pause().then(function () {
          if (isStale()) return null;
          return zxDecode(Z, reader, drawTo(img, p)) || step();
        });
      }
      return step();
    });
  }
  function toJpeg(img, max) {
    return new Promise(function (resolve) {
      var c = drawTo(img, { max: max });
      if (!c.toBlob) { resolve(null); return; }
      c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.86);
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
  function visionOn() { return validUrl((settings.visionUrl || '').trim()); }

  /* ---------------- item panel ---------------- */
  var ip = {
    root: $('#itemPanel'), title: $('#itemTitle'), close: $('#itemClose'), save: $('#itemSave'),
    thumbImg: $('#thumbImg'), thumbIcon: $('#thumbIcon'), status: $('#scanStatus'), statusText: $('#scanStatusText'), note: $('#scanNote'),
    busyBar: $('#busyBar'), retake: $('#retake'), retakeText: $('#retakeText'), visionRead: $('#visionRead'),
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
  var RANK = { digitado: 6, balanca: 5, api: 4, foto: 3, carrinho: 2, memoria: 1 };

  function makeDraft(mode) {
    return {
      mode: mode, lineId: null, existingId: null, fromScanner: false,
      code: '', codeFrom: '', scale: null, lastTyped: '',
      name: '', nameFrom: '', nameTouched: false,
      price: null, priceFrom: '', priceTouched: false, altPrice: null,
      unit: 'un', unitUser: false, qty: 1, grams: 1000,
      kind: 'idle', status: '', note: '', memNote: '', obs: '',
      url: '', jpeg: null, photoTaken: false, token: 0,
      lookingCatalog: false, lookingApi: false, catalogResult: '',
      vision: 'idle', vctl: null
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
    ip.busyBar.hidden = !(d.lookingCatalog || d.lookingApi || d.vision === 'reading');
    ip.retake.hidden = d.mode === 'edit' || (!!d.code && !visionOn());
    ip.retakeText.textContent = d.code ? 'Foto da etiqueta' : 'Foto do código';
    ip.visionRead.hidden = !(visionOn() && d.jpeg && d.mode === 'new' && d.vision !== 'reading' && d.vision !== 'done');
    var isKg = d.unit === 'kg';
    ip.unitSeg.hidden = !!d.scale || d.mode === 'more';
    ip.unitUn.setAttribute('aria-pressed', String(!isKg));
    ip.unitKg.setAttribute('aria-pressed', String(isKg));
    ip.perKg.hidden = !isKg;
    ip.priceLabel.textContent = d.scale ? 'Valor da etiqueta' : isKg ? 'Preço por kg' : 'Preço';
    ip.qtyField.hidden = isKg; ip.kgField.hidden = !isKg;
    var alt = d.altPrice && d.altPrice.cents !== d.price ? d.altPrice : null;
    ip.hint.hidden = !alt;
    if (alt) ip.hintText.textContent = (alt.src === 'api' ? 'Sistema do mercado: ' : 'Na foto: ') + brl(alt.cents) + (isKg ? '/kg' : '');
    ip.obs.hidden = !d.obs; ip.obs.textContent = d.obs ? 'Na etiqueta: ' + d.obs : '';
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
        else { s.className = pt / b >= 0.85 ? 'warn' : 'ok'; s.textContent = ' · faltam ' + brl(b - pt); }
        ip.after.appendChild(s);
      }
    }
    ip.submit.disabled = !valid; ip.save.disabled = !valid;
    ip.submit.textContent = valid ? verb + ' · ' + brl(lt) : verb;
    ip.save.textContent = verb;
  }

  function discardDraft() {
    var d = draft; if (!d) return;
    abortVision(d); d.token++;
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
    if (d.lookingCatalog || d.lookingApi || d.vision === 'reading') { d.note = 'Buscando nome e preço…'; return; }
    var alt = d.altPrice && d.altPrice.cents !== d.price ? d.altPrice : null, pf = d.priceFrom;
    if (alt) d.note = (alt.src === 'api' ? 'O sistema do mercado' : 'A foto') + ' mostra outro valor. Veja qual vale.';
    else if (pf === 'api') d.note = 'Preço do sistema do mercado.';
    else if (pf === 'foto') d.note = 'Preço lido na foto. Confira com a etiqueta.';
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
    if (r.name && !d.nameTouched && (!d.name || d.nameFrom === 'catalogo' || (src === 'api' && d.nameFrom === 'foto'))) setName(r.name, src);
    if (r.perKg && !d.unitUser && !d.scale && d.mode === 'new') { d.unit = 'kg'; if (!d.grams) d.grams = 1000; ip.grams.value = kg(d.grams); }
    if (r.cents) {
      var cur = d.priceTouched ? RANK.digitado : (RANK[d.priceFrom] || 0);
      if (d.price == null || RANK[src] >= cur) { setPrice(r.cents, src); if (d.altPrice && d.altPrice.cents === r.cents) d.altPrice = null; }
      else if (r.cents !== d.price) d.altPrice = { cents: r.cents, src: src };
    }
    if (r.obs) d.obs = r.obs;
  }

  function maybeVision(d) {
    if (!visionOn() || !d.jpeg || d.vision !== 'idle' || d.mode !== 'new') return false;
    if (d.price > 0 || d.lookingCatalog || d.lookingApi) return false;
    if (!d.photoTaken && d.name) return false; // quadro da câmera sem etiqueta: só vale a pena para achar o nome
    runVision(d); return true;
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
    if (maybeVision(d)) return;
    finishNote(d); renderDraft();
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
    var token = ++d.token, hadCode = !!d.code;
    var stale = function () { return draft !== d || d.token !== token; };
    abortVision(d);
    if (d.url) URL.revokeObjectURL(d.url);
    d.url = URL.createObjectURL(file); d.jpeg = null; d.photoTaken = true; d.vision = 'idle';
    if (hadCode) d.note = 'Preparando a foto…';
    else setStatus(d, 'busy', 'Procurando o código…', '');
    renderDraft();
    var img = null;
    loadImage(file).then(function (im) {
      img = im;
      if (stale() || hadCode) return null;
      return findBarcode(img, stale);
    }, function () { return null; }).then(function (hit) {
      if (!img || stale()) return { hit: null, jpeg: null };
      return toJpeg(img, 1280).then(function (j) { return { hit: hit, jpeg: j }; }, function () { return { hit: hit, jpeg: null }; });
    }).then(function (res) {
      if (img) { img.close(); img = null; }
      if (stale()) return;
      d.jpeg = res.jpeg;
      if (!res.jpeg && !res.hit) {
        setStatus(d, 'warn', 'Não consegui abrir a foto', 'Tente outra foto ou digite o preço.');
        renderDraft(); return;
      }
      if (hadCode) { if (visionOn()) runVision(d); else { finishNote(d); renderDraft(); } return; }
      if (res.hit) { beep(); applyCode(res.hit, 'foto'); return; }
      setStatus(d, 'warn', window.ZXing || nativeDet ? 'Não achei o código de barras' : 'Leitor de código indisponível',
        visionOn() ? 'Lendo a foto…' : 'Tente mais perto, sem reflexo, ou digite o código.');
      renderDraft();
      if (visionOn()) runVision(d);
    }).catch(function () {
      if (img) { img.close(); img = null; }
      if (stale()) return;
      setStatus(d, 'warn', 'Não consegui ler a foto', 'Tente outra foto ou digite o preço.');
      renderDraft();
    });
  }

  function abortVision(d) {
    if (d && d.vctl) { var c = d.vctl; d.vctl = null; try { c.abort(); } catch (e) {} }
    if (d && d.vision === 'reading') d.vision = 'idle';
  }
  function runVision(d) {
    if (!visionOn() || !d.jpeg) return;
    abortVision(d);
    var ctl = new AbortController();
    d.vctl = ctl; d.vision = 'reading';
    finishNote(d); renderDraft();
    var fd = new FormData();
    fd.append('foto', d.jpeg, 'foto.jpg');
    if (d.code) fd.append('ean', d.code);
    if (settings.store) fd.append('mercado', settings.store);
    fetchJson(settings.visionUrl.trim(), { method: 'POST', body: fd, credentials: 'omit', mode: 'cors' }, 25000, ctl.signal).then(function (out) {
      if (d.vctl !== ctl || draft !== d) return;
      d.vctl = null; d.vision = 'done';
      if (d.kind === 'warn') { d.kind = 'ok'; d.status = 'Lido pela foto'; }
      applyRemote(d, normalizeRemote(out), 'foto');
      finishNote(d); renderDraft();
    }, function () {
      if (d.vctl !== ctl || draft !== d) return;
      d.vctl = null; d.vision = 'error';
      d.note = 'Não consegui ler a foto agora. Digite o preço da etiqueta.';
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
    renderAll(flashId, true);
    toast(msg, function () { restore(before); });
  }

  /* inputs */
  ip.price.addEventListener('input', function () {
    if (!draft) return;
    var c = digitsToInt(ip.price.value, 7);
    draft.price = c; draft.priceTouched = true; draft.priceFrom = 'digitado';
    if (draft.note && !draft.lookingApi && draft.vision !== 'reading' && draft.mode !== 'more') draft.note = '';
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
  }
  ip.code.addEventListener('input', function () { typedCode(false); });
  ip.code.addEventListener('change', function () { typedCode(true); });
  ip.hintUse.addEventListener('click', function () {
    if (!draft || !draft.altPrice) return;
    setPrice(draft.altPrice.cents, draft.altPrice.src); draft.priceTouched = true; draft.altPrice = null;
    draft.note = 'Valor trocado. Confira com a etiqueta.';
    renderDraft();
  });
  ip.visionRead.addEventListener('click', function () { if (draft) runVision(draft); });
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
    root: $('#scanner'), video: $('#scanVideo'), frame: $('#scanFrame'), msg: $('#scanMsg'),
    close: $('#scanClose'), torch: $('#scanTorch'), zoom: $('#scanZoom'), type: $('#scanType')
  };
  var scanner = {
    open: false, paused: false, stream: null, track: null, timer: 0, session: 0, frame: 0,
    last: '', lastAt: 0, hits: 0, cooldown: { code: '', until: 0 },
    canvas: document.createElement('canvas'), torchOn: false, zoomCaps: null, zoomOn: false
  };
  function setScanMsg(text, isErr) { sc.msg.textContent = text; sc.msg.classList.toggle('err', !!isErr); }

  function canLive() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function openScanner() {
    primeAudio();
    if (!canLive()) { cam.click(); return; }
    scanner.open = true; scanner.paused = false;
    sc.root.hidden = false;
    document.documentElement.classList.add('scanning'); updateLock();
    renderTotals();
    try { sc.close.focus({ preventScroll: true }); } catch (e) {}
    startCamera();
  }
  function closeScanner() {
    scanner.open = false; scanner.paused = false;
    stopCamera();
    sc.root.hidden = true;
    document.documentElement.classList.remove('scanning'); updateLock();
    renderAll();
    try { $('#scanBtn').focus({ preventScroll: true }); } catch (e) {}
  }
  function pauseScanner() { scanner.paused = true; clearTimeout(scanner.timer); }
  function resumeScanner(code) {
    scanner.cooldown = { code: code || '', until: Date.now() + 3000 };
    scanner.hits = 0; scanner.last = ''; scanner.paused = false;
    sc.frame.classList.remove('hit');
    if (!scanner.stream) startCamera();
    else { setScanMsg('Aponte para o próximo código'); loop(); }
  }
  function stopCamera() {
    scanner.session++;
    clearTimeout(scanner.timer);
    if (scanner.stream) scanner.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    scanner.stream = null; scanner.track = null; scanner.torchOn = false; scanner.zoomOn = false;
    sc.torch.setAttribute('aria-pressed', 'false'); sc.zoom.setAttribute('aria-pressed', 'false');
    try { sc.video.srcObject = null; } catch (e) {}
  }
  function startCamera() {
    stopCamera();
    var mine = scanner.session;
    setScanMsg('Abrindo a câmera…');
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (stream) {
      if (mine !== scanner.session || !scanner.open || document.hidden) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scanner.stream = stream; scanner.track = stream.getVideoTracks()[0] || null;
      sc.video.srcObject = stream;
      var p = sc.video.play(); if (p && p.catch) p.catch(function () {});
      setupTrack();
      setScanMsg('Aponte para o código de barras');
      loop();
    }, function (e) { if (mine === scanner.session) cameraError(e); });
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
    try { caps = t && t.getCapabilities ? t.getCapabilities() : {}; } catch (e) { caps = {}; }
    sc.torch.hidden = !caps.torch;
    scanner.zoomCaps = caps.zoom && caps.zoom.max >= 1.8 ? caps.zoom : null;
    sc.zoom.hidden = !scanner.zoomCaps;
    if (t && caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
      t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
    }
  }
  sc.torch.addEventListener('click', function () {
    if (!scanner.track) return;
    var on = !scanner.torchOn;
    scanner.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      scanner.torchOn = on; sc.torch.setAttribute('aria-pressed', String(on));
    }, function () { sc.torch.hidden = true; });
  });
  sc.zoom.addEventListener('click', function () {
    if (!scanner.track || !scanner.zoomCaps) return;
    var on = !scanner.zoomOn, z = scanner.zoomCaps;
    scanner.track.applyConstraints({ advanced: [{ zoom: on ? Math.min(2, z.max) : (z.min || 1) }] }).then(function () {
      scanner.zoomOn = on; sc.zoom.setAttribute('aria-pressed', String(on));
    }, function () { sc.zoom.hidden = true; });
  });

  // Região do vídeo, em pixels do vídeo: a moldura com folga ou, a cada 3 quadros, tudo o que aparece na tela
  // (perdoa código maior que a moldura ou fora do centro).
  function cropRect(wide) {
    var v = sc.video, vw = v.videoWidth, vh = v.videoHeight;
    var vr = v.getBoundingClientRect(), fr = sc.frame.getBoundingClientRect();
    var s = Math.max(vr.width / vw, vr.height / vh);
    var offX = (vr.width - vw * s) / 2, offY = (vr.height - vh * s) / 2;
    var x, y, w, h;
    if (wide) {
      x = -offX / s; y = -offY / s; w = vr.width / s; h = vr.height / s;
    } else {
      var mx = fr.width * 0.12, my = fr.height * 0.4;
      x = (fr.left - vr.left - mx - offX) / s; y = (fr.top - vr.top - my - offY) / s;
      w = (fr.width + 2 * mx) / s; h = (fr.height + 2 * my) / s;
    }
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    if (!(w > 20 && h > 20)) return { x: 0, y: 0, w: vw, h: vh };
    return { x: x, y: y, w: w, h: h };
  }
  function decodeVideo() {
    var v = sc.video;
    if (v.readyState < 2 || !v.videoWidth) return Promise.resolve(null);
    var n = ++scanner.frame;
    var r = cropRect(n % 3 === 0), c = scanner.canvas;
    var k = Math.min(1, 960 / Math.max(r.w, r.h * 1.5));
    c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (nativeDet) return nativeDet.detect(c).then(pickNative, function () { return null; });
    var Z = window.ZXing;
    if (!Z || !Z.MultiFormatReader) return Promise.resolve(null);
    return Promise.resolve(zxDecode(Z, zxReader(Z, n % 4 === 0), c, n % 2 ? Z.HybridBinarizer : Z.GlobalHistogramBinarizer));
  }
  function loop() {
    clearTimeout(scanner.timer);
    if (!scanner.open || scanner.paused || !scanner.stream) return;
    scanner.timer = setTimeout(function () {
      if (!scanner.open || scanner.paused || !scanner.stream) return;
      decodeVideo().then(function (code) {
        if (!scanner.open || scanner.paused) return;
        if (code) onLiveCode(code); else loop();
      }, function () { loop(); });
    }, nativeDet ? 70 : 100);
  }
  function onLiveCode(raw) {
    var code = normCode(raw), now = Date.now();
    if (scanner.cooldown.code && scanner.cooldown.code === code && now < scanner.cooldown.until) { loop(); return; }
    if (code === scanner.last && now - scanner.lastAt < 1500) scanner.hits++; else scanner.hits = 1;
    scanner.last = code; scanner.lastAt = now;
    if (scanner.hits < (/^\d{8,14}$/.test(code) ? 2 : 3)) { loop(); return; }
    scanner.hits = 0;
    pauseScanner();
    beep();
    sc.frame.classList.add('hit');
    setScanMsg('Código lido');
    var shot = grabFrame();
    setTimeout(function () { sc.frame.classList.remove('hit'); }, 600);
    openNew(); draft.fromScanner = true;
    var d = draft;
    openPanel(ip.root, ip.title);
    applyCode(code, 'camera');
    shot.then(function (blob) {
      if (draft !== d || !blob) return;
      d.jpeg = blob;
      if (!d.url) d.url = URL.createObjectURL(blob);
      renderDraft();
      if (maybeVision(d)) return;
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
  sc.close.addEventListener('click', closeScanner);
  sc.type.addEventListener('click', function () { pauseScanner(); openManual(true, ip.code); });
  $('#scanBtn').addEventListener('click', openScanner);
  $('#typeBtn').addEventListener('click', function () { openManual(false); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (scanner.stream) stopCamera(); return; }
    if (scanner.open && !scanner.paused && !scanner.stream) startCamera();
    if (!trip.cart.length) renderHead();
  });
  window.addEventListener('pagehide', function () { if (scanner.stream) stopCamera(); });

  /* ---------------- options ---------------- */
  var mp = {
    root: $('#menuPanel'), title: $('#menuTitle'), close: $('#menuClose'), install: $('#menuInstall'),
    store: $('#storeInput'), budget: $('#budgetInput'), budgetClear: $('#budgetClear'),
    beep: $('#beepToggle'), catalog: $('#catalogToggle'),
    newTrip: $('#newTrip'), newConfirm: $('#newConfirm'), newSummary: $('#newSummary'), newYes: $('#newYes'), newNo: $('#newNo'),
    hist: $('#histList'), histEmpty: $('#histEmpty'), monthSum: $('#monthSum'),
    dataInfo: $('#dataInfo'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'), importFile: $('#importFile'),
    importConfirm: $('#importConfirm'), importSummary: $('#importSummary'), importYes: $('#importYes'), importNo: $('#importNo'),
    memClear: $('#memClear'), memConfirm: $('#memConfirm'), memYes: $('#memYes'), memNo: $('#memNo'),
    priceUrl: $('#priceUrlInput'), visionUrl: $('#visionUrlInput'), integrationMsg: $('#integrationMsg')
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
  }
  function fillMenu() {
    mp.store.value = settings.store;
    mp.budget.value = settings.budget ? money(settings.budget) : '';
    mp.beep.checked = !!settings.beep; mp.catalog.checked = !!settings.catalog;
    mp.priceUrl.value = settings.priceUrl; mp.visionUrl.value = settings.visionUrl;
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
  mp.priceUrl.addEventListener('change', function () { saveUrl(mp.priceUrl, 'priceUrl', 'Consulta de preço'); });
  mp.visionUrl.addEventListener('change', function () { saveUrl(mp.visionUrl, 'visionUrl', 'Leitura de etiqueta'); });

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
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ---------------- start ---------------- */
  renderAll(); renderStorageWarn(); renderInstall();
  checkPersist(standalone);
})();
