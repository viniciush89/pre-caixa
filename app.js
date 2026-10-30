/* Pré-Caixa · assistente pré-caixa do mercado (PWA)
   Tudo fica no próprio celular (localStorage). Nenhum dado sai do aparelho, exceto:
   - o código de barras enviado ao catálogo aberto Open Food Facts, para achar o nome;
   - o que você mesmo ligar em Opções > Integrações. */
(function () {
  'use strict';
  var VERSION = '1.5.0';
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

  var DEFAULTS = { store: '', budget: null, beep: true, catalog: true, priceUrl: '', installDismissed: false, cameraId: '', zoom: 0, tab: 'cart', fast: true };
  function cleanSettings(s) {
    s = Object.assign({}, DEFAULTS, s && typeof s === 'object' ? s : {});
    if (typeof s.store !== 'string') s.store = '';
    if (!(num(s.budget, 0) > 0)) s.budget = null;
    if (typeof s.priceUrl !== 'string') s.priceUrl = '';
    delete s.visionUrl;
    s.beep = s.beep !== false; s.catalog = s.catalog !== false; s.installDismissed = !!s.installDismissed;
    if (typeof s.cameraId !== 'string') s.cameraId = '';
    s.zoom = num(s.zoom, 0); if (!(s.zoom >= 1 && s.zoom <= 3)) s.zoom = 0;
    if (s.tab !== 'list') s.tab = 'cart';
    s.fast = s.fast !== false;
    return s;
  }
  function cleanTrip(t) {
    var base = { cart: [], startedAt: Date.now(), seq: 0, setup: false };
    if (!t || typeof t !== 'object' || !Array.isArray(t.cart)) return base;
    var cart = t.cart.filter(function (l) { return l && typeof l === 'object' && num(l.price, -1) >= 0; }).map(function (l) {
      return {
        id: String(l.id || uid()), seq: Math.max(0, Math.round(num(l.seq, 0))),
        code: typeof l.code === 'string' ? l.code : '', name: typeof l.name === 'string' ? l.name : '',
        unit: l.unit === 'kg' ? 'kg' : 'un', price: Math.round(l.price),
        qty: Math.max(1, Math.round(num(l.qty, 1))), grams: Math.max(1, Math.round(num(l.grams, 1000))),
        scale: !!l.scale, at: num(l.at, Date.now()),
        chk: !!l.chk, charged: num(l.charged, 0) > 0 ? Math.round(l.charged) : null, nameMiss: l.nameMiss ? 1 : 0
      };
    });
    var seq = Math.round(num(t.seq, 0));
    cart.forEach(function (l) { if (l.seq > seq) seq = l.seq; });
    return { cart: cart, startedAt: num(t.startedAt, Date.now()), seq: seq, setup: !!t.setup, check: !!t.check };
  }
  function cleanMemory(m) { return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
  // Itens de uma compra guardada: n nome, c código, u unidade, q quantidade, g gramas, p preço, t total da linha.
  function cleanItems(a) {
    if (!Array.isArray(a)) return null;
    return a.filter(function (x) { return x && typeof x.n === 'string'; }).slice(0, 200).map(function (x) {
      return { n: x.n.slice(0, 80), c: typeof x.c === 'string' ? x.c : '', u: x.u === 'kg' ? 'kg' : 'un', q: Math.max(1, Math.round(num(x.q, 1))),
        g: Math.max(1, Math.round(num(x.g, 1000))), p: Math.max(0, Math.round(num(x.p, 0))), t: Math.max(0, Math.round(num(x.t, 0))) };
    });
  }
  function cleanHistory(h) {
    return Array.isArray(h) ? h.filter(function (x) { return x && num(x.total, -1) >= 0 && num(x.at, 0) > 0; }).slice(0, 60).map(function (x) {
      var o = { at: x.at, end: num(x.end, x.at), store: typeof x.store === 'string' ? x.store : '', total: Math.round(x.total), lines: Math.max(0, Math.round(num(x.lines, 0))) };
      var items = cleanItems(x.items);
      if (items) o.items = items;
      return o;
    }) : [];
  }
  // Lista de compras: { id, text, qty, code, lineId (linha do carrinho que pegou o item), manual (marcado à mão),
  //   ac (o código veio do produto que riscou o item, não de uma escolha da pessoa) }
  function cleanList(a) {
    return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.text === 'string' && x.text.trim(); }).map(function (x) {
      return {
        id: String(x.id || uid()), text: x.text.trim().slice(0, 60), qty: Math.max(1, Math.min(99, Math.round(num(x.qty, 1)))),
        code: typeof x.code === 'string' ? x.code : '', lineId: typeof x.lineId === 'string' ? x.lineId : '', manual: !!x.manual, at: num(x.at, Date.now()),
        ac: !!x.ac
      };
    }).slice(0, 200) : [];
  }
  // O que a pessoa ensinou: item da lista (palavras) → produtos que valem (y) e que não valem (n).
  function cleanLinks(o) {
    var out = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    var keys = function (a) { return Array.isArray(a) ? a.filter(function (s) { return typeof s === 'string' && s; }).slice(0, 8) : []; };
    Object.keys(o).slice(0, 600).forEach(function (k) {
      var e = o[k];
      if (!e || typeof e !== 'object') return;
      var y = keys(e.y), n = keys(e.n);
      if (y.length || n.length) out[k] = { y: y, n: n, t: num(e.t, 0) };
    });
    return out;
  }

  var settings = cleanSettings(readStore('settings', {}));
  var trip = cleanTrip(readStore('trip', null));
  var memory = cleanMemory(readStore('memory', {}));
  var history = cleanHistory(readStore('history', []));
  var list = cleanList(readStore('list', []));
  var links = cleanLinks(readStore('links', {}));

  var memVer = 0;
  function saveTrip() { writeStore('trip', trip); }
  function saveSettings() { writeStore('settings', settings); }
  function saveMemory() { memVer++; writeStore('memory', memory); }
  function saveHistory() { writeStore('history', history); }
  function saveList() { writeStore('list', list); }
  function saveLinks() { writeStore('links', links); }

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
  // Chave do produto na memória: o código de barras ou, para item sem código, o nome.
  function memKey(code, name) { var n = normText(name); return code || (n ? 'nome:' + n : ''); }
  function ddmm(ts) { var d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  // Texto para comparar nomes: sem acento, minúsculo, número colado na unidade ("5 kg" vira "5kg").
  function normText(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/(\d)[\s.]*(kg|g|gr|ml|l|lt|un)\b/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  var wordsCache = {};
  function wordsOf(s) {
    s = String(s || '');
    return wordsCache[s] || (wordsCache[s] = normText(s).split(' ').filter(function (w) { return w.length >= 2; }));
  }
  // Mesma palavra, ou plural simples (leite/leites, ovo/ovos).
  function wordMatch(a, b) {
    if (a === b) return true;
    var sh = a.length < b.length ? a : b, lo = a.length < b.length ? b : a;
    return sh.length >= 3 && lo.length - sh.length <= 2 && lo.indexOf(sh) === 0;
  }
  /* ---------------- reconhecer o item da lista no nome do produto (sem IA) ----------------
     "leite" casa com "Leite Integral Piracanjuba 1L": toda palavra do item aparece no nome do produto,
     comparando sem plural/feminino (pães = pão, moída = moído), sem as palavras pequenas (de, em, com…),
     com sinônimos (sabão em pó = lava roupas) e tipos (refrigerante → Coca, Guaraná…).
     E não confunde produto feito do ingrediente: "leite" não risca creme de leite; "laranja" não risca suco. */
  var STOP = {};
  'de do da dos das em com sem para pra pro e o a os as ao aos no na nos nas um uma tipo'.split(' ').forEach(function (w) { STOP[w] = 1; });
  function stem(w) {
    if (/\d/.test(w)) return w;
    if (w.length >= 4 && /[oa]es$/.test(w)) return w.slice(0, -3) + 'ao';
    if (w.length >= 5 && /ais$/.test(w)) return w.slice(0, -3) + 'al';
    if (w.length >= 5 && /eis$/.test(w)) return w.slice(0, -3) + 'el';
    if (w.length >= 5 && /[rsz]es$/.test(w)) w = w.slice(0, -2);
    else if (w.length >= 4 && /s$/.test(w)) w = w.slice(0, -1);
    if (/ao$/.test(w)) return w;
    if (w.length >= 5 && /[aeo]$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  var mwCache = {};
  function mwords(s) {
    s = String(s || '');
    if (mwCache[s]) return mwCache[s];
    var t = normText(s).replace(/(\d+)\s*(?:quilos?|kilos?|kgs)\b/g, '$1kg').replace(/(\d+)\s*(?:gramas?|grs?)\b/g, '$1g').replace(/(\d+)\s*(?:litros?|lts?)\b/g, '$1l');
    return (mwCache[s] = t.split(' ').filter(function (w) { return w.length >= 2 && !STOP[w]; }).map(stem));
  }
  function phrases(s) { return s.split(',').map(function (p) { return mwords(p.trim()); }).filter(function (p) { return p.length; }); }
  function wordSet(s) { var o = {}; phrases(s).forEach(function (p) { p.forEach(function (w) { o[w] = 1; }); }); return o; }
  // Mesma coisa com outro nome (vale nos dois sentidos).
  var SAME = [
    'sabão em pó, lava roupas, lava roupa', 'sabão líquido, lava roupas líquido', 'detergente, lava louças, lava louça',
    'papel higiênico, papel hig', 'creme dental, pasta de dente, pasta dental', 'escova de dente, escova dental',
    'desodorante, antitranspirante', 'biscoito, bolacha', 'shampoo, xampu', 'iogurte, yogurte', 'água sanitária, cândida',
    'mussarela, muçarela, muzzarela, mozarela, mozzarella', 'refrigerante, refri', 'papel toalha, toalha de papel',
    'margarina, creme vegetal', 'cotonete, haste flexível', 'bombril, lã de aço', 'maisena, amido de milho', 'durex, fita adesiva'
  ].map(phrases);
  // Tipo de produto: a palavra da lista vale para qualquer um destes (só nesse sentido).
  var KINDS = {};
  [
    ['refrigerante', 'coca, coca cola, guaraná, pepsi, fanta, sprite, sukita, kuat, tubaína, schweppes'],
    ['macarrão', 'espaguete, spaghetti, penne, talharim, fusilli, miojo, lamen'],
    ['queijo', 'mussarela, muçarela, muzzarela, mozarela, parmesão, coalho, provolone, gorgonzola, cottage, ricota, cheddar, gouda, brie'],
    ['carne', 'patinho, acém, alcatra, picanha, maminha, músculo, contrafilé, fraldinha, costela, lagarto, cupim, coxão, filé mignon'],
    ['peixe', 'tilápia, salmão, merluza, pescada, bacalhau, cação, robalo, dourado, corvina, linguado'],
    ['frios', 'presunto, mortadela, salame, peito de peru, apresuntado, blanquet'],
    ['pão', 'bisnaguinha, baguete, ciabatta, broa'],
    ['achocolatado', 'nescau, toddy'],
    ['biscoito', 'oreo, negresco, passatempo, trakinas, cookie'],
    ['salgadinho', 'doritos, ruffles, cheetos, fandangos, baconzitos, pringles'],
    ['fruta', 'banana, maçã, laranja, mamão, manga, uva, pera, abacaxi, melancia, melão, morango, limão, tangerina, mexerica, kiwi, goiaba, maracujá, abacate, caqui, ameixa, pêssego'],
    ['verdura', 'alface, couve, rúcula, agrião, espinafre, repolho, brócolis, acelga, chicória, cheiro verde'],
    ['legume', 'batata, cenoura, tomate, cebola, abobrinha, chuchu, beterraba, pepino, pimentão, abóbora, inhame, aipim, mandioca, berinjela, quiabo, vagem, jiló']
  ].forEach(function (k) { KINDS[mwords(k[0])[0]] = phrases(k[1]); });
  // Ingredientes e sabores: quando o produto começa por um destes tipos (suco, iogurte, molho…), o ingrediente sozinho não vale.
  var INGR = wordSet('chocolate, baunilha, coco, leite, mel, alho, cebola, sal, galinha, frango, carne, queijo, milho, aveia, fubá, polvilho, menta, ' +
    'hortelã, canela, café, açaí, amendoim, castanha, ervilha, presunto, bacon, calabresa, camarão, peixe, ovo, água, soja, arroz, feijão, ' +
    'manteiga, hambúrguer, salsicha, gengibre, pimenta, cereja, framboesa');
  KINDS.frut.concat(KINDS.legum).forEach(function (p) { p.forEach(function (w) { INGR[w] = 1; }); });
  var HEADS = wordSet('suco, néctar, refresco, bebida, iogurte, sorvete, picolé, gelatina, geleia, bala, bolo, biscoito, bolacha, tempero, caldo, ' +
    'pão, macarrão, molho, creme, doce, extrato, polpa, farinha, amido, óleo, leite, água, chá, cereal, sopa, mistura, massa, ' +
    'manteiga, margarina, azeite, vinagre');
  // Produto diferente com nome que começa pela palavra da lista: "leite" não é leite condensado; "água" não é água sanitária.
  var COMPOUND = phrases('leite condensado, leite de coco, leite fermentado, água tônica, água sanitária, água oxigenada, água de coco, ' +
    'pão de queijo, pão de alho, pão de mel, batata palha, farinha de rosca');
  function hasAll(words, p) { return p.every(function (w) { return words.indexOf(w) >= 0; }); }
  function blocked(v, n) {
    for (var i = 0; i < COMPOUND.length; i++) {
      var c = COMPOUND[i];
      if (hasAll(n, c) && !hasAll(v, c) && c.some(function (w) { return v.indexOf(w) >= 0; })) return true;
    }
    // Ingrediente da lista que vem depois de um tipo de produto no nome ("Suco de Laranja", "Molho de Tomate").
    var at = -1;
    v.forEach(function (w) { var k = INGR[w] ? n.indexOf(w) : -1; if (k >= 0 && (at < 0 || k < at)) at = k; });
    for (var j = 0; j < at; j++) if (HEADS[n[j]] && v.indexOf(n[j]) < 0) return true;
    return false;
  }
  function indexOfSeq(q, p) {
    for (var i = 0; i + p.length <= q.length; i++) {
      var ok = true;
      for (var j = 0; j < p.length && ok; j++) ok = q[i + j] === p[j];
      if (ok) return i;
    }
    return -1;
  }
  var varCache = {};
  function variants(q) {
    var key = q.join(' ');
    if (varCache[key]) return varCache[key];
    var out = [q];
    SAME.forEach(function (g) {
      g.forEach(function (p) {
        var i = indexOfSeq(q, p);
        if (i < 0) return;
        g.forEach(function (alt) { if (alt !== p) out.push(q.slice(0, i).concat(alt, q.slice(i + p.length))); });
      });
    });
    q.forEach(function (w, i) { (KINDS[w] || []).forEach(function (alt) { out.push(q.slice(0, i).concat(alt, q.slice(i + 1))); }); });
    return (varCache[key] = out);
  }
  function nameMatches(query, name) {
    var q = mwords(query), n = mwords(name);
    if (!q.length || !n.length || blocked(q, n)) return false;
    return variants(q).some(function (v) { return hasAll(n, v) && !blocked(v, n); });
  }
  // Quantas palavras do item aparecem no nome (para pôr os mais parecidos primeiro).
  function nameScore(query, name) {
    var n = mwords(name);
    return mwords(query).filter(function (w) { return n.indexOf(w) >= 0; }).length;
  }
  // Enquanto digita: a última palavra vale como começo ("caf" acha "Café").
  function typeMatches(query, name) {
    var q = wordsOf(query).slice(), n = wordsOf(name);
    if (!q.length) return false;
    var last = q.pop();
    if (!n.some(function (x) { return x.indexOf(last) === 0; })) return false;
    return q.every(function (w) { return n.some(function (x) { return wordMatch(w, x); }); });
  }
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
    rDate: $('#rDate'), rStore: $('#rStore'), rStores: $('#rStores'), rStoresChips: $('#rStoresChips'), storageWarn: $('#storageWarn'), scanTotal: $('#scanTotal'), tagLabel: $('#tagLabel'),
    footUp: $('#footUp'), footUpL: $('#footUpL'), footUpV: $('#footUpV'), footDown: $('#footDown'), footDownL: $('#footDownL'), footDownV: $('#footDownV')
  };

  // Faixas do orçamento: amarelo até 75%, laranja até 90%, vermelho até o limite, vermelho listrado depois.
  var LEVEL_RANK = { none: 0, ok: 0, near: 1, close: 2, over: 3 };
  var shownLevel = null;
  function budgetLevel(total, b) {
    if (!b) return 'none';
    var r = total / b;
    return r > 1 ? 'over' : r >= 0.9 ? 'close' : r >= 0.75 ? 'near' : 'ok';
  }
  var mini = { root: $('#mini'), btn: $('#miniBtn'), total: $('#miniTotal'), info: $('#miniInfo') };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      var e = es[es.length - 1];
      mini.root.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0);
    }, { threshold: 0 }).observe(el.tag);
  }
  mini.btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });
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
    mini.root.dataset.level = lvl;
    mini.total.textContent = brl(total);
    mini.info.textContent = !b ? plural(n, 'item', 'itens') : total > b ? 'passou ' + brl(total - b) : 'faltam ' + brl(b - total);
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
    var anchor = mini.root.classList.contains('show') ? mini.root : el.top;
    ba.root.style.top = scanner.open ? '' : Math.max(8, Math.round(anchor.getBoundingClientRect().bottom + 6)) + 'px';
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

  // Última compra antes desta (ignora o que já entrou no carrinho de agora).
  function lastBefore(code, before) {
    var m = memory[code];
    if (!m) return null;
    if (!Array.isArray(m.h)) return m.p > 0 && (m.t || 0) < before ? [m.p, m.t, m.s || ''] : null;
    for (var i = 0; i < m.h.length; i++) if (m.h[i][1] < before) return m.h[i];
    return null;
  }
  function cheapestBefore(code, before, days) {
    var m = memory[code], since = Date.now() - days * 864e5, best = null;
    if (!m || !Array.isArray(m.h)) return null;
    m.h.forEach(function (e) { if (e[1] < before && e[1] >= since && (!best || e[0] < best[0])) best = e; });
    return best;
  }
  function tripStart() { return trip.cart.length ? trip.startedAt : Date.now(); }
  // Diferença de preço de uma linha do carrinho em relação à última compra.
  function deltaFor(l) {
    var key = memKey(l.code, l.name);
    if (!key || l.scale) return null;
    var m = memory[key];
    if (!m || (m.u || 'un') !== l.unit) return null;
    var prev = lastBefore(key, trip.startedAt);
    if (!prev || prev[0] === l.price) return null;
    var units = l.unit === 'kg' ? l.grams / 1000 : l.qty;
    return { d: l.price - prev[0], total: Math.round((l.price - prev[0]) * units), prev: prev };
  }

  // Na conferência do caixa, tocar na linha marca como conferida; "Cobrou outro valor?" abre o valor do caixa.
  var ckEdit = '';
  function renderCart(flashId) {
    var ol = el.lines, has = trip.cart.length > 0, ups = 0, upSum = 0, downs = 0, downSum = 0, ck = !!trip.check && has;
    ol.textContent = '';
    ol.classList.toggle('checking', ck);
    el.empty.hidden = has; el.cols.hidden = !has; el.foot.hidden = !has;
    fin.box.hidden = !has; if (!has) fin.confirm.hidden = true;
    trip.cart.forEach(function (l) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'line'; b.dataset.id = l.id;
      var lt = lineTotal(l), dl = deltaFor(l), calc = span('calc', calcText(l)), lead;
      if (dl) {
        if (!ck) calc.append(' ', span('delta ' + (dl.d > 0 ? 'up' : 'down'), (dl.d > 0 ? '▲ ' : '▼ ') + money(Math.abs(dl.d))));
        if (dl.d > 0) { ups++; upSum += dl.total; } else { downs++; downSum -= dl.total; }
      }
      var spoken = displayName(l) + ', ' + (l.unit === 'kg' ? kg(l.grams) + ' quilo a ' + brl(l.price) + ' o quilo' : l.qty + ' a ' + brl(l.price)) + ', total ' + brl(lt);
      if (ck) {
        lead = span('ck-box', ''); lead.innerHTML = CHECK_SVG;
        var diff = l.charged != null && l.charged !== l.price;
        if (diff) calc.append(' ', span('charged ' + (l.charged > l.price ? 'up' : 'down'), 'caixa ' + money(l.charged)));
        b.setAttribute('aria-pressed', String(!!l.chk));
        b.setAttribute('aria-label', spoken + (diff ? ', o caixa cobrou ' + brl(l.charged) : '') + '. ' + (l.chk ? 'Conferido.' : 'Toque quando o caixa passar este item.'));
        li.className = 'ck-li';
      } else {
        lead = span('seq', String(l.seq).padStart(3, '0'));
        b.setAttribute('aria-label', spoken + (dl ? (dl.d > 0 ? ', subiu ' : ', baixou ') + brl(Math.abs(dl.d)) + ' desde a última compra' : '') + '. Toque para editar.');
      }
      b.append(lead, span('desc', displayName(l)), calc, span('sub', money(lt)));
      if (l.id === flashId) b.classList.add('flash');
      li.appendChild(b);
      if (ck) {
        var o = document.createElement('button');
        o.type = 'button'; o.className = 'ck-other' + (l.charged != null && l.charged !== l.price ? ' set' : ''); o.dataset.id = l.id;
        o.textContent = l.charged != null && l.charged !== l.price ? 'Caixa cobrou ' + brl(l.charged) + (l.unit === 'kg' ? '/kg' : '') + ' · mudar' : 'Cobrou outro valor?';
        o.setAttribute('aria-expanded', String(ckEdit === l.id));
        o.setAttribute('aria-label', 'Valor cobrado no caixa para ' + displayName(l));
        li.appendChild(o);
      }
      ol.appendChild(li);
      if (ck && ckEdit === l.id) ol.appendChild(chargedEditor(l));
    });
    el.footUp.hidden = !ups; el.footDown.hidden = !downs;
    if (ups) { el.footUpL.textContent = plural(ups, 'item mais caro', 'itens mais caros') + ' que da última vez'; el.footUpV.textContent = '+' + money(upSum); }
    if (downs) { el.footDownL.textContent = plural(downs, 'item mais barato', 'itens mais baratos') + ' que da última vez'; el.footDownV.textContent = '−' + money(downSum); }
    renderCheck(); renderLast();
  }

  function renderHead() {
    var ts = trip.cart.length ? trip.startedAt : Date.now();
    el.rDate.textContent = dmy(ts) + ' ' + hm(ts);
    el.rStore.textContent = settings.store || 'Informar mercado';
    el.rStore.hidden = !settings.store;
    el.rStores.hidden = !!settings.store;
    if (!settings.store) renderStoreChips(el.rStoresChips, true);
  }

  function renderAll(flashId, bump, alert) {
    renderTotals(bump, alert); renderCart(flashId); renderHead(); renderList();
    if (flashId && !scanner.open) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function renderStorageWarn() { el.storageWarn.hidden = storageOk; }

  function lineById(id) { return trip.cart.filter(function (l) { return l.id === id; })[0] || null; }
  function refocusLine(sel) {
    var n = el.lines.querySelector(sel);
    if (n) { try { n.focus({ preventScroll: true }); } catch (e) {} }
  }
  function saveCharged(l, cents) {
    l.charged = cents && cents !== l.price ? cents : null;
    l.chk = true; ckEdit = '';
    saveTrip(); renderCart();
    refocusLine('button.line[data-id="' + l.id + '"]');
  }
  el.lines.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !el.lines.contains(b)) return;
    var l = lineById(b.dataset.id);
    if (!l) return;
    if (b.classList.contains('ck-other')) {
      ckEdit = ckEdit === l.id ? '' : l.id;
      renderCart();
      var inp = $('#chargedInput');
      if (inp) { try { inp.focus(); } catch (x) {} }
      else refocusLine('button.ck-other[data-id="' + l.id + '"]');
      return;
    }
    if (b.classList.contains('ck-save')) { saveCharged(l, digitsToInt(($('#chargedInput') || {}).value, 7)); return; }
    if (b.classList.contains('ck-same')) { saveCharged(l, null); return; }
    if (!b.classList.contains('line')) return;
    if (trip.check) {
      l.chk = !l.chk; if (ckEdit === l.id) ckEdit = '';
      saveTrip(); renderCart();
      refocusLine('button.line[data-id="' + l.id + '"]');
      return;
    }
    openEdit(l.id);
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
    busyBar: $('#busyBar'), retake: $('#retake'), ph: $('#priceHist'), phDiff: $('#phDiff'), phLast: $('#phLast'), phBest: $('#phBest'),
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
      lookingCatalog: false, lookingApi: false, catalogResult: '',
      listPick: '', listCur: ''
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
    if (d.code || d.mode === 'edit' || !ip.name.value.trim()) ns.hidden = true;
    renderPriceHist(d);
    renderListPick();
    renderCalc();
  }

  // "Esse preço subiu?": compara com a última compra e com o menor preço visto nos últimos 90 dias.
  function renderPriceHist(d) {
    var code = memKey(d.code, d.name), m = code && !d.scale ? memory[code] : null, before = tripStart();
    var prev = m ? lastBefore(code, before) : null;
    if (!prev) { ip.ph.hidden = true; return; }
    ip.ph.hidden = false;
    var unitTxt = (m.u || 'un') === 'kg' ? '/kg' : '';
    ip.phLast.textContent = 'Última compra: ' + brl(prev[0]) + unitTxt + ' em ' + ddmm(prev[1]) + (prev[2] ? ' · ' + prev[2] : '');
    var kind = '', text = '';
    var checked = d.priceTouched || d.priceFrom === 'api' || d.priceFrom === 'balanca';
    if (d.price > 0 && checked && (m.u || 'un') === d.unit) {
      var delta = d.price - prev[0], pct = prev[0] ? Math.abs(delta) / prev[0] * 100 : 0;
      var pctTxt = pct >= 0.05 ? ' (' + (delta > 0 ? '+' : '−') + pct.toFixed(1).replace('.', ',') + '%)' : '';
      if (delta > 0) { kind = 'up'; text = 'Subiu ' + brl(delta) + pctTxt + ' desde a última compra'; }
      else if (delta < 0) { kind = 'down'; text = 'Baixou ' + brl(-delta) + pctTxt + ' desde a última compra'; }
      else { kind = 'same'; text = 'Mesmo preço da última compra'; }
    }
    ip.phDiff.textContent = text; ip.phDiff.hidden = !text; ip.phDiff.dataset.kind = kind;
    var best = cheapestBefore(code, before, 90), cur = d.price > 0 ? d.price : prev[0];
    if (best && best[0] < cur) {
      var where = best[2] ? (settings.store && sameStore(best[2], settings.store) ? ' aqui' : ' no ' + best[2]) : '';
      ip.phBest.textContent = 'Mais barato visto: ' + brl(best[0]) + unitTxt + where + ' em ' + ddmm(best[1]);
      ip.phBest.hidden = false;
    } else ip.phBest.hidden = true;
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
    setStatus(draft, 'idle', fromScanner ? 'Digite o código ou o preço' : 'Item sem código',
      fromScanner ? 'Digite o preço que está na etiqueta.' : 'Escreva o nome: o que você já comprou aparece para escolher, com o preço.');
    renderDraft();
    openPanel(ip.root, focusEl || (fromScanner ? ip.price : ip.name));
  }
  function openEdit(id) {
    var l = trip.cart.find(function (x) { return x.id === id; }); if (!l) return;
    draft = makeDraft('edit');
    Object.assign(draft, {
      lineId: id, code: l.code, scale: l.scale ? (scaleOf(l.code) || { key: '', cents: l.price }) : null,
      name: l.name, nameTouched: true, price: l.price, priceTouched: true, priceFrom: 'digitado', unit: l.unit, unitUser: true,
      qty: l.qty, grams: l.grams
    });
    var cur = list.filter(function (x) { return x.lineId === id; })[0];
    draft.listPick = draft.listCur = cur ? cur.id : '';
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
        if (n && !d.nameTouched && (!d.name || d.nameFrom === 'lista')) setName(n, 'catalogo');
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
      d.memNote = other ? 'Último preço é do ' + m.s + '. Aqui pode ser outro: confira na etiqueta.' : 'Último preço salvo. Confira na etiqueta.';
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
    var key = memKey(d.code, name);
    if (!key) return;
    var now = Date.now();
    if (d.scale) {
      if (name && d.scale.key) { memory[d.scale.key] = { n: name, t: now, s: settings.store || '' }; saveMemory(); }
      return;
    }
    // Histórico por produto: [preço, quando, mercado], o mais novo primeiro. Uma entrada por compra.
    var prev = memory[key], store = settings.store || '';
    var h = prev && Array.isArray(prev.h) ? prev.h.slice() : (prev && prev.p > 0 ? [[prev.p, prev.t || now, prev.s || '']] : []);
    if (h.length && h[0][1] >= trip.startedAt) h[0] = [d.price, now, store];
    else h.unshift([d.price, now, store]);
    var entry = { n: name || (prev && prev.n) || '', p: d.price, u: d.unit, t: now, s: store, c: ((prev && prev.c) || 0) + (d.mode === 'new' ? 1 : 0), h: h.slice(0, 8) };
    if (d.unit === 'kg') entry.g = d.grams;
    memory[key] = entry;
    var keys = Object.keys(memory);
    if (keys.length > 3000) {
      keys.sort(function (a, b) { return (memory[a].t || 0) - (memory[b].t || 0); });
      keys.slice(0, keys.length - 3000).forEach(function (k) { delete memory[k]; });
    }
    saveMemory();
  }

  var askedPersist = false;
  function commitDraft() {
    var d = draft; if (!d) return;
    var lt = draftLineTotal(d);
    if (lt == null || !(d.price > 0)) return;
    var before = snapshot(), name = (d.name || '').trim(), flashId = null, msg = '', i = -1, l, line = null;
    if (d.mode === 'more') {
      i = trip.cart.findIndex(function (x) { return x.id === d.existingId; });
      if (i < 0) d.mode = 'new';
    }
    if (d.mode === 'new') {
      if (!trip.cart.length) trip.startedAt = Date.now();
      trip.seq += 1;
      l = { id: uid(), seq: trip.seq, code: d.code, name: name, unit: d.unit, price: d.price,
        qty: d.unit === 'un' ? d.qty : 1, grams: d.unit === 'kg' ? d.grams : 1000, scale: !!d.scale, at: Date.now() };
      trip.cart.unshift(l); flashId = l.id; line = l;
      msg = displayName(l) + ' · ' + brl(lineTotal(l));
    } else if (d.mode === 'more') {
      var m = mergedLine(trip.cart[i], d);
      if (name) m.name = name;
      m.at = Date.now();
      trip.cart.splice(i, 1); trip.cart.unshift(m); flashId = m.id; line = m;
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
    var crossed = null;
    if (d.mode === 'new' && line) {
      if (d.listPick === 'none') { var pred = findListItem(line, openListItems()); if (pred) learnLink(pred.text, prodKey(line), false); }
      else if (d.listPick) crossed = linkTo(d.listPick, line);
      else crossed = linkList(line);
    } else if (d.mode === 'more' && line) crossed = linkList(line);
    else if (d.mode === 'edit' && l) {
      // Editar também risca: nome novo, ou item da lista escolhido na tela.
      var cur = list.filter(function (x) { return x.lineId === l.id; })[0];
      if (d.listPick === 'none') { if (cur) { unlinkItem(cur); learnLink(cur.text, prodKey(l), false); saveList(); } }
      else if (d.listPick && (!cur || cur.id !== d.listPick)) crossed = linkTo(d.listPick, l);
      else if (!cur) crossed = linkList(l);
    }
    if (crossed) msg += ' · ' + crossedText(crossed);
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
  // Tocar num valor já preenchido seleciona tudo: o que for digitado substitui, não emenda.
  // Seleciona na hora do foco, de novo logo depois (o iPhone desfaz a seleção) e no clique, até a pessoa digitar.
  function selectAllNow(input) { try { input.setSelectionRange(0, input.value.length); } catch (e) {} }
  function selectOnTap(input, when) {
    input.addEventListener('focus', function () {
      input._sel = when() ? input.value : null;
      if (input._sel == null) return;
      selectAllNow(input);
      setTimeout(function () { if (document.activeElement === input && input.value === input._sel) selectAllNow(input); }, 0);
    });
    input.addEventListener('click', function () {
      if (input._sel != null && input.value === input._sel) selectAllNow(input);
      input._sel = null;
    });
  }
  function hasValue(input) { return function () { return !!input.value; }; }
  selectOnTap(ip.price, function () { return !!(draft && !draft.priceTouched && ip.price.value); });
  ip.price.addEventListener('focus', function () { if (draft && draft.priceTouched) setTimeout(function () { caretEnd(ip.price); }, 0); });
  selectOnTap(ip.qty, hasValue(ip.qty));
  selectOnTap(ip.grams, hasValue(ip.grams));
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
  ip.name.addEventListener('input', function () { if (!draft) return; draft.name = ip.name.value.slice(0, 80); draft.nameTouched = true; draft.nameFrom = 'digitado'; renderNameSugg(); renderPriceHist(draft); renderListPick(); });
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
    votes: {}, votesAt: 0, block: null, since: 0, seenAt: 0, hint: 0, seenT: 0,
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
    hideFast();
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
    blockCode(code);
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
  // O mesmo produto só conta de novo depois de sair da câmera (quase 1 s sem aparecer).
  function blockCode(code) { var now = Date.now(); scanner.block = code ? { code: code, at: now, seen: now } : null; }
  function onCandidate(hit) {
    var code = normCode(hit.code), now = Date.now(), bl = scanner.block;
    if (bl && bl.code === code) {
      if (now - bl.seen < 900 || now - bl.at < 1500) { bl.seen = now; return false; }
      scanner.block = null;
    }
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
    setTimeout(function () { sc.frame.classList.remove('hit'); }, 600);
    if (settings.fast && fastAdd(code)) {
      blockCode(code);
      scanner.paused = false; scanner.since = Date.now(); scanner.hint = -1;
      setScanMsg(fast.mode === 'ask' ? 'Esse já está no carrinho.' : 'Adicionado. Aponte para o próximo.');
      loop();
      return;
    }
    hideFast();
    setScanMsg('Código lido');
    var shot = grabFrame();
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
  // Modo rápido: produto com preço salvo (ou já no carrinho) entra direto, sem abrir a tela do item.
  var fast = { root: $('#fastCard'), name: $('#fastName'), info: $('#fastInfo'), undo: $('#fastUndo'), edit: $('#fastEdit'), timer: 0, before: null, lineId: '' };
  function fastCandidate(code) {
    var inCart = trip.cart.filter(function (l) { return l.code === code; })[0];
    if (inCart) return inCart.unit === 'un' && !inCart.scale ? { line: inCart } : null;
    var lab = scaleOf(code);
    if (lab) return lab.cents > 0 ? { price: lab.cents, name: (memory[lab.key] && memory[lab.key].n) || '', scale: true } : null;
    var m = memory[code];
    return m && m.p > 0 && (m.u || 'un') === 'un' ? { price: m.p, name: m.n || '', m: m } : null;
  }
  function fastAdd(code) {
    var f = fastCandidate(code);
    if (!f) return false;
    // Já está no carrinho: não soma sozinho (a câmera pode passar de novo pelo produto no carrinho); pergunta com um toque.
    if (f.line) { askMore(f.line); return true; }
    var before = snapshot(), line, more = false;
    if (more) {
      line = f.line; line.qty = Math.min(999, line.qty + 1); line.at = Date.now();
      trip.cart.splice(trip.cart.indexOf(line), 1); trip.cart.unshift(line);
    } else {
      if (!trip.cart.length) trip.startedAt = Date.now();
      trip.seq += 1;
      line = { id: uid(), seq: trip.seq, code: code, name: f.name, unit: 'un', price: f.price, qty: 1, grams: 1000, scale: !!f.scale, at: Date.now() };
      trip.cart.unshift(line);
      if (f.m) { f.m.c = (f.m.c || 0) + 1; saveMemory(); }
    }
    var crossed = linkList(line);
    saveTrip();
    renderAll(line.id, true, true);
    var info = (more ? line.qty + ' no carrinho · ' : '') + brl(line.price);
    if (f.m && f.m.s && settings.store && !sameStore(f.m.s, settings.store)) info += ' · preço do ' + f.m.s + ', confira';
    else if (f.m && Date.now() - (f.m.t || 0) > 30 * 864e5) info += ' · preço de ' + ddmm(f.m.t) + ', confira';
    if (crossed) info += ' · ' + crossedText(crossed);
    fast.before = before; fast.lineId = line.id; fast.mode = 'added';
    fast.undo.textContent = 'Desfazer';
    fast.name.textContent = displayName(line);
    fast.info.textContent = info;
    fast.root.hidden = false;
    fast.root.classList.remove('pop'); void fast.root.offsetWidth; fast.root.classList.add('pop');
    clearTimeout(fast.timer);
    fast.timer = setTimeout(hideFast, 6000);
    return true;
  }
  function askMore(line) {
    fast.before = null; fast.lineId = line.id; fast.mode = 'ask';
    fast.undo.textContent = 'Mais 1';
    fast.name.textContent = displayName(line);
    fast.info.textContent = 'Já está no carrinho: ' + line.qty + ' × ' + brl(line.price);
    fast.root.hidden = false;
    fast.root.classList.remove('pop'); void fast.root.offsetWidth; fast.root.classList.add('pop');
    clearTimeout(fast.timer);
    fast.timer = setTimeout(hideFast, 6000);
  }
  function hideFast() { clearTimeout(fast.timer); fast.root.hidden = true; fast.before = null; }
  fast.undo.addEventListener('click', function () {
    if (fast.mode === 'ask') {
      var line = trip.cart.filter(function (l) { return l.id === fast.lineId; })[0];
      if (!line) { hideFast(); return; }
      var before = snapshot();
      line.qty = Math.min(999, line.qty + 1); line.at = Date.now();
      trip.cart.splice(trip.cart.indexOf(line), 1); trip.cart.unshift(line);
      saveTrip(); renderAll(line.id, true, true);
      fast.before = before; fast.mode = 'added';
      fast.undo.textContent = 'Desfazer';
      var li = list.filter(function (x) { return x.lineId === line.id; })[0];
      fast.info.textContent = line.qty + ' no carrinho · ' + brl(line.price) + ' cada' + (li ? ' · ' + crossedText(li) : '');
      clearTimeout(fast.timer); fast.timer = setTimeout(hideFast, 6000);
      return;
    }
    var b = fast.before;
    if (!b) return;
    hideFast();
    restore(b, 'Desfeito.');
  });
  fast.edit.addEventListener('click', function () {
    var id = fast.lineId;
    hideFast();
    if (!trip.cart.some(function (l) { return l.id === id; })) return;
    pauseScanner();
    openEdit(id);
    if (draft) draft.fromScanner = true;
  });

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
  $('#scanBtn').addEventListener('click', function () { begin(openScanner); });
  $('#typeBtn').addEventListener('click', function () { begin(function () { openManual(false); }); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (scanner.stream) stopCamera(); return; }
    if (scanner.open) keepAwake(true);
    if (scanner.open && !scanner.paused && !scanner.stream) startCamera();
    if (!trip.cart.length) renderHead();
  });
  window.addEventListener('pagehide', function () { if (scanner.stream) stopCamera(); });

  /* ---------------- lista de compras ---------------- */
  var lv = {
    tabCart: $('#tabCart'), tabList: $('#tabList'), nCart: $('#tabCartN'), nList: $('#tabListN'),
    cartView: $('#cartView'), listView: $('#listView'), peek: $('#listPeek'), peekText: $('#listPeekText'),
    form: $('#listForm'), input: $('#listInput'), sugg: $('#listSugg'), items: $('#listItems'), empty: $('#listEmpty'),
    foot: $('#listFoot'), fCart: $('#lfCart'), fPend: $('#lfPend'), fTotal: $('#lfTotal'), fNote: $('#lfNote'), clear: $('#listClearDone'),
    scan: $('#scanList')
  };
  var tab = settings.tab;
  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4L18.5 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var DEL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';

  /* O app aprende: quando a pessoa liga um item da lista a um produto (ou diz "não era esse"), guarda para a próxima vez. */
  function listKey(text) { return mwords(text).join(' '); }
  // Identidade do produto: código de barras, etiqueta de balança (sem o preço) ou nome, para item sem código.
  function prodKey(l) { var sc = l.scale && scaleOf(l.code || ''); return sc ? sc.key : memKey(l.code, l.name); }
  function taught(text, pk) {
    var e = pk && links[listKey(text)];
    return !e ? 0 : e.y.indexOf(pk) >= 0 ? 1 : e.n.indexOf(pk) >= 0 ? -1 : 0;
  }
  function learnLink(text, pk, ok) {
    var k = listKey(text);
    if (!k || !pk) return;
    var e = links[k] || (links[k] = { y: [], n: [], t: 0 });
    var add = ok ? e.y : e.n, rem = ok ? e.n : e.y, i = rem.indexOf(pk);
    if (i >= 0) rem.splice(i, 1);
    i = add.indexOf(pk);
    if (i >= 0) add.splice(i, 1);
    add.unshift(pk); add.splice(8);
    e.t = Date.now();
    var ks = Object.keys(links);
    if (ks.length > 500) {
      ks.sort(function (a, b) { return links[a].t - links[b].t; });
      ks.slice(0, ks.length - 500).forEach(function (x) { delete links[x]; });
    }
    saveLinks(); memCache = {};
  }

  // Preço de referência de um item da lista: pelo código, pelo produto ensinado, ou o salvo mais recente com o mesmo nome.
  var memCache = {};
  function memFor(it) {
    if (it.code && memory[it.code] && memory[it.code].p > 0) return memory[it.code];
    var ck = it.text + '|' + it.code, c = memCache[ck];
    if (c && c.v === memVer) return c.m;
    var e = links[listKey(it.text)], best = null;
    if (e) for (var i = 0; i < e.y.length && !best; i++) { var t = memory[e.y[i]]; if (t && t.p > 0) best = t; }
    if (!best) {
      for (var k in memory) {
        var m = memory[k];
        if (!m || !(m.p > 0) || !m.n || k.indexOf('balanca:') === 0) continue;
        if ((!best || (m.t || 0) > (best.t || 0)) && (!e || e.n.indexOf(k) < 0) && nameMatches(it.text, m.n)) best = m;
      }
    }
    memCache[ck] = { v: memVer, m: best };
    return best;
  }
  function unitEstimate(m) { return m.u === 'kg' ? Math.round(m.p * (m.g || 1000) / 1000) : m.p; }

  function listRows() {
    var inCart = {};
    trip.cart.forEach(function (l) { inCart[l.id] = l; });
    return list.map(function (it) {
      var line = it.lineId ? inCart[it.lineId] || null : null;
      var got = line ? (line.unit === 'kg' ? it.qty : Math.min(it.qty, line.qty)) : 0;
      var done = it.manual || got >= it.qty;
      var m = done ? null : memFor(it);
      return { it: it, line: line, got: got, done: done, m: m, each: m ? unitEstimate(m) : null, rest: done ? 0 : it.qty - got };
    });
  }
  function listSummary(rows) {
    var s = { pending: 0, est: 0, unknown: 0, done: 0 };
    rows.forEach(function (r) {
      if (r.done) { s.done++; return; }
      s.pending++;
      if (r.each != null) s.est += r.each * r.rest; else s.unknown++;
    });
    s.forecast = cartTotal(trip.cart) + s.est;
    return s;
  }

  // Qual item da lista este produto risca: pelo código, pelo que a pessoa ensinou, depois pelo nome
  // (o nome mais completo ganha: "leite integral" antes de "leite"). Nunca o que a pessoa disse que não era.
  function findListItem(line, items) {
    var pk = prodKey(line), lk = memKey(line.code, line.name), best = null, score = 0;
    items.forEach(function (it) {
      var t = taught(it.text, pk), s = 0;
      if (t < 0) return;
      if (it.code && (it.code === lk || it.code === pk)) s = 3;
      else if (t > 0) s = 2;
      else if (line.name && nameMatches(it.text, line.name)) s = 1 + mwords(it.text).length / 100;
      if (s > score) { best = it; score = s; }
    });
    return best;
  }
  function openListItems() { return listRows().filter(function (r) { return !r.done && !r.line; }).map(function (r) { return r.it; }); }
  // Item que acabou de entrar no carrinho risca o item da lista que bate.
  function linkList(line) {
    if (!list.length || list.some(function (it) { return it.lineId === line.id; })) return null;
    var hit = findListItem(line, openListItems());
    if (!hit) return null;
    hit.lineId = line.id; hit.manual = false;
    if (!hit.code) { hit.code = prodKey(line); hit.ac = true; }
    saveList();
    return hit;
  }
  // Ligação escolhida pela pessoa (na tela do item ou em "Foi um destes?"): liga e aprende.
  function linkTo(itemId, line) {
    var it = list.filter(function (x) { return x.id === itemId; })[0];
    if (!it) return null;
    list.forEach(function (x) { if (x !== it && x.lineId === line.id) x.lineId = ''; });
    it.lineId = line.id; it.manual = false;
    var pk = prodKey(line);
    if (!it.code || it.ac) { it.code = pk; it.ac = true; }
    learnLink(it.text, pk, true);
    saveList();
    return it;
  }
  function unlinkItem(it) {
    it.lineId = '';
    if (it.ac) { it.code = ''; it.ac = false; }
  }
  // Para os avisos: 'riscou “café” da lista' ou '“leite”: 1 de 2 da lista' (sem repetir o nome quando é o mesmo do produto).
  function sameName(it, line) { return !!(line && line.name) && normText(it.text) === normText(line.name); }
  function crossedText(it) {
    var r = listRows().filter(function (x) { return x.it === it; })[0];
    if (!r) return '';
    var what = sameName(it, r.line) ? '' : '“' + it.text + '” ';
    return r.done ? (what ? 'riscou ' + what + 'da lista' : 'riscado da lista') : (what ? what.trim() + ': ' : '') + r.got + ' de ' + it.qty + ' da lista';
  }

  // "2 leite", "2x leite", "3 un leite"; no fim, "leite x2", "leite 2x", "leite (2)". "1 kg de feijão" é peso, não quantidade.
  function parseListText(raw) {
    raw = String(raw || '').trim();
    var m = /^(\d{1,2})\s*(?:x|×|un\.?|unid\.?|unidades?)?\s*\s(.+)$/i.exec(raw) || /^(\d{1,2})\s*(?:x|×)\s*(.+)$/i.exec(raw);
    if (m && /^(kg|g|gr|grs|gramas?|quilos?|kilos?|l|lt|litros?|ml)\b/i.test(m[2])) m = null;
    if (m) return { qty: Math.max(1, +m[1]), text: m[2].trim() };
    var e = /^(.+?)\s+[x×]\s*(\d{1,2})$/i.exec(raw) || /^(.+?)\s+(\d{1,2})\s*[x×]$/i.exec(raw) || /^(.+?)\s*\((\d{1,2})\)$/.exec(raw);
    if (e && +e[2] >= 1) return { qty: +e[2], text: e[1].replace(/[\s\-–:,]+$/, '') };
    return { qty: 1, text: raw };
  }
  function addToList(text, code, qty) {
    text = text.trim().slice(0, 60);
    var key = normText(text);
    var same = listRows().filter(function (r) { return !r.done && ((code && r.it.code === code) || normText(r.it.text) === key); })[0];
    if (same) { same.it.qty = Math.min(99, same.it.qty + qty); saveList(); return same.it; }
    var it = { id: uid(), text: text, qty: qty, code: code || '', lineId: '', manual: false, at: Date.now() };
    list.push(it); saveList();
    return it;
  }
  // Lista colada ou "Comprar de novo": se o item já está na lista, fica a maior quantidade (não soma de novo);
  // se já foi pego nesta compra, não entra de novo.
  function ensureInList(text, code, qty) {
    text = String(text || '').trim().slice(0, 60);
    if (!text) return null;
    var key = normText(text), rows = listRows();
    var match = function (r) { return (code && r.it.code === code) || normText(r.it.text) === key; };
    var same = rows.filter(function (r) { return !r.done && match(r); })[0];
    if (same) { same.it.qty = Math.max(same.it.qty, Math.min(99, qty)); saveList(); return same.it; }
    if (rows.some(function (r) { return r.done && match(r); })) return null;
    return addToList(text, code, Math.min(99, qty));
  }

  // Sugestões: produtos já comprados, primeiro os mais frequentes.
  function suggestions(q) {
    var inList = {};
    list.forEach(function (it) { if (it.code) inList[it.code] = 1; inList['n:' + normText(it.text)] = 1; });
    var keys = Object.keys(memory).filter(function (k) {
      var m = memory[k];
      return k.indexOf('balanca:') !== 0 && m && m.n && m.p > 0 && !inList[k] && !inList['n:' + normText(m.n)] && (!q || typeMatches(q, m.n));
    });
    keys.sort(function (a, b) { return ((memory[b].c || 0) - (memory[a].c || 0)) || ((memory[b].t || 0) - (memory[a].t || 0)); });
    return keys.slice(0, q ? 6 : 8);
  }
  function renderSugg() {
    var raw = lv.input.value.trim(), q = raw ? parseListText(raw).text : '';
    var keys = suggestions(q);
    lv.sugg.textContent = '';
    lv.sugg.hidden = !keys.length;
    if (!keys.length) return;
    lv.sugg.appendChild(span('np-sugg-label', q ? 'Já comprados' : 'Mais comprados'));
    keys.forEach(function (k) {
      var m = memory[k], b = document.createElement('button');
      b.type = 'button'; b.className = 'np-chip'; b.dataset.code = k;
      b.append(span('np-chip-name', m.n), span('np-chip-price', money(m.p) + (m.u === 'kg' ? '/kg' : '')));
      lv.sugg.appendChild(b);
    });
  }

  // Produtos do carrinho que ainda não riscaram nada da lista, os mais parecidos com o item primeiro.
  function freeLines(text) {
    var used = {};
    list.forEach(function (x) { if (x.lineId) used[x.lineId] = 1; });
    return trip.cart.filter(function (l) { return !used[l.id] && taught(text, prodKey(l)) >= 0; })
      .map(function (l, i) { return { l: l, s: nameScore(text, l.name || ''), i: i }; })
      .sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); })
      .slice(0, 3).map(function (x) { return x.l; });
  }
  function listRow(r) {
    var it = r.it, li = document.createElement('li');
    li.className = 'np-row' + (r.done ? ' done' : r.got ? ' part' : '');
    li.dataset.id = it.id;
    var chk = document.createElement('button');
    chk.type = 'button'; chk.className = 'np-check'; chk.dataset.act = 'check'; chk.innerHTML = CHECK_SVG;
    chk.setAttribute('aria-pressed', String(r.done));
    chk.setAttribute('aria-label', (r.done ? 'Desmarcar ' : 'Marcar como pego: ') + it.text);
    var sub;
    if (r.done && r.line) sub = 'No carrinho' + (sameName(it, r.line) ? '' : ': ' + displayName(r.line)) + ' · ' + brl(lineTotal(r.line));
    else if (r.done) sub = 'Marcado à mão';
    else if (r.got) sub = r.got + ' de ' + it.qty + ' no carrinho' + (sameName(it, r.line) ? '' : ' (' + displayName(r.line) + ')') + (r.each != null ? ' · falta ≈ ' + brl(r.each * r.rest) : '');
    else if (r.each != null) sub = '≈ ' + brl(r.each) + (it.qty > 1 ? ' cada' : '') + (r.m.u === 'kg' ? ' (' + kg(r.m.g || 1000) + ' kg)' : '') + ' · ' + (r.m.s ? r.m.s + ', ' : '') + ddmm(r.m.t);
    else sub = 'Sem preço salvo ainda';
    var txt = document.createElement('div');
    txt.className = 'np-text';
    txt.append(span('np-name', (it.qty > 1 ? it.qty + ' × ' : '') + it.text), span('np-sub', sub));
    // Marcado à mão com produtos soltos no carrinho: "Foi um destes?" ensina o app.
    var fl = r.done && it.manual && !r.line ? freeLines(it.text) : [];
    if (fl.length) {
      var pair = document.createElement('div');
      pair.className = 'np-pair';
      pair.appendChild(span('np-pair-label', 'Foi um destes?'));
      fl.forEach(function (l) {
        var pb = document.createElement('button');
        pb.type = 'button'; pb.className = 'np-chip np-pair-btn'; pb.dataset.act = 'pair'; pb.dataset.line = l.id;
        pb.textContent = displayName(l);
        pb.setAttribute('aria-label', '“' + it.text + '” foi ' + displayName(l));
        pair.appendChild(pb);
      });
      txt.appendChild(pair);
    }
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'np-del'; del.dataset.act = 'del'; del.innerHTML = DEL_SVG;
    del.setAttribute('aria-label', 'Tirar da lista: ' + it.text);
    li.append(chk, txt, del);
    return li;
  }

  function renderList() {
    var rows = listRows(), sum = listSummary(rows);
    lv.nCart.textContent = String(trip.cart.length);
    lv.nList.textContent = String(sum.pending);
    lv.tabCart.setAttribute('aria-selected', String(tab === 'cart'));
    lv.tabList.setAttribute('aria-selected', String(tab === 'list'));
    lv.cartView.hidden = tab !== 'cart';
    lv.listView.hidden = tab !== 'list';
    lv.peek.hidden = !(tab === 'cart' && sum.pending);
    if (sum.pending) lv.peekText.textContent = (sum.pending === 1 ? 'Falta 1 item da lista' : 'Faltam ' + sum.pending + ' itens da lista') + (sum.forecast > 0 ? ' · previsão no caixa ≈ ' + brl(sum.forecast) : '');
    lv.scan.hidden = !sum.pending;
    lv.scan.textContent = sum.pending === 1 ? 'Falta 1 da lista' : 'Faltam ' + sum.pending + ' da lista';
    if (tab !== 'list') return;
    lx.wa.hidden = lx.share.hidden = !sum.pending;
    lv.items.textContent = '';
    var pend = rows.filter(function (r) { return !r.done; }), done = rows.filter(function (r) { return r.done; });
    pend.forEach(function (r) { lv.items.appendChild(listRow(r)); });
    if (done.length) {
      var lab = document.createElement('li');
      lab.className = 'np-label'; lab.textContent = 'Já peguei';
      lv.items.appendChild(lab);
      done.forEach(function (r) { lv.items.appendChild(listRow(r)); });
    }
    lv.empty.hidden = list.length > 0;
    lv.foot.hidden = !list.length;
    if (list.length) {
      lv.fCart.textContent = brl(cartTotal(trip.cart));
      lv.fPend.textContent = sum.pending ? '≈ ' + brl(sum.est) : brl(0);
      lv.fTotal.textContent = '≈ ' + brl(sum.forecast);
      var notes = [], b = settings.budget;
      if (sum.unknown) notes.push(plural(sum.unknown, 'item ainda sem preço salvo', 'itens ainda sem preço salvo') + ', fora da conta.');
      if (b) notes.push(sum.forecast > b ? 'Passa ' + brl(sum.forecast - b) + ' do orçamento.' : 'Cabe no orçamento: sobram ≈ ' + brl(b - sum.forecast) + '.');
      lv.foot.dataset.level = budgetLevel(sum.forecast, b);
      lv.fNote.textContent = notes.join(' ');
      lv.fNote.hidden = !notes.length;
      lv.clear.hidden = !done.length;
    }
    renderSugg();
  }

  function setTab(t) {
    tab = t; settings.tab = t; saveSettings();
    renderList();
    window.scrollTo({ top: 0 });
  }
  lv.tabCart.addEventListener('click', function () { setTab('cart'); });
  lv.tabList.addEventListener('click', function () { setTab('list'); });
  lv.peek.addEventListener('click', function () { setTab('list'); });
  lv.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = lv.input.value.trim();
    if (!raw) return;
    var p = parseListText(raw);
    var it = addToList(p.text, '', p.qty);
    lv.input.value = '';
    alreadyInCart(it);
    renderList();
    try { lv.input.focus(); } catch (x) {}
  });
  // Item posto na lista com o produto já no carrinho: risca na hora.
  function alreadyInCart(it) {
    if (!it || it.lineId) return;
    trip.cart.forEach(linkList);
    var line = it.lineId && lineById(it.lineId);
    if (line) toast('“' + it.text + '” já está no carrinho: ' + displayName(line) + '.');
  }
  lv.input.addEventListener('input', renderSugg);
  lv.sugg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-code]');
    if (!b || !memory[b.dataset.code]) return;
    var raw = lv.input.value.trim(), qty = /^\d/.test(raw) ? parseListText(raw).qty : 1;
    var it = addToList(memory[b.dataset.code].n, b.dataset.code, qty);
    lv.input.value = '';
    alreadyInCart(it);
    renderList();
  });
  lv.items.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.closest('.np-row').dataset.id, it = list.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    if (b.dataset.act === 'del') {
      var before = list.slice();
      list.splice(list.indexOf(it), 1); saveList(); renderList();
      toast('Tirado da lista: ' + it.text, function () { list = before; saveList(); renderList(); });
      return;
    }
    if (b.dataset.act === 'pair') {
      var pl = lineById(b.dataset.line);
      if (!pl) return;
      var wasManual = it.manual;
      linkTo(it.id, pl); it.manual = wasManual; saveList(); renderList();
      toast('Pronto: “' + it.text + '” é ' + displayName(pl) + '. Da próxima vez o app risca sozinho.');
      return;
    }
    var r = listRows().filter(function (x) { return x.it === it; })[0];
    if (!r.done) it.manual = true;                 // pendente ou "1 de 2": marca como pego
    else if (it.manual) it.manual = false;         // desmarca o que foi marcado à mão
    else if (r.line) {                             // riscado por um produto: desfaz; se foi engano, o app aprende
      var wrong = r.line, pk = prodKey(wrong), text = it.text;
      unlinkItem(it); saveList(); renderList();
      toast('“' + text + '” desmarcado.', function () {
        learnLink(text, pk, false);
        toast('Certo: “' + text + '” não vai mais ser riscado por ' + displayName(wrong) + '.');
      }, 'Não era esse');
      return;
    }
    saveList(); renderList();
  });
  lv.clear.addEventListener('click', function () {
    var before = list.slice();
    list = listRows().filter(function (r) { return !r.done; }).map(function (r) { return r.it; });
    saveList(); renderList();
    toast('Itens pegos tirados da lista.', function () { list = before; saveList(); renderList(); });
  });

  /* ---------------- lista pelo WhatsApp: enviar, compartilhar e colar ---------------- */
  var lx = {
    wa: $('#listWa'), share: $('#listShare'), shareText: $('#listShareText'), paste: $('#listPaste'),
    box: $('#pasteBox'), area: $('#pasteText'), add: $('#pasteAdd'), cancel: $('#pasteCancel')
  };
  lx.shareText.textContent = navigator.share ? 'Compartilhar' : 'Copiar';
  function listShareText() {
    var rows = listRows().filter(function (r) { return !r.done; });
    return 'Lista de compras\n' + rows.map(function (r) { return '• ' + (r.rest > 1 ? r.rest + ' ' : '') + r.it.text; }).join('\n');
  }
  function openExternal(url) {
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function copyText(text, okMsg) {
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.top = '0'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      toast(ok ? okMsg : 'Não deu para copiar. Use o botão WhatsApp.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    else fallback();
  }
  lx.wa.addEventListener('click', function () { openExternal('https://wa.me/?text=' + encodeURIComponent(listShareText())); });
  lx.share.addEventListener('click', function () {
    var text = listShareText();
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    copyText(text, 'Lista copiada. Cole no WhatsApp ou onde quiser.');
  });
  // Uma linha por item (ou "leite, café, pão" numa linha só). Tira marcadores, emojis, caixinhas, numeração e negrito do WhatsApp.
  function parsePasted(text) {
    var parts = String(text || '').split(/\r?\n/);
    if (parts.filter(function (p) { return p.trim(); }).length === 1) parts = parts.join(' ').split(/\s*[;,]\s*/);
    return parts.map(function (x) {
      return x.replace(/^[^\p{L}\p{N}\[]+/u, '').replace(/^\[\s*[xX✓✔]?\s*\]\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/^\d{1,2}[.)]\s+/, '').replace(/^(\d{1,2})\s*[-–:]\s+/, '$1 ')
        .replace(/[^\p{L}\p{N})]+$/u, '').replace(/\s+/g, ' ').trim();
    }).filter(function (x) {
      return x && x.length <= 80 && /\p{L}/u.test(x) && !/^lista\b/i.test(x) && !/^previs[aã]o\b/i.test(x);
    });
  }
  function showPaste(prefill) {
    lx.box.hidden = false;
    lx.area.value = prefill || '';
    if (prefill) return;
    var focusArea = function () { try { lx.area.focus(); } catch (e) {} };
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) { if (t && t.trim() && !lx.area.value) lx.area.value = t; else focusArea(); }, focusArea);
    } else focusArea();
  }
  lx.paste.addEventListener('click', function () { if (lx.box.hidden) showPaste(''); else { try { lx.area.focus(); } catch (e) {} } });
  lx.cancel.addEventListener('click', function () { lx.box.hidden = true; lx.area.value = ''; });
  lx.add.addEventListener('click', function () {
    var items = parsePasted(lx.area.value);
    if (!items.length) { toast('Não achei itens. Cole um item por linha.'); try { lx.area.focus(); } catch (e) {} return; }
    var before = JSON.parse(JSON.stringify(list)), n = 0;
    items.forEach(function (x) { var p = parseListText(x); if (ensureInList(p.text, '', p.qty)) n++; });
    trip.cart.forEach(linkList);
    lx.box.hidden = true; lx.area.value = '';
    renderList();
    var skipped = items.length - n;
    toast((n ? plural(n, 'item posto', 'itens postos') + ' na lista.' : 'Nada novo para a lista.') + (skipped ? ' ' + plural(skipped, 'já pego', 'já pegos') + '.' : ''),
      n ? function () { list = cleanList(before); saveList(); renderList(); } : null);
  });
  // Lista enviada de outro app (WhatsApp → Compartilhar → Pré-Caixa, no Android com o app instalado).
  function takeSharedText() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var parts = [q.get('title'), q.get('text'), q.get('url')].filter(function (s) { return s && s.trim(); });
    if (!parts.length) return;
    try { window.history.replaceState(null, '', location.pathname); } catch (e) {}
    tab = 'list'; settings.tab = 'list'; saveSettings();
    renderAll();
    showPaste(parts.join('\n'));
    try { lx.box.scrollIntoView({ block: 'center' }); } catch (e) {}
  }

  /* ---------------- mercados ---------------- */
  var DEFAULT_STORES = ['Guanabara', 'Mundial', 'Supermarket'];
  function knownStores() {
    var out = [];
    function add(s) { s = String(s || '').trim(); if (s && !out.some(function (x) { return sameStore(x, s); })) out.push(s); }
    DEFAULT_STORES.forEach(add);
    history.forEach(function (h) { add(h.store); });
    Object.keys(memory).forEach(function (k) { if (memory[k]) add(memory[k].s); });
    if (settings.store) add(settings.store);
    return out.slice(0, 8);
  }
  function renderStoreChips(box, withOther) {
    box.textContent = '';
    knownStores().forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.store = s; b.textContent = s;
      b.setAttribute('aria-pressed', String(!!settings.store && sameStore(s, settings.store)));
      box.appendChild(b);
    });
    if (withOther) {
      var o = document.createElement('button');
      o.type = 'button'; o.dataset.other = '1'; o.textContent = 'Outro';
      box.appendChild(o);
    }
  }
  // Ao trocar de mercado no meio da compra, os preços desta compra passam a contar para o mercado novo.
  function setStore(s) {
    settings.store = String(s || '').slice(0, 40); saveSettings();
    var changed = false;
    trip.cart.forEach(function (l) {
      var m = l.code && memory[l.code];
      if (!m || !Array.isArray(m.h) || !m.h.length || m.h[0][1] < trip.startedAt) return;
      m.h[0][2] = settings.store; m.s = settings.store; changed = true;
    });
    if (changed) saveMemory();
    renderHead();
  }
  el.rStoresChips.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.other) { openMenu(mp.store); return; }
    setStore(b.dataset.store);
  });

  /* ---------------- início e fim de compra ---------------- */
  // Na primeira leitura de uma compra nova: em qual mercado e quanto pretende gastar.
  var st = {
    root: $('#startPanel'), title: $('#startTitle'), close: $('#startClose'), skip: $('#startSkip'),
    stores: $('#startStores'), storeIn: $('#startStoreInput'), chips: $('#startBudgetChips'), budget: $('#startBudget'), go: $('#startGo'), next: null
  };
  var BUDGETS = [10000, 15000, 20000, 30000, 50000];
  function begin(next) {
    if (trip.cart.length || trip.setup) { next(); return; }
    st.next = next;
    renderStart();
    st.storeIn.hidden = true;
    openPanel(st.root, st.title);
  }
  function renderStart() {
    renderStoreChips(st.stores, true);
    st.chips.textContent = '';
    BUDGETS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.v = String(v); b.textContent = brl(v).replace(',00', '');
      b.setAttribute('aria-pressed', String(settings.budget === v));
      st.chips.appendChild(b);
    });
    var none = document.createElement('button');
    none.type = 'button'; none.dataset.v = '0'; none.textContent = 'Sem limite';
    none.setAttribute('aria-pressed', String(!settings.budget));
    st.chips.appendChild(none);
    if (document.activeElement !== st.budget) st.budget.value = settings.budget && BUDGETS.indexOf(settings.budget) < 0 ? money(settings.budget) : '';
    st.go.textContent = st.next === openScanner ? 'Começar a escanear' : 'Começar';
  }
  function startGo() {
    trip.setup = true; saveTrip();
    var next = st.next; st.next = null;
    closePanel(true);
    if (next) next();
  }
  st.stores.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.other) { st.storeIn.hidden = false; st.storeIn.value = ''; st.storeIn.focus(); return; }
    setStore(b.dataset.store); st.storeIn.hidden = true; renderStart();
  });
  st.storeIn.addEventListener('input', function () { setStore(st.storeIn.value); renderStoreChips(st.stores, true); });
  st.storeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); st.storeIn.blur(); } });
  st.chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]');
    if (!b) return;
    settings.budget = parseInt(b.dataset.v, 10) || null; saveSettings();
    st.budget.value = ''; renderStart(); renderTotals();
  });
  selectOnTap(st.budget, hasValue(st.budget));
  st.budget.addEventListener('input', function () {
    var c = digitsToInt(st.budget.value, 7);
    settings.budget = c || null; saveSettings();
    st.budget.value = c ? money(c) : ''; caretEnd(st.budget);
    renderStart(); renderTotals();
  });
  st.go.addEventListener('click', startGo);
  st.skip.addEventListener('click', startGo);
  st.close.addEventListener('click', function () { st.next = null; closePanel(); });

  // Fim da compra: guarda no histórico, tira da lista o que já foi pego e zera o carrinho e o mercado.
  function finishSummary() {
    var taken = listRows().filter(function (r) { return r.done; }).length;
    return 'Guardar ' + plural(trip.cart.length, 'item', 'itens') + ' (' + brl(cartTotal(trip.cart)) + ') no histórico e começar do zero?' +
      (taken ? ' ' + (taken === 1 ? 'O item já pego sai da lista.' : 'Os ' + taken + ' itens já pegos saem da lista.') : '');
  }
  function finishTrip() {
    var before = snapshot(), had = trip.cart.length > 0, listBefore = JSON.parse(JSON.stringify(list)), storeBefore = settings.store;
    list = listRows().filter(function (r) { return !r.done; }).map(function (r) {
      if (r.got) r.it.qty = r.rest;
      r.it.lineId = '';
      return r.it;
    });
    saveList();
    if (had) {
      history.unshift({ at: trip.startedAt, end: Date.now(), store: settings.store || '', total: cartTotal(trip.cart), lines: trip.cart.length,
        items: trip.cart.slice().reverse().map(function (l) {
          return { n: displayName(l), c: l.scale ? '' : l.code, u: l.unit, q: l.qty, g: l.grams, p: l.price, t: lineTotal(l) };
        }) });
      history = history.slice(0, 60); saveHistory();
    }
    trip.cart = []; trip.seq = 0; trip.startedAt = Date.now(); trip.setup = false; trip.check = false; saveTrip();
    settings.store = ''; saveSettings();
    fin.confirm.hidden = true;
    closePanel(); renderAll(null, true);
    window.scrollTo({ top: 0 });
    toast('Compra guardada no histórico. Carrinho zerado.', function () {
      if (had) { history.shift(); saveHistory(); }
      list = cleanList(listBefore); saveList();
      settings.store = storeBefore; saveSettings();
      trip.setup = true;
      restore(before, 'Compra recuperada.');
    });
  }
  var fin = { box: $('#finishBox'), btn: $('#finishBtn'), confirm: $('#finishConfirm'), summary: $('#finishSummary'), yes: $('#finishYes'), no: $('#finishNo') };
  fin.btn.addEventListener('click', function () {
    fin.summary.textContent = finishSummary();
    fin.confirm.hidden = false;
    fin.confirm.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    try { fin.yes.focus({ preventScroll: true }); } catch (e) {}
  });
  fin.no.addEventListener('click', function () { fin.confirm.hidden = true; });
  fin.yes.addEventListener('click', finishTrip);

  /* ---------------- conferir no caixa ---------------- */
  var ckc = {
    card: $('#checkCard'), fill: $('#ckFill'), count: $('#ckCount'), rest: $('#ckRest'), over: $('#ckOver'), under: $('#ckUnder'), help: $('#ckHelp'),
    exit: $('#checkExit'), btn: $('#checkBtn'), btnText: $('#checkBtnText')
  };
  function chargedEditor(l) {
    var li = document.createElement('li');
    li.className = 'ck-edit';
    var lab = document.createElement('label');
    lab.htmlFor = 'chargedInput';
    lab.append(span('ck-name', displayName(l)), 'Quanto o caixa cobrou ' + (l.unit === 'kg' ? 'por kg' : 'por unidade') + '? No app: ' + brl(l.price) + (l.unit === 'kg' ? '/kg' : ''));
    var wrap = document.createElement('div');
    wrap.className = 'money';
    var inp = document.createElement('input');
    inp.id = 'chargedInput'; inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.enterKeyHint = 'done';
    inp.placeholder = money(l.price);
    inp.value = l.charged != null ? money(l.charged) : '';
    inp.addEventListener('input', function () {
      var c = digitsToInt(inp.value, 7);
      inp.value = c ? money(c) : ''; caretEnd(inp);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveCharged(l, digitsToInt(inp.value, 7)); } });
    selectOnTap(inp, hasValue(inp));
    var pre = span('pre', 'R$'); pre.setAttribute('aria-hidden', 'true');
    wrap.append(pre, inp);
    var row = document.createElement('div');
    row.className = 'btn-pair';
    var save = document.createElement('button');
    save.type = 'button'; save.className = 'btn-wide strong ck-save'; save.dataset.id = l.id; save.textContent = 'Salvar';
    var same = document.createElement('button');
    same.type = 'button'; same.className = 'btn-wide ck-same'; same.dataset.id = l.id; same.textContent = 'Igual ao app';
    row.append(save, same);
    li.append(lab, wrap, row);
    return li;
  }
  function renderCheck() {
    var on = !!trip.check && trip.cart.length > 0;
    ckc.card.hidden = !on;
    ckc.btnText.textContent = on ? 'Sair da conferência' : 'Conferir no caixa';
    ckc.btn.setAttribute('aria-pressed', String(on));
    if (!on) return;
    var n = trip.cart.length, done = 0, rest = 0, over = 0, overSum = 0, under = 0, underSum = 0;
    trip.cart.forEach(function (l) {
      if (l.chk) done++; else rest += lineTotal(l);
      if (l.charged != null && l.charged !== l.price) {
        var units = l.unit === 'kg' ? l.grams / 1000 : l.qty, d = Math.round((l.charged - l.price) * units);
        if (d > 0) { over++; overSum += d; } else if (d < 0) { under++; underSum -= d; }
      }
    });
    var total = cartTotal(trip.cart);
    ckc.fill.style.width = (done / n * 100).toFixed(1) + '%';
    ckc.count.textContent = done === n ? 'Tudo conferido' : done + ' de ' + n + ' conferidos';
    ckc.rest.textContent = done === n
      ? 'No app ' + brl(total) + (over || under ? ' · cobrado ' + brl(total + overSum - underSum) : ' · igual ao caixa')
      : 'Falta conferir: ' + plural(n - done, 'item', 'itens') + ' · ' + brl(rest);
    ckc.over.hidden = !over;
    if (over) ckc.over.textContent = '+' + brl(overSum) + ' cobrado a mais em ' + plural(over, 'item', 'itens') + '. Se a etiqueta mostrava menos, peça a correção: vale o menor preço (Lei 10.962/2004).';
    ckc.under.hidden = !under;
    if (under) ckc.under.textContent = '−' + brl(underSum) + ' cobrado a menos em ' + plural(under, 'item', 'itens') + '.';
    ckc.help.hidden = done > 0;
    ckc.card.classList.toggle('editing', !!ckEdit);
    ckc.card.dataset.state = over ? 'over' : done === n ? 'ok' : '';
  }
  function setCheck(on) {
    trip.check = on; ckEdit = ''; saveTrip(); renderCart();
    if (!on) { try { ckc.btn.focus({ preventScroll: true }); } catch (e) {} return; }
    // Vai para o começo do cupom (o cartão é "grudento": mede onde ele fica sem grudar).
    ckc.card.style.position = 'static';
    var y = ckc.card.getBoundingClientRect().top + window.scrollY;
    ckc.card.style.position = '';
    window.scrollTo({ top: Math.max(0, y - 64), behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  ckc.btn.addEventListener('click', function () { setCheck(!trip.check); });
  ckc.exit.addEventListener('click', function () { setCheck(false); });

  /* ---------------- compras anteriores ---------------- */
  var tp = {
    root: $('#tripPanel'), title: $('#tripTitle'), close: $('#tripClose'), meta: $('#tripMeta'), items: $('#tripItems'), total: $('#tripTotal'),
    none: $('#tripNoItems'), again: $('#tripAgain'), againHelp: $('#tripAgainHelp'), del: $('#tripDelete'), delBox: $('#tripDelConfirm'),
    delYes: $('#tripDelYes'), delNo: $('#tripDelNo'), i: -1, fromMenu: false
  };
  function openTrip(i, fromMenu) {
    var h = history[i];
    if (!h) return;
    tp.i = i; tp.fromMenu = !!fromMenu;
    tp.title.textContent = 'Compra de ' + ddmm(h.at);
    tp.meta.textContent = (h.store || 'Mercado não informado') + ' · ' + dmy(h.at) + ' às ' + hm(h.at) + ' · ' + plural(h.lines || 0, 'item', 'itens');
    tp.items.textContent = '';
    var items = h.items || [];
    items.forEach(function (x, k) {
      var li = document.createElement('li');
      li.className = 'line';
      li.append(span('seq', String(k + 1).padStart(3, '0')), span('desc', x.n),
        span('calc', x.u === 'kg' ? kg(x.g) + ' kg x ' + money(x.p) + '/kg' : x.q + ' un x ' + money(x.p)), span('sub', money(x.t)));
      tp.items.appendChild(li);
    });
    tp.items.hidden = !items.length;
    tp.none.hidden = !!items.length;
    tp.again.hidden = tp.againHelp.hidden = !items.length;
    tp.total.textContent = money(h.total);
    tp.delBox.hidden = true;
    openPanel(tp.root, tp.title);
  }
  function backToMenu(i) {
    fillMenu();
    var row = i >= 0 ? mp.hist.querySelector('button[data-i="' + i + '"]') : null;
    openPanel(mp.root, row || mp.title);
    if (row) { try { row.scrollIntoView({ block: 'center' }); } catch (e) {} }
  }
  function closeTrip() {
    var back = tp.fromMenu, i = tp.i;
    closePanel();
    if (back) backToMenu(i);
  }
  // Põe os itens de uma compra na lista, com as mesmas quantidades (kg vira 1).
  function buyAgain(h) {
    var before = JSON.parse(JSON.stringify(list)), n = 0, skipped = 0;
    (h.items || []).forEach(function (x) {
      var code = x.c && !scaleOf(x.c) ? x.c : '';
      var name = (code && memory[code] && memory[code].n) || x.n;
      if (!name || name === 'Item de balança' || name === 'Item sem nome') return;
      if (ensureInList(name, code || memKey('', name), x.u === 'kg' ? 1 : x.q)) n++; else skipped++;
    });
    trip.cart.forEach(linkList);
    tab = 'list'; settings.tab = 'list'; saveSettings();
    closePanel(); renderAll();
    window.scrollTo({ top: 0 });
    toast((n ? plural(n, 'item posto', 'itens postos') + ' na lista.' : 'Nada novo para a lista.') + (skipped ? ' ' + plural(skipped, 'já pego', 'já pegos') + '.' : ''),
      n ? function () { list = cleanList(before); saveList(); renderList(); } : null);
  }
  tp.again.addEventListener('click', function () { var h = history[tp.i]; if (h) buyAgain(h); });
  tp.close.addEventListener('click', closeTrip);
  tp.del.addEventListener('click', function () { tp.delBox.hidden = false; try { tp.delYes.focus(); } catch (e) {} });
  tp.delNo.addEventListener('click', function () { tp.delBox.hidden = true; try { tp.del.focus(); } catch (e) {} });
  tp.delYes.addEventListener('click', function () {
    var i = tp.i, gone = history.splice(i, 1)[0], back = tp.fromMenu;
    if (!gone) return;
    saveHistory(); closePanel(); renderAll();
    if (back) backToMenu(-1);
    toast('Compra apagada do histórico.', function () {
      history.splice(i, 0, gone); saveHistory(); renderAll();
      if (openPanelEl === mp.root) renderHistory();
    });
  });
  // Carrinho vazio: atalho para a última compra.
  var lastc = { box: $('#lastTrip'), open: $('#lastOpen'), text: $('#lastText'), again: $('#lastAgain') };
  function renderLast() {
    var h = history[0];
    lastc.box.hidden = trip.cart.length > 0 || !h;
    if (lastc.box.hidden) return;
    lastc.text.textContent = ddmm(h.at) + ' · ' + (h.store || 'Mercado') + ' · ' + brl(h.total) + ' · ' + plural(h.lines || 0, 'item', 'itens');
    lastc.again.hidden = !(h.items && h.items.length);
  }
  lastc.open.addEventListener('click', function () { openTrip(0, false); });
  lastc.again.addEventListener('click', function () { if (history[0]) buyAgain(history[0]); });

  /* ---------------- nome que faltou: procura de novo quando a internet volta ---------------- */
  var filling = false;
  function fillMissingNames() {
    if (filling || !settings.catalog || navigator.onLine === false) return;
    var todo = trip.cart.filter(function (l) { return l.code && !l.name && !l.scale && !l.nameMiss && !scaleOf(l.code); }).slice(0, 15);
    if (!todo.length) return;
    filling = true;
    var found = 0, missed = 0;
    function finish() {
      filling = false;
      if (!found && !missed) return;
      saveTrip();
      if (found) {
        saveMemory(); renderAll();
        toast(found === 1 ? 'Achei o nome de 1 produto que tinha ficado sem nome.' : 'Achei o nome de ' + found + ' produtos que tinham ficado sem nome.');
      }
    }
    (function next(k) {
      if (k >= todo.length) { finish(); return; }
      var code = todo[k].code;
      catalogName(code).then(function (n) {
        if (n === null) { finish(); return; } // sem conexão: tenta na próxima vez
        trip.cart.forEach(function (l) {
          if (l.code !== code || l.name) return;
          if (n) { l.name = n; found++; linkList(l); } else { l.nameMiss = 1; missed++; }
        });
        if (n && memory[code] && !memory[code].n) memory[code].n = n;
        next(k + 1);
      }, finish);
    })(0);
  }
  window.addEventListener('online', function () { setTimeout(fillMissingNames, 1200); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(fillMissingNames, 600); });

  /* ---------------- tela do item: qual item da lista este produto risca ---------------- */
  var lp = { root: $('#listPick'), label: $('#listPickLabel'), chips: $('#listPickChips'), help: $('#listPickHelp') };
  function draftLine(d) { return { id: d.lineId || '', code: d.code, name: (d.name || '').trim(), scale: !!d.scale }; }
  // Itens que este produto pode riscar; ao editar, o item que ele já riscou também aparece.
  function pickItems(d) {
    var items = openListItems();
    var cur = d.listCur && list.filter(function (x) { return x.id === d.listCur; })[0];
    if (cur && items.indexOf(cur) < 0) items.unshift(cur);
    return items;
  }
  function pickedItem(d) {
    if (d.listPick === 'none') return null;
    if (d.listPick) return list.filter(function (x) { return x.id === d.listPick; })[0] || null;
    return findListItem(draftLine(d), pickItems(d));
  }
  function renderListPick() {
    var d = draft, items = d && (d.mode === 'new' || d.mode === 'edit') ? pickItems(d) : [];
    lp.root.hidden = !items.length;
    if (!items.length) return;
    var sel = pickedItem(d), name = (d.name || '').trim();
    var order = items.map(function (it, i) { return { it: it, s: it === sel ? 1e3 : nameScore(it.text, name), i: i }; })
      .sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); }).slice(0, 8);
    lp.label.textContent = sel ? 'Vai riscar da lista' : 'Riscar algum item da lista?';
    lp.chips.textContent = '';
    order.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.id = o.it.id;
      b.textContent = (o.it.qty > 1 ? o.it.qty + ' × ' : '') + o.it.text;
      b.setAttribute('aria-pressed', String(o.it === sel));
      lp.chips.appendChild(b);
    });
    lp.help.hidden = !sel;
    if (sel) lp.help.textContent = d.listCur && sel.id === d.listCur ? 'Este produto riscou este item. Toque nele para desfazer.'
      : d.listPick ? 'Escolhido por você. Toque de novo para não riscar.'
      : 'O app reconheceu. Toque em outro item para trocar, ou neste para não riscar.';
  }
  lp.chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-id]'), d = draft;
    if (!b || !d) return;
    var sel = pickedItem(d);
    if (sel && sel.id === b.dataset.id) d.listPick = 'none';
    else {
      d.listPick = b.dataset.id;
      var it = list.filter(function (x) { return x.id === b.dataset.id; })[0];
      // Produto sem nome: fica com o nome do item da lista (o catálogo ainda pode trocar por um nome melhor).
      if (it && !(d.name || '').trim() && !d.nameTouched) { setName(it.text.charAt(0).toUpperCase() + it.text.slice(1), 'lista'); renderPriceHist(d); }
    }
    renderListPick();
  });

  /* ---------------- nome de item sem código: escolher um já comprado ---------------- */
  var ns = $('#nameSugg');
  function renderNameSugg() {
    var d = draft;
    ns.textContent = '';
    var q = d && d.mode !== 'edit' && !d.code ? ip.name.value.trim() : '';
    var keys = q.length >= 2 ? Object.keys(memory).filter(function (k) {
      var m = memory[k];
      return k.indexOf('balanca:') !== 0 && m && m.n && m.p > 0 && typeMatches(q, m.n) && normText(m.n) !== normText(q);
    }) : [];
    keys.sort(function (a, b) { return ((memory[b].c || 0) - (memory[a].c || 0)) || ((memory[b].t || 0) - (memory[a].t || 0)); });
    keys = keys.slice(0, 5);
    ns.hidden = !keys.length;
    keys.forEach(function (k) {
      var m = memory[k], b = document.createElement('button');
      b.type = 'button'; b.className = 'np-chip'; b.dataset.key = k;
      b.append(span('np-chip-name', m.n), span('np-chip-price', money(m.p) + (m.u === 'kg' ? '/kg' : '')));
      ns.appendChild(b);
    });
  }
  ns.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
  ns.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-key]'), d = draft;
    if (!b || !d || !memory[b.dataset.key]) return;
    var key = b.dataset.key, m = memory[key];
    ns.hidden = true;
    if (key.indexOf('nome:') !== 0) {
      ip.code.value = key; d.lastTyped = key;
      applyCode(key, 'digitado');
      return;
    }
    setName(m.n, 'memoria'); d.nameTouched = true;
    d.unit = m.u === 'kg' ? 'kg' : 'un'; d.unitUser = true;
    if (d.unit === 'kg') { d.grams = m.g || 1000; ip.grams.value = kg(d.grams); }
    if (!d.priceTouched) setPrice(m.p, 'memoria');
    var other = m.s && settings.store && !sameStore(m.s, settings.store);
    d.memNote = other ? 'Último preço é do ' + m.s + '. Aqui pode ser outro: confira na etiqueta.' : 'Último preço salvo. Confira na etiqueta.';
    setStatus(d, 'ok', 'Item já comprado', d.memNote);
    renderDraft();
    if (d.unit === 'kg') { try { ip.grams.focus(); } catch (x) {} }
  });

  /* ---------------- options ---------------- */
  var mp = {
    root: $('#menuPanel'), title: $('#menuTitle'), close: $('#menuClose'), install: $('#menuInstall'),
    store: $('#storeInput'), storeChips: $('#storeChips'), budget: $('#budgetInput'), budgetClear: $('#budgetClear'), budgetChips: $('#budgetChips'), diag: $('#diagInfo'),
    beep: $('#beepToggle'), catalog: $('#catalogToggle'), fast: $('#fastToggle'),
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
    history.slice(0, 20).forEach(function (h, i) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'h-row'; b.dataset.i = String(i);
      b.append(span('h-when', ddmm(h.at)), span('h-where', (h.store || 'Mercado') + ' · ' + plural(h.lines || 0, 'item', 'itens')), span('h-total', brl(h.total)));
      b.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>');
      b.setAttribute('aria-label', 'Compra de ' + dmy(h.at) + ', ' + (h.store || 'mercado não informado') + ', ' + plural(h.lines || 0, 'item', 'itens') + ', ' + brl(h.total) + '. Ver os itens.');
      li.appendChild(b);
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
    mp.dataInfo.textContent = 'Tudo fica guardado neste celular: ' + plural(trip.cart.length, 'item', 'itens') + ' no carrinho, ' + plural(list.length, 'item', 'itens') + ' na lista, ' +
      plural(prices, 'preço salvo', 'preços salvos') + ' e ' + plural(history.length, 'compra', 'compras') + ' no histórico.' +
      (persisted ? ' O celular marcou estes dados como permanentes.' : '') + ' Versão ' + VERSION + '.';
    mp.memClear.hidden = !Object.keys(memory).length;
    mp.diag.textContent = scanner.diag || ('Leitor: ' + engineName() + '. Abra o leitor uma vez para ver a câmera usada.');
  }
  function fillMenu() {
    mp.store.value = settings.store;
    renderStoreChips(mp.storeChips, false);
    mp.budget.value = settings.budget ? money(settings.budget) : '';
    mp.beep.checked = !!settings.beep; mp.catalog.checked = !!settings.catalog; mp.fast.checked = !!settings.fast;
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
  mp.hist.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (b) openTrip(parseInt(b.dataset.i, 10), true);
  });
  mp.store.addEventListener('input', function () { setStore(mp.store.value); renderStoreChips(mp.storeChips, false); });
  mp.storeChips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-store]');
    if (!b) return;
    setStore(b.dataset.store); mp.store.value = settings.store; renderStoreChips(mp.storeChips, false);
  });
  mp.store.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); mp.store.blur(); } });
  selectOnTap(mp.budget, hasValue(mp.budget));
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
  mp.fast.addEventListener('change', function () { settings.fast = mp.fast.checked; saveSettings(); });
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
    mp.newSummary.textContent = finishSummary();
    mp.newConfirm.hidden = false; mp.newYes.focus();
  });
  mp.newNo.addEventListener('click', function () { mp.newConfirm.hidden = true; mp.newTrip.focus(); });
  mp.newYes.addEventListener('click', finishTrip);
  mp.memClear.addEventListener('click', function () { mp.memConfirm.hidden = false; mp.memYes.focus(); });
  mp.memNo.addEventListener('click', function () { mp.memConfirm.hidden = true; mp.memClear.focus(); });
  mp.memYes.addEventListener('click', function () {
    memory = {}; saveMemory(); mp.memConfirm.hidden = true; renderDataInfo(); toast('Preços salvos apagados.');
  });

  // backup
  mp.exportBtn.addEventListener('click', function () {
    var data = { app: 'pre-caixa', v: 3, exportedAt: new Date().toISOString(), settings: settings, trip: trip, memory: memory, history: history, list: list, links: links };
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
        plural(t.cart.length, 'item', 'itens') + ' no carrinho, ' + plural(cleanList(data.list).length, 'item', 'itens') + ' na lista, ' + plural(Object.keys(m).length, 'preço', 'preços') + ' e ' + plural(h.length, 'compra', 'compras') +
        '. Substituir o que está neste celular?';
      mp.importConfirm.hidden = false; mp.importYes.focus();
    }).catch(function () { toast('Este arquivo não é um backup do Pré-Caixa.'); });
  });
  mp.importNo.addEventListener('click', function () { pendingImport = null; mp.importConfirm.hidden = true; });
  mp.importYes.addEventListener('click', function () {
    var data = pendingImport; if (!data) return;
    settings = cleanSettings(data.settings); trip = cleanTrip(data.trip); memory = cleanMemory(data.memory); history = cleanHistory(data.history); list = cleanList(data.list);
    links = cleanLinks(data.links); memCache = {};
    tab = settings.tab;
    saveSettings(); saveTrip(); saveMemory(); saveHistory(); saveList(); saveLinks();
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
  takeSharedText();
  checkPersist(standalone);
  setTimeout(fillMissingNames, 1500);
})();
