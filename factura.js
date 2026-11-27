/* Facturador ARCA para el panel de Empretienda (ALUMINETCG).
   Se abre con el marcador "Facturar" estando en el detalle de una orden (panel.empretienda.com).
   Lee los datos de la orden de la pantalla, deja revisarlos y dispara el workflow "Facturar" del repo
   privado aluminetcg/facturador (que tiene el certificado). Después trae el PDF con el CAE. */
(function () {
  "use strict";
  var old = document.getElementById("alumine-factura");
  if (old) old.remove();

  var REPO = "https://api.github.com/repos/aluminetcg/facturador";
  var PROD_LISTO = false;      // pasa a true cuando esté el certificado de producción
  var host = document.createElement("div");
  host.id = "alumine-factura";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483000";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  var ls = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem("alumine-factura-" + k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem("alumine-factura-" + k); else localStorage.setItem("alumine-factura-" + k, JSON.stringify(v)); } catch (e) {} }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(s) { s = String(s || "").replace(/[^\d,.-]/g, ""); return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0; }
  function plata(v) { return "$" + v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var CSS = '<style>*{box-sizing:border-box}.bg{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#222}' +
    '.box{background:#fff;border-radius:14px;width:min(760px,100%);padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h2{margin:0 0 4px;font-size:20px}.sub{color:#666;margin-bottom:14px}' +
    'label{display:block;font-size:12px;color:#555;margin:10px 0 3px}input,select{width:100%;padding:7px 9px;border:1px solid #ccc;border-radius:8px;font:inherit}.row{display:flex;gap:10px}.row>*{flex:1;min-width:0}' +
    'table{width:100%;border-collapse:collapse;margin-top:6px}td,th{padding:4px;border-bottom:1px solid #eee;text-align:left;font-size:13px}th{font-size:12px;color:#555}td input{padding:5px 7px}' +
    '.tot{text-align:right;font-size:18px;font-weight:700;margin:12px 0}.btns{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}' +
    'button{padding:9px 16px;border-radius:8px;border:1px solid #bbb;background:#fff;font:inherit;cursor:pointer}button.ok{background:#4caf50;border-color:#4caf50;color:#fff;font-weight:600}button:disabled{opacity:.5;cursor:default}' +
    '.x{border:0;font-size:18px;padding:2px 8px}.msg{padding:10px 12px;border-radius:8px;margin-top:12px}.err{background:#fdecea;color:#a12}.info{background:#eef5ff}.bien{background:#e8f6ea}' +
    '.prueba{background:#fff4d6;border:1px solid #f0c040;padding:6px 10px;border-radius:8px;margin-bottom:8px;font-size:13px}a{color:#1a6fc4}</style>';

  function pantalla(html) {
    root.innerHTML = CSS + '<div class="bg"><div class="box">' + html + "</div></div>";
    var c = root.querySelector("[data-cerrar]");
    if (c) c.onclick = function () { host.remove(); };
  }

  if (location.hostname !== "panel.empretienda.com") {
    pantalla('<h2>Facturar</h2><p>Abrí una orden en <b>panel.empretienda.com</b> (Ventas → la orden) y tocá de nuevo el marcador.</p><div class="btns"><button data-cerrar>Cerrar</button></div>');
    return;
  }

  // ------------------------------------------------------------------ token de GitHub (lo pega el usuario)
  var TOKEN = ls.get("token", "");
  function pedirToken(error) {
    pantalla('<h2>Conectar el facturador</h2><div class="sub">Se hace una sola vez en esta compu.</div>' +
      (error ? '<div class="msg err">' + esc(error) + "</div>" : "") +
      '<ol style="padding-left:18px"><li>Entrá a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token nuevo</a>.</li>' +
      '<li>Nombre: <b>Facturador Empretienda</b>. Vencimiento: el que quieras (por ej. 1 año).</li>' +
      '<li>Resource owner: <b>aluminetcg</b>. Repository access: <b>Only select repositories</b> → <b>facturador</b>.</li>' +
      '<li>Permissions → Repository permissions: <b>Actions: Read and write</b> y <b>Contents: Read-only</b>.</li>' +
      '<li>Generate token, copialo y pegalo acá abajo.</li></ol>' +
      '<label>Token</label><input type="password" id="tk" autocomplete="off" placeholder="github_pat_...">' +
      '<div class="btns"><button data-cerrar>Cancelar</button><button class="ok" id="g">Guardar</button></div>');
    root.getElementById("g").onclick = function () {
      var t = root.getElementById("tk").value.trim();
      if (!t) return;
      TOKEN = t;
      gh("").then(function () { ls.set("token", t); iniciar(); })["catch"](function (e) { TOKEN = ""; pedirToken("Ese token no funcionó: " + e.message); });
    };
  }
  function gh(path, opt) {
    opt = opt || {};
    var h = { Authorization: "Bearer " + TOKEN, Accept: opt.raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    return fetch(REPO + path + (opt.method ? "" : (path.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now()),
      { method: opt.method || "GET", headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: "no-store" })
      .then(function (r) {
        if (r.status === 404 && opt.ok404) return null;
        if (r.status === 401 || r.status === 403) { ls.set("token", null); throw new Error("GitHub rechazó el token (" + r.status + "). Volvé a conectarlo."); }
        if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub " + r.status + ": " + t.slice(0, 200)); });
        return opt.raw ? r.blob() : r.status === 204 ? {} : r.json();
      });
  }

  // ------------------------------------------------------------------ leer la orden de la pantalla
  function leerOrden() {
    var txt = document.body.innerText, L = txt.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var o = { venta: "", nombre: "", doc: "", domicilio: "", cond_venta: "", items: [] };
    var m = txt.match(/Orden\s*#\s*(\d+)/);
    if (m) o.venta = m[1];
    function despues(titulo, campo) {      // "campo: valor" dentro de la sección que empieza en "titulo"
      var i = L.findIndex(function (l) { return l.indexOf(titulo) === 0; });
      if (i < 0) return "";
      for (var j = i + 1; j < Math.min(L.length, i + 40); j++) {
        var mm = L[j].match(new RegExp("^" + campo + "\\s*:\\s*(.*)$", "i"));
        if (mm) return mm[1].trim();
      }
      return "";
    }
    o.nombre = despues("Información de facturación", "Nombre completo") || despues("Enviar a", "Nombre completo");
    o.doc = (despues("Información de facturación", "(?:DNI|CUIT|CUIL|Documento)") || despues("Enviar a", "(?:DNI|CUIT|CUIL)")).replace(/\D/g, "");
    var calle = despues("Dirección de envío", "Calle"), nro = despues("Dirección de envío", "Número"),
      ciudad = despues("Dirección de envío", "Ciudad"), prov = despues("Dirección de envío", "Provincia");
    o.domicilio = [[calle, nro].filter(function (s) { return s && s !== "-"; }).join(" "), ciudad, prov].filter(Boolean).join(", ");
    m = txt.match(/Pago\s*:\s*([^\n]+)/);
    if (m) o.cond_venta = m[1].trim().replace(/\b\w+/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); });

    // productos: "3 x Nombre" ... "$29.067,00" entre "Detalle de la orden" y "Subtotal"
    var i0 = L.findIndex(function (l) { return /^Detalle de la orden/i.test(l); });
    var i1 = L.findIndex(function (l, k) { return k > i0 && /^Subtotal/i.test(l); });
    var cur = null;
    if (i0 >= 0) for (var k = i0 + 1; k < (i1 > 0 ? i1 : L.length); k++) {
      var l = L[k], q = l.match(/^(\d+)\s*x\s+(.+?)(?:\s+\$\s*([\d.]+,\d{2}))?$/);
      if (q) {
        cur = { d: q[2].trim(), c: +q[1], tot: q[3] ? num(q[3]) : 0 };
        o.items.push(cur);
        continue;
      }
      var pr = l.match(/^-?\$\s*-?[\d.]+,\d{2}$/);
      if (pr && cur && !cur.tot) cur.tot = num(l);
    }
    o.items.forEach(function (it) { it.p = it.c ? Math.round(it.tot / it.c * 100) / 100 : it.tot; delete it.tot; });
    // envío y descuentos (después de "Subtotal", antes de "Total")
    var it2 = L.findIndex(function (l, k) { return k > i1 && /^Total\b/i.test(l); });
    for (k = i1 + 1; i1 > 0 && k < (it2 > 0 ? it2 : i1 + 12); k++) {
      var et = L[k], val = null, mm2 = et.match(/^(.*?)\s+(-?\$\s*-?[\d.]+,\d{2})$/);
      if (mm2) { et = mm2[1]; val = mm2[2]; } else if (L[k + 1] && /^-?\$\s*-?[\d.]+,\d{2}$/.test(L[k + 1])) { val = L[k + 1]; k++; }
      if (val == null) continue;
      var v = num(val);
      if (/env[ií]o/i.test(et) && v > 0) o.items.push({ d: "Envío", c: 1, p: v });
      else if (/descuento|cup[oó]n|bonif/i.test(et) && v) o.items.push({ d: et, c: 1, p: -Math.abs(v) });
    }
    m = txt.match(/\bTotal\s*\n?\s*\$\s*([\d.]+,\d{2})/);
    o.total_pantalla = m ? num(m[1]) : 0;
    return o;
  }

  // ------------------------------------------------------------------ pantalla principal
  var ENT = PROD_LISTO ? ls.get("entorno", "homo") : "homo";
  function carpeta() { return "/contents/facturas/" + ENT; }

  function iniciar() {
    if (!TOKEN) return pedirToken();
    var o = leerOrden();
    if (!o.venta) {
      pantalla('<h2>Facturar</h2><p>No encontré la orden en esta pantalla. Abrí el detalle de una venta (donde dice <b>Orden #…</b>) y tocá de nuevo el marcador.</p><div class="btns"><button data-cerrar>Cerrar</button></div>');
      return;
    }
    pantalla('<h2>Orden #' + esc(o.venta) + '</h2><div class="msg info">Revisando si ya tiene factura…</div>');
    gh(carpeta() + "/venta-" + o.venta + ".json", { raw: true, ok404: true }).then(function (b) {
      if (!b) return opciones(o);
      return b.text().then(function (t) { yaFacturada(o, JSON.parse(t)); });
    })["catch"](function (e) { /token/i.test(e.message) ? pedirToken(e.message) : opciones(o, e.message); });
  }

  // primero: ¿con los datos del cliente o anónima?
  function opciones(o, aviso) {
    var t = o.items.reduce(function (s, it) { return s + it.c * it.p; }, 0);
    var big = 'style="display:block;width:100%;text-align:left;padding:14px 16px;margin-top:10px;border-radius:10px"';
    pantalla('<div style="display:flex;justify-content:space-between;align-items:center"><h2>Facturar orden #' + esc(o.venta) + '</h2><button class="x" data-cerrar>×</button></div>' +
      '<div class="sub">' + esc(o.nombre || "Cliente sin nombre") + " · " + plata(Math.round(t * 100) / 100) + "</div>" +
      (aviso ? '<div class="msg err">' + esc(aviso) + "</div>" : "") +
      (ENT === "homo" ? '<div class="prueba">Modo PRUEBA (homologación): las facturas no tienen validez. Lo cambiás en el paso siguiente.</div>' : "") +
      '<button ' + big + ' id="cli"><b>👤 Con los datos del cliente</b><br><small>Nombre, ' + (o.doc ? (o.doc.length === 11 ? "CUIT " : "DNI ") + esc(o.doc) : "documento") + " y domicilio de la orden</small></button>" +
      '<button ' + big + ' id="anon"><b>🧾 Anónima (consumidor final)</b><br><small>Sin nombre ni documento — válido para ventas de menos de $10.000.000</small></button>' +
      '<button ' + big + ' id="sinenv"' + (o.items.some(function (it) { return it.d === "Envío"; }) ? "" : " hidden") + '><b>📦 Con datos del cliente, sin el envío</b><br><small>Si el envío lo cobra / factura el correo aparte</small></button>' +
      '<div class="btns"><button data-cerrar>Cancelar</button></div>');
    root.getElementById("cli").onclick = function () { formulario(o, aviso); };
    root.getElementById("anon").onclick = function () { o.nombre = "Consumidor final"; o.doc = ""; o.domicilio = ""; o.anon = true; formulario(o, aviso); };
    root.getElementById("sinenv").onclick = function () { o.items = o.items.filter(function (it) { return it.d !== "Envío"; }); o.total_pantalla = 0; formulario(o, aviso); };
  }

  function yaFacturada(o, f) {
    pantalla('<h2>Orden #' + esc(o.venta) + " ya facturada</h2>" + (ENT === "homo" ? '<div class="prueba">Modo PRUEBA (homologación)</div>' : "") +
      '<div class="msg bien">Factura C <b>' + String(f.pto_vta).padStart(5, "0") + "-" + String(f.nro).padStart(8, "0") + "</b> · " + plata(f.total) +
      "<br>CAE " + esc(f.cae) + " · " + esc(f.nombre) + "</div>" +
      '<div class="btns"><button data-cerrar>Cerrar</button><button class="ok" id="pdf">Descargar PDF</button></div>');
    root.getElementById("pdf").onclick = function () { bajarPdf("facturas/" + ENT + "/venta-" + o.venta + ".pdf", o.venta); };
  }

  function formulario(o, aviso) {
    var docTipo = o.anon ? 99 : o.doc.length === 11 ? 80 : o.doc ? 96 : 99;
    var filas = o.items.map(function (it, i) {
      return '<tr><td><input data-i="' + i + '" data-k="d" value="' + esc(it.d) + '"></td><td style="width:70px"><input data-i="' + i + '" data-k="c" type="number" step="1" value="' + it.c + '"></td>' +
        '<td style="width:120px"><input data-i="' + i + '" data-k="p" type="number" step="0.01" value="' + it.p + '"></td><td style="width:100px;text-align:right" data-sub="' + i + '"></td><td style="width:30px"><button class="x" data-del="' + i + '">×</button></td></tr>';
    }).join("");
    pantalla('<div style="display:flex;justify-content:space-between;align-items:center"><h2>Facturar orden #' + esc(o.venta) + '</h2><button class="x" data-cerrar>×</button></div>' +
      '<div class="sub">Factura C · ' + (o.anon ? "anónima (consumidor final)" : "con datos del cliente") + ' · revisá antes de emitir · <a href="#" id="volver">← cambiar opción</a></div>' +
      (aviso ? '<div class="msg err">' + esc(aviso) + "</div>" : "") +
      '<label>Entorno</label><select id="ent"><option value="homo">Prueba (homologación, sin validez)</option><option value="prod"' + (PROD_LISTO ? "" : " disabled") + '>REAL (producción)' + (PROD_LISTO ? "" : " — falta el certificado real") + '</option></select>' +
      '<div class="row"><div><label>Cliente</label><input id="nombre" value="' + esc(o.nombre) + '"></div>' +
      '<div style="flex:.5"><label>Documento</label><select id="dt"><option value="96">DNI</option><option value="80">CUIT</option><option value="86">CUIL</option><option value="99">Sin identificar</option></select></div>' +
      '<div style="flex:.6"><label>Número</label><input id="dn" value="' + esc(o.doc) + '"></div></div>' +
      '<div class="row"><div><label>Domicilio</label><input id="dom" value="' + esc(o.domicilio) + '"></div><div style="flex:.5"><label>Condición de venta</label><input id="cv" value="' + esc(o.cond_venta || "Otra") + '"></div></div>' +
      '<table><thead><tr><th>Producto / Servicio</th><th>Cant.</th><th>Precio unit.</th><th style="text-align:right">Subtotal</th><th></th></tr></thead><tbody>' + filas + "</tbody></table>" +
      '<button id="add" style="margin-top:6px;font-size:13px">+ Agregar línea</button>' +
      '<div class="tot" id="tot"></div><div id="dif"></div><div id="msg"></div>' +
      '<div class="btns"><button data-cerrar>Cancelar</button><button class="ok" id="go">Emitir factura</button></div>');
    var $ = function (id) { return root.getElementById(id); };
    $("ent").value = ENT;
    $("volver").onclick = function (e) { e.preventDefault(); o.anon = false; iniciar(); };
    $("dt").value = String(docTipo);
    function total() {
      var t = 0;
      o.items.forEach(function (it, i) { var s = it.c * it.p; t += s; var td = root.querySelector('[data-sub="' + i + '"]'); if (td) td.textContent = plata(s); });
      t = Math.round(t * 100) / 100;
      $("tot").textContent = "Total " + plata(t);
      $("dif").innerHTML = o.total_pantalla && Math.abs(o.total_pantalla - t) > 0.01
        ? '<div class="msg err">Ojo: el total de la orden en Empretienda es ' + plata(o.total_pantalla) + ". Revisá las líneas.</div>" : "";
      $("go").textContent = ($("ent").value === "prod" ? "Emitir factura REAL por " : "Emitir factura de PRUEBA por ") + plata(t);
      return t;
    }
    root.querySelectorAll("tbody input").forEach(function (inp) {
      inp.oninput = function () { var it = o.items[+inp.dataset.i]; it[inp.dataset.k] = inp.dataset.k === "d" ? inp.value : parseFloat(inp.value) || 0; total(); };
    });
    root.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { o.items.splice(+b.dataset.del, 1); guardarCampos(); formulario(o); }; });
    $("add").onclick = function () { guardarCampos(); o.items.push({ d: "", c: 1, p: 0 }); formulario(o); };
    function guardarCampos() { o.nombre = $("nombre").value; o.doc = $("dn").value; o.domicilio = $("dom").value; o.cond_venta = $("cv").value; }
    $("ent").onchange = function () {
      ENT = $("ent").value; ls.set("entorno", ENT); guardarCampos(); iniciar();
    };
    total();
    $("go").onclick = function () {
      guardarCampos();
      var t = total(), items = o.items.filter(function (it) { return it.d.trim() && it.c && it.p; });
      if (t <= 0 || !items.length) { $("msg").innerHTML = '<div class="msg err">El total tiene que ser mayor a 0.</div>'; return; }
      var dt = +$("dt").value, dn = o.doc.replace(/\D/g, "");
      if (dt !== 99 && !dn) { $("msg").innerHTML = '<div class="msg err">Falta el número de documento (o elegí "Sin identificar").</div>'; return; }
      if (dt === 80 && dn.length !== 11) { $("msg").innerHTML = '<div class="msg err">El CUIT tiene que tener 11 números.</div>'; return; }
      emitir(o, { venta: o.venta, nombre: o.nombre || "Consumidor final", doc_tipo: dn ? dt : 99, doc_nro: dn || "0", domicilio: o.domicilio, cond_venta: o.cond_venta || "Otra", items: items }, t);
    };
  }

  function emitir(o, datos, t) {
    datos.req = o.venta + "-" + Date.now().toString(36);
    pantalla('<h2>Facturando orden #' + esc(o.venta) + "</h2>" + (ENT === "homo" ? '<div class="prueba">Modo PRUEBA (homologación)</div>' : "") +
      '<div class="msg info" id="st">Enviando a ARCA… (tarda alrededor de 30 segundos)</div><div class="btns"><button data-cerrar>Cerrar</button></div>');
    var st = root.getElementById("st");
    gh("/actions/workflows/facturar.yml/dispatches", { method: "POST", body: { ref: "main", inputs: { datos: JSON.stringify(datos), entorno: ENT } } })
      .then(function () {
        var inicio = Date.now();
        return new Promise(function (ok, mal) {
          (function poll() {
            gh(carpeta() + "/pedidos/" + datos.req + ".json", { raw: true, ok404: true }).then(function (b) {
              if (b) return b.text().then(function (x) { ok(JSON.parse(x)); });
              var s = Math.round((Date.now() - inicio) / 1000);
              if (s > 240) return mal(new Error("Tardó demasiado. Fijate en github.com/aluminetcg/facturador/actions si terminó."));
              st.textContent = "Esperando a ARCA… " + s + " s";
              setTimeout(poll, 5000);
            })["catch"](mal);
          })();
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.error || "ARCA rechazó la factura");
        pantalla('<h2>¡Factura emitida!</h2>' + (ENT === "homo" ? '<div class="prueba">Modo PRUEBA: esta factura no tiene validez</div>' : "") +
          '<div class="msg bien">Factura C <b>' + String(r.pto_vta).padStart(5, "0") + "-" + String(r.nro).padStart(8, "0") + "</b> · " + plata(r.total) +
          "<br>CAE <b>" + esc(r.cae) + "</b> (vence " + esc(r.cae_vto.replace(/(\d{4})(\d\d)(\d\d)/, "$3/$2/$1")) + ")</div>" +
          '<div class="btns"><button data-cerrar>Cerrar</button><button class="ok" id="pdf">Descargar PDF</button></div>');
        root.getElementById("pdf").onclick = function () { bajarPdf(r.pdf, o.venta); };
        bajarPdf(r.pdf, o.venta);
      })["catch"](function (e) {
        st.className = "msg err";
        st.textContent = "No se pudo facturar: " + e.message;
      });
  }

  function bajarPdf(ruta, venta, intento) {
    gh("/contents/" + ruta, { raw: true, ok404: true }).then(function (b) {
      if (!b) { if ((intento || 0) < 6) setTimeout(function () { bajarPdf(ruta, venta, (intento || 0) + 1); }, 4000); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
      a.download = "Factura-ALUMINETCG-orden-" + venta + (ENT === "homo" ? "-PRUEBA" : "") + ".pdf";
      document.body.appendChild(a); a.click(); a.remove();
    })["catch"](function (e) { alert("No se pudo bajar el PDF: " + e.message); });
  }

  iniciar();
})();
