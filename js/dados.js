// ============================================================================
// dados.js — banco local (IndexedDB), ajustes, histórico de índices,
// relatórios salvos, estimativa de forragem e Painel da fazenda.
// Usa as funções e variáveis globais do index.html.
// ============================================================================
"use strict";

// ---------------- Janela (modal) genérica ----------------
function abrirModal(titulo, conteudo, largo=false){
  $("modalTit").textContent = titulo;
  const c = $("modalCorpo"); c.innerHTML = "";
  if (typeof conteudo === "string") c.innerHTML = conteudo; else c.appendChild(conteudo);
  $("modal").classList.toggle("largo", !!largo);
  $("modal").style.display = "flex";
  return c;
}
function fecharModal(){ $("modal").style.display = "none"; $("modalCorpo").innerHTML = ""; if (window.aoFecharModal){ const f = window.aoFecharModal; window.aoFecharModal = null; f(); } }
$("modalFechar").onclick = fecharModal;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) fecharModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("modal").style.display !== "none") fecharModal(); });

// ---------------- IndexedDB ----------------
const BD = (() => {
  let p = null;
  const abrir = () => p || (p = new Promise((ok, erro) => {
    if (!window.indexedDB){ erro(new Error("Este navegador não tem IndexedDB")); return; }
    const rq = indexedDB.open("monitoramento-talhoes", 1);
    rq.onupgradeneeded = () => { const db = rq.result; ["relatorios","fotos"].forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n); }); };
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => erro(rq.error);
  }));
  const tx = async (loja, modo, fn) => {
    const db = await abrir();
    return new Promise((ok, erro) => { const t = db.transaction(loja, modo), s = t.objectStore(loja); const rq = fn(s); t.oncomplete = () => ok(rq && rq.result); t.onerror = () => erro(t.error); t.onabort = () => erro(t.error); });
  };
  return {
    get: (l, k) => tx(l, "readonly", s => s.get(k)),
    put: (l, k, v) => tx(l, "readwrite", s => s.put(v, k)),
    del: (l, k) => tx(l, "readwrite", s => s.delete(k)),
    chaves: l => tx(l, "readonly", s => s.getAllKeys())
  };
})();

// ---------------- Ajustes (pastagem e alertas) ----------------
const CFG_CHAVE = "monitoramento-talhoes.cfg";
const CFG_PADRAO = {
  a:6500, b:-1300,        // MS (kg/ha) = a × NDVI + b   (estimativa; calibre com medições)
  residuo:1500,           // kg MS/ha que devem ficar após o pastejo
  eficiencia:60,          // % da forragem disponível que o gado colhe
  consumo:12,             // kg MS/animal/dia (vaca em lactação ~14–18; novilha ~7–9)
  descanso:30,            // dias de descanso mínimos do piquete
  metaEntrada:2800,       // kg MS/ha para liberar a entrada
  quedaAlerta:10          // % de queda do NDVI que gera alerta
};
function lerCfg(){ try{ return {...CFG_PADRAO, ...(JSON.parse(localStorage.getItem(CFG_CHAVE)) || {})}; }catch(e){ return {...CFG_PADRAO}; } }
function gravarCfg(c){ try{ localStorage.setItem(CFG_CHAVE, JSON.stringify(c)); }catch(e){} }
window.lerCfg = lerCfg;
window.importarCfg = c => { if (c && typeof c === "object") gravarCfg({...lerCfg(), ...c}); };

function abrirAjustes(){
  const c = lerCfg();
  const campo = (k, rot, dica, passo="1") => `<label>${rot}<input type="number" step="${passo}" data-k="${k}" value="${c[k]}"></label>${dica ? `<p class="hint" style="margin:2px 0 6px">${dica}</p>` : ""}`;
  const corpo = abrirModal("Ajustes de pastagem e alertas", `
    <div class="ajustes">
      <h4>Estimativa de forragem</h4>
      <p class="hint">Matéria seca (kg/ha) = <b>A × NDVI + B</b>. Os valores padrão são uma média para capins tropicais (braquiária, mombaça). Para calibrar: corte com um quadrado de 1 m² em 3 a 5 pontos, pese a matéria seca e compare com o NDVI do dia.</p>
      <div class="row">${campo("a","A (inclinação)","","50")}${campo("b","B (intercepto)","","50")}</div>
      <div class="row">${campo("residuo","Resíduo pós-pastejo (kg MS/ha)")}${campo("eficiencia","Eficiência de pastejo (%)")}</div>
      ${campo("consumo","Consumo por animal (kg MS/dia)","Vaca em lactação: 14–18 · vaca seca: 10–12 · novilha: 7–9 · bezerra: 3–5.","0.5")}
      <h4>Rotação e alertas</h4>
      <div class="row">${campo("descanso","Descanso mínimo (dias)")}${campo("metaEntrada","Massa para entrar (kg MS/ha)","","50")}</div>
      ${campo("quedaAlerta","Alerta de queda do NDVI (%)","Avisa quando o NDVI cai mais que isso entre duas imagens.")}
      <div class="row" style="margin-top:12px"><button id="ajPadrao">Restaurar padrão</button><button class="primary" id="ajSalvar">Salvar ajustes</button></div>
    </div>`);
  corpo.querySelector("#ajPadrao").onclick = () => corpo.querySelectorAll("input[data-k]").forEach(i => i.value = CFG_PADRAO[i.dataset.k]);
  corpo.querySelector("#ajSalvar").onclick = () => {
    const n = {...c}; corpo.querySelectorAll("input[data-k]").forEach(i => { const v = parseFloat(String(i.value).replace(",", ".")); if (!isNaN(v)) n[i.dataset.k] = v; });
    gravarCfg(n); fecharModal(); renderPainel(); if (estado.resultado && window.aposMostrar) window.aposMostrar(estado.resultado);
    toast("Ajustes salvos.");
  };
}
$("btnAjustes").onclick = abrirAjustes;
$("btnAjustes2").onclick = abrirAjustes;

// ---------------- Forragem ----------------
function forragem(ndvi, c=lerCfg()){ return ndvi == null ? null : Math.max(0, c.a*ndvi + c.b); }
// dias de pastejo para "animais" na área (ha) com a massa msHa
function diasPastejo(msHa, ha, animais, c=lerCfg()){
  if (msHa == null || !animais) return null;
  const disp = Math.max(0, msHa - c.residuo)*ha*c.eficiencia/100;
  return disp/(animais*c.consumo);
}
// capacidade: quantos animais a área sustenta por N dias
function capacidade(msHa, ha, dias, c=lerCfg()){
  if (msHa == null) return null;
  return Math.max(0, msHa - c.residuo)*ha*c.eficiencia/100/(dias*c.consumo);
}

// ---------------- Histórico de índices por talhão ----------------
function juntarHist(t, pontos){
  t.hist = Array.isArray(t.hist) ? t.hist : [];
  const porIso = new Map(t.hist.map(h => [h.iso, h]));
  for (const p of pontos){ if (!p.iso || p.ndvi == null) continue; porIso.set(p.iso, {...(porIso.get(p.iso) || {}), ...p}); }
  t.hist = [...porIso.values()].sort((a,b) => a.iso.localeCompare(b.iso)).slice(-120);
}

// Situação de rotação a partir do diário
function situacaoRotacao(t, c=lerCfg()){
  const evs = (t.diario || []).filter(e => e.tipo === "entrada" || e.tipo === "saida").sort((a,b) => a.data.localeCompare(b.data));
  if (!evs.length) return null;
  const u = evs[evs.length-1], dias = difDias(u.data, hojeISO());
  if (u.tipo === "entrada") return {ocupado:true, desde:u.data, dias, animais:u.animais};
  const ent = [...evs].reverse().find(e => e.tipo === "entrada" && e.data <= u.data);
  return {ocupado:false, desde:u.data, dias, animais:(ent && ent.animais) || u.animais, pronto: dias >= c.descanso};
}

// Último ponto e tendência
function tendencia(t, c=lerCfg()){
  const h = (t.hist || []).filter(x => x.ndvi != null);
  if (!h.length) return null;
  const u = h[h.length-1], p = h.length > 1 ? h[h.length-2] : null;
  const d = p ? u.ndvi - p.ndvi : null, pct = p && Math.abs(p.ndvi) > 0.05 ? d/Math.abs(p.ndvi)*100 : null;
  return {u, p, d, pct, alerta: pct != null && pct <= -c.quedaAlerta && d <= -0.03};
}

// ---------------- Depois de cada análise: histórico + relatório salvo ----------------
window.aoAnalisar = res => {
  if (!res.talhaoId) return;
  const t = talhoes.find(x => x.id === res.talhaoId); if (!t) return;
  juntarHist(t, res.meses.map(m => ({iso:m.iso, ndvi:m.ndvi.media, ndmi:m.ndmi.media, ndre:m.ndre ? m.ndre.media : null, fonte:"relatorio"})));
  gravarTalhoes(talhoes);
  salvarRelatorio(res).catch(e => console.warn("Não salvei o relatório:", e));
  setTimeout(renderPainel, 0);
};

// Serialização do resultado: canvas -> PNG (Blob); o resto vai como está
async function serializar(v, vistos=new WeakSet()){
  if (v == null || typeof v !== "object") return v;
  if (v instanceof HTMLCanvasElement) return {__cv: await new Promise(ok => v.toBlob(ok, "image/png"))};
  if (ArrayBuffer.isView(v) || v instanceof ImageData || v instanceof Blob || v instanceof Date) return v;
  if (vistos.has(v)) return undefined; vistos.add(v);
  if (Array.isArray(v)) return Promise.all(v.map(x => serializar(x, vistos)));
  const o = {}; for (const k of Object.keys(v)) o[k] = await serializar(v[k], vistos); return o;
}
async function restaurar(v){
  if (v == null || typeof v !== "object") return v;
  if (v.__cv instanceof Blob){
    const bm = await createImageBitmap(v.__cv), c = document.createElement("canvas");
    c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0); return c;
  }
  if (ArrayBuffer.isView(v) || v instanceof ImageData || v instanceof Blob || v instanceof Date) return v;
  if (Array.isArray(v)) return Promise.all(v.map(restaurar));
  const o = {}; for (const k of Object.keys(v)) o[k] = await restaurar(v[k]); return o;
}
async function salvarRelatorio(res){
  const copia = {...res}; delete copia.salvoEm;
  await BD.put("relatorios", res.talhaoId, {salvoEm:new Date().toISOString(), res: await serializar(copia)});
}
window.carregarRelatorio = async id => {
  try{
    const reg = await BD.get("relatorios", id); if (!reg) return;
    if (!estado.atual || estado.atual.id !== id || estado.resultado) return; // usuário já mudou de talhão
    const res = await restaurar(reg.res);
    if (!estado.atual || estado.atual.id !== id || estado.resultado) return;
    const t = talhoes.find(x => x.id === id); if (t) res.nome = t.nome;
    res.salvoEm = reg.salvoEm;
    estado.resultado = res; mostrarResultado(true);
    $("btnPdf").style.display = "";
  }catch(e){ console.warn("Relatório salvo não pôde ser aberto:", e); }
};
window.aoExcluir = t => { BD.del("relatorios", t.id).catch(() => {}); (t.diario || []).forEach(e => e.fotoId && BD.del("fotos", e.fotoId).catch(() => {})); renderPainel(); };

// ---------------- Verificação rápida (só números) de todos os talhões ----------------
async function verificarRecente(t){
  const fim = hojeISO(), ini = somaDias(fim, -40);
  const feat = {type:"Feature", properties:{}, geometry:t.geom}, ha = t.areaHa || areaHa(t.geom);
  const cenas = (await buscarCenas(t.geom, ini, fim)).filter(c => c.properties["eo:cloud_cover"] < 70)
    .sort((a,b) => b.properties.datetime.localeCompare(a.properties.datetime));
  const porDia = []; const vistos = new Set();
  for (const c of cenas){ const d = c.properties.datetime.slice(0,10); if (!vistos.has(d)){ vistos.add(d); porDia.push(c); } }
  for (const item of porDia.slice(0, 8)){
    let av; try{ av = await avaliarNuvem(item, feat, ha); }catch(e){ continue; }
    if (av.cobertura < 0.9 || av.nuvem > 0.15) continue;
    const [a, b, c2] = await Promise.all(IDX.map(ind => estatistica(item, feat, ind).catch(() => null)));
    if (!a) continue;
    return {iso:item.properties.datetime.slice(0,10), ndvi:a.media, ndmi:b && b.media, ndre:c2 && c2.media, nuvem:av.nuvem, fonte:"rapida"};
  }
  return null;
}
async function atualizarTodos(){
  if (!talhoes.length) return;
  const btn = $("btnAtualizarTodos"); btn.disabled = true; btn.classList.add("carregando");
  const pr = $("progPainel"); pr.style.display = "block"; pr.firstElementChild.style.width = "3%";
  let feitos = 0, novos = 0, semImg = 0;
  try{
    await pool([...talhoes], 2, async t => {
      try{
        const p = await verificarRecente(t);
        if (p){ const antes = (t.hist || []).some(h => h.iso === p.iso); juntarHist(t, [p]); if (!antes) novos++; }
        else semImg++;
      }catch(e){ console.warn(t.nome, e); semImg++; }
      feitos++; pr.firstElementChild.style.width = Math.round(feitos/talhoes.length*100) + "%";
      renderPainel();
    });
    gravarTalhoes(talhoes);
    try{ localStorage.setItem("ui.ultimaVerificacao", new Date().toISOString()); }catch(e){}
    const alertas = talhoes.filter(t => { const tn = tendencia(t); return tn && tn.alerta; }).length;
    toast(`Painel atualizado: ${novos} imagem(ns) nova(s)` + (semImg ? `, ${semImg} talhão(ões) sem imagem limpa nos últimos 40 dias` : "") + (alertas ? `. ⚠ ${alertas} alerta(s) de queda.` : "."), alertas > 0);
  }finally{
    btn.disabled = false; btn.classList.remove("carregando"); pr.style.display = "none"; renderPainel(); renderLista();
  }
}
$("btnAtualizarTodos").onclick = atualizarTodos;

// ---------------- Painel da fazenda ----------------
function badgeRot(s, msHa, c){
  if (!s) return '<span class="pill cinza">sem registro</span>';
  if (s.ocupado) return `<span class="pill azul">Ocupado há ${s.dias} d${s.animais ? ` · ${s.animais} anim.` : ""}</span>`;
  const okMassa = msHa == null || msHa >= c.metaEntrada;
  if (s.pronto && okMassa) return `<span class="pill verde">✓ Pronto · descanso ${s.dias} d</span>`;
  const falta = Math.max(0, c.descanso - s.dias);
  return `<span class="pill amarelo">Descanso ${s.dias} d${falta ? ` · faltam ${falta}` : !okMassa ? " · pouca massa" : ""}</span>`;
}
function semaforoAgua(ndmi){
  if (ndmi == null) return {cls:"cinza", txt:"—"};
  if (ndmi >= 0.05) return {cls:"verde", txt:"boa"};
  if (ndmi >= -0.1) return {cls:"amarelo", txt:"atenção"};
  return {cls:"vermelho", txt:"estresse"};
}
function renderPainel(){
  const card = $("cardPainel");
  card.style.display = talhoes.length ? "" : "none";
  if (window.uiAtualizar) window.uiAtualizar();
  if (!talhoes.length) return;
  const c = lerCfg();
  const linhas = [...talhoes].sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR")).map(t => {
    const tn = tendencia(t), s = situacaoRotacao(t, c), ms = tn ? forragem(tn.u.ndvi, c) : null;
    return {t, tn, s, ms, idade: tn ? difDias(tn.u.iso, hojeISO()) : null};
  });
  const alertas = linhas.filter(l => l.tn && l.tn.alerta), prontos = linhas.filter(l => l.s && !l.s.ocupado && l.s.pronto && (l.ms == null || l.ms >= c.metaEntrada));
  const estresse = linhas.filter(l => l.tn && l.tn.u.ndmi != null && l.tn.u.ndmi < -0.1);
  $("painelResumo").textContent = `${talhoes.length} talhões` + (alertas.length ? ` · ⚠ ${alertas.length}` : "");
  let ult = null; try{ ult = localStorage.getItem("ui.ultimaVerificacao"); }catch(e){}
  $("painelInfo").textContent = ult ? `Última atualização: ${fmtData(ult)} ${new Date(ult).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}` : "Ainda não atualizado — clique em “Atualizar todos”.";
  const box = [];
  for (const l of alertas) box.push(`<div class="alerta vermelho" data-id="${l.t.id}">⚠ <b>${esc(l.t.nome)}</b>: NDVI caiu ${fmt(Math.abs(l.tn.pct),0)}% (${fmt(l.tn.p.ndvi)} → ${fmt(l.tn.u.ndvi)}) entre ${fmtData(l.tn.p.iso)} e ${fmtData(l.tn.u.iso)}.</div>`);
  for (const l of estresse) if (!alertas.includes(l)) box.push(`<div class="alerta amarelo" data-id="${l.t.id}">💧 <b>${esc(l.t.nome)}</b>: umidade baixa na vegetação (NDMI ${fmt(l.tn.u.ndmi)} em ${fmtData(l.tn.u.iso)}).</div>`);
  if (prontos.length) box.push(`<div class="alerta verde">🐄 Prontos para entrada: ${prontos.map(l => `<a data-id="${l.t.id}">${esc(l.t.nome)}</a>`).join(", ")}.</div>`);
  $("alertas").innerHTML = box.join("");
  $("alertas").querySelectorAll("[data-id]").forEach(e => e.onclick = () => abrirTalhao(e.dataset.id));
  $("painelTab").innerHTML = `<tr><th>Talhão</th><th class="n">NDVI</th><th class="n">Tendência</th><th class="n">Forragem*</th><th>Água</th><th>Rotação</th></tr>` + linhas.map(l => {
    const ag = semaforoAgua(l.tn && l.tn.u.ndmi);
    const tend = !l.tn || l.tn.d == null ? "—" : `<span class="${l.tn.d >= 0 ? "up" : "down"}">${l.tn.d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(l.tn.d))}${l.tn.alerta ? " ⚠" : ""}</span>`;
    const dias = l.s && l.s.ocupado && l.ms != null ? diasPastejo(l.ms, l.t.areaHa, l.s.animais, c) : null;
    return `<tr data-id="${l.t.id}" class="${estado.atual && estado.atual.id === l.t.id ? "ativo" : ""}">
      <td><b>${esc(l.t.nome)}</b><div class="sub">${fmt(l.t.areaHa,1)} ha${l.tn ? ` · imagem de ${fmtData(l.tn.u.iso)}${l.idade > 20 ? ' <span class="down">(antiga)</span>' : ""}` : ""}</div></td>
      <td class="n">${l.tn ? `<b>${fmt(l.tn.u.ndvi)}</b>` : "—"}</td>
      <td class="n">${tend}</td>
      <td class="n">${l.ms != null ? fmt(l.ms,0) + " kg/ha" : "—"}${dias != null ? `<div class="sub">${dias >= 1 ? `~${fmt(dias,0)} dias p/ o lote` : '<span class="down">sem sobra p/ o lote</span>'}</div>` : ""}</td>
      <td><span class="pill ${ag.cls}">${ag.txt}</span></td>
      <td>${badgeRot(l.s, l.ms, c)}</td></tr>`;
  }).join("") + `<tr class="rodape"><td colspan="6">* Massa de forragem estimada pelo NDVI (MS = ${c.a} × NDVI ${c.b < 0 ? "−" : "+"} ${Math.abs(c.b)}). É uma aproximação: calibre em ⚙ Ajustes.</td></tr>`;
  $("painelTab").querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => abrirTalhao(tr.dataset.id));
}
window.renderPainel = renderPainel;
window.aoMudarDiario = () => { renderPainel(); if (window.desenharPontosDiario) window.desenharPontosDiario(); };

// primeira montagem + lembrete
setTimeout(() => {
  renderPainel();
  const alertas = talhoes.filter(t => { const tn = tendencia(t); return tn && tn.alerta; });
  if (alertas.length) toast(`⚠ ${alertas.length} talhão(ões) com queda de NDVI: ${alertas.map(t => t.nome).join(", ")}.`, true);
  let ult = null; try{ ult = localStorage.getItem("ui.ultimaVerificacao"); }catch(e){}
  if (talhoes.length && (!ult || difDias(ult.slice(0,10), hojeISO()) >= 5)) toast("Dica: clique em “Atualizar todos” no Painel para ver a situação recente de cada talhão.");
}, 600);
