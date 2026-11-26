/* Buscador avanzado de ALUMINETCG, para usar DENTRO de la tienda (aluminetcg.com.ar).
   Se carga con una sola línea en Empretienda > Etiquetas HTML > head:
     <script src="https://aluminetcg.github.io/catalogo/tienda.js" defer></script>
   Qué hace:
     - Reemplaza la búsqueda de la tienda (limitada a 24 resultados) por un buscador completo con filtros.
     - Cada carta tiene "Agregar al carrito", que usa el carrito real de la tienda (stock controlado por Empretienda).
   Los datos salen de data/cards.json, que se actualiza solo. */
(function () {
  "use strict";
  if (window.__alumineBuscador) return;
  window.__alumineBuscador = true;

  var DATA_URL = window.ALUMINE_DATA_URL || "https://aluminetcg.github.io/catalogo/data/cards.json";
  var PAGE = 60;
  var FACETS = [
    ["game", "Juego"], ["kind", "Tipo de producto"], ["lang", "Idioma"], ["year", "Año"], ["set", "Expansión"],
    ["rarity", "Rareza"], ["color", "Color (Magic)"], ["finish", "Acabado"], ["ptype", "Tipo"], ["super", "Clase de carta"], ["variant", "Variante"]
  ];
  var ALL = null, loading = null, view = [], shown = 0, root, facetSearch = {}, expanded = {};
  var state = { q: "", sort: "rel", stock: true, min: "", max: "", f: {} };
  FACETS.forEach(function (f) { state.f[f[0]] = new Set(); });

  var fmt = function (n) { return n == null ? "" : "$" + Math.round(n).toLocaleString("es-AR"); };
  var norm = function (s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim(); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (s) { return root.querySelector(s); };

  var CSS = "\
  :host{all:initial}\
  *{box-sizing:border-box;font-family:Rubik,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}\
  [hidden]{display:none!important}\
  .fab{position:fixed;left:16px;bottom:16px;z-index:2147482000;background:#111;color:#fff;border:0;border-radius:999px;padding:12px 18px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);display:flex;gap:8px;align-items:center}\
  .fab:hover{background:#333}\
  .ov{position:fixed;inset:0;z-index:2147483000;background:#f5f5f3;color:#1d2330;overflow-y:auto;font-size:15px;line-height:1.45}\
  .bar{position:sticky;top:0;z-index:5;background:#111;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center}\
  .bar b{white-space:nowrap}\
  .bar input{flex:1;min-width:0;padding:11px 14px;border:0;border-radius:10px;font-size:16px;background:#fff;color:#111}\
  .bar button{background:#fff;color:#111;border:0;border-radius:10px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}\
  .bar .cart{background:#16a34a;color:#fff}\
  .bar .fbtn{display:none}\
  .layout{max-width:1400px;margin:0 auto;padding:16px;display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:start}\
  aside{background:#fff;border:1px solid #e2e2dc;border-radius:12px;padding:6px 14px 14px;position:sticky;top:74px;max-height:calc(100vh - 90px);overflow:auto}\
  aside h3{margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6a7080;font-weight:600}\
  .opts{display:flex;flex-direction:column;gap:2px}\
  .vermas{margin-top:4px;padding:6px 8px;border:0;background:none;color:#2f5fd0;font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer;border-radius:8px}\
  .vermas:hover{background:#f0f0ec}\
  .opt{display:flex;gap:8px;align-items:center;padding:4px 6px;border-radius:8px;cursor:pointer}\
  .opt:hover{background:#f0f0ec}\
  .opt .n{margin-left:auto;color:#6a7080;font-size:12px}\
  .opt.zero{opacity:.45}\
  .mini,.row input,select{width:100%;padding:8px 10px;border:1px solid #d8d8d0;border-radius:8px;background:#fff;color:#111;font-size:14px}\
  .mini{margin-bottom:6px}\
  .row{display:flex;gap:8px}\
  .toggle{display:flex;gap:8px;align-items:center;padding:10px 6px 2px;cursor:pointer;font-weight:600}\
  .top{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap}\
  .top select{width:auto}\
  .count{font-weight:700}\
  .count small{font-weight:400;color:#6a7080}\
  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}\
  .chip{background:#e8e8e2;border-radius:999px;padding:4px 6px 4px 12px;font-size:13px;display:flex;gap:6px;align-items:center}\
  .chip button{border:0;background:none;cursor:pointer;color:#6a7080;font-size:16px;line-height:1}\
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:14px}\
  .card{background:#fff;border:1px solid #e2e2dc;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}\
  .imgw{aspect-ratio:5/7;background:#eeeee8;position:relative;display:block;font-size:0;color:transparent}\
  .imgw img{width:100%;height:100%;object-fit:contain;display:block}\
  .stock{position:absolute;left:8px;top:8px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#dcfce7;color:#15803d}\
  .stock.out{background:#ffedd5;color:#9a3412}\
  .card.out img{filter:grayscale(.85);opacity:.7}\
  .body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;flex:1}\
  .name{font-weight:700;line-height:1.25;color:#111;text-decoration:none}\
  .name:hover{text-decoration:underline}\
  .meta{color:#6a7080;font-size:12.5px}\
  .badges{display:flex;gap:4px;flex-wrap:wrap}\
  .badge{font-size:11px;background:#eeeee8;padding:2px 8px;border-radius:999px}\
  .price{margin-top:auto;padding-top:6px;font-size:18px;font-weight:800}\
  .tr{font-size:12.5px;color:#15803d;font-weight:600}\
  .buy{display:flex;gap:6px;margin-top:8px}\
  .buy input{width:54px;padding:8px 6px;border:1px solid #d8d8d0;border-radius:8px;font-size:14px;text-align:center}\
  .buy button{flex:1;background:#111;color:#fff;border:0;border-radius:8px;padding:9px 8px;font-size:13.5px;font-weight:600;cursor:pointer}\
  .buy button:hover{background:#333}\
  .buy button:disabled{background:#c9c9c2;cursor:default}\
  .buy button.ok{background:#16a34a}\
  .buy button.err{background:#b91c1c}\
  .msg{padding:48px 16px;text-align:center;color:#6a7080}\
  .more{height:60px}\
  @media (max-width:860px){\
    .layout{grid-template-columns:1fr;padding:12px}\
    .bar b{display:none}\
    .bar{flex-wrap:wrap;gap:8px}\
    .bar input{flex:1 1 100%;order:-1}\
    .bar button{flex:1}\
    .bar .fbtn{display:block}\
    aside{position:fixed;inset:0 18% 0 0;top:0;max-height:none;border-radius:0 12px 12px 0;z-index:8;transform:translateX(-105%);transition:transform .2s}\
    aside.open{transform:none;box-shadow:0 0 0 100vw rgba(0,0,0,.45)}\
    .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\
  }";

  var HTML = '\
  <button class="fab" id="fab" type="button">Buscador avanzado</button>\
  <div class="ov" id="ov" hidden role="dialog" aria-label="Buscador avanzado">\
    <div class="bar">\
      <b>Buscador</b>\
      <input id="q" type="search" placeholder="Buscar carta, número o expansión… ej: charizard 151, 058/165" autocomplete="off" enterkeyhint="search">\
      <button class="fbtn" id="openF" type="button">Filtros</button>\
      <button class="cart" id="cart" type="button">Carrito (<span id="cartN">0</span>)</button>\
      <button id="close" type="button" aria-label="Cerrar buscador">Cerrar</button>\
    </div>\
    <div class="layout">\
      <aside id="filters"></aside>\
      <div>\
        <div class="top"><div class="count" id="count"></div>\
          <label>Ordenar: <select id="sort"><option value="rel">Relevancia</option><option value="pa">Precio: menor a mayor</option><option value="pd">Precio: mayor a menor</option><option value="az">Nombre A–Z</option><option value="new">Más nuevos</option></select></label>\
        </div>\
        <div class="chips" id="chips"></div>\
        <div class="grid" id="grid"></div>\
        <div id="msg" class="msg">Cargando catálogo…</div>\
        <div class="more" id="more"></div>\
      </div>\
    </div>\
  </div>';

  // ------------------------------------------------------------------ datos
  function load() {
    if (ALL) return Promise.resolve();
    // version.json (chiquito, siempre fresco) dice qu\u00e9 versi\u00f3n del cat\u00e1logo pedir: as\u00ed se ve apenas se publica
    if (!loading) loading = fetch(DATA_URL.replace(/cards\.json$/, "version.json") + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })["catch"](function () { return {}; })
      .then(function (v) { return fetch(DATA_URL + "?v=" + encodeURIComponent(v.v || Math.floor(Date.now() / 6e5))); }).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.json();
    }).then(function (data) {
      ALL = Array.isArray(data) ? data : data.cards;
      ALL.forEach(function (c) {
        c._hay = norm([c.title, c.card, c.set, c.number, c.rarity, c.finish, c.ptype, c.super, c.game, c.lang, c.year, (c.color || []).join(" ")].join(" "));
        c._num = c.number ? c.number.toLowerCase() : "";
      });
      buildFilters();
    }).catch(function (e) { loading = null; $("#msg").textContent = "No pude cargar el catálogo. Probá de nuevo en un momento."; throw e; });
    return loading;
  }

  // -------------------------------------------------------------- filtrado
  function matches(c, skip) {
    if (state.stock && c.stock <= 0) return false;
    if (state.min !== "" && c.price < +state.min) return false;
    if (state.max !== "" && c.price > +state.max) return false;
    for (var i = 0; i < FACETS.length; i++) {
      var k = FACETS[i][0];
      if (k === skip) continue;
      if (!state.f[k].size) continue;
      if (Array.isArray(c[k]) ? !c[k].some(function (v) { return state.f[k].has(v); }) : !state.f[k].has(c[k] || (k === "color" ? "" : "Sin dato"))) return false;
    }
    return true;
  }
  function score(c, toks) {
    var s = 0, cn = norm(c.card);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (c._hay.indexOf(t) < 0) return -1;
      s += cn === t ? 6 : cn.indexOf(t) === 0 ? 4 : cn.indexOf(t) > 0 ? 3 : 1;
      if (c._num && (c._num === t || c._num.indexOf(t + "/") === 0)) s += 2;
    }
    return s;
  }
  function apply(keepScroll) {
    if (!ALL) return;
    var toks = norm(state.q).split(" ").filter(Boolean), out = [];
    ALL.forEach(function (c) {
      if (!matches(c)) return;
      if (toks.length) { var s = score(c, toks); if (s < 0) return; c._s = s; } else c._s = 0;
      out.push(c);
    });
    out.sort({
      rel: function (a, b) { return (b.stock > 0) - (a.stock > 0) || b._s - a._s || a.card.localeCompare(b.card); },
      pa: function (a, b) { return a.price - b.price; }, pd: function (a, b) { return b.price - a.price; },
      az: function (a, b) { return a.card.localeCompare(b.card) || a.price - b.price; },
      "new": function (a, b) { return b.id - a.id; }
    }[state.sort]);
    view = out; shown = 0;
    $("#grid").innerHTML = "";
    $("#msg").textContent = out.length ? "" : "No encontramos productos con esos filtros. Probá quitar alguno.";
    $("#msg").hidden = !!out.length;
    var inStock = out.reduce(function (n, c) { return n + (c.stock > 0); }, 0);
    $("#count").innerHTML = out.length.toLocaleString("es-AR") + " resultados <small>· " + inStock.toLocaleString("es-AR") + " con stock</small>";
    more(); chips(); facetCounts();
    if (!keepScroll) $("#ov").scrollTop = 0;
  }
  function cardHTML(c) {
    var out = c.stock <= 0, path = new URL(c.url).pathname;
    var stock = out ? '<span class="stock out">Sin stock</span>' : '<span class="stock">' + (c.stock >= 9999 ? "Disponible" : c.stock === 1 ? "Última unidad" : c.stock + " en stock") + "</span>";
    var badges = [c.rarity, c.finish, c.ptype, c.lang].filter(Boolean).map(function (b) { return '<span class="badge">' + esc(b) + "</span>"; }).join("");
    var max = c.stock >= 9999 ? 99 : c.stock;
    return '<div class="card' + (out ? " out" : "") + '">' +
      '<a class="imgw" href="' + esc(path) + '">' + stock + (c.img ? '<img loading="lazy" decoding="async" src="' + esc(c.img) + '" alt="' + esc(c.title) + '">' : "") + "</a>" +
      '<div class="body"><a class="name" href="' + esc(path) + '">' + esc(c.card) + "</a>" +
      '<div class="meta">' + esc(c.set) + (c.number ? " · " + esc(c.number) : "") + (c.year ? " · " + esc(c.year) : "") + "</div>" +
      '<div class="badges">' + badges + "</div>" +
      '<div class="price">' + fmt(c.price) + '</div><div class="tr">' + fmt(c.transfer) + " con transferencia</div>" +
      '<div class="buy">' + (out ? '<button disabled>Sin stock</button>' :
        '<input type="number" min="1" max="' + max + '" value="1" aria-label="Cantidad"><button type="button" data-add="' + c.id + '">Agregar al carrito</button>') +
      "</div></div></div>";
  }
  function more() {
    if (shown >= view.length) return;
    var next = view.slice(shown, shown + PAGE);
    $("#grid").insertAdjacentHTML("beforeend", next.map(cardHTML).join(""));
    shown += next.length;
  }

  // --------------------------------------------------------------- filtros
  function buildFilters() {
    var h = '<label class="toggle"><input type="checkbox" id="fStock" checked> Solo con stock</label>' +
      '<h3>Precio (ARS)</h3><div class="row"><input id="pMin" type="number" min="0" placeholder="Mín" inputmode="numeric"><input id="pMax" type="number" min="0" placeholder="Máx" inputmode="numeric"></div>';
    FACETS.forEach(function (f) { h += "<h3>" + f[1] + '</h3><input class="mini" data-fs="' + f[0] + '" placeholder="Buscar en ' + f[1].toLowerCase() + '…"><div class="opts" id="opts-' + f[0] + '"></div>'; });
    h += '<h3></h3><button class="mini" id="reset" type="button" style="cursor:pointer;font-weight:600">Limpiar filtros</button>';
    $("#filters").innerHTML = h;
    $("#fStock").onchange = function (e) { state.stock = e.target.checked; apply(); };
    var t; var deb = function () { clearTimeout(t); t = setTimeout(function () { state.min = $("#pMin").value; state.max = $("#pMax").value; apply(); }, 300); };
    $("#pMin").oninput = $("#pMax").oninput = deb;
    root.querySelectorAll("input.mini").forEach(function (i) { i.oninput = function () { facetSearch[i.dataset.fs] = norm(i.value); facetCounts(); }; });
    $("#reset").onclick = function () {
      state.stock = true; state.min = state.max = ""; FACETS.forEach(function (f) { state.f[f[0]].clear(); });
      $("#fStock").checked = true; $("#pMin").value = $("#pMax").value = ""; apply();
    };
    $("#filters").addEventListener("click", function (e) {
      var b = e.target.closest("[data-more]"); if (!b) return;
      expanded[b.dataset.more] = !expanded[b.dataset.more]; facetCounts();
    });
    $("#filters").addEventListener("change", function (e) {
      var i = e.target.closest("input[data-k]"); if (!i) return;
      var s = state.f[i.dataset.k]; if (i.checked) s.add(i.dataset.v); else s["delete"](i.dataset.v); apply(true);
    });
  }
  function facetCounts() {
    FACETS.forEach(function (f) {
      var k = f[0], counts = new Map();
      ALL.forEach(function (c) {
        if (!matches(c, k)) return;
        var vs = Array.isArray(c[k]) ? c[k] : k === "color" ? [] : [c[k] || "Sin dato"];      // color: solo Magic, y una carta puede tener varios
        vs.forEach(function (v) { counts.set(v, (counts.get(v) || 0) + 1); });
      });
      state.f[k].forEach(function (v) { if (!counts.has(v)) counts.set(v, 0); });
      var items = Array.from(counts.entries()), fs = facetSearch[k];
      root.querySelector('input.mini[data-fs="' + k + '"]').hidden = counts.size <= 8 && !fs;
      if (fs) items = items.filter(function (x) { return norm(x[0]).indexOf(fs) >= 0; });
      items.sort(function (a, b) { return (state.f[k].has(b[0]) - state.f[k].has(a[0])) || (k === "year" ? b[0].localeCompare(a[0]) : b[1] - a[1] || a[0].localeCompare(b[0])); });
      var lim = (expanded[k] || fs) ? 300 : Math.max(6, state.f[k].size);
      var btn = (!fs && items.length > Math.max(6, state.f[k].size)) ? '<button type="button" class="vermas" data-more="' + k + '">' + (expanded[k] ? "Ver menos" : "Ver más (" + (items.length - lim) + ")") + "</button>" : "";
      var ob = $("#opts-" + k), hd = ob.previousElementSibling && ob.previousElementSibling.previousElementSibling;
      if (hd && hd.tagName === "H3") hd.hidden = !items.length;     // sin opciones (p. ej. Color cuando no hay Magic): ocultar el t\u00edtulo
      $("#opts-" + k).innerHTML = items.slice(0, lim).map(function (x) {
        return '<label class="opt' + (x[1] ? "" : " zero") + '"><input type="checkbox" data-k="' + k + '" data-v="' + esc(x[0]) + '"' + (state.f[k].has(x[0]) ? " checked" : "") + "><span>" + esc(x[0]) + '</span><span class="n">' + x[1].toLocaleString("es-AR") + "</span></label>";
      }).join("") + btn;
    });
  }
  function chips() {
    var box = $("#chips"); box.innerHTML = "";
    FACETS.forEach(function (f) {
      state.f[f[0]].forEach(function (v) {
        var d = document.createElement("span"); d.className = "chip"; d.textContent = f[1] + ": " + v;
        var b = document.createElement("button"); b.textContent = "×"; b.setAttribute("aria-label", "Quitar filtro");
        b.onclick = function () { state.f[f[0]]["delete"](v); apply(true); }; d.appendChild(b); box.appendChild(d);
      });
    });
  }

  // --------------------------------------------------------------- carrito
  function cartTotal(data) {
    var n = 0, p = (data && data.productos) || {};
    Object.keys(p).forEach(function (k) { n += +p[k].cantidad || 0; });
    return n;
  }
  function addToCart(card, qty, btn) {
    var label = btn.textContent;
    var done = function (text, cls) {
      btn.textContent = text; if (cls) btn.classList.add(cls);
      setTimeout(function () { btn.textContent = label; btn.className = ""; btn.disabled = false; }, 2600);
    };
    btn.disabled = true; btn.textContent = "Agregando…";
    // La ficha del producto tiene los datos que pide el carrito (y confirma que sigue habiendo stock).
    fetch(new URL(card.url).pathname, { credentials: "same-origin" }).then(function (r) { return r.text(); }).then(function (html) {
      var f = new DOMParser().parseFromString(html, "text/html").querySelector("#add_to_cart-form");
      if (!f) throw new Error("Sin stock");
      var fd = new FormData();
      fd.append("product", f.querySelector('[name="product"]').value);
      fd.append("stock", f.querySelector('[name="stock"]').value);
      fd.append("quantity", String(qty));
      var token = window.csrf_token || (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
      return fetch("/v4/cart/add", { method: "POST", credentials: "same-origin", body: fd,
        headers: { "X-CSRF-TOKEN": token, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" } });
    }).then(function (r) { return r.json()["catch"](function () { return null; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var j = res.j;
        if (!res.ok || !j || j.status !== 200) {
          var d = j && j.message && j.message.description;
          throw new Error((Array.isArray(d) ? d.join(" ") : d) || "No se pudo agregar");
        }
        try { if (window.build_cart) window.build_cart(j.data, false, []); } catch (e) { }
        $("#cartN").textContent = cartTotal(j.data);
        done("Agregado ✓", "ok");
      })["catch"](function (e) { done(String(e.message || "No se pudo agregar").slice(0, 60), "err"); });
  }
  function openStoreCart() {
    close();
    var q = document.querySelector(".cart-qty");
    var t = q && q.closest("a,button,[uk-toggle]");
    if (t) t.click();
  }

  // ------------------------------------------------------------ abrir/cerrar
  function open(q) {
    $("#ov").hidden = false; $("#fab").hidden = true;
    document.documentElement.style.overflow = "hidden";
    var n = document.querySelector(".cart-qty"); if (n) $("#cartN").textContent = (n.textContent || "0").trim();
    if (typeof q === "string") { state.q = q; $("#q").value = q; }
    load().then(function () { apply(); });
    setTimeout(function () { $("#q").focus(); }, 50);
  }
  function close() {
    $("#ov").hidden = true; $("#fab").hidden = false;
    document.documentElement.style.overflow = "";
  }

  function init() {
    var host = document.createElement("div");
    host.id = "alumine-buscador";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + CSS + "</style>" + HTML;
    document.body.appendChild(host);

    $("#fab").onclick = function () { open(); };
    $("#close").onclick = close;
    $("#cart").onclick = openStoreCart;
    $("#openF").onclick = function () { $("#filters").classList.toggle("open"); };
    $("#ov").addEventListener("click", function (e) { if (!e.target.closest("aside") && e.target.id !== "openF") $("#filters").classList.remove("open"); });
    var qt; $("#q").addEventListener("input", function (e) { clearTimeout(qt); qt = setTimeout(function () { state.q = $("#q").value; apply(); }, 150); });
    $("#q").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); clearTimeout(qt); state.q = $("#q").value; apply(); $("#q").blur(); } });
    $("#sort").onchange = function (e) { state.sort = e.target.value; apply(); };
    $("#grid").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-add]"); if (!b || b.disabled) return;
      var card = ALL.find(function (c) { return String(c.id) === b.dataset.add; });
      var qty = Math.max(1, parseInt(b.parentNode.querySelector("input").value, 10) || 1);
      if (card) addToCart(card, qty, b);
    });
    new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) more(); }, { root: $("#ov"), rootMargin: "800px" }).observe($("#more"));
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#ov").hidden) close(); });

    // La búsqueda propia de la tienda (24 resultados) pasa a abrir este buscador.
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (f && f.matches && f.matches(".header-search__form")) {
        e.preventDefault(); e.stopPropagation();
        var i = f.querySelector('input[name="q"]');
        open(i ? i.value : "");
      }
    }, true);
    if (location.pathname === "/search") open(new URLSearchParams(location.search).get("q") || "");
    else if (location.hash === "#buscador") open();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* Filtro "Solo con stock" en las páginas de categoría de la tienda.
   Oculta los productos marcados SIN STOCK y va cargando más páginas solo hasta completar la grilla. */
(function () {
  "use strict";
  function init() {
    var feed = document.querySelector(".products-feed__products");
    if (!feed || document.querySelector(".alumine-stock-toggle")) return;
    var KEY = "alumine-solo-stock", on = false, want = 12, clicks = 0, waiting = false;
    try { on = localStorage.getItem(KEY) === "1"; } catch (e) { }
    var st = document.createElement("style");
    st.textContent = ".alumine-solo-stock .products-feed__product.alumine-out{display:none!important}" +
      ".alumine-stock-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;padding:8px 4px;user-select:none;white-space:nowrap}" +
      ".alumine-stock-toggle input{width:18px;height:18px;accent-color:#111;margin:0}" +
      ".alumine-stock-note{font-weight:400;opacity:.65;font-size:.9em}";
    document.head.appendChild(st);
    var label = document.createElement("label");
    label.className = "alumine-stock-toggle";
    label.innerHTML = '<input type="checkbox"> Solo con stock <span class="alumine-stock-note"></span>';
    var cb = label.querySelector("input"), note = label.querySelector("span");
    cb.checked = on;
    var head = document.querySelector(".category-feed__head");
    if (head) { var col = document.createElement("div"); col.className = "uk-width-auto"; col.appendChild(label); head.appendChild(col); }
    else feed.parentNode.insertBefore(label, feed);

    var btn = function () { var b = document.getElementById("products_feed-btn"); return b && b.offsetParent !== null && !b.disabled ? b : null; };
    function mark() {
      var hidden = 0, shown = 0;
      feed.querySelectorAll(".products-feed__product").forEach(function (p) {
        var out = !!p.querySelector(".products-feed__product-out-stock");
        p.classList.toggle("alumine-out", out);
        if (out) hidden++; else shown++;
      });
      feed.classList.toggle("alumine-solo-stock", on);
      note.textContent = on && hidden ? "(" + hidden + " sin stock ocultos)" : "";
      return shown;
    }
    function fill() {
      var shown = mark();
      if (!on || waiting || shown >= want || clicks >= 40) return;
      var b = btn(); if (!b) return;
      var before = feed.children.length;
      waiting = true; clicks++; b.click();
      setTimeout(function () { waiting = false; if (feed.children.length > before) fill(); }, 2500);
    }
    cb.addEventListener("change", function () {
      on = cb.checked; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { }
      fill();
    });
    document.addEventListener("click", function (e) {
      if (e.isTrusted && e.target.closest && e.target.closest("#products_feed-btn")) want += 12;
    }, true);
    new MutationObserver(function () { waiting = false; setTimeout(fill, 150); }).observe(feed, { childList: true });
    fill();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
