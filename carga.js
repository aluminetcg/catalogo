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
  var BASICAS = { "": 1, "Common": 1, "Uncommon": 1, "Rare": 1, "C": 1, "U": 1, "R": 1 };
  var ROOTS = { en: /ingl/i, jp: /jap/i, cn: /chin/i, mtg: /mtg|magic/i, mv: /marvel|\bdc\b/i };
  var MAN = { cn: 1, mv: 1 };          // bases armadas a mano: sin foto ni precio de referencia
  var RZ = ["", "AR", "SAR", "SR", "UR", "CHR", "CSR", "HR", "RR", "RRR", "Holo", "Reverse", "Masterball Reverse", "Pokeball Reverse", "Promo"];
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
  // efecto foil simulado: brillo arco\u00edris + reflejo diagonal sobre la foto de stock (las bases solo tienen escaneos sin brillo)
  async function foilize(blob) {
    // holo como el de las cartas foil: arco\u00edris suave de arriba hacia abajo, manchas difusas y textura fina
    var img = await createImageBitmap(blob), w = img.width, h = img.height;
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var x = cv.getContext("2d"); x.drawImage(img, 0, 0);
    var L = document.createElement("canvas"); L.width = w; L.height = h;
    var y = L.getContext("2d");
    var g = y.createLinearGradient(w * 0.2, 0, w * 0.8, h);
    [[0, 25], [0.18, 345], [0.36, 315], [0.5, 55], [0.62, 140], [0.78, 185], [0.9, 230], [1, 290]].forEach(function (s) { g.addColorStop(s[0], "hsl(" + s[1] + ",100%,62%)"); });
    y.fillStyle = g; y.fillRect(0, 0, w, h);
    [[0.15, 0.2, 330], [0.8, 0.35, 40], [0.25, 0.7, 170], [0.85, 0.85, 270]].forEach(function (b) {
      var r = y.createRadialGradient(w * b[0], h * b[1], 0, w * b[0], h * b[1], w * 0.55);
      r.addColorStop(0, "hsla(" + b[2] + ",100%,65%,.55)"); r.addColorStop(1, "hsla(" + b[2] + ",100%,65%,0)");
      y.fillStyle = r; y.fillRect(0, 0, w, h);
    });
    var n = y.getImageData(0, 0, w, h), d = n.data;               // textura granulada del foil
    for (var i = 0; i < d.length; i += 4) { var k = (Math.random() - 0.5) * 30; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
    y.putImageData(n, 0, 0);
    x.globalCompositeOperation = "overlay"; x.globalAlpha = 0.75; x.drawImage(L, 0, 0);
    x.globalCompositeOperation = "soft-light"; x.globalAlpha = 0.5; x.drawImage(L, 0, 0);
    x.globalCompositeOperation = "screen"; x.globalAlpha = 0.12; x.drawImage(L, 0, 0);
    return await new Promise(function (res) { cv.toBlob(res, "image/jpeg", 0.92); });
  }
  async function stockBlob(c) { return fetch(IMG(c[0], 1000), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("No pude bajar la foto de la carta"); return r.blob(); }); }
  // Magic: misma carta impresa en espa\u00f1ol, desde la API p\u00fablica de Scryfall (sus im\u00e1genes no se pueden alterar: sin efecto foil)
  async function scryfallEs(c) {
    S.esCache = S.esCache || {};
    if (c[0] in S.esCache) return S.esCache[c[0]];
    var name = mtgName(c[1]).split(" // ")[0].replace(/"/g, ""), cn = String(c[2] || "").replace(/^0+(?=\d)/, "");
    var q = '!"' + name + '" lang:es' + (cn ? " cn:" + cn : "");
    var url = null;
    try {
      var r = await fetch("https://api.scryfall.com/cards/search?unique=prints&include_extras=true&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
      if (r.ok) {
        var d = (await r.json()).data || [], want = norm(setName(setOf(c)));
        var best = d.filter(function (x) { return norm(x.set_name) === want; })[0] || d[0];
        if (best) url = (best.image_uris || (best.card_faces && best.card_faces[0].image_uris) || {}).large || null;
      }
    } catch (e) { url = null; }
    S.esCache[c[0]] = url;
    return url;
  }
  async function foilPreview(c) {
    var on = $("#fx") && $("#fx").checked;
    if (S.own || S.sel !== c) return;
    if ($("#es") && $("#es").checked && S.esCache && S.esCache[c[0]]) { $("#big").src = S.esCache[c[0]]; return; }
    if (!on) { $("#big").src = IMG(c[0], 1000); return; }
    try {
      if (!S.foilBlob || S.foilFor !== c) { S.foilBlob = await foilize(await stockBlob(c)); S.foilFor = c; if (S.foilUrl) URL.revokeObjectURL(S.foilUrl); S.foilUrl = URL.createObjectURL(S.foilBlob); }
      if (S.sel === c && $("#fx").checked && !S.own) $("#big").src = S.foilUrl;
    } catch (e) { $("#fx").checked = false; $("#fotoinfo").textContent = "No pude aplicar el efecto foil: " + e.message; }
  }
  // precio m\u00ednimo: $649 normal, $739 foil de Magic, $849 rare/mythic de Magic, $1389 holo o reverse holo de Pok\u00e9mon
  function minimo(c, k, foil) {
    if (c.L !== "mtg") return /holo/i.test(k || "") ? 1389 : 649;
    var rare = /^(rare|mythic)/i.test(c[4] || "") ? 849 : 649;          // Rare y Mythic de Magic: $849
    return Math.max(rare, foil || /foil/i.test(k || "") ? 739 : 649);
  }
  function sugerido(usd, min) { if (!usd || !S.usd) return 0; var v = usd * S.usd * S.mult; return Math.max(min || 649, Math.ceil(v / 100) * 100 - 21); }

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
    '.ph{width:100%;aspect-ratio:1;background:#f4f2ec;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:44px;color:#c9c3b3}' +
    '.nof{border:2px dashed #e3dfd3;border-radius:12px;padding:26px 14px;text-align:center;color:#6a7080;font-size:13px}' +
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
    '<select id="lang"><option value="all">Pok\u00e9mon Ingl\u00e9s + Japon\u00e9s + Chino</option><option value="en">Pok\u00e9mon Ingl\u00e9s</option><option value="jp">Pok\u00e9mon Japon\u00e9s</option><option value="cn">Pok\u00e9mon Chino (a mano)</option><option value="mtg">Magic</option><option value="mv">Marvel y DC vintage (a mano)</option></select>' +
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
    var d = await fetch(PAGES + "data/singles/" + lang + ".json?t=" + Math.floor(Date.now() / 36e5)).then(function (r) { if (!r.ok && MAN[lang]) return { sets: [], cards: [] }; if (!r.ok) throw new Error("No encontr\u00e9 la base de cartas (" + r.status + ")"); return r.json(); });
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
  function langs() { return S.lang === "all" ? ["en", "jp", "cn"] : S.lang === "cn" ? ["en", "cn"] : [S.lang]; }
  // Magic: "Nombre (Borderless)" de TCGplayer -> nombre y variante por separado
  function mtgName(n) { return cardName(n).replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim(); }
  function mtgVar(n) { return (cardName(n).match(/\(([^)]*)\)/g) || []).map(function (v) { return v.slice(1, -1); }).join(" "); }
  function searchLangs() { return S.lang === "all" ? ["en", "jp", "cn"] : [S.lang]; }
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
  // chino: no hay base de cartas; se arma la carta con el nombre (en ingl\u00e9s) y el n\u00famero que escrib\u00eds
  function nameList() {
    if (S.names || !S.idx.en) return S.names || [];
    var cnt = {};
    S.idx.en.cards.forEach(function (c) { var n = cardName(c[1]).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim(); if (n) cnt[n] = (cnt[n] || 0) + 1; });
    S.names = Object.keys(cnt).map(function (n) { return { n: n, w: norm(n), k: cnt[n] }; });
    return S.names;
  }
  function cnKey(c) { var t = String(c[2]).split("/")[1]; return "cn|" + (t ? "/" + nnum(t) : "promo"); }
  // chino solo con n\u00famero: busca ese n\u00famero en la tienda y muestra lo que ya ten\u00e9s cargado
  async function storeByNum(num) {
    var q0 = $("#q").value;
    $("#res").innerHTML = '<div class="msg">Buscando ' + esc(num) + ' en tu tienda\u2026</div>';
    var list = [];
    try { list = await api("/producto?search=" + encodeURIComponent(num) + "&limit=60") || []; }
    catch (e) { if ($("#q").value === q0) $("#res").innerHTML = '<div class="msg err">' + esc(e.message) + "</div>"; return; }
    if ($("#q").value !== q0 || S.lang !== "cn") return;
    var nn = nnum(num);
    list = list.filter(function (p) { return norm(p.p_nombre).split(" ").some(function (w) { return nn.indexOf("/") > 0 ? nnum(w) === nn : nnum(w).split("/")[0] === nn; }); });
    S.cnRes = list.map(function (p, i) {
      var t = String(p.p_nombre), k = norm(t).split(" "), pos = t.split(/\s+/).findIndex(function (w) { return nnum(norm(w)) === nnum(norm(num)) || nnum(norm(w)).split("/")[0] === nn; });
      var before = t.split(/\s+/).slice(0, Math.max(pos, 1)), rz = "";
      for (var j = RZ.length - 1; j > 0; j--) { var rw = RZ[j].split(" "); if (before.slice(-rw.length).join(" ").toLowerCase() === RZ[j].toLowerCase()) { rz = RZ[j]; before = before.slice(0, -rw.length); break; } }
      var name = before.join(" ").replace(/\b(special illustration rare|illustration rare)$/i, "").trim() || before.join(" ");
      var c = ["cn" + i, name, (t.split(/\s+/)[pos] || num), 0, rz, {}]; c.L = "cn"; c.img = ((p.imagenes || [])[0] || {}).i_link; c.full = t; return c;
    });
    $("#res").innerHTML = (S.cnRes.length ? '<div class="msg" style="padding:8px 0 0;text-align:left">Ya en tu tienda con el n\u00famero ' + esc(num) + ":</div>" + S.cnRes.map(function (c, i) {
      return '<div class="t" data-i="' + i + '" data-l="cn">' + (c.img ? '<img loading="lazy" src="' + CDN + c.img + '" alt="">' : '<div class="ph">\u4e2d</div>') + "<b>" + esc(c.full) + "</b></div>";
    }).join("") : '<div class="msg">No ten\u00e9s nada con el n\u00famero <b>' + esc(num) + "</b> en tu tienda.</div>") +
      '<div class="t" data-i="' + S.cnRes.length + '" data-l="cn"><div class="ph">+</div><b>Cargar nueva con el ' + esc(num) + "</b><small>El nombre lo escrib\u00eds despu\u00e9s</small></div>";
    var ab = num.split("/").map(function (p) { return +((p.match(/\d+/) || [0])[0]); });
    var nc = ["cnN", "", num, 0, ab.length === 2 && ab[1] && ab[0] > ab[1] ? "AR" : "", {}]; nc.L = "cn"; S.cnRes.push(nc);
  }
  function searchCn(quiet) {
    var raw = $("#q").value, toks = norm(raw).split(" ").filter(Boolean);
    var names = toks.filter(function (t) { return !/\d/.test(t); });
    var num = (raw.split(/\s+/).filter(function (t) { return /\d/.test(t); })[0] || "").replace(/[^A-Za-z0-9\/]/g, "").toUpperCase();
    S.cnRes = [];
    if (!names.length && num && !quiet) return storeByNum(num);
    if (!names.length || !num) { if (quiet) return ""; $("#res").innerHTML = '<div class="msg">Chino: escrib\u00ed el nombre en ingl\u00e9s y el n\u00famero, por ejemplo <b>zeraora 210/208</b>. No hay foto ni precio de referencia: la foto es opcional y el precio lo pon\u00e9s vos.</div>'; return; }
    var typed = names.join(" ");
    var found = nameList().filter(function (x) { var ws = x.w.split(" "); return names.every(function (t) { return ws.some(function (w) { return w.indexOf(t) === 0; }); }); });
    found.sort(function (a, b) { return (b.w === typed) - (a.w === typed) || (b.w.indexOf(typed) === 0) - (a.w.indexOf(typed) === 0) || b.k - a.k || a.n.length - b.n.length; });
    var opts = found.slice(0, 30).map(function (x) { return x.n; });
    if (!found.some(function (x) { return x.w === typed; })) opts.push(typed.replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); }));
    var ab = num.split("/").map(function (p) { return +((p.match(/\d+/) || [0])[0]); });
    var rz = ab.length === 2 && ab[1] && ab[0] > ab[1] ? "AR" : "";
    S.cnRes = opts.map(function (n, i) { var c = ["cn" + i, n, num, 0, rz, {}]; c.L = "cn"; return c; });
    var html = S.cnRes.map(function (c, i) {
      return '<div class="t" data-i="' + i + '" data-l="cn"><div class="ph">\u4e2d</div><b><span class="lg">CHI</span> ' + esc(c[1]) + "</b><small>" + esc(num) + (i === S.cnRes.length - 1 && !found.some(function (x) { return x.w === typed; }) ? " \u00b7 tal cual lo escribiste" : "") + "</small></div>";
    }).join("");
    if (quiet) return html;
    $("#res").innerHTML = html;
  }
  function search() {
    var L = searchLangs().filter(function (l) { return S.idx[l]; }); if (!L.length) return;
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
    if (S.lang === "cn" && !out.length) return searchCn();
    if (S.lang === "mv" && !out.length) { $("#res").innerHTML = '<div class="msg">No est\u00e1 en la base de Marvel y DC. Si es de un set que todav\u00eda no cargamos, pasame la lista del set.</div>'; return; }
    var cnHtml = S.lang === "all" || S.lang === "cn" ? searchCn(true) || "" : "";
    if (cnHtml) cnHtml = '<div class="msg" style="padding:8px 0 0;text-align:left">Chino a mano (si no est\u00e1 en la base):</div>' + cnHtml;
    $("#res").innerHTML = out.length || cnHtml ? out.map(function (c) {
      var p = bestPrice(c[5]);
      return '<div class="t' + (S.sel === c ? " on" : "") + '" data-pid="' + esc(c[0]) + '" data-l="' + c.L + '">' + (MAN[c.L] ? (c[6] ? '<img loading="lazy" src="' + esc(c[6]) + '" alt="">' : '<div class="ph">' + (c.L === "cn" ? "\u4e2d" : "\u2605") + '</div>') : '<img loading="lazy" src="' + IMG(c[0], 200) + '" alt="">') +
        '<b>' + (L.length > 1 || MAN[c.L] ? '<span class="lg">' + (c.L === "jp" ? "JAP" : c.L === "cn" ? "CHI" : c.L === "mtg" ? "MTG" : c.L === "mv" ? "M/DC" : "ING") + "</span> " : "") + esc(cardName(c[1])) + '</b><small>' + esc(c[2]) + " \u00b7 " + esc(setName(setOf(c))) + "</small>" +
        "<small>" + esc(c[4] || "") + (p ? " \u00b7 US$" + p[1] : "") + "</small></div>";
    }).join("") + cnHtml : '<div class="msg">No encontr\u00e9 cartas con eso. Prob\u00e1 solo con el n\u00famero (143/128) o con otra parte del nombre.</div>';
  }
  function bestPrice(prices, prefer) {
    var ks = Object.keys(prices || {}); if (!ks.length) return null;
    if (prefer && prices[prefer]) return [prefer, prices[prefer]];
    var k = prices.Normal ? "Normal" : ks.filter(function (k) { return !/reverse|foil/i.test(k); })[0] || ks.filter(function (k) { return !/reverse/i.test(k); })[0] || ks[0];   // por defecto la versi\u00f3n normal, no la foil
    return [k, prices[k]];
  }

  // ------------------------------------------------------------------ detalle
  function titleFor(c, catId) {
    var cat = S.cats.filter(function (x) { return x.id == catId; })[0];
    if (c.L === "mv") return [setOf(c) + " #" + c[2], "-", c[1]].join(" ").replace(/\s+/g, " ").slice(0, 80);   // "1990 Impel Marvel Universe #19 - Mister Fantastic"
    var set = cat ? cat.name : c.L === "cn" ? "" : setName(setOf(c));
    if (c.L === "mtg") {     // como ya est\u00e1n en la tienda: "Saruman of Many Colors #35 Borderless Foil The Hobbit"
      var foil = ($("#pk") && /foil/i.test($("#pk").value)) || ($("#fx") && $("#fx").checked) ? "Foil" : "";
      return [mtgName(c[1]), "#" + c[2], mtgVar(c[1]), foil, set].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 80);
    }
    return [cardName(c[1]), BASICAS[c[4]] ? "" : c[4], c[2], set].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 80);
  }
  function catOptions(sel, L) {
    var rootRe = ROOTS[L], f = MAN[L] ? "path" : "root";
    var list = S.cats.filter(function (c) { return c.leaf && rootRe.test(c[f]); });
    var others = S.cats.filter(function (c) { return c.leaf && !rootRe.test(c[f]); });
    var opt = function (c) { return '<option value="' + c.id + '"' + (c.id == sel ? " selected" : "") + ">" + esc(c.path) + "</option>"; };
    return '<option value="">\u2014 Eleg\u00ed la categor\u00eda \u2014</option>' + list.map(opt).join("") + (others.length ? '<optgroup label="Otras categor\u00edas">' + others.map(opt).join("") + "</optgroup>" : "");
  }
  function showDetailCn(c) {
    S.sel = c; S.own = null;
    root.querySelectorAll(".t").forEach(function (t) { t.classList.toggle("on", (t.dataset.l === "cn" && S.cnRes[+t.dataset.i] === c) || (t.dataset.pid !== undefined && t.dataset.pid == c[0])); });
    var L = c.L, setFull = typeof c[0] === "string" && c[0].indexOf(L + "|") === 0 ? setOf(c) : "";
    var cat = (setFull && (S.catMap[L + "|" + setFull] || guessCat(setFull, L))) || (L === "cn" && S.catMap[cnKey(c)]) || S.catMap[L + "|last"] || "";
    var rzs = RZ.indexOf(c[4]) >= 0 ? RZ : RZ.concat([c[4]]);
    $("#det").innerHTML = '<img class="big" id="big" alt="" hidden><div class="nof" id="nof">Sin foto (es opcional).<br>Peg\u00e1 (Ctrl+V), arrastr\u00e1 o eleg\u00ed una foto si quer\u00e9s ponerle.</div>' +
      '<div class="foto"><label class="sec">Elegir foto<input id="own" type="file" accept="image/*" hidden></label>' +
      '<button class="sec" id="rmown" hidden>Sacar la foto</button><span id="fotoinfo"></span></div>' +
      (c[6] ? '<label style="flex-direction:row;align-items:center;gap:6px"><input id="uf" type="checkbox" checked style="width:auto"> Usar la foto de tu publicaci\u00f3n anterior de esta carta</label>' : "") +
      '<div class="row"><label>Nombre<input id="nm"></label><label' + (L === "cn" ? "" : " hidden") + '>Rareza<select id="rz">' + rzs.map(function (r) { return '<option value="' + esc(r) + '"' + (r === c[4] ? " selected" : "") + ">" + esc(r || "(ninguna)") + "</option>"; }).join("") + "</select></label></div>" +
      (setFull ? '<div class="hint">De tu base ' + (L === "cn" ? "china" : "Marvel y DC") + ": " + esc(setFull) + " #" + esc(c[2]) + "</div>" : "") +
      '<label>T\u00edtulo del producto<input id="ti" maxlength="80"></label>' +
      '<label>Categor\u00eda<select id="ca">' + catOptions(cat, L) + "</select></label>" +
      '<div class="row"><label>Precio $<input id="pr" type="number" min="1" step="1" placeholder="a mano"></label><label>Stock<input id="st" type="number" min="1" step="1" value="1"></label></div>' +
      '<button class="go" id="add">Cargar nueva</button>' +
      '<div id="out"></div><div id="ex" class="hint">Buscando si ya la ten\u00e9s cargada\u2026</div>' +
      '<div class="log" id="log"></div>';
    $("#nm").value = c[1];
    $("#ti").value = titleFor(c, cat);
    if (c[6]) { $("#big").src = c[6]; $("#big").hidden = false; $("#nof").hidden = true; $("#fotoinfo").textContent = "Foto de una publicaci\u00f3n tuya de esta carta."; }
    var te;
    $("#nm").oninput = function () { c[1] = this.value.trim(); $("#ti").value = titleFor(c, $("#ca").value); clearTimeout(te); te = setTimeout(function () { $("#ex").innerHTML = "Buscando si ya la ten\u00e9s cargada\u2026"; existentes(c); }, 500); };
    $("#rz").onchange = function () { c[4] = this.value; $("#ti").value = titleFor(c, $("#ca").value); };
    $("#ca").onchange = function () { $("#ti").value = titleFor(c, $("#ca").value); };
    $("#add").onclick = function () { crear(c); };
    $("#own").onchange = function () { if (this.files && this.files[0]) setOwn(this.files[0]); this.value = ""; };
    $("#rmown").onclick = function () { setOwn(null); };
    renderLog();
    existentes(c);
  }
  function showDetail(c) {
    if (MAN[c.L]) return showDetailCn(c);
    S.sel = c; S.own = null;
    root.querySelectorAll(".t").forEach(function (t) { t.classList.toggle("on", t.dataset.pid == c[0]); });
    var setFull = setOf(c), cat = guessCat(setFull, c.L);
    var keys = Object.keys(c[5] || {}), bp = bestPrice(c[5]);
    $("#det").innerHTML = '<img class="big" id="big" src="' + IMG(c[0], 1000) + '" alt="">' +
      '<div class="foto"><label class="sec">Usar foto propia<input id="own" type="file" accept="image/*" hidden></label>' +
      '<button class="sec" id="rmown" hidden>Volver a la de stock</button><span id="fotoinfo">o peg\u00e1 (Ctrl+V) / arrastr\u00e1 una imagen ac\u00e1</span></div>' +
      (c.L === "mtg" ? '<label style="flex-direction:row;align-items:center;gap:6px"><input id="fx" type="checkbox" style="width:auto"> Efecto foil en la foto de stock</label>' +
        '<label id="eslb" style="flex-direction:row;align-items:center;gap:6px" hidden><input id="es" type="checkbox" style="width:auto"> Usar la foto de la carta en espa\u00f1ol (Scryfall, sin efecto foil)</label>' : "") +
      '<div><b>' + esc(cardName(c[1])) + "</b> \u00b7 " + esc(c[2]) + '<br><small class="hint">' + esc(setFull) + " \u00b7 " + esc(c[4] || "sin rareza") + "</small></div>" +
      '<label>T\u00edtulo del producto<input id="ti" maxlength="80"></label>' +
      '<label>Categor\u00eda<select id="ca">' + catOptions(cat, c.L) + "</select></label>" +
      '<div class="row"><label>Precio TCGplayer<select id="pk">' + (keys.length ? keys.map(function (k) { return '<option value="' + esc(k) + '"' + (bp && bp[0] === k ? " selected" : "") + ">" + esc(k) + " \u00b7 US$" + c[5][k] + "</option>"; }).join("") : '<option value="">Sin precio</option>') + "</select></label>" +
      '<label>Precio $<input id="pr" type="number" min="1" step="1"></label></div>' +
      '<div class="row"><label>Stock<input id="st" type="number" min="1" step="1" value="1"></label><label>&nbsp;<button class="go" id="add">Cargar nueva</button></label></div>' +
      '<div id="out"></div><div id="ex" class="hint">Buscando si ya la ten\u00e9s cargada\u2026</div>' +
      '<div class="log" id="log"></div>';
    $("#ti").value = titleFor(c, cat);
    var setPrice = function () { var k = $("#pk").value; $("#pr").value = k ? sugerido(c[5][k], minimo(c, k)) || "" : ""; if (c.L === "mtg") { $("#ti").value = titleFor(c, $("#ca").value); $("#fx").checked = /foil/i.test(k) && !$("#es").checked; foilPreview(c); } };
    setPrice();
    $("#pk").onchange = setPrice;
    if ($("#fx")) $("#fx").onchange = function () {     // tildar foil = pasar a la versi\u00f3n foil (precio y t\u00edtulo); destildar = volver a la normal
      var on = this.checked, ks = Object.keys(c[5] || {});
      var k = on ? ks.filter(function (k) { return /foil/i.test(k); })[0] : (c[5].Normal ? "Normal" : ks.filter(function (k) { return !/foil/i.test(k); })[0]);
      if (k && k !== $("#pk").value) { $("#pk").value = k; setPrice(); }
      else if ($("#pk").value) $("#pr").value = sugerido(c[5][$("#pk").value], minimo(c, $("#pk").value, on)) || "";     // sin precio foil: igual el m\u00ednimo de foil
      $("#fx").checked = on; $("#ti").value = titleFor(c, $("#ca").value); foilPreview(c);
      if (on && !k) say("hint", "TCGplayer no tiene precio foil de esta carta: le puse Foil al t\u00edtulo, pero revis\u00e1 el precio.");
    };
    if ($("#es")) {
      $("#es").onchange = function () { $("#fx").disabled = this.checked; if (this.checked) $("#fx").checked = false; foilPreview(c); };
      scryfallEs(c).then(function (u) { if (u && S.sel === c && $("#eslb")) $("#eslb").hidden = false; });
    }
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
      if (!name) { box.innerHTML = "Escrib\u00ed el nombre para revisar si ya la ten\u00e9s."; return; }
      var list = await api("/producto?search=" + encodeURIComponent(name) + "&limit=60");
      if (S.sel !== c) return;
      var num = nnum(c[2]);
      // n\u00famero con total (143/128): tiene que coincidir entero. Promos sin total (MEP099, SVP012, 099): alcanza con el n\u00famero
      var dig = (String(c[2]).split("/")[0].match(/\d+/g) || [""]).pop().replace(/^0+/, "");
      var hits = (list || []).filter(function (p) { return norm(p.p_nombre).split(" ").some(function (w) {
        if (num.indexOf("/") > 0) return w.indexOf("/") > 0 && nnum(w) === num;
        var m = w.match(/^[a-z]*0*(\d+)[a-z]*$/); return !!dig && !!m && m[1] === dig;
      }); });
      var viejas = false;
      if (!hits.length && c.L === "mtg") {      // publicaciones de Magic de antes, sin n\u00famero en el t\u00edtulo: alcanza con el nombre exacto
        var nm = norm(name);
        hits = (list || []).filter(function (p) { var t = norm(p.p_nombre); return (t === nm || t.indexOf(nm + " ") === 0) && !/#\s*\d/.test(p.p_nombre); });
        viejas = hits.length > 0;
      }
      if (!hits.length) { box.innerHTML = "No hay ning\u00fan producto con ese nombre y n\u00famero en tu tienda."; return; }
      box.innerHTML = (viejas ? "<b>Ten\u00e9s publicaciones con este nombre pero sin n\u00famero</b> (de antes). Fijate en la foto si es la misma versi\u00f3n:" :
        "<b>Ya ten\u00e9s cargada" + (hits.length > 1 ? "s estas" : " esta") + ":</b>") + hits.map(function (p) {
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
    var cn = S.sel && MAN[S.sel.L];
    if ($("#big")) { $("#big").src = S.ownUrl || (cn ? S.sel[6] || "" : IMG(S.sel[0], 1000)); if (cn) $("#big").hidden = !f && !S.sel[6]; }
    if (!f && !cn && (($("#fx") && $("#fx").checked) || ($("#es") && $("#es").checked))) foilPreview(S.sel);
    if ($("#nof")) $("#nof").hidden = !!f || !!(cn && S.sel[6]);
    if ($("#rmown")) $("#rmown").hidden = !f;
    if ($("#fotoinfo")) $("#fotoinfo").textContent = f ? "Se va a subir tu foto (" + Math.round(f.size / 1024) + " KB)." : cn ? "" : "o peg\u00e1 (Ctrl+V) / arrastr\u00e1 una imagen ac\u00e1";
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
    if (MAN[c.L] && !c[1]) return say("err", "Falta el nombre de la carta.");
    if (!(price > 0) && !reemplaza) return say("err", "Pon\u00e9 un precio.");
    if (!(stock > 0) && !(reemplaza && stock === 0)) return say("err", "Pon\u00e9 el stock (1 o m\u00e1s).");
    lock(true);
    var reemplazada = false, nota = "", vieja = [];
    if (MAN[c.L] && !S.own && c[6] && c[6].indexOf(CDN) === 0 && $("#uf") && $("#uf").checked) vieja = [c[6].slice(CDN.length)];   // foto de tu publicaci\u00f3n anterior
    if (reemplaza) {                   // datos frescos de la publicaci\u00f3n vieja: stock, precio y fotos
      try {
        var vp = await api("/producto/" + reemplaza), vs = (vp.stock || [])[0] || {};
        if ((vp.stock || []).length !== 1 || vs.s_ilimitado) throw new Error("Ese producto tiene variantes o stock ilimitado; republicalo desde el panel.");
        stock += +vs.s_cantidad || 0;
        if (!($("#np") && $("#np").checked)) price = Math.round(+vs.s_precio || +vp.p_precio || price);
        if (!S.own && $("#vf") && $("#vf").checked) vieja = (vp.imagenes || []).map(function (i) { return i.i_link; }).filter(Boolean);
      } catch (e) { lock(false); return say("err", "No se pudo republicar: " + esc(e.message)); }
      if (!(stock > 0)) { lock(false); return say("err", "Pon\u00e9 el stock (1 o m\u00e1s)."); }
      if (!(price > 0)) { lock(false); return say("err", "Pon\u00e9 un precio."); }
    }
    async function subirStock() {
      if (MAN[c.L] && !S.own) return [];             // chino sin foto: el producto va sin imagen
      say("hint", "Subiendo la foto\u2026");
      var es = !S.own && $("#es") && $("#es").checked && S.esCache && S.esCache[c[0]];
      var foil = !S.own && !es && $("#fx") && $("#fx").checked;
      var blob = S.own || (es && await fetch(es).then(function (r) { if (!r.ok) throw new Error("No pude bajar la foto en espa\u00f1ol"); return r.blob(); })) ||
        (foil && S.foilFor === c && S.foilBlob) || await stockBlob(c);
      if (foil && blob !== S.foilBlob) blob = await foilize(blob);
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
      if (MAN[c.L]) { if (c.L === "cn") S.catMap[cnKey(c)] = +cat; S.catMap[c.L + "|last"] = +cat; if (typeof c[0] === "string" && c[0].indexOf(c.L + "|") === 0) S.catMap[c.L + "|" + setOf(c)] = +cat; } else S.catMap[c.L + "|" + setOf(c)] = +cat;
      ls.set("cats", S.catMap);
      var id = prod && (prod.idProductos || (prod.producto && prod.producto.idProductos));
      S.log.unshift({ t: title, s: stock, p: price, id: id, nuevo: true, re: !!reemplaza });
      say("ok", "Listo: <b>" + esc(title) + "</b> " + (reemplaza ? "publicada de nuevo" : "cargada") + " con stock " + stock + " a " + money(price) + "." + borrada + nota + (id ? ' <a target="_blank" href="/productos/editar/' + id + '">Ver en el panel</a>' : ""));
      renderLog(); existentes(c);
      $("#q").focus(); $("#q").select();
    } catch (e) {
      var m = esc(e.message);
      if (reemplazada) m += ". <b>La publicaci\u00f3n vieja ya se borr\u00f3</b>: toc\u00e1 <b>Cargar nueva</b> para volver a intentar.";
      else if (MAN[c.L] && !S.own && !vieja.length && /imag|foto/i.test(e.message)) m += ". Parece que Empretienda pide foto: agreg\u00e1 una (pegala o arrastrala) y prob\u00e1 de nuevo.";
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
    if (t.dataset.l === "cn" && t.dataset.i !== undefined) { if (S.cnRes[+t.dataset.i]) showDetail(S.cnRes[+t.dataset.i]); return; }
    var c = S.idx[t.dataset.l].cards.filter(function (x) { return x[0] == t.dataset.pid; })[0]; if (c) showDetail(c);
  });
  $("#lang").onchange = async function () { S.lang = this.value; ls.set("lang", S.lang); S.sel = null; try { await loadAll(); search(); } catch (e) { $("#res").innerHTML = '<div class="msg err">' + esc(e.message) + "</div>"; } };
  $("#mult").onchange = function () { S.mult = Math.max(0.1, +this.value || 1); ls.set("mult", S.mult); if (S.sel && $("#pk")) $("#pk").onchange(); };

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
