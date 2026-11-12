// ============================================================================
// relatorio.js — cartões extras do relatório: pastagem/forragem, estresse
// hídrico, previsão do tempo, comparação com o ano passado, efeito do manejo
// (recuperação pós-pastejo e resposta à adubação) e comparação de datas.
// ============================================================================
"use strict";

window.aposMostrar = r => {
  // aviso de relatório salvo
  const av = $("avisoSalvo");
  if (r.salvoEm){
    av.style.display = "";
    av.innerHTML = `💾 Relatório salvo em ${fmtData(r.salvoEm)} às ${new Date(r.salvoEm).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · período ${fmtData(r.ini)} a ${fmtData(r.fim)}. <button class="mini txt" id="btnRefazer">Atualizar agora</button>`;
    $("btnRefazer").onclick = () => { $("btnProcessar").click(); };
  } else av.style.display = "none";
  $("btnComparar").disabled = !(r.meses && r.meses.length > 1);
  mostrarPasto(r);
  mostrarPrevisao(r);
  $("apNota").innerHTML = r.anoPassado ? textoAnoPassado(r) : "";
  $("btnAnoPassado").style.display = r.anoPassado ? "none" : "";
  if (r.manejo) mostrarManejo(r); else $("manejoRes").innerHTML = "";
};

// ---------------- Pastagem e água ----------------
function mostrarPasto(r){
  const c = lerCfg(), u = r.meses[r.meses.length-1];
  const t = r.talhaoId ? talhoes.find(x => x.id === r.talhaoId) : null;
  const s = t ? situacaoRotacao(t, c) : null;
  const ms = forragem(u.ndvi.media, c), ha = r.areaHa;
  const animaisPadrao = (s && s.animais) || 30;
  const box = $("pastoRes");
  // estresse hídrico: NDMI atual × média do período × chuva dos últimos 30 dias
  const ndmiMed = r.meses.reduce((a, m) => a + m.ndmi.media, 0)/r.meses.length;
  const chuva30 = r.clima ? r.clima.diario.filter(x => x.d > somaDias(r.clima.ultimoDia, -30)).reduce((a, x) => a + (x.p || 0), 0) : null;
  const ag = semaforoAgua(u.ndmi.media);
  let txtAgua = `NDMI ${fmt(u.ndmi.media)} em ${u.data} (média do período ${fmt(ndmiMed)}).`;
  if (chuva30 != null) txtAgua += ` Chuva nos últimos 30 dias: <b>${fmt(chuva30,0)} mm</b>.`;
  if (ag.cls === "vermelho") txtAgua += chuva30 != null && chuva30 < 30 ? " Seca: pouca chuva e vegetação com baixa umidade — o crescimento deve ficar lento." : " Vegetação com baixa umidade.";
  else if (ag.cls === "amarelo") txtAgua += " Umidade moderada: acompanhe a próxima imagem.";
  else txtAgua += " Vegetação bem hidratada.";
  const serie = r.meses.map(m => ({d:m.data, ms:forragem(m.ndvi.media, c)}));
  const maxMs = Math.max(1, ...serie.map(x => x.ms));
  box.innerHTML = `
    <div class="pastogrid">
      <div class="big"><span>Massa de forragem estimada</span><b>${fmt(ms,0)} <small>kg MS/ha</small></b><em>${fmt(ms*ha/1000,1)} t MS no talhão · NDVI ${fmt(u.ndvi.media)} em ${u.data}</em></div>
      <div class="big"><span>Água na vegetação</span><b><span class="pill ${ag.cls}" style="font-size:14px">${ag.txt}</span></b><em>${txtAgua}</em></div>
    </div>
    <div class="calc">
      <label>Nº de animais <input type="number" id="psAnimais" min="1" value="${animaisPadrao}"></label>
      <div id="psCalc"></div>
    </div>
    ${s ? `<p class="hint">Rotação: ${s.ocupado ? `ocupado desde ${fmtData(s.desde)} (${s.dias} dias)` : `em descanso desde ${fmtData(s.desde)} (${s.dias} dias; mínimo ${c.descanso})`}.</p>` : ""}
    <div class="mbar">${serie.map(x => `<div title="${x.d}: ${fmt(x.ms,0)} kg MS/ha"><i style="height:${Math.round(8 + 92*x.ms/maxMs)}%"></i><span>${x.d.slice(0,5)}</span></div>`).join("")}</div>
    <p class="hint">Estimativa pelo NDVI (MS = ${c.a} × NDVI ${c.b < 0 ? "−" : "+"} ${Math.abs(c.b)}; resíduo ${c.residuo} kg/ha; eficiência ${c.eficiencia}%; consumo ${c.consumo} kg MS/animal/dia). Calibre em ⚙ para a sua fazenda.</p>`;
  const calc = () => {
    const n = Math.max(1, +$("psAnimais").value || 1), d = diasPastejo(ms, ha, n, c), cap = capacidade(ms, ha, 1, c);
    $("psCalc").innerHTML = ms <= c.residuo
      ? `<span class="down">A massa estimada está abaixo do resíduo desejado (${c.residuo} kg/ha): não há sobra para pastejo agora.</span>`
      : `Dá para <b>~${fmt(d,1)} dias</b> com ${n} animais · ou ~${fmt(cap/7,0)} animais por 7 dias · ${ms >= c.metaEntrada ? '<span class="up">massa acima da meta de entrada</span>' : `<span class="down">abaixo da meta de entrada (${c.metaEntrada} kg/ha)</span>`}`;
  };
  $("psAnimais").oninput = calc; calc();
}

// ---------------- Previsão do tempo (Open-Meteo) ----------------
const cachePrev = {};
async function mostrarPrevisao(r){
  const box = $("previsaoRes");
  const [x0,y0,x1,y1] = r.bbox, lat = ((y0+y1)/2).toFixed(3), lon = ((x0+x1)/2).toFixed(3), k = lat + "," + lon;
  try{
    if (!cachePrev[k] || Date.now() - cachePrev[k].em > 36e5){
      box.innerHTML = '<p class="hint">Carregando previsão…</p>';
      const rq = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,weather_code&forecast_days=7&timezone=auto`);
      if (!rq.ok) throw new Error("HTTP " + rq.status);
      cachePrev[k] = {em:Date.now(), j: await rq.json()};
    }
    if (estado.resultado !== r) return;
    const d = cachePrev[k].j.daily, sem = ["dom","seg","ter","qua","qui","sex","sáb"];
    const icone = c => c >= 95 ? "⛈" : c >= 80 ? "🌧" : c >= 61 ? "🌧" : c >= 51 ? "🌦" : c >= 45 ? "🌫" : c >= 3 ? "⛅" : c >= 1 ? "🌤" : "☀️";
    const chuva = d.precipitation_sum.reduce((a, v) => a + (v || 0), 0), et0 = d.et0_fao_evapotranspiration.reduce((a, v) => a + (v || 0), 0);
    box.innerHTML = `<div class="prev">${d.time.map((t, i) => `<div class="dia${(d.precipitation_sum[i]||0) >= 5 ? " chuva" : ""}">
        <span>${i ? sem[new Date(t+"T12:00:00").getDay()] : "hoje"}</span><i>${icone(d.weather_code[i])}</i>
        <b>${fmt(d.temperature_2m_max[i],0)}° <small>${fmt(d.temperature_2m_min[i],0)}°</small></b>
        <em>${fmt(d.precipitation_sum[i]||0,0)} mm${d.precipitation_probability_max[i] != null ? ` · ${d.precipitation_probability_max[i]}%` : ""}</em></div>`).join("")}</div>
      <p class="hint">Chuva prevista na semana: <b>${fmt(chuva,0)} mm</b> · evapotranspiração ${fmt(et0,0)} mm → balanço <b class="${chuva-et0 >= 0 ? "up" : "down"}">${chuva-et0 >= 0 ? "+" : ""}${fmt(chuva-et0,0)} mm</b>${chuva-et0 < -15 ? " (déficit: o solo deve secar)" : chuva-et0 > 15 ? " (excedente de água)" : ""}. Fonte: Open-Meteo.</p>`;
  }catch(e){ box.innerHTML = `<p class="hint">Previsão indisponível agora (${esc(e.message)}).</p>`; }
}

// ---------------- Mesmo período do ano passado ----------------
const umAno = iso => { const [y, m, d] = iso.split("-").map(Number); return `${y-1}-${String(m).padStart(2,"0")}-${String(Math.min(d, 28)).padStart(2,"0")}`; };
const maisUmAno = iso => { const [y, m, d] = iso.split("-").map(Number); return `${y+1}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; };
async function compararAnoPassado(){
  const r = estado.resultado; if (!r) return;
  const btn = $("btnAnoPassado"); btn.disabled = true; btn.textContent = "Buscando o ano passado…";
  try{
    const ini = umAno(r.ini), fim = umAno(r.fim), feat = {type:"Feature", properties:{}, geometry:r.geom};
    const cenas = await buscarCenas(r.geom, ini, fim);
    const porMes = {};
    for (const c of cenas){ const k = c.properties.datetime.slice(0,7); (porMes[k] = porMes[k] || []).push(c); }
    const meses = Object.keys(porMes).sort(), cand = [];
    for (const m of meses){ porMes[m].sort((a,b) => a.properties["eo:cloud_cover"] - b.properties["eo:cloud_cover"]); porMes[m].slice(0,4).forEach(c => cand.push({m, item:c})); }
    let feitos = 0;
    await pool(cand, 5, async c => { try{ c.av = await avaliarNuvem(c.item, feat, r.areaHa); }catch(e){} feitos++; btn.textContent = `Ano passado: ${Math.round(feitos/cand.length*80)}%…`; });
    const esc_ = meses.map(m => cand.filter(c => c.m === m && c.av && c.av.cobertura >= 0.9 && c.av.nuvem <= Math.max(r.maxNuvem, 0.15)).sort((a,b) => b.av.limpo - a.av.limpo)[0]).filter(Boolean);
    await pool(esc_, 5, async c => { try{ c.ndvi = (await estatistica(c.item, feat, "ndvi")).media; }catch(e){} });
    const ap = esc_.filter(c => c.ndvi != null).map(c => { const iso = c.item.properties.datetime.slice(0,10); return {isoOrig:iso, iso:maisUmAno(iso), ndvi:c.ndvi}; });
    if (!ap.length) throw new Error("não achei imagem limpa no mesmo período do ano passado");
    r.anoPassado = ap;
    redesenharGrafico();
    $("apNota").innerHTML = textoAnoPassado(r); btn.style.display = "none";
    if (r.talhaoId) salvarRelatorio(r).catch(() => {});
  }catch(e){ console.error(e); toast("Ano passado: " + (e.message || e), true); btn.textContent = "＋ Comparar com o ano passado"; }
  finally{ btn.disabled = false; }
}
function textoAnoPassado(r){
  const ap = r.anoPassado, mA = ap.reduce((a, p) => a + p.ndvi, 0)/ap.length, mE = r.meses.reduce((a, m) => a + m.ndvi.media, 0)/r.meses.length;
  const d = (mE - mA)/Math.abs(mA)*100;
  return `<b>Comparação com o ano passado</b> (linha tracejada clara): NDVI médio ${fmt(mE)} neste período × ${fmt(mA)} no mesmo período de ${ap[0].isoOrig.slice(0,4)} → <b class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${fmt(d,0)}%</b> (${ap.length} imagens do ano anterior).`;
}
$("btnAnoPassado").onclick = compararAnoPassado;

// ---------------- Efeito do manejo ----------------
async function serieDensa(r, aviso){
  if (r.serieDensa) return r.serieDensa;
  const feat = {type:"Feature", properties:{}, geometry:r.geom};
  const cenas = await buscarCenas(r.geom, r.ini, r.fim);
  const porDia = {};
  for (const c of cenas){ const d = c.properties.datetime.slice(0,10); if (!porDia[d] || porDia[d].properties["eo:cloud_cover"] > c.properties["eo:cloud_cover"]) porDia[d] = c; }
  const lista = Object.keys(porDia).sort().map(d => ({d, item:porDia[d]}));
  let feitos = 0;
  await pool(lista, 5, async x => {
    try{
      x.av = await avaliarNuvem(x.item, feat, r.areaHa);
      if (x.av.cobertura >= 0.9 && x.av.nuvem <= Math.max(r.maxNuvem, 0.15)){
        const [a, b] = await Promise.all([estatistica(x.item, feat, "ndvi"), estatistica(x.item, feat, "ndre")]);
        x.ndvi = a.media; x.ndre = b.media;
      }
    }catch(e){}
    feitos++; aviso(feitos, lista.length);
  });
  r.serieDensa = lista.filter(x => x.ndvi != null).map(x => ({d:x.d, ndvi:x.ndvi, ndre:x.ndre}));
  return r.serieDensa;
}
function mediaJanela(serie, a, b, k){ const v = serie.filter(p => p.d >= a && p.d <= b && p[k] != null); return v.length ? {v: v.reduce((s, p) => s + p[k], 0)/v.length, n:v.length} : null; }
function chuvaJanela(r, a, b){ if (!r.clima) return null; const v = r.clima.diario.filter(x => x.d >= a && x.d <= b); return v.length ? v.reduce((s, x) => s + (x.p || 0), 0) : null; }

function calcularManejo(r, serie){
  const t = talhoes.find(x => x.id === r.talhaoId), evs = t ? [...t.diario].sort((a,b) => a.data.localeCompare(b.data)) : [];
  const pastejos = [], adubos = [];
  for (const sai of evs.filter(e => e.tipo === "saida" && e.data >= r.ini && e.data <= r.fim)){
    const ent = [...evs].reverse().find(e => e.tipo === "entrada" && e.data <= sai.data);
    const antes = [...serie].reverse().find(p => p.d <= (ent ? ent.data : somaDias(sai.data, -1)) && difDias(p.d, ent ? ent.data : sai.data) <= 25);
    const depois = serie.find(p => p.d >= sai.data && difDias(sai.data, p.d) <= 12);
    const alvo = antes ? antes.ndvi*0.95 : null;
    const rec = alvo != null ? serie.find(p => p.d > sai.data && p.ndvi >= alvo && (!depois || p.d > depois.d)) : null;
    const ultimo = serie[serie.length-1];
    pastejos.push({ent, sai, antes, depois, alvo, rec, dias: rec ? difDias(sai.data, rec.d) : null, emAndamento: !rec && ultimo && ultimo.d > sai.data, ultimo,
      chuva: rec ? chuvaJanela(r, sai.data, rec.d) : null});
  }
  for (const ad of evs.filter(e => e.tipo === "adubacao" && e.data >= r.ini && e.data <= r.fim)){
    const a = somaDias(ad.data, -30), b1 = somaDias(ad.data, 10), b2 = somaDias(ad.data, 45);
    const nA = mediaJanela(serie, a, ad.data, "ndvi"), nD = mediaJanela(serie, b1, b2, "ndvi");
    const rA = mediaJanela(serie, a, ad.data, "ndre"), rD = mediaJanela(serie, b1, b2, "ndre");
    adubos.push({ev:ad, nA, nD, rA, rD, dN: nA && nD ? nD.v - nA.v : null, dR: rA && rD ? rD.v - rA.v : null,
      chuvaA: chuvaJanela(r, a, ad.data), chuvaD: chuvaJanela(r, b1, b2), pendente: b2 > (serie.length ? serie[serie.length-1].d : r.fim)});
  }
  return {pastejos, adubos};
}

async function analisarManejo(){
  const r = estado.resultado; if (!r) return;
  if (!r.talhaoId){ $("manejoRes").innerHTML = '<p class="hint">Salve o talhão e registre entradas/saídas do gado e adubações no diário para usar esta análise.</p>'; return; }
  const btn = $("btnManejo"); btn.disabled = true;
  const box = $("manejoRes"); box.innerHTML = '<p class="hint">Buscando todas as imagens limpas do período…</p>';
  try{
    const serie = await serieDensa(r, (f, n) => box.innerHTML = `<p class="hint">Analisando imagens: ${f} de ${n}…</p>`);
    if (serie.length < 3) throw new Error("Poucas imagens limpas no período (mínimo 3).");
    r.manejo = calcularManejo(r, serie);
    mostrarManejo(r);
    salvarRelatorio(r).catch(() => {});
  }catch(e){ console.error(e); box.innerHTML = `<p class="hint" style="color:var(--red)">Erro: ${esc(e.message || e)}</p>`; }
  finally{ btn.disabled = false; }
}
$("btnManejo").onclick = analisarManejo;

function mostrarManejo(r){
  const box = $("manejoRes"), mj = r.manejo, serie = r.serieDensa || [];
  if (!mj) return;
  const partes = [];
  if (!mj.pastejos.length && !mj.adubos.length) partes.push('<p class="hint">Não há saídas do gado nem adubações registradas no diário dentro do período. Registre os eventos (com a data certa) e analise de novo.</p>');
  if (mj.pastejos.length){
    const ok = mj.pastejos.filter(p => p.dias != null), med = ok.length ? ok.reduce((a, p) => a + p.dias, 0)/ok.length : null;
    partes.push(`<h4>Recuperação após o pastejo${med != null ? ` · média <b>${fmt(med,0)} dias</b>` : ""}</h4>
      <table class="tab"><tr><th>Pastejo</th><th class="n">NDVI antes</th><th class="n">NDVI na saída</th><th class="n">Recuperou em</th><th class="n">Chuva</th></tr>
      ${mj.pastejos.map(p => `<tr><td>${p.ent ? fmtData(p.ent.data) + " → " : ""}${fmtData(p.sai.data)}${p.sai.animais || (p.ent && p.ent.animais) ? `<div class="sub">${p.sai.animais || p.ent.animais} animais</div>` : ""}</td>
        <td class="n">${p.antes ? fmt(p.antes.ndvi) : "—"}</td><td class="n">${p.depois ? fmt(p.depois.ndvi) : "—"}</td>
        <td class="n">${p.dias != null ? `<b>${p.dias} dias</b><div class="sub">${fmtData(p.rec.d)}</div>` : p.alvo == null ? "sem imagem antes" : p.emAndamento ? `<span class="down">ainda não</span><div class="sub">NDVI ${fmt(p.ultimo.ndvi)} em ${fmtData(p.ultimo.d)} (meta ${fmt(p.alvo)})</div>` : "—"}</td>
        <td class="n">${p.chuva != null ? fmt(p.chuva,0) + " mm" : "—"}</td></tr>`).join("")}</table>
      <p class="hint">"Recuperou" = primeira imagem limpa após a saída com NDVI ≥ 95% do valor antes da entrada. Compare com o descanso mínimo configurado (${lerCfg().descanso} dias).</p>`);
  }
  if (mj.adubos.length){
    const veredito = a => a.pendente ? '<span class="pill cinza">aguardando</span>' : a.dN == null ? "—" : a.dN >= 0.05 ? '<span class="pill verde">boa resposta</span>' : a.dN >= 0.015 ? '<span class="pill amarelo">resposta leve</span>' : '<span class="pill vermelho">sem resposta</span>';
    partes.push(`<h4>Resposta à adubação</h4>
      <table class="tab"><tr><th>Adubação</th><th class="n">NDVI antes → depois</th><th class="n">NDRE antes → depois</th><th class="n">Chuva antes / depois</th><th>Resultado</th></tr>
      ${mj.adubos.map(a => `<tr><td>${fmtData(a.ev.data)}${a.ev.nota ? `<div class="sub">${esc(a.ev.nota)}</div>` : ""}</td>
        <td class="n">${a.nA ? fmt(a.nA.v) : "—"} → ${a.nD ? fmt(a.nD.v) : "—"}${a.dN != null ? ` <b class="${a.dN >= 0 ? "up" : "down"}">(${a.dN >= 0 ? "+" : ""}${fmt(a.dN)})</b>` : ""}</td>
        <td class="n">${a.rA ? fmt(a.rA.v) : "—"} → ${a.rD ? fmt(a.rD.v) : "—"}${a.dR != null ? ` <b class="${a.dR >= 0 ? "up" : "down"}">(${a.dR >= 0 ? "+" : ""}${fmt(a.dR)})</b>` : ""}</td>
        <td class="n">${a.chuvaA != null ? fmt(a.chuvaA,0) : "—"} / ${a.chuvaD != null ? fmt(a.chuvaD,0) : "—"} mm</td><td>${veredito(a)}</td></tr>`).join("")}</table>
      <p class="hint">Antes = média dos 30 dias anteriores; depois = média de 10 a 45 dias após. O NDRE responde mais ao nitrogênio. A chuva influencia muito: uma "boa resposta" com muito mais chuva depois pode ser efeito do clima.</p>`);
  }
  box.innerHTML = partes.join("");
  if (serie.length){
    const cv = document.createElement("canvas"); cv.className = "chart"; cv.style.marginTop = "12px"; box.appendChild(cv);
    requestAnimationFrame(() => desenharSerieManejo(cv, r, Math.max(320, box.clientWidth), 230));
  }
}
function desenharSerieManejo(cv, r, W, H){
  CV = coresCanvas(false);
  const serie = r.serieDensa, dpr = window.devicePixelRatio || 1; cv.width = W*dpr; cv.height = H*dpr;
  const x = cv.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); x.fillStyle = CV.bg; x.fillRect(0,0,W,H);
  const m = {l:44, r:16, t:24, b:28}, pw = W-m.l-m.r, ph = H-m.t-m.b;
  const t0 = msData(r.ini), t1 = msData(r.fim) + 864e5, X = d => m.l + (msData(d)-t0)/(t1-t0)*pw;
  const vs = serie.flatMap(p => [p.ndvi, p.ndre]).filter(v => v != null);
  const lo = Math.floor((Math.min(...vs)-0.05)*10)/10, hi = Math.ceil((Math.max(...vs)+0.05)*10)/10, Y = v => m.t + (hi-v)/(hi-lo)*ph;
  x.font = "12px Segoe UI, Arial, sans-serif"; x.textBaseline = "middle";
  for (let v = lo; v <= hi+1e-9; v += 0.1){ x.strokeStyle = CV.grid; x.beginPath(); x.moveTo(m.l, Y(v)); x.lineTo(W-m.r, Y(v)); x.stroke(); x.fillStyle = CV.txt; x.textAlign = "right"; x.fillText(fmt(v,1), m.l-6, Y(v)); }
  // faixas de ocupação (entrada → saída)
  const t = talhoes.find(z => z.id === r.talhaoId), evs = t ? [...t.diario].sort((a,b) => a.data.localeCompare(b.data)) : [];
  let ent = null;
  for (const e of evs){
    if (e.tipo === "entrada") ent = e.data;
    if (e.tipo === "saida" && ent){ const a = Math.max(t0, msData(ent)), b = Math.min(t1, msData(e.data)); if (b > a){ x.fillStyle = "rgba(142,90,43,.16)"; x.fillRect(X(new Date(a).toISOString()), m.t, X(new Date(b).toISOString())-X(new Date(a).toISOString()), ph); } ent = null; }
  }
  for (const e of evs.filter(e => e.tipo === "adubacao" && e.data >= r.ini && e.data <= r.fim)){ x.strokeStyle = TIPOS.adubacao.cor; x.setLineDash([4,3]); x.beginPath(); x.moveTo(X(e.data), m.t); x.lineTo(X(e.data), m.t+ph); x.stroke(); x.setLineDash([]); }
  const linha = (k, cor) => { x.strokeStyle = cor; x.lineWidth = 2; x.beginPath(); serie.filter(p => p[k] != null).forEach((p, i) => i ? x.lineTo(X(p.d), Y(p[k])) : x.moveTo(X(p.d), Y(p[k]))); x.stroke(); x.fillStyle = cor; serie.forEach(p => { if (p[k] == null) return; x.beginPath(); x.arc(X(p.d), Y(p[k]), 2.8, 0, 7); x.fill(); }); };
  linha("ndvi", INDICES.ndvi.cor); linha("ndre", INDICES.ndre.cor);
  marcasMes(x, t0, t1, m.l, pw, H-m.b+6);
  x.textAlign = "left"; x.font = "600 12px Segoe UI, Arial, sans-serif";
  x.fillStyle = INDICES.ndvi.cor; x.fillRect(m.l, 9, 14, 3); x.fillText("NDVI", m.l+19, 11);
  x.fillStyle = INDICES.ndre.cor; x.fillRect(m.l+66, 9, 14, 3); x.fillText("NDRE", m.l+85, 11);
  x.fillStyle = "rgba(142,90,43,.5)"; x.fillRect(m.l+136, 5, 14, 11); x.fillStyle = CV.txt; x.fillText("gado no piquete", m.l+155, 11);
  x.strokeStyle = TIPOS.adubacao.cor; x.setLineDash([4,3]); x.beginPath(); x.moveTo(m.l+268, 4); x.lineTo(m.l+268, 17); x.stroke(); x.setLineDash([]); x.fillText("adubação", m.l+274, 11);
}

// ---------------- Comparar duas datas (antes × depois) ----------------
function abrirComparacao(){
  const r = estado.resultado; if (!r || r.meses.length < 2) return;
  const opts = sel => r.meses.map((m, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${m.data}</option>`).join("");
  const corpo = abrirModal("Comparar datas · " + r.nome, `
    <div class="cmpbar">
      <label>Antes<select id="cmpA">${opts(0)}</select></label>
      <label>Depois<select id="cmpB">${opts(r.meses.length-1)}</select></label>
      <label>Camada<select id="cmpCam"><option value="ndvi">NDVI</option><option value="ndmi">NDMI</option><option value="ndre">NDRE</option><option value="rgb">Cor real</option></select></label>
      <label>Modo<select id="cmpModo"><option value="cortina">Cortina (arraste)</option><option value="lado">Lado a lado</option><option value="dif">Mapa da diferença</option></select></label>
    </div>
    <div id="cmpArea"></div><div id="cmpInfo" class="hint"></div>`, true);
  const desenhar = () => {
    const a = +$("cmpA").value, b = +$("cmpB").value, cam = $("cmpCam").value, modo = $("cmpModo").value;
    const area = $("cmpArea"); area.innerHTML = "";
    const tam = Math.min(900, Math.max(280, area.clientWidth || 700));
    const ma = r.meses[a], mb = r.meses[b];
    const info = cam !== "rgb" ? `${INDICES[cam].sigla} médio: ${fmt(ma[cam].media)} (${ma.data}) → ${fmt(mb[cam].media)} (${mb.data}) · <b class="${mb[cam].media >= ma[cam].media ? "up" : "down"}">${mb[cam].media >= ma[cam].media ? "+" : ""}${fmt(mb[cam].media - ma[cam].media)}</b>` : `${ma.data} → ${mb.data}`;
    if (modo === "dif"){
      if (cam === "rgb"){ area.innerHTML = '<p class="hint">O mapa da diferença funciona com NDVI, NDMI ou NDRE.</p>'; $("cmpInfo").innerHTML = ""; return; }
      const pa = r.pilha[cam].meses[a], pb = r.pilha[cam].meses[b];
      if (!pa || !pb || pa.w !== pb.w || pa.h !== pb.h){ area.innerHTML = '<p class="hint">As duas imagens têm grades diferentes; use a cortina.</p>'; return; }
      const img = new ImageData(pa.w, pa.h), lim = 0.25;
      const lut = criaLUT(["#b2182b","#ef8a62","#fddbc7","#f7f7f7","#d9f0d3","#7fbf7b","#1b7837"]);
      let soma = 0, n = 0, pior = 0, melhor = 0;
      for (let i=0; i<pa.v.length; i++){
        const va = pa.v[i], vb = pb.v[i]; if (isNaN(va) || isNaN(vb)) continue;
        const d = vb - va; soma += d; n++; if (d < -0.1) pior++; if (d > 0.1) melhor++;
        const k = Math.round((Math.max(-lim, Math.min(lim, d))/lim*0.5 + 0.5)*255);
        img.data[i*4] = lut[k*3]; img.data[i*4+1] = lut[k*3+1]; img.data[i*4+2] = lut[k*3+2]; img.data[i*4+3] = 255;
      }
      const cv = renderCelula(canvasDe(img), r, tam, "#000"); cv.className = "cmpimg"; area.appendChild(cv);
      const lg = document.createElement("div"); lg.className = "legenda"; lg.innerHTML = `<span>−${fmt(lim)} piorou</span><canvas width="400" height="12"></canvas><span>+${fmt(lim)} melhorou</span>`;
      pintarLegenda(lg.querySelector("canvas"), lut); area.appendChild(lg);
      $("cmpInfo").innerHTML = info + (n ? ` · ${fmt(pior/n*100,0)}% da área caiu mais de 0,10 e ${fmt(melhor/n*100,0)}% subiu mais de 0,10.` : "");
      return;
    }
    const ca = renderCelula(ma.img[cam], r, tam, cam === "rgb" ? "#ff1e1e" : "#000"), cb = renderCelula(mb.img[cam], r, tam, cam === "rgb" ? "#ff1e1e" : "#000");
    if (modo === "lado"){
      const w = document.createElement("div"); w.className = "cmplado";
      [[ca, ma.data],[cb, mb.data]].forEach(([c, d]) => { const f = document.createElement("figure"); c.className = "cmpimg"; f.appendChild(c); f.insertAdjacentHTML("beforeend", `<figcaption>${d}</figcaption>`); w.appendChild(f); });
      area.appendChild(w);
    } else {
      const w = document.createElement("div"); w.className = "cortina";
      ca.className = "cmpimg"; cb.className = "cmpimg topo";
      w.append(ca, cb); w.insertAdjacentHTML("beforeend", `<div class="linha"><span>⇆</span></div><b class="rot e">${ma.data}</b><b class="rot d">${mb.data}</b>`);
      area.appendChild(w);
      const pos = f => { f = Math.max(0, Math.min(1, f)); cb.style.clipPath = `inset(0 0 0 ${f*100}%)`; w.querySelector(".linha").style.left = f*100 + "%"; };
      pos(0.5);
      const mover = e => { const rc = w.getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX); pos((cx - rc.left)/rc.width); };
      let arr = false;
      w.addEventListener("pointerdown", e => { arr = true; w.setPointerCapture(e.pointerId); mover(e); });
      w.addEventListener("pointermove", e => { if (arr) mover(e); });
      w.addEventListener("pointerup", () => arr = false);
    }
    $("cmpInfo").innerHTML = info + (modo === "cortina" ? " · arraste sobre a imagem para mover a cortina." : "");
  };
  ["cmpA","cmpB","cmpCam","cmpModo"].forEach(id => corpo.querySelector("#" + id).onchange = desenhar);
  requestAnimationFrame(desenhar);
}
$("btnComparar").onclick = abrirComparacao;

// ao limpar o resultado, desliga o botão de comparar
(() => {
  const obs = new MutationObserver(() => { if ($("resultados").style.display !== "flex") $("btnComparar").disabled = true; });
  obs.observe($("resultados"), {attributes:true, attributeFilter:["style"]});
})();
