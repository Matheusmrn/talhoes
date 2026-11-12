// ============================================================================
// campo.js — uso no campo e no celular: GPS no mapa, desenhar caminhando,
// pontos com foto no diário, tema escuro, gaveta/menu do celular e
// instalação como aplicativo (PWA).
// ============================================================================
"use strict";

const ehCelular = () => window.matchMedia("(max-width: 900px)").matches;
const temGPS = () => "geolocation" in navigator;
const metros = (a, b) => mapa.distance(a, b);

// ---------------- GPS: minha posição no mapa ----------------
const gps = {watch:null, marca:null, circ:null, seguir:true, ultimo:null};
function valorNoPixel(r, lat, lon){
  if (!r || !r.pilha) return null;
  const [x0,y0,x1,y1] = r.bbox; if (lon < x0 || lon > x1 || lat < y0 || lat > y1) return null;
  const cam = ["ndvi","ndmi","ndre"].includes(estado.camada) ? estado.camada : "ndvi";
  const i = estado.mesIdx >= 0 ? estado.mesIdx : r.meses.length-1, g = r.pilha[cam].meses[i]; if (!g) return null;
  const px = Math.min(g.w-1, Math.floor((lon-x0)/(x1-x0)*g.w)), py = Math.min(g.h-1, Math.floor((y1-lat)/(y1-y0)*g.h));
  const v = g.v[py*g.w + px]; return isNaN(v) ? null : {cam, v, data:r.meses[i].data};
}
function textoGPS(p){
  let t = `Você está aqui (±${Math.round(p.acc)} m)`;
  const val = valorNoPixel(estado.resultado, p.lat, p.lon);
  if (val) t += `<br><b>${INDICES[val.cam].sigla} ${fmt(val.v)}</b> neste ponto (${val.data})`;
  const t2 = talhoes.find(t => { const b = L.geoJSON(t.geom).getBounds(); return b.contains([p.lat, p.lon]); });
  if (t2) t += `<br>Talhão: ${esc(t2.nome)}`;
  return t;
}
function ligarGPS(){
  if (!temGPS()){ toast("Este aparelho/navegador não tem GPS disponível.", true); return; }
  if (gps.watch != null){ desligarGPS(); return; }
  gps.seguir = true; btnGPS.classList.add("on");
  gps.watch = navigator.geolocation.watchPosition(pos => {
    const p = {lat:pos.coords.latitude, lon:pos.coords.longitude, acc:pos.coords.accuracy}; gps.ultimo = p;
    const ll = [p.lat, p.lon];
    if (!gps.marca){
      gps.circ = L.circle(ll, {radius:p.acc, color:"#1e88e5", weight:1, fillOpacity:.12, interactive:false}).addTo(mapa);
      gps.marca = L.circleMarker(ll, {radius:8, color:"#fff", weight:3, fillColor:"#1e88e5", fillOpacity:1}).addTo(mapa).bindPopup("");
      mapa.setView(ll, Math.max(mapa.getZoom(), 16));
    } else { gps.marca.setLatLng(ll); gps.circ.setLatLng(ll).setRadius(p.acc); if (gps.seguir) mapa.panTo(ll, {animate:true}); }
    gps.marca.setPopupContent(textoGPS(p));
  }, e => { toast("GPS: " + (e.code === 1 ? "permissão negada. Libere a localização para este site." : e.message), true); desligarGPS(); },
  {enableHighAccuracy:true, maximumAge:5000, timeout:20000});
  mapa.once("dragstart", () => gps.seguir = false);
}
function desligarGPS(){
  if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch);
  gps.watch = null; btnGPS.classList.remove("on");
  if (gps.marca){ mapa.removeLayer(gps.marca); mapa.removeLayer(gps.circ); gps.marca = gps.circ = null; }
}
let btnGPS;
const ControleGPS = L.Control.extend({ options:{position:"topleft"}, onAdd(){
  const d = L.DomUtil.create("div", "leaflet-bar ctlgps");
  btnGPS = L.DomUtil.create("a", "", d); btnGPS.href = "#"; btnGPS.title = "Minha localização (GPS)"; btnGPS.setAttribute("role", "button");
  btnGPS.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  L.DomEvent.on(btnGPS, "click", e => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); if (gps.watch != null && !gps.seguir && gps.ultimo){ gps.seguir = true; mapa.setView([gps.ultimo.lat, gps.ultimo.lon]); return; } ligarGPS(); });
  return d;
}});
mapa.addControl(new ControleGPS());

// ---------------- Desenhar o talhão caminhando ----------------
const cam = {watch:null, pts:[], linha:null, painel:null, pausado:false};
function iniciarCaminhada(){
  if (!temGPS()){ toast("Este aparelho não tem GPS disponível.", true); return; }
  if (cam.watch != null) return;
  cam.pts = []; cam.pausado = false;
  cam.linha = L.polyline([], {color:"#00ff3c", weight:4}).addTo(mapa);
  const p = document.createElement("div"); p.className = "caminhada";
  p.innerHTML = `<b>🚶 Gravando o contorno</b><span id="camInfo">Aguardando o GPS…</span>
    <div class="row"><button id="camPausa">Pausar</button><button id="camDesfaz" title="Apagar o último ponto">↶</button><button class="primary" id="camOk">Concluir</button><button id="camSair">Cancelar</button></div>
    <p class="hint">Ande pela divisa do talhão. Os pontos só são gravados com boa precisão (até 25 m) e a cada 4 m.</p>`;
  $("cardMapa").appendChild(p); cam.painel = p;
  p.querySelector("#camPausa").onclick = () => { cam.pausado = !cam.pausado; p.querySelector("#camPausa").textContent = cam.pausado ? "Continuar" : "Pausar"; };
  p.querySelector("#camDesfaz").onclick = () => { cam.pts.pop(); cam.linha.setLatLngs(cam.pts); info(); };
  p.querySelector("#camSair").onclick = () => { if (!cam.pts.length || confirm("Descartar o contorno gravado?")) pararCaminhada(); };
  p.querySelector("#camOk").onclick = concluirCaminhada;
  let acc = null;
  const info = () => {
    const ha = cam.pts.length >= 3 ? areaHa({type:"Polygon", coordinates:[[...cam.pts.map(q => [q[1], q[0]]), [cam.pts[0][1], cam.pts[0][0]]]]}) : 0;
    p.querySelector("#camInfo").textContent = `${cam.pts.length} pontos${acc != null ? ` · precisão ±${Math.round(acc)} m` : ""}${ha ? ` · ${fmt(ha,2)} ha` : ""}${cam.pausado ? " · PAUSADO" : ""}`;
  };
  cam.watch = navigator.geolocation.watchPosition(pos => {
    acc = pos.coords.accuracy;
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (!cam.pausado && acc <= 25 && (!cam.pts.length || metros(cam.pts[cam.pts.length-1], ll) >= 4)){
      cam.pts.push(ll); cam.linha.setLatLngs(cam.pts);
      if (cam.pts.length === 1) mapa.setView(ll, Math.max(mapa.getZoom(), 17)); else mapa.panTo(ll);
    }
    info();
  }, e => { toast("GPS: " + (e.code === 1 ? "permissão negada." : e.message), true); }, {enableHighAccuracy:true, maximumAge:0, timeout:30000});
  if (ehCelular()) fecharGaveta();
  $("cardMapa").scrollIntoView({behavior:"smooth", block:"start"});
}
function pararCaminhada(){
  if (cam.watch != null) navigator.geolocation.clearWatch(cam.watch);
  cam.watch = null; if (cam.linha) mapa.removeLayer(cam.linha); cam.linha = null;
  if (cam.painel) cam.painel.remove(); cam.painel = null;
}
function concluirCaminhada(){
  if (cam.pts.length < 3){ toast("Grave pelo menos 3 pontos para fechar o contorno.", true); return; }
  const anel = cam.pts.map(q => [q[1], q[0]]); anel.push(anel[0]);
  const geom = {type:"Polygon", coordinates:[anel]};
  pararCaminhada();
  desenhados.clearLayers();
  L.geoJSON(geom, {style:estiloContorno}).eachLayer(l => desenhados.addLayer(l));
  mapa.fitBounds(desenhados.getBounds(), {padding:[30,30]});
  limparResultado(); definirAtual({id:null, geom});
  toast(`Contorno gravado: ${fmt(areaHa(geom),2)} ha. Dê um nome e salve.`);
  if (ehCelular()) abrirGaveta();
  setTimeout(() => $("nomeTalhao").focus(), 300);
}
$("btnCaminhar").onclick = iniciarCaminhada;

// ---------------- Diário: local e foto ----------------
const pend = {lat:null, lon:null, foto:null, url:null};
let marcaPend = null;
function atualizarPend(){
  $("evLocalTxt").textContent = pend.lat != null ? "Local ✓" : "Local";
  $("btnEvLocal").classList.toggle("on", pend.lat != null);
  $("evFotoTxt").textContent = pend.foto ? "Foto ✓" : "Foto";
  const pv = $("evPrevia");
  if (pend.url || pend.lat != null){
    pv.style.display = "";
    pv.innerHTML = `${pend.url ? `<img src="${pend.url}" alt="">` : ""}<span>${pend.lat != null ? `📍 ${pend.lat.toFixed(5)}, ${pend.lon.toFixed(5)}` : ""}</span><button title="Remover local e foto">✕</button>`;
    pv.querySelector("button").onclick = limparPend;
  } else { pv.style.display = "none"; pv.innerHTML = ""; }
}
function limparPend(){
  if (pend.url) URL.revokeObjectURL(pend.url);
  pend.lat = pend.lon = pend.foto = pend.url = null;
  if (marcaPend){ mapa.removeLayer(marcaPend); marcaPend = null; }
  atualizarPend();
}
function definirLocal(lat, lon){
  pend.lat = lat; pend.lon = lon;
  if (marcaPend) mapa.removeLayer(marcaPend);
  marcaPend = L.marker([lat, lon], {draggable:true}).addTo(mapa).bindTooltip("Local do registro (arraste para ajustar)");
  marcaPend.on("dragend", () => { const ll = marcaPend.getLatLng(); pend.lat = ll.lat; pend.lon = ll.lng; atualizarPend(); });
  atualizarPend();
}
$("btnEvLocal").onclick = () => {
  const corpo = abrirModal("Local do registro", `<div class="escolha">
    <button class="primary" id="locGPS" ${temGPS() ? "" : "disabled"}>📡 Usar minha posição (GPS)</button>
    <button id="locMapa">🖱 Tocar no mapa</button>
    ${pend.lat != null ? '<button id="locTirar">Remover local</button>' : ""}</div>`);
  corpo.querySelector("#locGPS").onclick = () => {
    fecharModal(); toast("Buscando sua posição…");
    navigator.geolocation.getCurrentPosition(p => { definirLocal(p.coords.latitude, p.coords.longitude); mapa.setView([p.coords.latitude, p.coords.longitude], Math.max(mapa.getZoom(), 16)); toast(`Local marcado (±${Math.round(p.coords.accuracy)} m).`); },
      e => toast("GPS: " + e.message, true), {enableHighAccuracy:true, timeout:20000});
  };
  corpo.querySelector("#locMapa").onclick = () => {
    fecharModal(); if (ehCelular()) fecharGaveta();
    $("cardMapa").scrollIntoView({behavior:"smooth", block:"start"});
    $("mapa").classList.add("mirando"); toast("Toque no mapa no local do registro.");
    mapa.once("click", e => { $("mapa").classList.remove("mirando"); definirLocal(e.latlng.lat, e.latlng.lng); if (ehCelular()) abrirGaveta(); });
  };
  const tr = corpo.querySelector("#locTirar"); if (tr) tr.onclick = () => { fecharModal(); pend.lat = pend.lon = null; if (marcaPend){ mapa.removeLayer(marcaPend); marcaPend = null; } atualizarPend(); };
};
$("evFoto").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("btnEvento").disabled = true; $("evFotoTxt").textContent = "Lendo…";
  try{
    const bm = await createImageBitmap(f), k = Math.min(1, 1280/Math.max(bm.width, bm.height));
    const c = document.createElement("canvas"); c.width = Math.round(bm.width*k); c.height = Math.round(bm.height*k);
    c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
    if (pend.url) URL.revokeObjectURL(pend.url);
    pend.foto = blob; pend.url = URL.createObjectURL(blob); atualizarPend();
    if (pend.lat == null && temGPS()) navigator.geolocation.getCurrentPosition(p => { if (pend.lat == null) definirLocal(p.coords.latitude, p.coords.longitude); }, () => {}, {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
  }catch(err){ toast("Não consegui ler a foto: " + err.message, true); atualizarPend(); }
  finally{ $("btnEvento").disabled = false; }
};
window.extrasEvento = ev => {
  const x = {};
  if (pend.lat != null){ x.lat = +pend.lat.toFixed(6); x.lon = +pend.lon.toFixed(6); }
  if (pend.foto){ x.fotoId = "f" + ev.id; BD.put("fotos", x.fotoId, pend.foto).catch(e => toast("A foto não foi salva: " + e.message, true)); }
  pend.foto = null; if (pend.url){ /* mantém a URL até limpar */ }
  setTimeout(limparPend, 0);
  return x;
};
window.apagarFoto = id => BD.del("fotos", id).catch(() => {});
async function verFoto(id, titulo){
  const b = await BD.get("fotos", id).catch(() => null);
  if (!b){ toast("Foto não encontrada neste aparelho (as fotos vão junto no backup).", true); return; }
  const u = URL.createObjectURL(b);
  abrirModal(titulo, `<img class="fotogrande" src="${u}" alt="">`, true);
  window.aoFecharModal = () => URL.revokeObjectURL(u);
}
window.verEvento = (ev, tipo) => {
  const tp = TIPOS[ev.tipo] || TIPOS.outro;
  if (tipo === "foto") return verFoto(ev.fotoId, `${fmtData(ev.data)} · ${tp.nome}`);
  if (ev.lat == null) return;
  if (ehCelular()) fecharGaveta();
  $("cardMapa").scrollIntoView({behavior:"smooth", block:"start"});
  mapa.setView([ev.lat, ev.lon], Math.max(mapa.getZoom(), 17));
  const m = pontosDiario.getLayers().find(l => l.evId === ev.id); if (m) setTimeout(() => m.openPopup(), 350);
};

// pontos do diário do talhão aberto
const pontosDiario = L.layerGroup().addTo(mapa);
function desenharPontosDiario(){
  pontosDiario.clearLayers();
  const t = talhaoAtual(); if (!t) return;
  for (const ev of t.diario.filter(e => e.lat != null)){
    const tp = TIPOS[ev.tipo] || TIPOS.outro;
    const ic = L.divIcon({className:"pinodiario", html:`<span style="background:${tp.cor}">${tp.sig}</span>`, iconSize:[26,26], iconAnchor:[13,13]});
    const m = L.marker([ev.lat, ev.lon], {icon:ic}).addTo(pontosDiario);
    m.evId = ev.id;
    m.bindPopup(`<b>${fmtData(ev.data)} · ${esc(tp.nome)}</b>${ev.animais ? `<br>${ev.animais} animais` : ""}${ev.nota ? `<br>${esc(ev.nota)}` : ""}${ev.fotoId ? `<div class="popfoto" data-f="${ev.fotoId}">carregando foto…</div>` : ""}`, {maxWidth:260});
    if (ev.fotoId) m.on("popupopen", async e => {
      const el = e.popup.getElement().querySelector(".popfoto"); if (!el || el.dataset.ok) return;
      const b = await BD.get("fotos", ev.fotoId).catch(() => null);
      if (!b){ el.textContent = "(foto não está neste aparelho)"; return; }
      const u = URL.createObjectURL(b); el.dataset.ok = 1; el.innerHTML = `<img src="${u}" alt="">`;
      el.querySelector("img").onclick = () => verFoto(ev.fotoId, `${fmtData(ev.data)} · ${tp.nome}`);
    });
  }
}
window.desenharPontosDiario = desenharPontosDiario;
// renderDiario é chamado sempre que o talhão aberto muda: redesenha os pontos junto
const _renderDiario = renderDiario;
renderDiario = function(){ _renderDiario(); desenharPontosDiario(); if (window.renderPainel) window.renderPainel(); };

// backup das fotos
const blobParaDataUrl = b => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => erro(r.error); r.readAsDataURL(b); });
window.fotosParaBackup = async () => {
  const out = {};
  for (const t of talhoes) for (const e of t.diario || []) if (e.fotoId){ const b = await BD.get("fotos", e.fotoId).catch(() => null); if (b) out[e.fotoId] = await blobParaDataUrl(b); }
  return out;
};
window.importarFotos = async mapa_ => {
  for (const [id, url] of Object.entries(mapa_ || {})){ try{ const b = await (await fetch(url)).blob(); await BD.put("fotos", id, b); }catch(e){} }
};

// ---------------- Tema claro / escuro ----------------
const temaMQ = window.matchMedia("(prefers-color-scheme: dark)");
function aplicarTema(){
  let pref = "auto"; try{ pref = localStorage.getItem("ui.tema") || "auto"; }catch(e){}
  const escuro = pref === "escuro" || (pref === "auto" && temaMQ.matches);
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
  $("btnTema").title = `Tema: ${pref === "auto" ? "automático (igual ao sistema)" : pref} — clique para trocar`;
  $("btnTema").dataset.pref = pref;
  const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = escuro ? "#0b1f14" : "#11482a";
  const r = estado.resultado;
  if (r){ redesenharGrafico(); if (r.silagem) mostrarSilagem(); if (r.manejo) mostrarManejo(r); }
}
$("btnTema").onclick = () => {
  let pref = "auto"; try{ pref = localStorage.getItem("ui.tema") || "auto"; }catch(e){}
  const prox = {auto:"escuro", escuro:"claro", claro:"auto"}[pref] || "auto";
  try{ localStorage.setItem("ui.tema", prox); }catch(e){}
  aplicarTema(); toast(`Tema: ${prox === "auto" ? "automático" : prox}.`);
};
temaMQ.addEventListener ? temaMQ.addEventListener("change", aplicarTema) : temaMQ.addListener(aplicarTema);
aplicarTema();

// ---------------- Celular: gaveta lateral e menu inferior ----------------
function abrirGaveta(){ document.body.classList.add("gaveta"); }
function fecharGaveta(){ document.body.classList.remove("gaveta"); }
$("veu").onclick = fecharGaveta;
document.addEventListener("click", e => { // no celular o botão ☰ abre a gaveta (em vez de esconder o painel)
  if (ehCelular() && e.target.closest("#btnLateral")){ e.stopImmediatePropagation(); e.preventDefault(); document.body.classList.toggle("gaveta"); }
}, true);
$("navMob").querySelectorAll("button").forEach(b => b.onclick = () => {
  const v = b.dataset.v;
  if (v === "talhoes"){ document.body.classList.toggle("gaveta"); return; }
  fecharGaveta();
  const alvo = v === "mapa" ? $("cardMapa") : v === "painel" ? $("cardPainel") : $("resultados");
  if (v === "relatorio" && $("resultados").style.display !== "flex"){ toast("Nenhum relatório aberto. Escolha um talhão e gere o relatório."); return; }
  if (v === "painel" && $("cardPainel").style.display === "none"){ toast("Salve um talhão para usar o Painel."); return; }
  if (v === "painel") $("cardPainel").classList.remove("fechado");
  window.scrollTo({top: alvo.getBoundingClientRect().top + window.scrollY - 70, behavior:"smooth"});
});
// ao escolher um talhão no celular, fecha a gaveta e mostra o mapa
const _abrirTalhao = abrirTalhao;
abrirTalhao = function(id){ _abrirTalhao(id); if (ehCelular()){ fecharGaveta(); window.scrollTo({top:0, behavior:"smooth"}); } };
// realça a aba do menu conforme a rolagem
window.addEventListener("scroll", () => {
  if (!ehCelular()) return;
  const y = window.scrollY + 140;
  const sec = $("resultados").style.display === "flex" && $("resultados").offsetTop <= y ? "relatorio" : $("cardPainel").style.display !== "none" && $("cardPainel").offsetTop <= y ? "painel" : "mapa";
  $("navMob").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === sec));
}, {passive:true});

// ---------------- Aplicativo instalável (PWA) ----------------
let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedidoInstalar = e; $("btnInstalar").style.display = ""; });
$("btnInstalar").onclick = async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt(); const r = await pedidoInstalar.userChoice; pedidoInstalar = null;
  $("btnInstalar").style.display = "none"; if (r.outcome === "accepted") toast("App instalado! Procure o ícone “Talhões” na tela inicial.");
};
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("Service worker:", e));
}
