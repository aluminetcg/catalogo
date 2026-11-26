/* Carga r\u00e1pida de singles para el panel de Empretienda (ALUMINETCG).
   Se abre con el marcador "Carga r\u00e1pida" estando en panel.empretienda.com.
   Busca la carta por n\u00famero / nombre en el \u00edndice de TCGplayer, sube la foto y crea el producto
   (o le suma stock si ya existe) usando la sesi\u00f3n del panel. */
(function () {
  "use strict";
  if (window.__alumineCarga) { window.__alumineCarga.open(); return; }

  var PAGES = "https://aluminetcg.github.io/catalogo/";
  var API = "https://api.empretienda.com";
  var AUTH = "https://auth0.empretienda.com", CID = "Kzsbi2SzTmTYF5tZnKOPN63wYpaDACMV";
  var IMG = function (pid, size) { return "https://tcgplayer-cdn.tcgplayer.com/product/" + pid + "_in_" + size + "x" + size + ".jpg"; };
  var BASICAS = { "": 1, "Common": 1, "Uncommon": 1, "Rare": 1 };
  var ROOTS = { en: /ingl/i, jp: /jap/i };
  var CDN = "https://d22fxaf9t8d39k.cloudfront.net/";

  var host = document.createElement("div");
  host.id = "alumine-carga";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483000";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  if (location.hostname !== "panel.empretienda.com") {
    root.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:16px system-ui"><div style="background:#fff;color:#222;padding:24px;border-radius:14px;max-width:420px">La carga r\u00e1pida funciona dentro del panel de Empretienda. Entr\u00e1 a <b>panel.empretienda.com</b>, inici\u00e1 sesi\u00f3n y toc\u00e1 de nuevo el marcador.<br><br><button style="padding:8px 16px">Cerrar</button></div></div>';
    root.querySelector("button").onclick = function () { host.remove(); };
    return;
  }

  // ------------------------------------------------------------------ estado
  var ls = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem("alumine-carga-" + k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("alumine-carga-" + k, JSON.stringify(v)); } catch (e) {} }
  };
  var S = {
    lang: ls.get("lang", "all"), mult: ls.get("mult", 1), usd: 0,
    idx: {}, cats: [], catMap: ls.get("cats", {}), sel: null, log: [], busy: false, oldImgs: {}
  };

  // ------------------------------------------------------------------ sesi\u00f3n del panel
  var tok = null;
  function b64u(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function rnd() { return b64u(crypto.getRandomValues(new Uint8Array(32))); }
  async function token() {
    if (tok && tok.exp > Date.now() + 5 * 60e3) return tok.at;
    var verifier = rnd(), state = rnd(), nonce = rnd();
    var challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    var q = new URLSearchParams({ client_id: CID, scope: "openid profile email", redirect_uri: location.origin, audience: "https://www.empretienda.com",
      prompt: "none", response_type: "code", response_mode: "web_message", state: state, nonce: nonce, code_challenge: challenge, code_challenge_method: "S256" });
    var code = await new Promise(function (res, rej) {
      var f = document.createElement("iframe"); f.style.display = "none";
      var to = setTimeout(function () { done(); rej(new Error("El panel no respondi\u00f3. Recarg\u00e1 la p\u00e1gina e intent\u00e1 de nuevo.")); }, 20000);
      function done() { clearTimeout(to); removeEventListener("message", h); f.remove(); }
      function h(e) {
        if (e.origin !== AUTH || !e.data || e.data.type !== "authorization_response") return;
        done(); var r = e.data.response;
        if (r.error) rej(new Error("La sesi\u00f3n del panel venci\u00f3. Volv\u00e9 a iniciar sesi\u00f3n en Empretienda.")); else if (r.state !== state) rej(new Error("Sesi\u00f3n inv\u00e1lida")); else res(r.code);
      }
      addEventListener("message", h); f.src = AUTH + "/authorize?" + q; document.body.appendChild(f);
    });
    var r = await fetch(AUTH + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CID, grant_type: "authorization_code", code: code, code_verifier: verifier, redirect_uri: location.origin }) }).then(function (r) { return r.json(); });
    if (!r.access_token) throw new Error("No pude obtener la sesi\u00f3n del panel.");
    tok = { at: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
    return tok.at;
  }
  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: "Bearer " + (await token()) }, opts.json ? { "Content-Type": "application/json" } : {});
    var r = await fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.json ? JSON.stringify(opts.json) : opts.body });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || (j && j.status && (j.status < 200 || j.status > 299))) throw new Error((j && j.message) || ("Empretienda respondi\u00f3 " + r.status));
    return j ? j.data : null;
  }

  // ------------------------------------------------------------------ utilidades
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function nnum(s) { return String(s || "").toLowerCase().split("/").map(function (p) { p = p.trim(); var m = p.match(/^([a-z]*)0*(\d+)([a-z]*)$/); return m ? m[1] + m[2] + m[3] : p; }).join("/"); }
  function words(s) { return norm(s).split(" ").filter(function (w) { return w && ["and", "the", "pattern", "de", "y"].indexOf(w) < 0; }); }
  function setName(n) { return String(n || "").split(": ").slice(-1)[0]; }
  function cardName(n) { return String(n || "").split(" - ")[0].trim(); }
  function money(n) { return "$" + Math.round(n).toLocaleString("es-AR"); }
  function sugerido(usd) { if (!usd || !S.usd) return 0; var v = usd * S.usd * S.mult; return Math.max(100, Math.ceil(v / 100) * 100 - 21); }

  // ------------------------------------------------------------------ interfaz
  root.innerHTML = '<style>' +
    ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}' +
    '.wrap{position:fixed;inset:0;background:#f4f2ec;color:#1d2330;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column}' +
    'header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#1d2330;color:#fff}' +
    'header b{font-size:16px;margin-right:6px}header b span{color:#fb923c}' +
    'header input,header select{padding:9px 11px;border-radius:9px;border:0;font:inherit;font-size:15px}' +
    '#q{flex:1 1 280px;min-width:0}' +
    'header label{display:flex;gap:6px;align-items:center;font-size:13px;color:#cbd2e0}' +
    '#mult{width:70px}' +
    '.x{margin-left:auto;background:none;border:0;color:#fff;font-size:26px;cursor:pointer;line-height:1;padding:0 6px}' +
    'main{flex:1;display:grid;grid-template-columns:1fr 430px;min-height:0}' +
    '#res{overflow:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;align-content:start}' +
    '.t{background:#fff;border:2px solid transparent;border-radius:12px;padding:8px;cursor:pointer;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
    '.t:hover{border-color:#fb923c}.t.on{border-color:#c2410c}' +
    '.t img{width:100%;aspect-ratio:1;object-fit:contain;background:#f4f2ec;border-radius:8px}' +
    '.lg{display:inline-block;font-size:10px;font-weight:800;background:#1d2330;color:#fff;border-radius:5px;padding:1px 5px;vertical-align:1px}' +
    '.t b{font-size:13px;line-height:1.2}.t small{color:#6a7080;font-size:12px;line-height:1.25}' +
    '.msg{grid-column:1/-1;color:#6a7080;padding:30px;text-align:center}' +
    'aside{background:#fff;border-left:1px solid #e3dfd3;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px}' +
    'aside img.big{width:100%;max-height:340px;object-fit:contain}' +
    '.foto{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#6a7080}' +
    '.foto label.sec{display:inline-block;font-size:13px;color:#c2410c;flex-direction:row}' +
    '.drop{outline:3px dashed #c2410c;outline-offset:-6px}' +
    'aside label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6a7080;font-weight:600}' +
    'aside input,aside select{padding:9px 10px;border:1.5px solid #e3dfd3;border-radius:9px;font:inherit;font-size:15px;color:#1d2330;width:100%}' +
    '.row{display:flex;gap:10px}.row>*{flex:1;min-width:0}' +
    '.go{background:#c2410c;color:#fff;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:800;font-size:16px;cursor:pointer}' +
    '.go:disabled{opacity:.5;cursor:default}' +
    '.sec{background:#fff;border:1.5px solid #c2410c;color:#c2410c;border-radius:9px;padding:7px 10px;font:inherit;font-weight:700;cursor:pointer}' +
    '.ex{border:1px solid #e3dfd3;border-radius:10px;padding:8px;display:flex;gap:8px;align-items:center}' +
    '.ex div{flex:1;min-width:0;font-size:13px}.ex small{color:#6a7080}' +
    '.hint{font-size:12px;color:#6a7080}' +
    '.ok{background:#dcfce7;color:#14532d;border-radius:10px;padding:10px;font-size:13px}' +
    '.err{background:#fee2e2;color:#7f1d1d;border-radius:10px;padding:10px;font-size:13px}' +
    '.log{font-size:12px;color:#6a7080;border-top:1px solid #e3dfd3;padding-top:10px}.log a{color:#c2410c}' +
    '@media (max-width:900px){main{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #e3dfd3;max-height:60vh}}' +
    '</style>' +
    '<div class="wrap"><header>' +
    '<b>ALUMINE<span>TCG</span> \u00b7 carga r\u00e1pida</b>' +
    '<select id="lang"><option value="all">Pok\u00e9mon Ingl\u00e9s + Japon\u00e9s</option><option value="en">Pok\u00e9mon Ingl\u00e9s</option><option value="jp">Pok\u00e9mon Japon\u00e9s</option></select>' +
    '<input id="q" type="search" placeholder="N\u00famero y/o nombre: 143/128, kommo-o 143, charizard 151\u2026" autocomplete="off">' +
    '<label>Precio = TCG \u00d7 d\u00f3lar \u00d7 <input id="mult" type="number" step="0.05" min="0.1"></label>' +
    '<label id="dolar"></label>' +
    '<button class="x" title="Cerrar">\u00d7</button></header>' +
    '<main><section id="res"><div class="msg">Cargando\u2026</div></section>' +
    '<aside id="det"><div class="hint">Busc\u00e1 una carta y tocala para cargarla.</div></aside></main></div>';
  var $ = function (s) { return root.querySelector(s); };
  $("#lang").value = S.lang; $("#mult").value = S.mult;
  $(".x").onclick = function () { host.hidden = true; };

  // ------------------------------------------------------------------ datos
  async function loadIndex(lang) {
    if (S.idx[lang]) return S.idx[lang];
    $("#res").innerHTML = '<div class="msg">Cargando la base de cartas\u2026</div>';
    var d = await fetch(PAGES + "data/singles/" + lang + ".json?t=" + Math.floor(Date.now() / 36e5)).then(function (r) { if (!r.ok) throw new Error("No encontr\u00e9 la base de cartas (" + r.status + ")"); return r.json(); });
    d.cards.forEach(function (c) { c.L = lang; c.n = nnum(c[2]); c.w = norm(cardName(c[1])); c.s = norm(d.sets[c[3]][0]); });
    S.idx[lang] = d; return d;
  }
  function flatCats(list, path, out) {
    (list || []).forEach(function (c) {
      var p = path.concat(c.c_nombre);
      out.push({ id: c.idCategorias, name: c.c_nombre, path: p.join(" \u203a "), root: p[0], leaf: !(c.subcategorias && c.subcategorias.length) });
      flatCats(c.subcategorias, p, out);
    });
    return out;
  }
  function langs() { return S.lang === "all" ? ["en", "jp"] : [S.lang]; }
  async function loadAll() { for (var i = 0, l = langs(); i < l.length; i++) await loadIndex(l[i]); }
  function setOf(c) { return S.idx[c.L].sets[c[3]][0]; }
  function guessCat(setFull, L) {
    if (S.catMap[L + "|" + setFull]) return S.catMap[L + "|" + setFull];
    if (S.catMap[setFull]) return S.catMap[setFull];
    var target = words(setName(setFull)), code = (String(setFull).match(/^([A-Za-z0-9.]+):/) || [])[1];
    var best = null, bestScore = 0;
    S.cats.forEach(function (c) {
      if (!c.leaf || !ROOTS[L].test(c.root)) return;
      var cw = words(c.name), inter = target.filter(function (w) { return cw.indexOf(w) >= 0; }).length;
      var score = inter / Math.max(target.length, cw.length, 1);
      if (code && norm(c.name).split(" ").indexOf(norm(code)) >= 0) score += 0.5;
      if (score > bestScore) { bestScore = score; best = c.id; }
    });
    return bestScore >= 0.5 ? best : "";
  }

  // ------------------------------------------------------------------ b\u00fasqueda
  function search() {
    var L = langs().filter(function (l) { return S.idx[l]; }); if (!L.length) return;
    var toks = norm($("#q").value).split(" ").filter(Boolean);
    if (!toks.length) { $("#res").innerHTML = '<div class="msg">Escrib\u00ed el n\u00famero de la carta (por ejemplo 143/128) o parte del nombre.</div>'; return; }
    var nums = toks.filter(function (t) { return /\d/.test(t); }), names = toks.filter(function (t) { return !/\d/.test(t); });
    var out = [];
    for (var li = 0; li < L.length; li++) {
    var d = S.idx[L[li]], lim = out.length + 80;
    for (var i = 0; i < d.cards.length && out.length < lim; i++) {
      var c = d.cards[i], ok = true;
      for (var a = 0; a < nums.length && ok; a++) {
        var t = nnum(nums[a]);
        ok = t.indexOf("/") >= 0 ? c.n === t : (c.n.split("/")[0] === t || c.s.split(" ").indexOf(nums[a]) >= 0 || c.w.split(" ").indexOf(nums[a]) >= 0);
      }
      for (var b = 0; b < names.length && ok; b++) ok = c.w.indexOf(names[b]) >= 0 || c.s.indexOf(names[b]) >= 0;
      if (ok) out.push(c);
    }
    }
    $("#res").innerHTML = out.length ? out.map(function (c) {
      var p = bestPrice(c[5]);
      return '<div class="t' + (S.sel === c ? " on" : "") + '" data-pid="' + c[0] + '" data-l="' + c.L + '"><img loading="lazy" src="' + IMG(c[0], 200) + '" alt="">' +
        '<b>' + (L.length > 1 ? '<span class="lg">' + (c.L === "jp" ? "JAP" : "ING") + "</span> " : "") + esc(cardName(c[1])) + '</b><small>' + esc(c[2]) + " \u00b7 " + esc(setName(setOf(c))) + "</small>" +
        "<small>" + esc(c[4] || "") + (p ? " \u00b7 US$" + p[1] : "") + "</small></div>";
    }).join("") : '<div class="msg">No encontr\u00e9 cartas con eso. Prob\u00e1 solo con el n\u00famero (143/128) o con otra parte del nombre.</div>';
  }
  function bestPrice(prices, prefer) {
    var ks = Object.keys(prices || {}); if (!ks.length) return null;
    if (prefer && prices[prefer]) return [prefer, prices[prefer]];
    var k = ks.filter(function (k) { return !/reverse/i.test(k); })[0] || ks[0];
    return [k, prices[k]];
  }

  // ------------------------------------------------------------------ detalle
  function titleFor(c, catId) {
    var cat = S.cats.filter(function (x) { return x.id == catId; })[0];
    var set = cat ? cat.name : setName(setOf(c));
    return [cardName(c[1]), BASICAS[c[4]] ? "" : c[4], c[2], set].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 80);
  }
  function catOptions(sel, L) {
    var rootRe = ROOTS[L];
    var list = S.cats.filter(function (c) { return c.leaf && rootRe.test(c.root); });
    var others = S.cats.filter(function (c) { return c.leaf && !rootRe.test(c.root); });
    var opt = function (c) { return '<option value="' + c.id + '"' + (c.id == sel ? " selected" : "") + ">" + esc(c.path) + "</option>"; };
    return '<option value="">\u2014 Eleg\u00ed la categor\u00eda \u2014</option>' + list.map(opt).join("") + (others.length ? '<optgroup label="Otras categor\u00edas">' + others.map(opt).join("") + "</optgroup>" : "");
  }
  function showDetail(c) {
    S.sel = c; S.own = null;
    root.querySelectorAll(".t").forEach(function (t) { t.classList.toggle("on", t.dataset.pid == c[0]); });
    var setFull = setOf(c), cat = guessCat(setFull, c.L);
    var keys = Object.keys(c[5] || {}), bp = bestPrice(c[5]);
    $("#det").innerHTML = '<img class="big" id="big" src="' + IMG(c[0], 1000) + '" alt="">' +
      '<div class="foto"><label class="sec">Usar foto propia<input id="own" type="file" accept="image/*" hidden></label>' +
      '<button class="sec" id="rmown" hidden>Volver a la de stock</button><span id="fotoinfo">o peg\u00e1 (Ctrl+V) / arrastr\u00e1 una imagen ac\u00e1</span></div>' +
      '<div><b>' + esc(cardName(c[1])) + "</b> \u00b7 " + esc(c[2]) + '<br><small class="hint">' + esc(setFull) + " \u00b7 " + esc(c[4] || "sin rareza") + "</small></div>" +
      '<label>T\u00edtulo del producto<input id="ti" maxlength="80"></label>' +
      '<label>Categor\u00eda<select id="ca">' + catOptions(cat, c.L) + "</select></label>" +
      '<div class="row"><label>Precio TCGplayer<select id="pk">' + (keys.length ? keys.map(function (k) { return '<option value="' + esc(k) + '"' + (bp && bp[0] === k ? " selected" : "") + ">" + esc(k) + " \u00b7 US$" + c[5][k] + "</option>"; }).join("") : '<option value="">Sin precio</option>') + "</select></label>" +
      '<label>Precio $<input id="pr" type="number" min="1" step="1"></label></div>' +
      '<div class="row"><label>Stock<input id="st" type="number" min="1" step="1" value="1"></label><label>&nbsp;<button class="go" id="add">Cargar nueva</button></label></div>' +
      '<div id="out"></div><div id="ex" class="hint">Buscando si ya la ten\u00e9s cargada\u2026</div>' +
      '<div class="log" id="log"></div>';
    $("#ti").value = titleFor(c, cat);
    var setPrice = function () { var k = $("#pk").value; $("#pr").value = k ? sugerido(c[5][k]) || "" : ""; };
    setPrice();
    $("#pk").onchange = setPrice;
    $("#ca").onchange = function () { $("#ti").value = titleFor(c, $("#ca").value); };
    $("#add").onclick = function () { crear(c); };
    $("#own").onchange = function () { if (this.files && this.files[0]) setOwn(this.files[0]); this.value = ""; };
    $("#rmown").onclick = function () { setOwn(null); };
    renderLog();
    existentes(c);
  }
  async function existentes(c) {
    var box = $("#ex");
    try {
      var name = cardName(c[1]).replace(/\(.*?\)/g, "").trim();
      var list = await api("/producto?search=" + encodeURIComponent(name) + "&limit=60");
      if (S.sel !== c) return;
      var num = nnum(c[2]);
      var hits = (list || []).filter(function (p) { return norm(p.p_nombre).split(" ").some(function (w) { return w.indexOf("/") > 0 && nnum(w) === num; }); });
      if (!hits.length) { box.innerHTML = "No hay ning\u00fan producto con ese nombre y n\u00famero en tu tienda."; return; }
      box.innerHTML = "<b>Ya ten\u00e9s cargada" + (hits.length > 1 ? "s estas" : " esta") + ":</b>" + hits.map(function (p) {
        var s = (p.stock || [])[0] || {};
        S.oldImgs[p.idProductos] = (p.imagenes || []).map(function (i) { return i.i_link; }).filter(Boolean);
        return '<div class="ex">' + (S.oldImgs[p.idProductos][0] ? '<img src="' + CDN + S.oldImgs[p.idProductos][0] + '" alt="" style="width:46px;height:64px;object-fit:contain;flex:none;border-radius:4px">' : "") + '<div>' + esc(p.p_nombre) + "<br><small>Stock " + (s.s_ilimitado ? "ilimitado" : s.s_cantidad) + " \u00b7 " + money(p.p_precio) + (p.p_desactivado ? " \u00b7 desactivado" : "") + "</small></div>" +
          '<div style="display:flex;flex-direction:column;gap:6px;flex:none"><button class="sec" data-id="' + p.idProductos + '">Sumar stock</button>' +
          ((p.stock || []).length === 1 && !s.s_ilimitado ? '<button class="sec" data-re="' + p.idProductos + '" data-lbl="' + (+s.s_cantidad > 0 ? "Subir arriba" : "Borrar y publicar de nuevo") + '" title="Borra esta publicaci\u00f3n y la crea de nuevo (queda primera como reci\u00e9n subida), sum\u00e1ndole el stock de arriba">' + (+s.s_cantidad > 0 ? "Subir arriba" : "Borrar y publicar de nuevo") + "</button>" : "") + "</div></div>";
      }).join("") + '<label style="flex-direction:row;align-items:center;gap:6px;margin-top:6px"><input id="np" type="checkbox" style="width:auto"> y ponerle el precio de arriba</label>' +
        (hits.some(function (p) { var s = (p.stock || [])[0] || {}; return (p.stock || []).length === 1 && !s.s_ilimitado; }) ?
          '<label style="flex-direction:row;align-items:center;gap:6px"><input id="vf" type="checkbox" checked style="width:auto"> al republicar, usar la foto de la publicaci\u00f3n vieja</label>' : "");
      box.querySelectorAll("[data-id]").forEach(function (b) { b.onclick = function () { sumar(c, +b.dataset.id); }; });
      box.querySelectorAll("[data-re]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.ok) { crear(c, +b.dataset.re); return; }
          b.dataset.ok = "1"; b.textContent = "\u00bfSeguro? Toc\u00e1 de nuevo";
          b.style.background = "#c2410c"; b.style.color = "#fff";
          setTimeout(function () { if (b.isConnected) { delete b.dataset.ok; b.textContent = b.dataset.lbl; b.style.background = ""; b.style.color = ""; } }, 6000);
        };
      });
    } catch (e) { box.innerHTML = '<span class="err">No pude revisar si ya existe: ' + esc(e.message) + "</span>"; }
  }

  // ------------------------------------------------------------------ acciones
  function setOwn(f) {
    if (f && !/^image\/(jpe?g|png|webp)$/i.test(f.type)) { say("err", "La foto tiene que ser JPG, PNG o WEBP."); return; }
    if (f && f.size > 10 * 1024 * 1024) { say("err", "La foto pesa m\u00e1s de 10 MB."); return; }
    S.own = f || null;
    if (S.ownUrl) URL.revokeObjectURL(S.ownUrl);
    S.ownUrl = f ? URL.createObjectURL(f) : null;
    if ($("#big")) $("#big").src = S.ownUrl || IMG(S.sel[0], 1000);
    if ($("#rmown")) $("#rmown").hidden = !f;
    if ($("#fotoinfo")) $("#fotoinfo").textContent = f ? "Se va a subir tu foto (" + Math.round(f.size / 1024) + " KB)." : "o peg\u00e1 (Ctrl+V) / arrastr\u00e1 una imagen ac\u00e1";
  }
  root.addEventListener("paste", function (e) {
    if (!S.sel || host.hidden) return;
    var it = [].slice.call((e.clipboardData && e.clipboardData.items) || []).filter(function (i) { return /^image\//.test(i.type); })[0];
    if (it) { e.preventDefault(); setOwn(it.getAsFile()); }
  });
  document.addEventListener("paste", function (e) {
    if (!S.sel || host.hidden || e.composedPath().indexOf(host) >= 0) return;
    var it = [].slice.call((e.clipboardData && e.clipboardData.items) || []).filter(function (i) { return /^image\//.test(i.type); })[0];
    if (it) { e.preventDefault(); setOwn(it.getAsFile()); }
  });
  ["dragover", "dragleave", "drop"].forEach(function (ev) {
    root.addEventListener(ev, function (e) {
      var det = e.target.closest && e.target.closest("#det"); if (!det || !S.sel) return;
      e.preventDefault();
      det.classList.toggle("drop", ev === "dragover");
      if (ev === "drop" && e.dataTransfer.files && e.dataTransfer.files[0]) setOwn(e.dataTransfer.files[0]);
    });
  });
  function lock(on) { S.busy = on; root.querySelectorAll("#det button").forEach(function (b) { b.disabled = on; }); }
  function say(cls, html) { $("#out").innerHTML = '<div class="' + cls + '">' + html + "</div>"; }
  async function crear(c, reemplaza) {
    if (S.busy) return;
    var cat = $("#ca").value, title = $("#ti").value.trim(), price = Math.round(+$("#pr").value), stock = Math.round(+$("#st").value);
    if (!cat) return say("err", "Eleg\u00ed la categor\u00eda.");
    if (!title) return say("err", "Falta el t\u00edtulo.");
    if (!(price > 0)) return say("err", "Pon\u00e9 un precio.");
    if (!(stock > 0) && !(reemplaza && stock === 0)) return say("err", "Pon\u00e9 el stock (1 o m\u00e1s).");
    lock(true);
    var reemplazada = false, nota = "", vieja = [];
    if (reemplaza) {                   // datos frescos de la publicaci\u00f3n vieja: stock, precio y fotos
      try {
        var vp = await api("/producto/" + reemplaza), vs = (vp.stock || [])[0] || {};
        if ((vp.stock || []).length !== 1 || vs.s_ilimitado) throw new Error("Ese producto tiene variantes o stock ilimitado; republicalo desde el panel.");
        stock += +vs.s_cantidad || 0;
        if (!($("#np") && $("#np").checked)) price = Math.round(+vs.s_precio || +vp.p_precio || price);
        if (!S.own && $("#vf") && $("#vf").checked) vieja = (vp.imagenes || []).map(function (i) { return i.i_link; }).filter(Boolean);
      } catch (e) { lock(false); return say("err", "No se pudo republicar: " + esc(e.message)); }
      if (!(stock > 0)) { lock(false); return say("err", "Pon\u00e9 el stock (1 o m\u00e1s)."); }
    }
    async function subirStock() {
      say("hint", "Subiendo la foto\u2026");
      var blob = S.own || await fetch(IMG(c[0], 1000), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("No pude bajar la foto de la carta"); return r.blob(); });
      var fd = new FormData(); fd.append("max_width", "600"); fd.append("max_height", "1200");
      fd.append("images[]", S.own ? S.own : new File([blob], "carta-" + c[0] + ".jpg", { type: blob.type || "image/jpeg" }));
      var up = await api("/upload/products", { method: "POST", body: fd });
      if (!up || !up.length) throw new Error("Empretienda no devolvi\u00f3 la foto subida");
      return up.slice(0, 1);
    }
    try {
      var imgs = vieja.length ? vieja : await subirStock();
      var borrada = "";
      if (reemplaza) {                 // Empretienda no deja dos productos con el mismo nombre: primero se borra la vieja (sin stock)
        say("hint", "Borrando la publicaci\u00f3n vieja\u2026");
        await api("/producto/" + reemplaza, { method: "DELETE" });
        borrada = " La publicaci\u00f3n vieja se borr\u00f3.";
        reemplazada = true;
      }
      say("hint", "Creando el producto\u2026");
      var payload = function (fotos) { return {
        atributos: [], imagenes: fotos, categorias_secundarias: [+cat], idCategorias: +cat,
        p_nombre: title, p_descripcion: "", p_tipo_venta: 0, p_producto_digital: 0, p_cantidad_minima: 1, p_atributos: 0,
        stock: [{ idStock: -1, s_alto: "1", s_ancho: "1", s_peso: "0.01", s_profundidad: "1", s_precio: String(price), s_precio_oferta: "",
          s_sku: "", s_precio_mayorista: "", s_cantidad: String(stock), s_cantidad_minima: "1", s_producto_digital_link: "",
          s_producto_digital_observacion: "", s_producto_digital_plazo: "", s_mostrar_precio: 1, s_imagen: 0 }]
      }; };
      var prod;
      try { prod = await api("/producto", { method: "POST", json: payload(imgs) }); }
      catch (e1) {
        if (!vieja.length || /ya existe/i.test(e1.message)) throw e1;
        prod = await api("/producto", { method: "POST", json: payload(await subirStock()) });   // no acept\u00f3 la foto vieja: va la de stock
        nota = " Empretienda no acept\u00f3 la foto vieja, as\u00ed que puse la de stock.";
      }
      if (vieja.length && !nota) nota = " Con la foto de la publicaci\u00f3n vieja.";
      S.catMap[c.L + "|" + setOf(c)] = +cat; ls.set("cats", S.catMap);
      var id = prod && (prod.idProductos || (prod.producto && prod.producto.idProductos));
      S.log.unshift({ t: title, s: stock, p: price, id: id, nuevo: true, re: !!reemplaza });
      say("ok", "Listo: <b>" + esc(title) + "</b> " + (reemplaza ? "publicada de nuevo" : "cargada") + " con stock " + stock + " a " + money(price) + "." + borrada + nota + (id ? ' <a target="_blank" href="/productos/editar/' + id + '">Ver en el panel</a>' : ""));
      renderLog(); existentes(c);
      $("#q").focus(); $("#q").select();
    } catch (e) {
      var m = esc(e.message);
      if (reemplazada) m += ". <b>La publicaci\u00f3n vieja ya se borr\u00f3</b>: toc\u00e1 <b>Cargar nueva</b> para volver a intentar.";
      else if (/ya existe/i.test(e.message)) m += ". Ya hay un producto con ese t\u00edtulo: sumale stock, us\u00e1 <b>Borrar y publicar de nuevo</b> o cambi\u00e1 el t\u00edtulo.";
      say("err", "No se pudo cargar: " + m);
      if (reemplazada) existentes(c);
    }
    lock(false);
  }
  async function sumar(c, id) {
    if (S.busy) return;
    var n = Math.round(+$("#st").value), price = Math.round(+$("#pr").value), setPrice = $("#np") && $("#np").checked;
    if (!(n > 0)) return say("err", "Pon\u00e9 cu\u00e1nto stock sumar (1 o m\u00e1s).");
    if (setPrice && !(price > 0)) return say("err", "Pon\u00e9 el precio nuevo.");
    lock(true); say("hint", "Actualizando el stock\u2026");
    try {
      var p = await api("/producto/" + id), s = (p.stock || [])[0];
      if (!p.stock || p.stock.length !== 1) throw new Error("Ese producto tiene variantes; sumale el stock desde el panel.");
      if (s.s_ilimitado) throw new Error("Ese producto tiene stock ilimitado.");
      var total = (+s.s_cantidad || 0) + n, precio = setPrice ? price : s.s_precio;
      await api("/producto/" + id + "/stock", { method: "PUT", json: {
        idStock: s.idStock, idProductos: id, p_atributos: p.p_atributos || 0, atributos: [],
        s_precio: Number(precio) || 0, s_oferta: s.s_oferta || 0, s_precio_oferta: s.s_precio_oferta || 0, s_precio_mayorista: s.s_precio_mayorista || 0,
        s_cantidad_minima: s.s_cantidad_minima || 1, s_cantidad: total, s_sku: s.s_sku || "",
        s_producto_digital_link: s.s_producto_digital_link || "", s_producto_digital_plazo: s.s_producto_digital_plazo || "", s_producto_digital_observacion: s.s_producto_digital_observacion || ""
      } });
      S.log.unshift({ t: p.p_nombre, s: n, p: precio, id: id, nuevo: false, total: total });
      say("ok", "Listo: <b>" + esc(p.p_nombre) + "</b> ahora tiene stock " + total + (setPrice ? " y precio " + money(precio) : "") + ".");
      renderLog(); existentes(c);
      $("#q").focus(); $("#q").select();
    } catch (e) { say("err", "No se pudo actualizar: " + esc(e.message)); }
    lock(false);
  }
  function renderLog() {
    var el = $("#log"); if (!el) return;
    el.innerHTML = S.log.length ? "<b>Cargadas en esta sesi\u00f3n (" + S.log.length + ")</b><br>" + S.log.slice(0, 30).map(function (l) {
      return (l.re ? "Republicada: " : l.nuevo ? "Nueva: " : "Stock +" + l.s + " \u2192 " + l.total + ": ") + (l.id ? '<a target="_blank" href="/productos/editar/' + l.id + '">' + esc(l.t) + "</a>" : esc(l.t)) + (l.nuevo ? " (stock " + l.s + ", " + money(l.p) + ")" : "");
    }).join("<br>") + '<br><br>Cuando termines, toc\u00e1 <a target="_blank" href="https://github.com/aluminetcg/catalogo/actions/workflows/actualizar.yml">Run workflow</a> para que aparezcan en el buscador.' : "";
  }

  // ------------------------------------------------------------------ eventos
  var tq;
  $("#q").addEventListener("input", function () { clearTimeout(tq); tq = setTimeout(search, 150); });
  $("#q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var first = root.querySelector(".t"); if (first) first.click(); }
  });
  $("#res").addEventListener("click", function (e) {
    var t = e.target.closest(".t"); if (!t) return;
    var c = S.idx[t.dataset.l].cards.filter(function (x) { return x[0] == t.dataset.pid; })[0]; if (c) showDetail(c);
  });
  $("#lang").onchange = async function () { S.lang = this.value; ls.set("lang", S.lang); S.sel = null; try { await loadAll(); search(); } catch (e) { $("#res").innerHTML = '<div class="msg err">' + esc(e.message) + "</div>"; } };
  $("#mult").onchange = function () { S.mult = Math.max(0.1, +this.value || 1); ls.set("mult", S.mult); if (S.sel) $("#pk").onchange(); };

  window.__alumineCarga = { open: function () { host.hidden = false; $("#q").focus(); } };

  (async function init() {
    try {
      var meta = await fetch(PAGES + "data/singles/meta.json?t=" + Math.floor(Date.now() / 36e5)).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
      S.usd = meta.usd || 0;
      $("#dolar").textContent = S.usd ? "D\u00f3lar oficial " + money(S.usd) : "Sin d\u00f3lar: pon\u00e9 el precio a mano";
      await token();
      S.cats = flatCats(await api("/categoria"), [], []);
      await loadAll();
      $("#res").innerHTML = '<div class="msg">Escrib\u00ed el n\u00famero de la carta (por ejemplo 143/128) o parte del nombre.</div>';
      $("#q").focus();
    } catch (e) { $("#res").innerHTML = '<div class="msg err">' + esc(e.message) + "</div>"; }
  })();
})();
