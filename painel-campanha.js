/* =====================================================================
   Painel de gestão — "Ao vivo" e "Relatório final da campanha"
   ---------------------------------------------------------------------
   Ao vivo: mapa de calor das unidades (concluída, em andamento, não
   iniciada), ranking, levantamentos parados e últimas coletas, com
   atualização automática enquanto a aba está aberta.
   Relatório final: documento único da campanha, pronto para o processo
   e a prestação de contas (imprimir ou salvar em PDF, e planilha).
   Usa as funções globais do gestao.html: sb, ORG, esc, normG, planilhaLib.
   ===================================================================== */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const fmtN = n => Number(n || 0).toLocaleString('pt-BR');
  const fmtR = v => Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  const fmtDH = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const pct = v => (v == null || isNaN(v)) ? '—' : String(Math.round(v * 10) / 10).replace('.', ',') + '%';
  const haDias = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
  const campAtual = () => ($('fCamp') && $('fCamp').value) || '';
  const campanhas = () => { try{ return (typeof DADOS !== 'undefined' && DADOS.campanhas) || []; }catch(e){ return []; } };
  const nomeCamp = id => { const c = campanhas().find(x => x.id === id); return c ? String(c.nome).split(' · ')[0] : ''; };
  const tipoCamp = id => { const c = campanhas().find(x => x.id === id); const p = c ? String(c.nome).split(' · ') : []; return p.length > 1 ? p[p.length - 1] : ''; };

  /* ---------------- estilos e marcação ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  .av-topo{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .av-topo .sub{margin:0}
  .av-vivo{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;color:var(--verde);text-transform:uppercase;letter-spacing:.6px}
  .av-vivo i{width:8px;height:8px;border-radius:50%;background:#2fa36b;box-shadow:0 0 0 0 rgba(47,163,107,.6);animation:avPulso 1.6s infinite}
  .av-vivo.off i{background:#aaa;animation:none}
  @keyframes avPulso{70%{box-shadow:0 0 0 8px rgba(47,163,107,0)}100%{box-shadow:0 0 0 0 rgba(47,163,107,0)}}
  .av-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--tinta-2);margin:4px 0 12px}
  .av-leg span{display:inline-flex;align-items:center;gap:6px}
  .av-leg b{width:14px;height:14px;border-radius:4px;display:inline-block}
  .av-grupo{margin-bottom:14px}
  .av-grupo h4{font-size:12px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.6px;color:var(--tinta-2);margin:0 0 6px}
  .av-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
  .av-t{border-radius:9px;padding:8px 10px;font-size:12px;line-height:1.3;color:#1c1c1a;border:1px solid rgba(0,0,0,.06);cursor:default;min-height:58px;display:flex;flex-direction:column;justify-content:space-between}
  .av-t b{font-size:12px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .av-t small{font-family:var(--mono);font-size:10.5px;opacity:.85}
  .av-t.ok{background:#1A7F4B;color:#fff}
  .av-t.nao{background:var(--vermelho-bg);color:var(--vermelho)}
  .av-t.sem{background:var(--papel);color:var(--tinta-2);border-style:dashed}
  .av-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:18px}
  .av-rank{list-style:none;margin:0;padding:0}
  .av-rank li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--linha);font-size:13px}
  .av-rank li .pos{font-family:var(--mono);font-size:11px;color:var(--tinta-2);width:22px}
  .av-rank li .nm{flex:1;min-width:0}
  .av-rank li .nm small{display:block;color:var(--tinta-2);font-size:11px}
  .av-rank .bar{width:90px;height:7px;background:var(--linha);border-radius:4px;overflow:hidden}
  .av-rank .bar i{display:block;height:100%;background:var(--verde)}
  .av-filtro{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .av-filtro select,.av-filtro input{padding:6px 10px;border-radius:8px;border:1px solid var(--linha-2);font:inherit;font-size:12.5px;background:#fff}
  `;
  document.head.appendChild(css);

  function montar(){
    const abas = document.querySelector('.abas'), painelBtn = abas && abas.querySelector('[data-sec="painel"]');
    if(!abas || $('sec-aovivo')) return;
    const b = document.createElement('button'); b.dataset.sec = 'aovivo'; b.textContent = 'Ao vivo'; b.setAttribute('onclick', 'aba(this)');
    painelBtn.insertAdjacentElement('afterend', b);
    const sec = document.createElement('section'); sec.className = 'secao'; sec.id = 'sec-aovivo';
    sec.innerHTML = `
      <div class="av-topo"><div><span class="av-vivo" id="avVivo"><i></i>ao vivo</span> <span class="sub" id="avQuando"></span></div>
        <div class="av-filtro">
          <select id="avVer"><option value="previstas">Unidades previstas</option><option value="todas">Todas as unidades finais</option></select>
          <input type="search" id="avBusca" placeholder="Filtrar unidade…">
          <button class="btn mini" id="avAtualizar">↻ Atualizar</button>
          <button class="btn mini pri" id="avRelatorio">📄 Relatório final da campanha</button>
        </div></div>
      <div class="indicadores" id="avInd"></div>
      <div class="painel"><h3>Mapa da campanha</h3><p class="sub">Cada quadro é uma unidade. A cor mostra a situação; o número, os ambientes coletados sobre o previsto.</p>
        <div class="av-leg"><span><b style="background:#1A7F4B"></b>Concluída (processada)</span><span><b style="background:linear-gradient(90deg,#f6dfae,#C87A00)"></b>Em andamento (mais escuro = mais adiantada)</span><span><b style="background:var(--vermelho-bg);border:1px solid var(--vermelho)"></b>Não iniciada</span></div>
        <div id="avMapa"><p class="vazio">Carregando…</p></div></div>
      <div class="av-cols">
        <div class="painel"><h3>Ranking das unidades</h3><p class="sub">Mais adiantadas na coleta</p><ul class="av-rank" id="avRank"></ul></div>
        <div class="painel"><h3>Precisam de atenção</h3><p class="sub">Em andamento sem coleta há 7 dias ou mais</p><ul class="av-rank" id="avParadas"></ul></div>
        <div class="painel"><h3>Últimas coletas</h3><p class="sub">Ambientes concluídos mais recentes</p><ul class="av-rank" id="avUltimas"></ul></div>
      </div>`;
    const ref = $('sec-painel'); ref.insertAdjacentElement('afterend', sec);
    $('avAtualizar').onclick = () => carregarAoVivo(true);
    $('avRelatorio').onclick = () => relatorioFinal();
    $('avVer').onchange = () => desenhar();
    $('avBusca').oninput = () => desenhar();
    // botão também no Painel
    const acoes = document.querySelector('#sec-painel .acoes');
    if(acoes && !$('btnRelFinal')){ const r = document.createElement('button'); r.className = 'btn mini pri'; r.id = 'btnRelFinal'; r.textContent = '📄 Relatório final da campanha'; r.onclick = () => relatorioFinal(); acoes.appendChild(r); }
    // a aba "Ao vivo" carrega ao abrir e para de atualizar quando sai
    const abaOrig = window.aba;
    window.aba = function(btn){ abaOrig(btn); if(btn.dataset.sec === 'aovivo') carregarAoVivo(true); };
    $('fCamp') && $('fCamp').addEventListener('change', () => { if(sec.classList.contains('on')) carregarAoVivo(true); });
  }

  /* ---------------- dados ---------------- */
  async function paginado(base){
    const todas = [];
    for(let ini = 0; ini < 300000; ini += 1000){
      const parte = await sb(base + (base.includes('?') ? '&' : '?') + 'limit=1000&offset=' + ini);
      todas.push(...(parte || [])); if(!parte || parte.length < 1000) break;
    }
    return todas;
  }
  let UNIDS = null, LOCAIS_N = null;
  async function dadosCampanha(camp){
    if(!UNIDS) UNIDS = await paginado(`/rest/v1/unidades?org_id=eq.${ORG.id}&ativo=eq.true&select=code,name,parent_code&order=code`);
    if(LOCAIS_N === null){
      try{ const ls = await paginado(`/rest/v1/locais?org_id=eq.${ORG.id}&ativo=eq.true&select=unidade_code`); LOCAIS_N = new Map(); ls.forEach(l => LOCAIS_N.set(l.unidade_code, (LOCAIS_N.get(l.unidade_code) || 0) + 1)); }
      catch(e){ LOCAIS_N = new Map(); }
    }
    let levs = [];
    try{ levs = await sb(`/rest/v1/levantamentos?org_id=eq.${ORG.id}&campanha_id=eq.${camp}&select=*&limit=5000`); }catch(e){ levs = []; }
    const ambs = await paginado(`/rest/v1/ambientes?campanha_id=eq.${camp}&select=id,nome,unidade_code,status,coletado_em,criado_em`);
    return { unids: UNIDS, locaisN: LOCAIS_N, levs: levs || [], ambs };
  }
  // situação de cada unidade na campanha
  function situacao(d){
    const porU = new Map();
    const reg = code => { if(!porU.has(code)) porU.set(code, { code, ambs: 0, colet: 0, ultima: null, lev: null, proc: false }); return porU.get(code); };
    d.ambs.forEach(a => { if(!a.unidade_code) return; const r = reg(a.unidade_code); r.ambs++;
      if(['coletado','consolidado'].includes(String(a.status))) r.colet++;
      const t = a.coletado_em || a.criado_em; if(t && (!r.ultima || t > r.ultima)) r.ultima = t; });
    d.levs.forEach(l => { if(!l.unidade_code) return; const r = reg(l.unidade_code); if(!r.lev || l.status === 'processado') r.lev = l; if(l.status === 'processado') r.proc = true;
      const t = l.atualizado_em || l.criado_em; if(t && (!r.ultima || t > r.ultima)) r.ultima = t; });
    const nomes = new Map(d.unids.map(u => [u.code, u]));
    const lista = [...porU.values()].map(r => {
      const u = nomes.get(r.code) || { code: r.code, name: (r.lev && r.lev.unidade_nome) || r.code };
      const previsto = Math.max(r.ambs, d.locaisN.get(r.code) || 0);
      return Object.assign(r, { name: u.name, parent: u.parent_code || null, previsto, pct: r.proc ? 100 : (previsto ? Math.round(r.colet / previsto * 100) : 0),
        estado: r.proc ? 'concluida' : 'andamento' });
    });
    return { lista, nomes };
  }

  /* ---------------- ao vivo ---------------- */
  let DADOS_AV = null, timer = null, ultimaCarga = 0;
  async function carregarAoVivo(forcar){
    const camp = campAtual();
    if(!camp){ $('avMapa').innerHTML = '<p class="vazio">Escolha uma campanha nos filtros acima.</p>'; return; }
    if(!forcar && Date.now() - ultimaCarga < 20000) return;
    try{
      const d = await dadosCampanha(camp);
      DADOS_AV = Object.assign(d, situacao(d), { camp });
      ultimaCarga = Date.now();
      desenhar();
    }catch(e){ $('avMapa').innerHTML = '<p class="vazio">Falha ao carregar: ' + esc(e.message) + '</p>'; }
    agendar();
  }
  function agendar(){
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sec = $('sec-aovivo');
      if(sec && sec.classList.contains('on') && !document.hidden) carregarAoVivo(true); else agendar();
    }, 30000);
  }
  setInterval(() => { if(ultimaCarga && $('avQuando')) $('avQuando').textContent = 'atualizado há ' + Math.round((Date.now() - ultimaCarga) / 1000) + ' s · atualiza sozinho a cada 30 s'; }, 1000);
  function corAndamento(p){
    // âmbar claro (pouco) → âmbar escuro (quase pronto)
    const a = [246, 223, 174], b = [200, 122, 0], t = Math.max(0, Math.min(1, p / 100));
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
    return `background:rgb(${c.join(',')});color:${t > .55 ? '#fff' : '#5a3a00'}`;
  }
  function desenhar(){
    const d = DADOS_AV; if(!d) return;
    const ver = $('avVer').value, q = normG($('avBusca').value);
    const temFilho = new Set(d.unids.map(u => u.parent_code).filter(Boolean));
    let base = d.lista.slice();
    const comPrevisao = d.unids.filter(u => (d.locaisN.get(u.code) || 0) > 0 && !base.some(x => x.code === u.code));
    // previstas: as que têm levantamento/ambientes + as que têm ambientes cadastrados na estrutura
    let todos = base.concat(comPrevisao.map(u => ({ code: u.code, name: u.name, parent: u.parent_code, previsto: d.locaisN.get(u.code), colet: 0, pct: 0, estado: 'nao', ultima: null })));
    if(ver === 'todas') todos = todos.concat(d.unids.filter(u => !temFilho.has(u.code) && !todos.some(x => x.code === u.code)).map(u => ({ code: u.code, name: u.name, parent: u.parent_code, previsto: 0, colet: 0, pct: 0, estado: 'sem', ultima: null })));
    if(q) todos = todos.filter(x => normG(x.name).includes(q) || normG(x.code).includes(q));
    const conc = todos.filter(x => x.estado === 'concluida').length, and = todos.filter(x => x.estado === 'andamento').length, nao = todos.filter(x => x.estado === 'nao').length;
    const ambTot = d.ambs.length, ambCol = d.ambs.filter(a => ['coletado','consolidado'].includes(String(a.status))).length;
    $('avInd').innerHTML = `
      <div class="ind v"><div class="n">${conc}</div><div class="r">Unidades concluídas</div></div>
      <div class="ind a"><div class="n">${and}</div><div class="r">Em andamento</div></div>
      <div class="ind r"><div class="n">${nao}</div><div class="r">Não iniciadas (com ambientes cadastrados)</div></div>
      <div class="ind"><div class="n">${fmtN(ambCol)}<span style="font-size:18px;color:var(--tinta-2)"> / ${fmtN(ambTot)}</span></div><div class="r">Ambientes coletados</div></div>`;
    if(!todos.length){
      $('avMapa').innerHTML = '<p class="vazio">Nenhuma unidade com levantamento nesta campanha ainda.' + (d.locaisN.size ? '' : ' Cadastre os ambientes de cada unidade na Estrutura organizacional para que as unidades previstas apareçam aqui como "não iniciadas".') + '</p>';
    } else {
      const grupos = new Map();
      todos.forEach(x => { const p = x.parent && d.nomes.get(x.parent); const k = p ? p.name : 'Sem unidade superior'; if(!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(x); });
      const ordem = { concluida: 0, andamento: 1, nao: 2, sem: 3 };
      $('avMapa').innerHTML = [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([g, us]) => `<div class="av-grupo"><h4>${esc(g)} · ${us.length}</h4><div class="av-tiles">${
        us.sort((a, b) => ordem[a.estado] - ordem[b.estado] || b.pct - a.pct || a.name.localeCompare(b.name, 'pt-BR')).map(x => {
          const cls = x.estado === 'concluida' ? 'ok' : x.estado === 'nao' ? 'nao' : x.estado === 'sem' ? 'sem' : '';
          const st = x.estado === 'andamento' ? corAndamento(x.pct) : '';
          const info = x.estado === 'concluida' ? 'processada' : x.estado === 'nao' ? 'não iniciada · ' + x.previsto + ' amb.' : x.estado === 'sem' ? 'sem ambientes previstos' : x.colet + '/' + x.previsto + ' amb. · ' + x.pct + '%';
          const tip = x.name + ' (' + x.code + ')\n' + info + (x.ultima ? '\núltima atividade: ' + fmtDH(x.ultima) : '');
          return `<div class="av-t ${cls}" style="${st}" title="${esc(tip)}"><b>${esc(x.name)}</b><small>${esc(info)}</small></div>`;
        }).join('')}</div></div>`).join('');
    }
    const rank = d.lista.filter(x => x.estado !== 'nao').sort((a, b) => b.pct - a.pct || b.colet - a.colet).slice(0, 10);
    $('avRank').innerHTML = rank.length ? rank.map((x, i) => `<li><span class="pos">${i + 1}º</span><span class="nm">${esc(x.name)}<small>${x.colet}/${x.previsto} ambientes${x.estado === 'concluida' ? ' · processada' : ''}</small></span><span class="bar"><i style="width:${x.pct}%"></i></span><b style="font-size:12px;width:38px;text-align:right">${x.pct}%</b></li>`).join('') : '<li class="sub">Nada ainda.</li>';
    const paradas = d.lista.filter(x => x.estado === 'andamento' && haDias(x.ultima) >= 7).sort((a, b) => haDias(b.ultima) - haDias(a.ultima)).slice(0, 10);
    $('avParadas').innerHTML = paradas.length ? paradas.map(x => `<li><span class="pos" style="color:var(--vermelho)">⚠</span><span class="nm">${esc(x.name)}<small>sem coleta há ${haDias(x.ultima)} dias · ${x.pct}% concluído</small></span></li>`).join('') : '<li class="sub">Nenhuma unidade parada. 👍</li>';
    const ult = d.ambs.filter(a => a.coletado_em).sort((a, b) => b.coletado_em.localeCompare(a.coletado_em)).slice(0, 10);
    $('avUltimas').innerHTML = ult.length ? ult.map(a => `<li><span class="pos">✓</span><span class="nm">${esc(a.nome)}<small>${esc((d.nomes.get(a.unidade_code) || {}).name || a.unidade_code || '')} · ${fmtDH(a.coletado_em)}</small></span></li>`).join('') : '<li class="sub">Nenhum ambiente concluído ainda.</li>';
  }

  /* ---------------- relatório final da campanha ---------------- */
  async function codigo(obj){
    try{
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(obj)));
      const h = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16);
    }catch(e){ return Date.now().toString(36).toUpperCase(); }
  }
  async function relatorioFinal(){
    const camp = campAtual();
    if(!camp) return alert('Escolha a campanha nos filtros do painel.');
    const janela = window.open('', '_blank');
    if(!janela) return alert('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.');
    janela.document.write('<!doctype html><meta charset="utf-8"><title>Gerando relatório…</title><body style="font-family:system-ui;padding:40px;color:#555">Gerando o relatório final da campanha…</body>');
    try{
      const d = await dadosCampanha(camp), s = situacao(d);
      const termos = await sb(`/rest/v1/eventos?org_id=eq.${ORG.id}&tipo=eq.termo&select=dados,ocorrido_em&order=ocorrido_em&limit=5000`).catch(() => []);
      const enc = (termos || []).filter(t => t.dados && t.dados.especie === 'encerramento');
      const cons = await sb(`/rest/v1/vw2_conservacao?campanha_id=eq.${camp}&select=*`).catch(() => []);
      let inserv = [];
      try{ inserv = await paginado(`/rest/v1/itens?select=plaqueta,descricao,conservacao,ambientes!inner(nome,unidade_code,campanha_id)&ambientes.campanha_id=eq.${camp}&conservacao=in.(inservivel,ruim)&status=neq.discarded`); }catch(e){ inserv = []; }
      const levs = d.levs.slice().sort((a, b) => String(a.unidade_nome || '').localeCompare(String(b.unidade_nome || ''), 'pt-BR'));
      const proc = levs.filter(l => l.status === 'processado');
      // consolidação
      const tot = { unidades: s.lista.length, processadas: proc.length, ambientes: d.ambs.length, confirmados: 0, esperados: 0, conformes: 0, naoLoc: 0, valorNao: 0, outroLocal: 0, semRegistro: 0 };
      const naoLoc = [], outroLocal = [];
      levs.forEach(l => { const r = l.resultado || {}, c = r.conciliacao || null;
        tot.confirmados += r.confirmados || 0;
        if(c){ tot.esperados += c.esperados || 0; tot.conformes += c.conferidos || 0; tot.naoLoc += c.naoLocalizados || 0; tot.valorNao += Number(c.valorNao || 0); tot.outroLocal += c.outroLocal || 0; tot.semRegistro += c.semRegistro || 0;
          (c.listaNaoLocalizados || []).forEach(x => naoLoc.push(Object.assign({ unidade: l.unidade_nome }, x)));
          (c.listaOutroLocal || []).forEach(x => outroLocal.push(Object.assign({ unidade: l.unidade_nome }, x))); } });
      const conformidade = tot.esperados ? tot.conformes / tot.esperados * 100 : null;
      const comissao = [...new Map(levs.flatMap(l => (l.comissao || []).map(m => [String(m.nome).trim().toLowerCase(), m]))).values()].filter(m => m.nome);
      const naoIniciadas = d.unids.filter(u => (d.locaisN.get(u.code) || 0) > 0 && !s.lista.some(x => x.code === u.code))
        .map(u => ({ code: u.code, name: u.name, estado: 'nao', pct: 0, ultima: null }));
      const pendentes = s.lista.filter(x => x.estado !== 'concluida').concat(naoIniciadas);
      const consAg = {}; (cons || []).forEach(c => { consAg[c.conservacao] = (consAg[c.conservacao] || 0) + (c.total || 0); });
      const totCons = Object.values(consAg).reduce((a, b) => a + b, 0);
      const inicio = levs.reduce((m, l) => !m || (l.criado_em && l.criado_em < m) ? l.criado_em : m, null);
      const fim = proc.reduce((m, l) => !m || (l.processado_em && l.processado_em > m) ? l.processado_em : m, null);
      const cod = await codigo({ org: ORG.id, camp, tot, n: naoLoc.length, em: new Date().toISOString().slice(0, 10) });
      const nomeC = nomeCamp(camp), tipo = tipoCamp(camp), sis = ORG.sistema_origem || 'sistema patrimonial';
      const vivo = new Map(s.lista.map(x => [x.code, x]));
      const linhaU = levs.map(l => { const r = l.resultado || {}, c = r.conciliacao || {}, v = vivo.get(l.unidade_code) || {};
        return `<tr><td>${esc(l.unidade_nome || l.unidade_code)}</td><td>${l.status === 'processado' ? 'Processado em ' + fmtD(l.processado_em) : '<span class="pend">Em andamento</span>'}</td>
          <td class="n">${fmtN(r.ambientes != null ? r.ambientes : v.ambs)}</td><td class="n">${r.confirmados != null ? fmtN(r.confirmados) : '—'}</td><td class="n">${c.esperados != null ? fmtN(c.esperados) : '—'}</td>
          <td class="n">${c.conformidade != null ? pct(c.conformidade) : '—'}</td><td class="n">${c.naoLocalizados != null ? fmtN(c.naoLocalizados) : '—'}</td><td class="n">${c.valorNao ? fmtR(c.valorNao) : '—'}</td><td>${esc(l.codigo || '')}</td></tr>`; }).join('');
      const tabela = (cols, linhas) => `<table><tr>${cols.map(c => `<th${c[2] ? ' class="n"' : ''}>${c[0]}</th>`).join('')}</tr>${linhas.map(i => `<tr>${cols.map(c => `<td${c[2] ? ' class="n"' : ''}>${c[1](i)}</td>`).join('')}</tr>`).join('')}</table>`;
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório final — ${esc(nomeC)}</title>
<style>
  @page{size:A4;margin:18mm 16mm}
  body{font-family:Georgia,'Times New Roman',serif;color:#1c1c1a;font-size:11.5pt;line-height:1.45;max-width:900px;margin:0 auto;padding:24px}
  .barra{position:sticky;top:0;background:#1A4731;color:#fff;padding:10px 14px;border-radius:10px;display:flex;gap:10px;align-items:center;font-family:system-ui;font-size:13px;margin-bottom:24px}
  .barra button{font:inherit;font-weight:600;border:0;border-radius:7px;padding:7px 12px;cursor:pointer;background:#fff;color:#1A4731}
  .capa{border-bottom:3px solid #C87A00;padding-bottom:16px;margin-bottom:18px}
  .org{font-family:system-ui;font-size:10pt;letter-spacing:.12em;text-transform:uppercase;color:#555}
  h1{font-size:20pt;margin:6px 0 4px;color:#1A4731} h2{font-size:13.5pt;color:#1A4731;border-bottom:1px solid #ddd;padding-bottom:4px;margin:26px 0 10px}
  .meta{font-family:system-ui;font-size:10pt;color:#444}
  table{width:100%;border-collapse:collapse;font-family:system-ui;font-size:9pt;margin:6px 0 10px}
  th{background:#e8f0ea;color:#1A4731;text-align:left;padding:5px 6px;font-size:8pt;text-transform:uppercase;letter-spacing:.04em}
  td{padding:5px 6px;border-bottom:1px solid #e6e2d8;vertical-align:top} .n{text-align:right;white-space:nowrap}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-family:system-ui;margin:10px 0}
  .kpis div{border:1px solid #e2ded3;border-radius:8px;padding:8px 10px} .kpis b{display:block;font-size:16pt;color:#1A4731} .kpis span{font-size:8.5pt;color:#555;text-transform:uppercase}
  .pend{color:#C0392B} .ass{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:28px;margin-top:40px}
  .ass div{border-top:1px solid #333;padding-top:4px;text-align:center;font-family:system-ui;font-size:9.5pt}
  .cod{margin-top:30px;font-family:monospace;font-size:9pt;color:#555;border-top:1px dashed #bbb;padding-top:8px}
  @media print{.barra{display:none}body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<div class="barra">📄 Relatório final da campanha <span style="flex:1"></span><button onclick="print()">Imprimir / salvar em PDF</button><button id="xls">Baixar planilha</button></div>
<div class="capa"><div class="org">${esc(ORG.nome || '')}${ORG.sigla ? ' · ' + esc(ORG.sigla) : ''}</div>
<h1>Relatório Final do Inventário Patrimonial</h1>
<div class="meta"><b>Campanha:</b> ${esc(nomeC)}${tipo ? ' · <b>Tipo:</b> ' + esc(tipo) : ''}<br>
<b>Período:</b> ${fmtD(inicio)} a ${fim ? fmtD(fim) : 'em andamento'} · <b>Emitido em:</b> ${new Date().toLocaleString('pt-BR')}<br>
<b>Código de verificação:</b> ${cod}</div></div>

<h2>1. Resumo</h2>
<div class="kpis"><div><b>${fmtN(tot.unidades)}</b><span>unidades levantadas</span></div><div><b>${fmtN(tot.processadas)}</b><span>levantamentos processados</span></div>
<div><b>${fmtN(tot.ambientes)}</b><span>ambientes</span></div><div><b>${fmtN(tot.confirmados)}</b><span>bens confirmados</span></div>
<div><b>${conformidade != null ? pct(conformidade) : '—'}</b><span>acuracidade (conformidade)</span></div><div><b>${fmtN(tot.naoLoc)}</b><span>bens não localizados</span></div>
<div><b>${fmtR(tot.valorNao)}</b><span>valor não localizado</span></div><div><b>${fmtN(tot.outroLocal)}</b><span>em local divergente</span></div></div>
<p>${conformidade != null ? `Dos ${fmtN(tot.esperados)} bens registrados no ${esc(sis)} para as unidades levantadas, ${fmtN(tot.conformes)} foram encontrados no local registrado, uma acuracidade de <b>${pct(conformidade)}</b>.` : 'Os levantamentos foram processados sem conciliação com a base oficial.'}
${tot.naoLoc ? ` Não foram localizados ${fmtN(tot.naoLoc)} bens, somando ${fmtR(tot.valorNao)}, que devem ser objeto de apuração.` : ''}${pendentes.length ? ` ${pendentes.length} unidade(s) ainda não tiveram o levantamento processado (seção 8).` : ''}</p>

<h2>2. Metodologia</h2>
<p>O levantamento foi realizado em campo, ambiente por ambiente, com o aplicativo ${esc((window.PRODUTO && PRODUTO.nome) || 'de levantamento patrimonial')}, a partir da estrutura organizacional da instituição (unidades e respectivos ambientes). Cada bem foi identificado pela plaqueta de tombamento (leitura do código ou digitação), descrito, fotografado quando necessário e classificado quanto ao estado de conservação (bom, regular, ruim ou inservível). Os bens herdados do levantamento anterior ou da base oficial foram conferidos um a um e marcados como localizados ou não localizados.</p>
<p>Ao final de cada unidade, o levantamento foi processado: o resultado foi conciliado com a base oficial do ${esc(sis)}, classificando os bens em conformes, em local divergente, não localizados, sem registro, sem plaqueta e com plaqueta repetida, e gerando relatório e termo de encerramento com código de verificação.</p>

<h2>3. Comissão de inventário</h2>
${comissao.length ? tabela([['Nome', m => esc(m.nome)], ['Função', m => esc(m.funcao || 'Membro')]], comissao) : '<p>Não informada nos levantamentos.</p>'}

<h2>4. Resultado por unidade</h2>
${levs.length ? `<table><tr><th>Unidade</th><th>Situação</th><th class="n">Ambientes</th><th class="n">Confirmados</th><th class="n">Esperados</th><th class="n">Conformidade</th><th class="n">Não localiz.</th><th class="n">Valor não localiz.</th><th>Código</th></tr>${linhaU}</table>` : '<p>Nenhum levantamento registrado nesta campanha.</p>'}

<h2>5. Bens não localizados</h2>
${naoLoc.length ? tabela([['Unidade', i => esc(i.unidade)], ['Plaqueta', i => esc(i.plaqueta)], ['Descrição', i => esc(i.descricao)], ['Local no cadastro', i => esc(i.local)], ['Valor', i => i.valor != null ? fmtR(i.valor) : '', 1]], naoLoc) + `<p><b>Total listado:</b> ${fmtN(naoLoc.length)} bens · ${fmtR(naoLoc.reduce((t, i) => t + Number(i.valor || 0), 0))}. <b>Providência:</b> abrir apuração de responsabilidade para os bens não localizados, conforme as normas da instituição.</p>` : '<p>Nenhum bem não localizado nos levantamentos processados.</p>'}

<h2>6. Bens em local divergente</h2>
${outroLocal.length ? tabela([['Unidade', i => esc(i.unidade)], ['Plaqueta', i => esc(i.plaqueta)], ['Descrição', i => esc(i.descricao)], ['Encontrado em', i => esc(i.achadoEm)], ['No cadastro', i => esc(i.cadastro)]], outroLocal) + '<p><b>Providência:</b> regularizar a localização no sistema patrimonial (transferência) ou devolver o bem ao local de origem.</p>' : '<p>Nenhum bem em local divergente.</p>'}

<h2>7. Estado de conservação e bens para desfazimento</h2>
${totCons ? tabela([['Estado', x => esc({ bom:'Bom', regular:'Regular', ruim:'Ruim', inservivel:'Inservível', nao_informada:'Não informado' }[x[0]] || x[0])], ['Bens', x => fmtN(x[1]), 1], ['%', x => pct(x[1] / totCons * 100), 1]], Object.entries(consAg).sort((a, b) => b[1] - a[1])) : '<p>Sem dados de conservação.</p>'}
${inserv.length ? '<p>Bens classificados como <b>ruins</b> ou <b>inservíveis</b>, candidatos à avaliação para desfazimento (doação, alienação ou descarte), conforme a legislação aplicável:</p>' + tabela([['Unidade', i => esc((s.nomes.get(i.ambientes.unidade_code) || {}).name || i.ambientes.unidade_code)], ['Ambiente', i => esc(i.ambientes.nome)], ['Plaqueta', i => esc(i.plaqueta || '—')], ['Descrição', i => esc(i.descricao)], ['Estado', i => i.conservacao === 'inservivel' ? 'Inservível' : 'Ruim']], inserv) : ''}

<h2>8. Pendências</h2>
${pendentes.length ? tabela([['Unidade', x => esc(x.name)], ['Situação', x => x.estado === 'nao' ? 'Não iniciada' : 'Em andamento (' + x.pct + '%)'], ['Última atividade', x => fmtD(x.ultima)]], pendentes) : '<p>Todas as unidades levantadas foram processadas.</p>'}

<h2>9. Termos de encerramento emitidos</h2>
${enc.length ? tabela([['Número', t => esc(t.dados.numero || '')], ['Unidade', t => esc(t.dados.unidade || '')], ['Data', t => fmtD(t.ocorrido_em)], ['Conformidade', t => t.dados.conformidade != null ? pct(t.dados.conformidade) : '—', 1], ['Código', t => esc(t.dados.codigo || '')]], enc) : '<p>Nenhum termo de encerramento enviado à nuvem.</p>'}

<div class="ass">${(comissao.length ? comissao : [{ nome:'', funcao:'Presidente da comissão' }, { nome:'', funcao:'Membro' }, { nome:'', funcao:'Membro' }]).slice(0, 6).map(m => `<div><div style="height:46px"></div>${esc(m.nome || '')}<br>${esc(m.funcao || 'Membro')}</div>`).join('')}</div>
<div class="cod">Código de verificação ${cod} · ${esc(ORG.nome || '')} · gerado por ${esc((window.PRODUTO && PRODUTO.nome) || 'Levantamento Patrimonial')} em ${new Date().toLocaleString('pt-BR')}</div>
</body></html>`;
      janela.document.open(); janela.document.write(html); janela.document.close();
      janela.document.getElementById('xls').onclick = async () => {
        try{
          const X = await planilhaLib(), wb = X.utils.book_new();
          const aba = (nome, linhas) => X.utils.book_append_sheet(wb, X.utils.json_to_sheet(linhas.length ? linhas : [{ 'Situação':'Nenhum registro' }]), nome);
          aba('Resumo', [{ 'Campanha': nomeC, 'Tipo': tipo, 'Unidades': tot.unidades, 'Processadas': tot.processadas, 'Ambientes': tot.ambientes, 'Bens confirmados': tot.confirmados,
            'Esperados': tot.esperados, 'Conformes': tot.conformes, 'Acuracidade (%)': conformidade != null ? Math.round(conformidade * 10) / 10 : '', 'Não localizados': tot.naoLoc, 'Valor não localizado': tot.valorNao, 'Código': cod }]);
          aba('Por unidade', levs.map(l => { const r = l.resultado || {}, c = r.conciliacao || {}; return { 'Unidade': l.unidade_nome || l.unidade_code, 'Situação': l.status === 'processado' ? 'processado' : 'em andamento',
            'Processado em': fmtD(l.processado_em), 'Ambientes': r.ambientes || '', 'Confirmados': r.confirmados || '', 'Esperados': c.esperados != null ? c.esperados : '', 'Conformidade (%)': c.conformidade != null ? c.conformidade : '',
            'Não localizados': c.naoLocalizados != null ? c.naoLocalizados : '', 'Valor não localizado': c.valorNao || '', 'Código': l.codigo || '' }; }));
          aba('Não localizados', naoLoc.map(i => ({ 'Unidade': i.unidade, 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Local no cadastro': i.local, 'Valor': i.valor })));
          aba('Local divergente', outroLocal.map(i => ({ 'Unidade': i.unidade, 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Encontrado em': i.achadoEm, 'No cadastro': i.cadastro })));
          aba('Ruins e inservíveis', inserv.map(i => ({ 'Unidade': (s.nomes.get(i.ambientes.unidade_code) || {}).name || i.ambientes.unidade_code, 'Ambiente': i.ambientes.nome, 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Estado': i.conservacao })));
          aba('Pendências', pendentes.map(x => ({ 'Unidade': x.name, 'Situação': x.estado === 'nao' ? 'não iniciada' : 'em andamento', 'Concluído (%)': x.pct, 'Última atividade': fmtD(x.ultima) })));
          X.writeFile(wb, 'relatorio-final-' + normG(nomeC).replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.xlsx');
        }catch(e){ janela.alert('Não foi possível gerar a planilha: ' + e.message); }
      };
    }catch(e){
      janela.document.body.innerHTML = '<p style="font-family:system-ui;padding:40px;color:#C0392B">Não foi possível gerar o relatório: ' + esc(e.message) + '</p>';
    }
  }

  window.PAINEL_CAMPANHA = { carregarAoVivo, relatorioFinal, situacao };
  // o script fica no fim da página: as abas já existem, então monta na hora
  // (antes de o painel reabrir a aba lembrada)
  if(document.querySelector('.abas')) montar(); else document.addEventListener('DOMContentLoaded', montar);
})();
