/* =====================================================================
   LEVANTAMENTOS, MENU E TELA INICIAL
   - Levantamento = unidade + campanha (finalidade) + descrição + comissão,
     reunindo os ambientes levantados. Iniciar, editar, excluir, processar
     (com checagem de pendências e conciliação) e reabrir.
   - Importar o levantamento anterior como ponto de partida (nuvem, aparelho,
     arquivo ou base oficial): os bens entram como "pendentes de conferência".
   - Menu lateral por seções e tela Início com indicadores e ações rápidas.
   Usa as pontes window.APP (index.html) e window.CONTROLE (controle.js).
   ===================================================================== */
(function(){
  'use strict';
  const A = () => window.APP, C = () => window.CONTROLE;
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const org = () => window.ORG || {};
  const hoje = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  const unidadeDe = a => { const u = a && a.units && a.units[0]; return u ? { code: u.code || String(u), name: u.name || u.code || String(u), path: u.path || '' } : null; };
  const ui = () => C().ui;

  /* ---------------- dados ---------------- */
  let LEVS = [];
  const chave = () => 'levantamentos:' + (org().id || 'legado');
  async function carregar(){ try{ LEVS = (await A().meta.ler(chave())) || []; }catch(e){ LEVS = []; } }
  async function gravar(){ try{ await A().meta.gravar(chave(), LEVS); }catch(e){} }
  const ambsDe = lev => A().ambientes().filter(a => a.levantamentoId === lev.id);
  function numeros(lev){
    const ambs = ambsDe(lev), itens = ambs.flatMap(a => (a.items || []).filter(i => i.status !== 'discarded'));
    return { ambs, total: ambs.length, coletados: ambs.filter(a => a.status === 'coletado').length,
      bens: itens.length, confirmados: itens.filter(i => i.status === 'confirmed').length, pendentes: itens.filter(i => i.status === 'pending').length,
      naoLocalizados: ambs.reduce((t, a) => t + (a.items || []).filter(i => i.status === 'discarded' && i.herdado).length, 0) };
  }

  /* ---------------- campanhas ---------------- */
  let CAMPANHAS = [];
  const chaveCamp = () => 'campanhas_cache:' + (org().id || 'legado');
  try{ CAMPANHAS = JSON.parse(localStorage.getItem(chaveCamp()) || '[]'); }catch(e){}
  async function buscarCampanhas(){
    try{
      const filtro = org().id ? '&org_id=eq.' + org().id : '';
      const lista = await ui().nuvem('/rest/v1/campanhas?select=id,nome,aberta,criado_em&order=criado_em.desc' + filtro);
      if(Array.isArray(lista)){ CAMPANHAS = lista; try{ localStorage.setItem(chaveCamp(), JSON.stringify(lista)); }catch(e){} }
    }catch(e){}
    return CAMPANHAS;
  }
  const nomeCamp = id => { const c = CAMPANHAS.find(x => x.id === id); return c ? String(c.nome).split(' · ')[0] : ''; };
  const finalidadeCamp = id => { const c = CAMPANHAS.find(x => x.id === id); const p = c ? String(c.nome).split(' · ') : []; return p.length > 1 ? p[p.length - 1] : ''; };
  /* tipos de levantamento (lista em config.js) */
  const TIPOS = () => (window.TIPOS_LEVANTAMENTO && window.TIPOS_LEVANTAMENTO.length) ? window.TIPOS_LEVANTAMENTO : [{ nome:'Anual', desc:'' }];
  // nomes antigos de tipo (campanhas criadas antes desta lista) → nome atual
  const ALIAS_TIPO = { 'mudanca de gestao':'transferencia de responsabilidade', 'semestral':'semestral / periodico', 'conferencia':'conferencia por amostragem',
    'conformidade':'auditoria / conformidade', 'tombamento inicial':'tombamento / regularizacao', 'localizacao / rastreamento':'localizacao de bens' };
  const tipoCanon = t => { const n = norm(t || '').trim(); return ALIAS_TIPO[n] || n; };
  const mesmoTipo = (a, b) => !!a && !!b && tipoCanon(a) === tipoCanon(b);
  function opcoesTipos(sel){
    const lst = TIPOS().slice();
    if(sel && !lst.some(t => t.nome === sel)) lst.push({ nome: sel, desc: '' });
    return '<option value="">Selecione o tipo…</option>' + lst.map(t => `<option value="${esc(t.nome)}"${t.nome === sel ? ' selected' : ''}>${esc(t.nome)}</option>`).join('');
  }
  const descTipo = n => { const t = TIPOS().find(x => x.nome === n); return t ? t.desc : ''; };
  const podeCriarCampanha = () => !!(org().id && ['gestor','admin'].includes(org().papel));
  function opcoesCampanhas(sel, soAbertas, tipo){
    const lista = CAMPANHAS.filter(c => !soAbertas || c.aberta !== false);
    const doTipo = tipo ? lista.filter(c => mesmoTipo(finalidadeCampDe(c), tipo)) : [];
    const outras = lista.filter(c => !doTipo.includes(c));
    const op = c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(String(c.nome).split(' · ')[0])}${finalidadeCampDe(c) && !doTipo.includes(c) ? ' · ' + esc(finalidadeCampDe(c)) : ''}${c.aberta === false ? ' (encerrada)' : ''}</option>`;
    let h = '<option value="">' + (lista.length ? 'Selecione a campanha…' : 'Nenhuma campanha aberta') + '</option>';
    if(doTipo.length) h += `<optgroup label="Campanhas de ${esc(tipo)}">${doTipo.map(op).join('')}</optgroup>`;
    if(tipo && !doTipo.length && podeCriarCampanha()) h += `<option value="__nova"${sel === '__nova' ? ' selected' : ''}>＋ Criar a campanha "${esc(tipo)} ${new Date().getFullYear()}"</option>`;
    if(outras.length) h += `<optgroup label="${tipo ? 'Outras campanhas abertas' : 'Campanhas abertas'}">${outras.map(op).join('')}</optgroup>`;
    return h;
  }
  const finalidadeCampDe = c => { const p = String(c.nome).split(' · '); return p.length > 1 ? p[p.length - 1] : ''; };
  // gestor/administrador: cria a campanha do tipo escolhido sem sair do app
  async function criarCampanhaDoTipo(tipo){
    const ano = new Date().getFullYear(), o = org();
    let inv = await ui().nuvem('/rest/v1/inventarios?select=id&ano=eq.' + ano + '&org_id=eq.' + o.id + '&limit=1');
    let invId = inv && inv[0] && inv[0].id;
    if(!invId){
      const novo = await ui().nuvem('/rest/v1/inventarios', { method:'POST', headers:{ Prefer:'return=representation' },
        body: JSON.stringify([{ ano, titulo: 'Inventário ' + ano + (o.sigla ? ' — ' + o.sigla : ''), org_id: o.id }]) });
      invId = novo && novo[0] && novo[0].id;
    }
    const c = await ui().nuvem('/rest/v1/campanhas', { method:'POST', headers:{ Prefer:'return=representation' },
      body: JSON.stringify([{ inventario_id: invId, nome: tipo + ' ' + ano + ' · ' + tipo, aberta: true, org_id: o.id }]) });
    const nova = c && c[0];
    if(!nova || !nova.id) throw new Error('a campanha não foi criada');
    await buscarCampanhas();
    if(!CAMPANHAS.some(x => x.id === nova.id)) CAMPANHAS.unshift(nova);
    return nova.id;
  }
  function ativarCampanha(id){
    if(!id) return;
    try{ localStorage.setItem('campanha_ativa', id); }catch(e){}
    if(window.PatrimonioSync){ try{ PatrimonioSync.setCampaign(id); PatrimonioSync.start(); }catch(e){} }
  }

  /* ---------------- vínculo ambiente ↔ levantamento ---------------- */
  function novoLev(d){
    const lev = Object.assign({ id: A().novoId(), unidade: null, campanhaId: null, campanhaNome: '', finalidade: '', descricao: '', observacao: '',
      comissao: [], status: 'em_andamento', criadoEm: new Date().toISOString(), criadoPor: A().quemSou(), origem: { tipo: 'novo' } }, d || {});
    if(lev.campanhaId){ lev.campanhaNome = lev.campanhaNome || nomeCamp(lev.campanhaId); lev.finalidade = lev.finalidade || finalidadeCamp(lev.campanhaId); }
    LEVS.unshift(lev);
    return lev;
  }
  function vincular(a){
    const u = unidadeDe(a), camp = a.campanhaId || null;
    let lev = a.levantamentoId && LEVS.find(l => l.id === a.levantamentoId);
    if(lev && (!u || (lev.unidade && lev.unidade.code === u.code))) return lev;
    lev = LEVS.find(l => l.status !== 'processado' && l.unidade && u && l.unidade.code === u.code && (l.campanhaId || null) === camp);
    if(!lev) lev = novoLev({ unidade: u, campanhaId: camp });
    a.levantamentoId = lev.id;
    gravar();
    return lev;
  }
  async function garantirVinculos(){
    for(const a of A().ambientes()){
      if(a.levantamentoId && LEVS.some(l => l.id === a.levantamentoId)) continue;
      vincular(a); await A().salvar(a);
    }
  }

  /* ---------------- estilo ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  .barra-app{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:10px;background:var(--verde,#1A4731);color:#f3efe4;padding:10px 14px;border-bottom:3px solid var(--ambar,#C87A00)}
  .barra-app button{background:transparent;border:1px solid rgba(243,239,228,.35);color:#f3efe4;border-radius:8px;width:38px;height:34px;font-size:18px;cursor:pointer}
  .ba-titulo{font-family:var(--font-display,Georgia,serif);font-weight:600;font-size:16px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ba-org{font-family:var(--font-mono,monospace);font-size:10.5px;letter-spacing:.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw}
  .menu-lateral{position:fixed;top:0;left:0;bottom:0;width:268px;background:#102b1e;color:#e8efe9;z-index:60;overflow-y:auto;transform:translateX(-100%);transition:transform .2s;padding-bottom:20px}
  .menu-lateral.aberto{transform:none;box-shadow:8px 0 30px rgba(0,0,0,.3)}
  .menu-fundo{position:fixed;inset:0;background:rgba(10,20,14,.45);z-index:55;display:none}
  .menu-fundo.on{display:block}
  .ml-topo{padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:6px}
  .ml-marca{font-family:var(--font-display,Georgia,serif);font-size:18px;font-weight:600;color:#fff}
  .ml-org{font-family:var(--font-mono,monospace);font-size:10.5px;letter-spacing:.6px;color:#d9a441;margin-top:3px;line-height:1.4}
  .ml-sec{font-family:var(--font-mono,monospace);font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(232,239,233,.5);padding:14px 18px 6px}
  .menu-lateral nav button{display:flex;align-items:center;gap:11px;width:100%;text-align:left;background:none;border:0;color:#e8efe9;font-family:inherit;font-size:14px;padding:9px 18px;cursor:pointer;border-left:3px solid transparent}
  .menu-lateral nav button:hover{background:rgba(255,255,255,.06)}
  .menu-lateral nav button.on{background:rgba(217,164,65,.14);border-left-color:#d9a441;color:#fff;font-weight:600}
  .menu-lateral nav button .i{width:20px;text-align:center;font-size:15px;opacity:.9}
  @media(min-width:1100px){
    body.com-menu{padding-left:268px}
    .menu-lateral{transform:none}
    .barra-app #menuBtn{display:none}
    .menu-fundo{display:none !important}
  }
  .lv-saudacao{font-family:var(--font-display,Georgia,serif);font-size:24px;margin:6px 0 2px;color:var(--text-primary)}
  .lv-sub{font-size:13px;color:var(--text-muted);margin:0 0 16px}
  .lv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:16px}
  .lv-kpi{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:11px 13px}
  .lv-kpi b{display:block;font-family:var(--font-display,Georgia,serif);font-size:24px;line-height:1.1;color:var(--verde)}
  .lv-kpi span{font-size:11.5px;color:var(--text-muted)}
  .lv-kpi.alerta b{color:var(--pending)}
  .lv-acoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:18px}
  .lv-acao{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--bg-card);border:1.5px solid var(--border);border-radius:12px;padding:13px;cursor:pointer;font-family:inherit;color:var(--text-primary)}
  .lv-acao:hover{border-color:var(--verde)}
  .lv-acao.pri{background:var(--verde);border-color:var(--verde);color:#fff}
  .lv-acao .t{font-weight:700;font-size:14px}
  .lv-acao .d{font-size:11.5px;opacity:.75;line-height:1.35}
  .lv-titulo{font-family:var(--font-display,Georgia,serif);font-size:18px;margin:6px 0 10px;color:var(--text-primary)}
  .lv-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:13px 14px;margin-bottom:8px}
  .lv-card .cab{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
  .lv-card .nome{font-weight:700;font-size:14.5px;color:var(--text-primary);cursor:pointer}
  .lv-card .meta{font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.4}
  .lv-chip{flex-shrink:0;font-family:var(--font-mono,monospace);font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:10px;background:var(--pending-bg);color:var(--gold-dim)}
  .lv-chip.proc{background:var(--success-bg);color:var(--verde)}
  .lv-barra{height:6px;background:var(--border-soft,#ECE8DD);border-radius:4px;margin:9px 0 6px;overflow:hidden}
  .lv-barra i{display:block;height:100%;background:var(--verde)}
  .lv-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .lv-btn{font-family:inherit;font-size:12.5px;font-weight:600;padding:6px 11px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-primary);cursor:pointer}
  .lv-btn:hover{border-color:var(--verde);color:var(--verde)}
  .lv-btn.perigo{color:var(--danger);border-color:#e6c4be}
  .lv-btn.pri{background:var(--verde);border-color:var(--verde);color:#fff}
  .lv-info{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6;margin-bottom:12px}
  .lv-info b{color:var(--text-muted);font-weight:600;font-family:var(--font-mono,monospace);font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;display:inline-block;min-width:110px}
  .lv-amb{display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:6px}
  .lv-amb .n{flex:1;min-width:0;cursor:pointer}
  .lv-amb .n b{display:block;font-size:13.5px}
  .lv-amb .n small{font-size:11.5px;color:var(--text-muted)}
  .lv-amb .st{font-size:10px;font-family:var(--font-mono,monospace);text-transform:uppercase;padding:2px 7px;border-radius:9px;background:var(--pending-bg);color:var(--gold-dim)}
  .lv-amb .st.ok{background:var(--success-bg);color:var(--verde)}
  .lv-vazio{padding:24px 16px;text-align:center;background:var(--bg-card);border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);font-size:13.5px;line-height:1.6}
  .lv-passos{text-align:left;max-width:420px;margin:10px auto 0;padding-left:18px}
  .lv-check{display:flex;gap:9px;align-items:flex-start;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border-soft,#ECE8DD)}
  .lv-check i{font-style:normal;width:18px;text-align:center}
  .lv-origem{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
  .lv-origem label{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;font-size:13px;background:var(--bg-card)}
  .lv-origem label small{display:block;color:var(--text-muted);font-size:11.5px;margin-top:1px}
  .lv-origem input{margin-top:3px}
  .lv-res{max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:9px;background:var(--bg-card);margin-top:-6px;margin-bottom:10px}
  .lv-res div{padding:8px 11px;border-bottom:1px solid var(--border-soft,#ECE8DD);cursor:pointer;font-size:13px}
  .lv-res div:hover{background:var(--success-bg)}
  .lv-res small{display:block;font-size:11px;color:var(--text-faint)}
  .lv-proximo{display:flex;gap:14px;align-items:center;background:linear-gradient(135deg,var(--verde,#1A4731),#2a6b49);color:#fff;border-radius:14px;padding:14px 16px;margin-bottom:16px;box-shadow:0 6px 18px rgba(26,71,49,.18)}
  .lv-proximo .ic{font-size:26px;flex-shrink:0}
  .lv-proximo .tx{flex:1;min-width:0;font-size:13px;line-height:1.45}
  .lv-proximo .tx small{display:block;font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.8px;text-transform:uppercase;opacity:.8;margin-bottom:2px}
  .lv-proximo .tx b{font-size:15px;display:block}
  .lv-proximo button{flex-shrink:0;font-family:inherit;font-weight:700;font-size:13px;background:#fff;color:var(--verde,#1A4731);border:0;border-radius:10px;padding:10px 14px;cursor:pointer}
  .aj-passos{margin:6px 0 12px;padding-left:20px;font-size:13.5px;line-height:1.6}
  .aj-passos li{margin-bottom:6px}
  .aj-dica{background:var(--success-bg,#E8F2EC);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--verde,#1A4731);line-height:1.5}
  .cm-det{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:13px}
  .cm-det summary{cursor:pointer;font-weight:600}
  .cm-lst{max-height:240px;overflow-y:auto;margin-top:6px}
  .cm-lst div{padding:5px 0;border-bottom:1px solid var(--border-soft,#ECE8DD)}
  .cm-lst small{display:block;color:var(--text-faint);font-size:11.5px}
  .herdado-badge{font-family:var(--font-mono,monospace);font-size:10px;padding:2px 7px;border-radius:9px;background:#e7eef6;color:#0D3B6E;margin-right:6px}
  .herdados-barra{background:#e7eef6;border:1px solid #c9d8ea;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#0D3B6E;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;line-height:1.45}
  .aviso-processado{background:var(--success-bg);border:1px solid #c4dccb;border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--verde);margin-bottom:12px;line-height:1.45}
  .somente-leitura #itemList,.somente-leitura #addManualBtn,.somente-leitura #photoMode,.somente-leitura #coletaModo,.somente-leitura #editAmbienteBtn,.somente-leitura #finishRoomBtn{pointer-events:none;opacity:.55}
  `;
  document.head.appendChild(css);

  /* ---------------- telas novas ---------------- */
  const app = document.querySelector('.app');
  const tela = (id, html) => { const d = document.createElement('div'); d.id = id; d.className = 'tela-extra'; d.style.display = 'none'; d.innerHTML = html; app.appendChild(d); return d; };
  tela('screenInicio', '<div id="inicioConteudo"></div>');
  tela('screenLevantamentos', `
    <div class="lv-titulo">Levantamentos</div>
    <p class="lv-sub">Cada levantamento reúne os ambientes de uma unidade numa campanha. Abra para coletar, edite, processe ao final ou exclua.</p>
    <div class="ctl-barra"><input type="search" id="lvBusca" placeholder="Buscar unidade, campanha ou descrição…">
      <select id="lvFiltro"><option value="">Todos</option><option value="em_andamento">Em andamento</option><option value="processado">Processados</option></select></div>
    <button class="btn btn-primary btn-full" id="lvNovoBtn" type="button" style="margin-bottom:12px">+ Iniciar levantamento</button>
    <div id="lvLista"></div>`);
  tela('screenLevantamento', `
    <div class="breadcrumb-bar"><button class="back-link" id="lvVoltar">← Levantamentos</button><div class="breadcrumb-text"><p class="sala" id="lvNome"></p></div></div>
    <div id="lvDetalhe"></div>`);
  tela('screenBase', `
    <div class="lv-titulo">Base oficial e backup</div>
    <p class="lv-sub">A base oficial é a planilha do sistema patrimonial da organização, usada para conferir o que foi achado em campo. O backup guarda uma cópia de tudo o que está neste aparelho.</p>
    <div id="baseSlot"></div>`);
  // as barras de base, backup e destinação saem da lista e vão para a tela própria
  ['sipacImportBar', 'backupBar', 'reconectaBar'].forEach(id => { const el = $(id); if(el) $('baseSlot').appendChild(el); });
  const sc = $('screenControle'); if(sc) sc.classList.add('tela-extra');

  /* ---------------- menu lateral ---------------- */
  const ITENS = [
    ['Principal'], ['inicio', '🏠', 'Início'],
    ['Levantamento patrimonial'], ['estrutura', '🌳', 'Estrutura organizacional'], ['iniciar', '＋', 'Iniciar levantamento'], ['levantamentos', '📋', 'Levantamentos'], ['ambientes', '🏢', 'Unidades e ambientes'],
      ['importar', '↺', 'Importar levantamento anterior'], ['mapa', '🗺', 'Mapa dos ambientes'],
    ['Conferência e controle'], ['conciliacao', '⚖', 'Conciliação'], ['transferencias', '⇄', 'Transferências'], ['termos', '✍', 'Termos'], ['historico', '🕘', 'Histórico'],
    ['Dados'], ['base', '🗂', 'Base oficial e backup'], ['destinacao', '♻', 'Fila de destinação'],
    ['Conta'], ['perfil', '👤', 'Meu perfil'], ['organizacao', '🏛', 'Trocar de organização'], ['painel', '📊', 'Painel de gestão'], ['tutorial', '?', 'Como usar'], ['sair', '⏻', 'Sair']
  ];
  const aside = document.createElement('aside'); aside.id = 'menuLateral'; aside.className = 'menu-lateral';
  aside.innerHTML = `<div class="ml-topo"><div class="ml-marca">${esc((window.PRODUTO && PRODUTO.nome) || 'Levantamento Patrimonial')}</div><div class="ml-org" id="mlOrg"></div></div><nav>` +
    ITENS.map(i => i.length === 1 ? `<div class="ml-sec">${esc(i[0])}</div>` : `<button type="button" data-ir="${i[0]}"><span class="i">${i[1]}</span>${esc(i[2])}</button>`).join('') + '</nav>';
  const fundo = document.createElement('div'); fundo.id = 'menuFundo'; fundo.className = 'menu-fundo';
  const barra = document.createElement('header'); barra.className = 'barra-app';
  barra.innerHTML = '<button type="button" id="menuBtn" aria-label="Abrir menu">☰</button><span class="ba-titulo" id="baTitulo">Início</span><span class="ba-org" id="baOrg"></span><button type="button" id="ajudaBtn" aria-label="Ajuda desta tela" title="Como usar esta tela">?</button>';
  document.body.prepend(aside); document.body.prepend(fundo); app.parentNode.insertBefore(barra, app);
  document.body.classList.add('com-menu');
  const abrirMenu = v => { aside.classList.toggle('aberto', v); fundo.classList.toggle('on', v); };
  $('menuBtn').onclick = () => abrirMenu(!aside.classList.contains('aberto'));
  $('ajudaBtn').onclick = () => abrirAjuda();
  fundo.onclick = () => abrirMenu(false);
  aside.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => irPara(b.dataset.ir));
  function atualizarCabecalho(){
    const o = org(), txt = o.nome ? ((o.sigla ? o.sigla + ' · ' : '') + o.nome) : '';
    $('mlOrg').textContent = txt + (o.papel ? ' — ' + o.papel : '');
    $('baOrg').textContent = o.sigla || o.nome || '';
    const p = aside.querySelector('[data-ir="painel"]'); if(p) p.style.display = (!o.id || ['supervisor','gestor','admin'].includes(o.papel)) ? '' : 'none';
  }
  const TITULO = { inicio:'Início', levantamentos:'Levantamentos', ambientes:'Unidades e ambientes', mapa:'Mapa dos ambientes', conciliacao:'Conciliação e controle',
    transferencias:'Conciliação e controle', termos:'Conciliação e controle', historico:'Conciliação e controle', base:'Base oficial e backup', destinacao:'Fila de destinação', levantamento:'Levantamento', estrutura:'Estrutura organizacional' };
  function marcar(dest){
    aside.querySelectorAll('[data-ir]').forEach(b => b.classList.toggle('on', b.dataset.ir === dest));
    $('baTitulo').textContent = TITULO[dest] || $('baTitulo').textContent;
  }
  function mostrar(id){ A().esconderTelas(); $(id).style.display = 'block'; window.scrollTo({ top:0, behavior:'instant' }); }
  // tela atual: ao apertar F5 o app volta para ela (vale só nesta aba do navegador)
  const TELAS_FIXAS = ['inicio','estrutura','levantamentos','ambientes','conciliacao','transferencias','termos','historico','base','destinacao'];
  const lembrar = t => { try{ sessionStorage.setItem('app_tela', JSON.stringify(t)); }catch(e){} };
  window.lembrarTela = lembrar;
  async function irPara(dest){
    abrirMenu(false);
    switch(dest){
      case 'inicio': mostrar('screenInicio'); await renderInicio(); break;
      case 'levantamentos': mostrar('screenLevantamentos'); renderLista(); break;
      case 'iniciar': iniciarLevantamento(); return;
      case 'importar': escolherDestinoImportacao(); return;
      case 'ambientes': A().abrirTela('ambientes'); break;
      case 'mapa': A().abrirTela('ambientes'); $('viewMapBtn').click(); break;
      case 'conciliacao': case 'transferencias': case 'termos': case 'historico': C().abrir(dest); break;
      case 'base': mostrar('screenBase'); break;
      case 'estrutura': mostrar('screenEstrutura'); if(window.ESTRUTURA){ ESTRUTURA.render(); ESTRUTURA.carregar().then(() => ESTRUTURA.render()); } break;
      case 'destinacao': A().abrirTela('destinacao'); break;
      case 'perfil': $('btnPerfil').click(); return;
      case 'organizacao': if(window.trocarOrganizacao) window.trocarOrganizacao(); return;
      case 'painel': location.href = 'gestao.html'; return;
      case 'tutorial': if(window.abrirTutorial) window.abrirTutorial(); return;
      case 'sair':
        if(!confirm('Sair desta conta? O que ainda não foi enviado continua guardado neste aparelho.')) return;
        try{ localStorage.removeItem('supa_session'); localStorage.removeItem('gestao_session'); localStorage.removeItem('acesso_ok'); localStorage.removeItem('gestao_cache'); }catch(e){}
        location.reload(); return;
    }
    marcar(dest);
    if(TELAS_FIXAS.includes(dest)) lembrar({ dest });
  }

  /* ---------------- tela Início ---------------- */
  async function renderInicio(){
    await carregar();
    const ambs = A().ambientes(), itens = ambs.flatMap(a => (a.items || []).filter(i => i.status !== 'discarded'));
    const andamento = LEVS.filter(l => l.status !== 'processado');
    const pend = itens.filter(i => i.status === 'pending').length, herdPend = itens.filter(i => i.status === 'pending' && i.herdado).length;
    let ultimo = null; try{ const id = localStorage.getItem('ultimo_ambiente'); ultimo = ambs.find(a => String(a.id) === id); }catch(e){}
    const nome = (A().quemSou() || '').split(/[ @]/)[0];
    const nUn = A().unidades().length, E = window.ESTRUTURA, nAmbCad = E ? A().unidades().reduce((t, u) => t + E.locaisDe(u.code).length, 0) : 0;
    const avisoEstr = !nUn ? `<div class="es-aviso" style="margin-bottom:14px"><b>Cadastre a estrutura organizacional primeiro.</b> O levantamento é feito por unidade e pelos ambientes de cada unidade.
        ${E && E.podeEditar() ? '<br><button class="lv-btn" type="button" data-ir2="estrutura" style="margin-top:8px">🌳 Cadastrar estrutura</button>' : '<br>Peça à gestão patrimonial (gestor ou administrador) para cadastrá-la.'}</div>` : '';
    const prox = proximoPasso();
    const cardProx = prox && nUn ? `<div class="lv-proximo"><span class="ic">${prox.ic}</span><span class="tx"><small>Próximo passo</small><b>${esc(prox.titulo)}</b>${esc(prox.texto)}</span>
      <button type="button" id="proxBtn">${esc(prox.botao)} →</button></div>` : '';
    $('inicioConteudo').innerHTML = avisoEstr + `
      <div class="lv-saudacao">Olá${nome && nome !== 'não' ? ', ' + esc(nome) : ''}</div>
      <p class="lv-sub">${esc(org().nome || 'Levantamento patrimonial')}${org().papel ? ' · seu papel: ' + esc(org().papel) : ''}</p>
      ${cardProx}
      <div class="lv-kpis">
        <div class="lv-kpi"><b>${andamento.length}</b><span>levantamentos em andamento</span></div>
        <div class="lv-kpi"><b>${ambs.filter(a => a.status === 'coletado').length}/${ambs.length}</b><span>ambientes concluídos</span></div>
        <div class="lv-kpi"><b>${itens.filter(i => i.status === 'confirmed').length}</b><span>bens confirmados</span></div>
        <div class="lv-kpi${pend ? ' alerta' : ''}"><b>${pend}</b><span>aguardando conferência${herdPend ? ' (' + herdPend + ' do levantamento anterior)' : ''}</span></div>
        <div class="lv-kpi"><b>${A().base().length}</b><span>bens na base oficial</span></div>
      </div>
      <div class="lv-acoes">
        <button class="lv-acao pri" data-ir2="iniciar"><span class="t">＋ Iniciar levantamento</span><span class="d">Escolha a unidade e a campanha e comece</span></button>
        ${ultimo ? `<button class="lv-acao" data-amb="${ultimo.id}"><span class="t">▶ Continuar coleta</span><span class="d">${esc(ultimo.name)}</span></button>` : ''}
        <button class="lv-acao" data-ir2="importar"><span class="t">↺ Importar levantamento anterior</span><span class="d">Use o do ano passado como ponto de partida</span></button>
        <button class="lv-acao" data-ir2="levantamentos"><span class="t">📋 Levantamentos</span><span class="d">Editar, processar, excluir</span></button>
        <button class="lv-acao" data-ir2="estrutura"><span class="t">🌳 Estrutura organizacional</span><span class="d">${nUn} unidades · ${nAmbCad} ambientes cadastrados</span></button>
        <button class="lv-acao" data-ir2="conciliacao"><span class="t">⚖ Conciliação</span><span class="d">Achado em campo × base oficial</span></button>
      </div>
      <div class="lv-titulo">Em andamento</div>
      <div id="inicioLevs">${andamento.length ? andamento.slice(0, 6).map(cartao).join('') : `<div class="lv-vazio">Nenhum levantamento em andamento.
        <ol class="lv-passos"><li>Confira a <b>estrutura organizacional</b>: as unidades e os ambientes de cada uma.</li><li>Toque em <b>Iniciar levantamento</b> e escolha a unidade e a campanha.</li><li>Se houver levantamento do ano anterior, importe-o como ponto de partida.</li>
        <li>Crie os ambientes (salas) e lance ou confirme os bens.</li><li>Ao final, <b>processe</b> o levantamento para fechar o resultado.</li></ol></div>`}</div>`;
    ligarCartoes($('inicioLevs'));
    if(prox && $('proxBtn')) $('proxBtn').onclick = prox.acao;
    $('inicioConteudo').querySelectorAll('[data-ir2]').forEach(b => b.onclick = () => irPara(b.dataset.ir2));
    $('inicioConteudo').querySelectorAll('[data-amb]').forEach(b => b.onclick = () => abrirAmbiente(b.dataset.amb));
  }
  // o que fazer agora, conforme a situação de quem está usando
  function proximoPasso(){
    const E = window.ESTRUTURA, ed = E && E.podeEditar();
    const unid = A().unidades();
    if(!unid.length) return null;
    const temAmbCad = E && unid.some(u => E.locaisDe(u.code).length);
    const abertos = LEVS.filter(l => l.status !== 'processado');
    if(!LEVS.length){
      if(ed && E && !E.semTabela && !temAmbCad) return { ic:'🌳', titulo:'Cadastre os ambientes das unidades', texto:'Com as salas de cada unidade cadastradas, o levantamento já começa com os ambientes prontos.', botao:'Abrir estrutura', acao: () => irPara('estrutura') };
      return { ic:'🚀', titulo:'Inicie o seu primeiro levantamento', texto:'Escolha a unidade e o tipo de levantamento. Leva menos de um minuto.', botao:'Iniciar', acao: () => iniciarLevantamento() };
    }
    // levantamento com tudo coletado e ainda não processado
    const pronto = abertos.find(l => { const n = numeros(l); return n.total && n.coletados === n.total; });
    if(pronto) return { ic:'⚙', titulo:'Processe o levantamento de ' + (pronto.unidade ? pronto.unidade.name : ''), texto:'Todos os ambientes foram concluídos. Processar fecha o resultado e gera o relatório e o termo.', botao:'Processar', acao: () => { abrirLev(pronto); setTimeout(() => processarLev(pronto), 50); } };
    // continuar a coleta: o ambiente pendente mais recente
    for(const l of abertos){
      const pend = ambsDe(l).filter(a => a.status !== 'coletado' && !a.processado);
      if(pend.length){ const a = pend[0], n = numeros(l);
        return { ic:'▶', titulo:'Continue a coleta em ' + a.name, texto:(l.unidade ? l.unidade.name + ' · ' : '') + n.coletados + ' de ' + n.total + ' ambientes concluídos.', botao:'Continuar', acao: () => { veioDoLev = true; LEV_ABERTO = l; A().esconderTelas(); A().abrir(a); } }; }
      if(!ambsDe(l).length) return { ic:'＋', titulo:'Crie os ambientes de ' + (l.unidade ? l.unidade.name : 'seu levantamento'), texto:'O levantamento ainda não tem ambientes. Use os cadastrados da unidade ou crie em campo.', botao:'Abrir levantamento', acao: () => abrirLev(l) };
    }
    const proc = LEVS.filter(l => l.status === 'processado').sort((a, b) => String(b.processadoEm).localeCompare(String(a.processadoEm)))[0];
    if(proc) return { ic:'📜', titulo:'Feche com o termo de encerramento', texto:'O levantamento de ' + (proc.unidade ? proc.unidade.name : '') + ' foi processado. Emita o relatório e o termo de encerramento, ou inicie o da próxima unidade.', botao:'Ver levantamento', acao: () => abrirLev(proc) };
    return { ic:'🚀', titulo:'Inicie um novo levantamento', texto:'Escolha a próxima unidade.', botao:'Iniciar', acao: () => iniciarLevantamento() };
  }
  /* ---------------- ajuda de cada tela ---------------- */
  const AJUDA = {
    screenInicio: ['Início', ['O cartão verde mostra o <b>próximo passo</b> — é só tocar no botão.', 'Os números de cima resumem os levantamentos deste aparelho.', 'Use <b>☰</b> (menu) para ir a qualquer parte do app.'], 'Comece sempre por aqui: o app indica o que fazer em seguida.'],
    screenEstrutura: ['Estrutura organizacional', ['<b>Lista de cadastradas</b>: todas as unidades, com a superior e os ambientes de cada uma.', '<b>＋ Cadastrar unidade</b>: crie uma unidade e escolha a de cima.', 'Toque numa unidade para ver e cadastrar os <b>ambientes</b> (vários de uma vez, um por linha).', '<b>Importar / Exportar</b>: trabalhe em planilha e traga de volta.'], 'Sem a estrutura não há levantamento: ele é feito por unidade e pelos ambientes de cada unidade.'],
    screenLevantamentos: ['Levantamentos', ['Cada cartão é um levantamento: uma unidade numa campanha.', 'Toque no nome para abrir, coletar, processar ou emitir documentos.', 'Use a busca e o filtro para achar rápido.'], 'Um levantamento só termina quando é <b>processado</b>.'],
    screenLevantamento: ['Levantamento', ['<b>Ambientes</b>: toque num ambiente para coletar os bens dele.', '<b>⚖ Conciliação</b>: compara o que foi achado com a base oficial.', '<b>📊 Comparar com o anterior</b>: o que entrou, saiu e mudou de sala desde o último inventário.', 'Ao final, <b>⚙ Processar</b> fecha o resultado e libera relatório e termo.'], 'Dá para reabrir um levantamento processado, informando o motivo.'],
    screenAmbientes: ['Unidades e ambientes', ['Os ambientes deste aparelho, agrupados por unidade.', 'Toque num ambiente para continuar a coleta.', '<b>+ Novo ambiente</b> cria uma sala nova em campo.'], 'Os ambientes cadastrados na estrutura aparecem como sugestão ao criar um novo.'],
    screenNewAmbiente: ['Novo ambiente', ['Escolha a <b>unidade</b>: os ambientes cadastrados dela aparecem para tocar e usar.', 'Confira a <b>campanha</b>.', 'Toque em <b>Criar ambiente e iniciar coleta</b>.'], 'Se o ambiente não estiver cadastrado, o gestor que criar aqui já o cadastra na estrutura.'],
    screenCollection: ['Coleta do ambiente', ['<b>Foto</b>: tire uma foto da sala e o app sugere os bens.', '<b>Plaqueta</b>: leia o código ou digite o número.', 'Bens que vieram do levantamento anterior: toque <b>✓</b> se achou ou <b>✕ Não localizado</b>.', 'Ao terminar, toque em <b>Concluir ambiente</b>.'], 'Tudo é salvo no aparelho na hora, mesmo sem internet, e enviado quando a conexão voltar.'],
    screenBase: ['Base oficial e backup', ['<b>Base oficial</b>: a planilha do sistema patrimonial, usada para conferir o que foi achado.', '<b>Backup</b>: guarda uma cópia de tudo o que está neste aparelho.'], 'Gestores podem publicar a base na nuvem para toda a equipe.'],
    screenControle: ['Conferência e controle', ['<b>Conciliação</b>: achado em campo × base oficial.', '<b>Transferências</b>: mova bens entre setores com aceite.', '<b>Termos</b>: termo de responsabilidade e de encerramento.', '<b>Histórico</b>: tudo o que mudou em cada bem.'], 'Os documentos saem com código de verificação.']
  };
  function abrirAjuda(){
    const vis = [...document.querySelectorAll('.app > div')].find(d => d.style.display === 'block' && AJUDA[d.id]);
    const [titulo, passos, dica] = AJUDA[vis ? vis.id : 'screenInicio'];
    ui().abrirModal('Como usar: ' + titulo, `<ol class="aj-passos">${passos.map(p => '<li>' + p + '</li>').join('')}</ol>
      ${dica ? '<div class="aj-dica">💡 ' + dica + '</div>' : ''}
      <button class="btn btn-ghost btn-full" id="ajTutorial" type="button" style="margin-top:12px">Ver o tutorial completo</button>`);
    $('ajTutorial').onclick = () => { ui().fecharModal(); if(window.abrirTutorial) window.abrirTutorial(); };
  }
  function abrirAmbiente(id){ const a = A().todos().find(x => String(x.id) === String(id)); if(a){ A().esconderTelas(); A().abrir(a); } }

  /* ---------------- lista ---------------- */
  function cartao(l){
    const n = numeros(l), pct = n.total ? Math.round(n.coletados / n.total * 100) : 0;
    return `<div class="lv-card" data-lev="${l.id}">
      <div class="cab"><div><div class="nome" data-abrir>${esc(l.unidade ? l.unidade.name : 'Sem unidade')}</div>
        <div class="meta">${esc([l.campanhaNome || nomeCamp(l.campanhaId), l.finalidade].filter(Boolean).join(' · ') || 'Sem campanha')}${l.descricao ? ' — ' + esc(l.descricao) : ''}</div></div>
        <span class="lv-chip${l.status === 'processado' ? ' proc' : ''}">${l.status === 'processado' ? 'processado' : 'em andamento'}</span></div>
      <div class="lv-barra"><i style="width:${pct}%"></i></div>
      <div class="meta">${n.coletados}/${n.total} ambientes concluídos · ${n.confirmados} bens confirmados${n.pendentes ? ' · <b style="color:var(--pending)">' + n.pendentes + ' aguardando conferência</b>' : ''}${l.processadoEm ? ' · processado em ' + hoje(l.processadoEm) : ''}</div>
      <div class="lv-btns"><button class="lv-btn pri" data-abrir>Abrir</button><button class="lv-btn" data-editar>Editar</button>
        ${l.status === 'processado' ? '<button class="lv-btn" data-reabrir>Reabrir</button><button class="lv-btn" data-relatorio>Relatório</button>' : '<button class="lv-btn" data-processar>Processar</button>'}
        <button class="lv-btn perigo" data-excluir>Excluir</button></div></div>`;
  }
  function ligarCartoes(box){
    box.querySelectorAll('[data-lev]').forEach(card => {
      const lev = () => LEVS.find(l => l.id === card.dataset.lev);
      card.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => abrirLev(lev()));
      const on = (sel, fn) => { const b = card.querySelector(sel); if(b) b.onclick = () => fn(lev()); };
      on('[data-editar]', editarLev); on('[data-processar]', processarLev); on('[data-reabrir]', reabrirLev); on('[data-excluir]', excluirLev); on('[data-relatorio]', l => relatorioProcessamento(l));
    });
  }
  function renderLista(){
    const q = norm($('lvBusca').value), f = $('lvFiltro').value;
    const lst = LEVS.filter(l => (!f || l.status === f) && (!q || norm([l.unidade && l.unidade.name, l.unidade && l.unidade.code, l.campanhaNome, l.finalidade, l.descricao].join(' ')).includes(q)));
    $('lvLista').innerHTML = lst.length ? lst.map(cartao).join('') : '<div class="lv-vazio">Nenhum levantamento' + (q || f ? ' com esse filtro' : ' ainda. Toque em <b>Iniciar levantamento</b>.') + '</div>';
    ligarCartoes($('lvLista'));
  }
  $('lvBusca').oninput = renderLista; $('lvFiltro').onchange = renderLista;
  $('lvNovoBtn').onclick = () => iniciarLevantamento();
  $('lvVoltar').onclick = () => irPara('levantamentos');

  /* ---------------- detalhe ---------------- */
  let LEV_ABERTO = null, veioDoLev = false;
  // "Voltar" de dentro de um ambiente aberto pelo levantamento volta para o levantamento
  $('backToListBtn').addEventListener('click', () => {
    if(veioDoLev && LEV_ABERTO){ veioDoLev = false; abrirLev(LEVS.find(l => l.id === LEV_ABERTO.id) || LEV_ABERTO); }
  });
  function abrirLev(lev){
    if(!lev) return;
    LEV_ABERTO = lev; mostrar('screenLevantamento'); marcar('levantamentos'); $('baTitulo').textContent = 'Levantamento';
    lembrar({ dest: 'lev', id: lev.id });
    renderDetalhe();
  }
  function renderDetalhe(){
    const l = LEV_ABERTO; if(!l) return;
    const n = numeros(l), proc = l.status === 'processado';
    $('lvNome').textContent = l.unidade ? l.unidade.name : 'Levantamento';
    $('lvDetalhe').innerHTML = `
      <div class="lv-info">
        <div><b>Situação</b> <span class="lv-chip${proc ? ' proc' : ''}">${proc ? 'processado' : 'em andamento'}</span></div>
        <div><b>Unidade</b> ${esc(l.unidade ? l.unidade.name + ' (' + l.unidade.code + ')' : '—')}</div>
        ${l.unidade && l.unidade.path ? `<div><b>Hierarquia</b> <small>${esc(l.unidade.path)}</small></div>` : ''}
        <div><b>Campanha</b> ${esc(l.campanhaNome || nomeCamp(l.campanhaId) || '—')}</div>
        <div><b>Tipo</b> ${esc(l.finalidade || '—')}</div>
        ${l.descricao ? `<div><b>Descrição</b> ${esc(l.descricao)}</div>` : ''}
        ${l.observacao ? `<div><b>Observação</b> ${esc(l.observacao)}</div>` : ''}
        <div><b>Comissão</b> ${l.comissao && l.comissao.length ? esc(l.comissao.map(m => m.nome + (m.funcao ? ' (' + m.funcao + ')' : '')).join('; ')) : '<i>não informada</i>'}</div>
        <div><b>Criado</b> ${hoje(l.criadoEm)} por ${esc(l.criadoPor || '—')}${l.origem && l.origem.tipo !== 'novo' ? ' · ponto de partida: ' + esc(l.origem.detalhe || l.origem.tipo) : ''}</div>
        ${proc ? `<div><b>Processado</b> ${hoje(l.processadoEm)} por ${esc(l.processadoPor || '—')}</div>` : ''}
      </div>
      <div class="lv-kpis">
        <div class="lv-kpi"><b>${n.coletados}/${n.total}</b><span>ambientes concluídos</span></div>
        <div class="lv-kpi"><b>${n.confirmados}</b><span>bens confirmados</span></div>
        <div class="lv-kpi${n.pendentes ? ' alerta' : ''}"><b>${n.pendentes}</b><span>aguardando conferência</span></div>
        <div class="lv-kpi"><b>${n.naoLocalizados}</b><span>do ano anterior não localizados</span></div>
      </div>
      <div class="lv-btns" style="margin-bottom:14px">
        ${proc ? '' : '<button class="lv-btn pri" id="dNovoAmb">+ Novo ambiente</button><button class="lv-btn" id="dImportar">↺ Importar anterior</button>'}
        <button class="lv-btn" id="dPlanta">▦ Planta</button><button class="lv-btn" id="dConc">⚖ Conciliação</button><button class="lv-btn" id="dTermo">✍ Termo</button>
        <button class="lv-btn" id="dPlanilha">⭳ Planilha</button><button class="lv-btn" id="dComparar">📊 Comparar com o anterior</button>
        ${proc ? '<button class="lv-btn" id="dRelatorio">🖨 Relatório</button><button class="lv-btn" id="dReabrir">Reabrir</button>' : '<button class="lv-btn pri" id="dProcessar">⚙ Processar levantamento</button>'}
        <button class="lv-btn" id="dEditar">✎ Editar</button><button class="lv-btn perigo" id="dExcluir">🗑 Excluir</button>
      </div>
      <div class="lv-titulo" style="font-size:16px">Ambientes (${n.total})</div>
      <div id="dAmbs">${n.ambs.length ? n.ambs.slice().sort((a, b) => (a.andar || '').localeCompare(b.andar || '') || a.name.localeCompare(b.name)).map(a => {
        const its = (a.items || []), conf = its.filter(i => i.status === 'confirmed').length, pen = its.filter(i => i.status === 'pending').length;
        return `<div class="lv-amb" data-id="${a.id}"><div class="n" data-abre><b>${esc(a.name)}</b><small>${esc(a.andar || 'sem andar')} · ${conf} confirmados${pen ? ' · ' + pen + ' aguardando' : ''}</small></div>
          <span class="st${a.status === 'coletado' ? ' ok' : ''}">${a.status === 'coletado' ? 'concluído' : 'pendente'}</span>
          ${proc ? '' : '<button class="lv-btn" data-ed title="Editar">✎</button><button class="lv-btn perigo" data-ex title="Excluir">🗑</button>'}</div>`; }).join('')
        : '<div class="lv-vazio">Nenhum ambiente ainda. Crie o primeiro ou importe o levantamento anterior.</div>'}</div>`;
    const on = (id, fn) => { const b = $(id); if(b) b.onclick = fn; };
    on('dNovoAmb', () => A().novoAmbienteUI(l.unidade, l.campanhaId));
    on('dImportar', () => escolherFonte(l));
    on('dPlanta', () => l.unidade && A().plantaDaUnidade(l.unidade));
    on('dConc', () => resumoConciliacao(l));
    on('dTermo', () => l.unidade && C().termoDaUnidade(l.unidade));
    on('dPlanilha', () => planilhaDoLev(l));
    on('dComparar', () => compararAnterior(l));
    on('dProcessar', () => processarLev(l)); on('dReabrir', () => reabrirLev(l)); on('dRelatorio', () => relatorioProcessamento(l));
    on('dEditar', () => editarLev(l)); on('dExcluir', () => excluirLev(l));
    $('dAmbs').querySelectorAll('[data-id]').forEach(row => {
      const a = () => A().todos().find(x => String(x.id) === row.dataset.id);
      row.querySelector('[data-abre]').onclick = () => { veioDoLev = true; A().esconderTelas(); A().abrir(a()); if(LEV_ABERTO) lembrar({ dest:'amb', id:a().id, lev:LEV_ABERTO.id }); };
      const ed = row.querySelector('[data-ed]'); if(ed) ed.onclick = () => A().editarAmbienteUI(a());
      const ex = row.querySelector('[data-ex]'); if(ex) ex.onclick = () => excluirAmbiente(a());
    });
  }

  /* ---------------- iniciar / editar ---------------- */
  function formLev(l, novo){
    const com = (l.comissao || []).concat([{}, {}, {}, {}]).slice(0, 4);
    return `
      ${novo ? `<div class="ctl-campo"><label>Unidade *</label><input id="fUnidBusca" placeholder="Buscar pelo nome ou pelo código…" autocomplete="off"></div>
      <div id="fUnidRes" class="lv-res" style="display:none"></div><div class="ctl-dica" id="fUnidSel">${l.unidade ? '✓ ' + esc(l.unidade.name) : 'Nenhuma unidade escolhida.'}</div>
      <div id="fUnidAmb"></div>` : ''}
      <div class="ctl-campo"><label>Tipo de levantamento *</label><select id="fTipo">${opcoesTipos(l.finalidade || '')}</select>
        <div class="ctl-dica" id="fTipoDesc">${esc(descTipo(l.finalidade || ''))}</div></div>
      <div class="ctl-campo"><label>Campanha *</label><select id="fCamp">${opcoesCampanhas(l.campanhaId, novo, l.finalidade || '')}</select>
        <div class="ctl-dica" id="fCampDica"></div></div>
      <div class="ctl-campo"><label>Descrição</label><input id="fDesc" value="${esc(l.descricao || '')}" maxlength="500" placeholder="Ex.: Inventário anual dos bens do bloco administrativo"></div>
      <div class="ctl-campo"><label>Observação</label><textarea id="fObs" rows="2" maxlength="500">${esc(l.observacao || '')}</textarea></div>
      <div class="ctl-campo"><label>Comissão de inventário (opcional)</label>
        ${com.map((m, i) => `<div style="display:flex;gap:6px;margin-bottom:6px"><input id="fCm${i}" value="${esc(m.nome || '')}" placeholder="Nome${i === 0 ? ' do presidente' : ''}" style="flex:2"><input id="fCf${i}" value="${esc(m.funcao || (i === 0 && !m.nome ? '' : ''))}" placeholder="${i === 0 ? 'Presidente' : 'Membro'}" style="flex:1"></div>`).join('')}</div>`;
  }
  function ligarTipo(l, soAbertas){
    const t = $('fTipo'), c = $('fCamp'), d = $('fTipoDesc'), dc = $('fCampDica');
    const atualizar = manterCamp => {
      const tipo = t.value, atual = manterCamp ? c.value : '';
      d.textContent = descTipo(tipo);
      c.innerHTML = opcoesCampanhas(atual, soAbertas, tipo);
      // escolhe sozinha a campanha quando só há uma do tipo
      if(!c.value){ const doTipo = [...c.querySelectorAll('optgroup:first-of-type option')]; if(tipo && doTipo.length === 1 && /^Campanhas de/.test(doTipo[0].parentNode.label)) c.value = doTipo[0].value; }
      if(!c.value && tipo && c.querySelector('option[value="__nova"]')) c.value = '__nova';
      dicaCamp();
    };
    const dicaCamp = () => {
      const tipo = t.value;
      dc.textContent = c.value === '__nova' ? 'A campanha será criada e aberta ao iniciar o levantamento.'
        : (tipo && !CAMPANHAS.some(x => x.aberta !== false && mesmoTipo(finalidadeCampDe(x), tipo)) && !podeCriarCampanha()
          ? 'Ainda não há campanha aberta deste tipo. Peça à gestão patrimonial para abrir uma, ou escolha outra campanha.' : '');
    };
    t.onchange = () => atualizar(false);
    c.onchange = () => {
      // escolheu a campanha antes do tipo: o tipo vem da campanha
      if(!t.value && c.value && c.value !== '__nova'){
        const cp = CAMPANHAS.find(x => x.id === c.value), fc = cp ? finalidadeCampDe(cp) : '';
        const tp = fc && TIPOS().find(x => mesmoTipo(x.nome, fc));
        if(tp){ t.value = tp.nome; d.textContent = descTipo(tp.nome); }
      }
      dicaCamp();
    };
    l._atualizarCamp = () => atualizar(true);
    if(t.value) atualizar(true);
  }
  async function resolverCampanha(camp, tipo, msg){
    if(camp !== '__nova') return camp;
    if(!navigator.onLine){ msg.textContent = 'Sem internet: para criar a campanha é preciso estar conectado. Escolha uma campanha existente.'; return null; }
    msg.textContent = 'Criando a campanha…';
    try{ const id = await criarCampanhaDoTipo(tipo); msg.textContent = ''; return id; }
    catch(e){ msg.textContent = 'Não foi possível criar a campanha (' + e.message + '). Peça à gestão patrimonial ou escolha outra.'; return null; }
  }
  const lerComissao = () => [0,1,2,3].map(i => ({ nome: $('fCm' + i).value.trim(), funcao: $('fCf' + i).value.trim() || (i === 0 ? 'Presidente' : 'Membro') })).filter(m => m.nome);
  function buscaUnidade(onEscolher){
    const inp = $('fUnidBusca'), res = $('fUnidRes');
    inp.oninput = () => {
      const q = norm(inp.value); if(q.length < 2){ res.style.display = 'none'; return; }
      const lst = A().unidades().filter(u => norm(u.name).includes(q) || norm(u.code).includes(q))
        .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1)).slice(0, 40);
      res.innerHTML = lst.length ? lst.map(u => `<div data-c="${esc(u.code)}">${esc(u.name)}<small>${esc(u.code)}${u.path ? ' · ' + esc(u.path) : ''}</small></div>`).join('') : '<div>Nenhuma unidade encontrada.</div>';
      res.style.display = 'block';
      res.querySelectorAll('[data-c]').forEach(d => d.onclick = () => { const u = A().unidades().find(x => x.code === d.dataset.c); onEscolher(u); res.style.display = 'none'; inp.value = ''; });
    };
  }
  // sem hierarquia não há levantamento: guia para cadastrar
  function exigirEstrutura(){
    if(A().unidades().length) return true;
    const E = window.ESTRUTURA, ed = E && E.podeEditar();
    ui().abrirModal('Cadastre a estrutura organizacional', `
      <p class="ctl-dica" style="font-size:13.5px;line-height:1.55">Todo levantamento é feito <b>por unidade</b> (secretaria, diretoria, departamento, setor…) e pelos <b>ambientes</b> de cada unidade (salas, laboratórios, depósitos). Esta organização ainda não tem a estrutura cadastrada.</p>
      ${ed ? `<ol class="lv-passos" style="margin:8px 0 14px"><li>Cadastre as <b>unidades</b>, uma a uma ou importando a planilha.</li><li>Em cada unidade, cadastre os <b>ambientes</b>.</li><li>Volte aqui e inicie o levantamento.</li></ol>
        <button class="btn btn-primary btn-full" id="fEstr" type="button">🌳 Cadastrar a estrutura agora</button>`
        : '<p class="ctl-dica">Só gestores e administradores cadastram a estrutura. Peça à gestão patrimonial da sua organização.</p>'}`);
    if(ed) $('fEstr').onclick = () => { ui().fecharModal(); irPara('estrutura'); };
    return false;
  }
  // mostra os ambientes cadastrados da unidade escolhida (e permite cadastrar ali mesmo)
  function painelAmbientesDaUnidade(l){
    const box = $('fUnidAmb'); if(!box) return;
    const E = window.ESTRUTURA, u = l.unidade;
    if(!u || !E){ box.innerHTML = ''; atualizarOrigem(0); return; }
    const ls = E.locaisDe(u.code), ed = E.podeEditar() && !E.semTabela;
    box.innerHTML = ls.length
      ? `<div class="es-aviso es-ok" style="margin:4px 0 12px"><b>${ls.length} ambiente(s) cadastrado(s)</b> nesta unidade: ${ls.slice(0, 6).map(x => esc(x.nome)).join(', ')}${ls.length > 6 ? '…' : ''}
          ${ed ? '<br><button class="lv-btn" type="button" id="fAmbMais" style="margin-top:6px">＋ Cadastrar mais ambientes</button>' : ''}</div>`
      : `<div class="es-aviso" style="margin:4px 0 12px"><b>Esta unidade não tem ambientes cadastrados.</b> ${ed
          ? 'Cadastre-os abaixo (um por linha) — eles entram na estrutura e já viram os ambientes do levantamento:<textarea id="fAmbNovos" rows="4" style="width:100%;margin-top:8px;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--border)" placeholder="Sala 101; Térreo&#10;Laboratório; 1º andar&#10;Almoxarifado"></textarea><small>Em cada linha: nome; andar; bloco (andar e bloco são opcionais).</small>'
          : 'Os ambientes podem ser criados em campo, durante a coleta. Peça à gestão para cadastrá-los na estrutura.'}</div>`;
    const mais = $('fAmbMais'); if(mais) mais.onclick = () => { const txt = prompt('Novos ambientes de ' + u.name + ' (separe por vírgula):'); if(!txt) return;
      E.gravarLocais(txt.split(',').map(x => x.trim()).filter(Boolean).map(nome => ({ unidade_code: u.code, nome }))).then(() => painelAmbientesDaUnidade(l)).catch(e => alert('Não foi possível cadastrar: ' + e.message)); };
    const novos = $('fAmbNovos'); if(novos) novos.oninput = () => atualizarOrigem(novos.value.trim() ? 1 : 0);
    atualizarOrigem(ls.length);
  }
  function atualizarOrigem(n){
    const r = document.querySelector('[name="fOrig"][value="cadastro"]'); if(!r) return;
    const lab = r.closest('label'); r.disabled = !n; lab.style.opacity = n ? '' : '.5';
    const sm = lab.querySelector('small'); if(sm) sm.textContent = n ? 'Cria os ambientes do levantamento a partir dos ambientes cadastrados da unidade (' + (n > 1 || !$('fAmbNovos') ? n + ' ambiente(s)' : 'os que você escreveu acima') + ').' : 'A unidade não tem ambientes cadastrados.';
    if(n && !r._mexeu) r.checked = true;
    if(!n && r.checked) document.querySelector('[name="fOrig"][value="zero"]').checked = true;
  }
  // cria os ambientes do levantamento a partir dos cadastrados da unidade
  async function fonteCadastro(lev){
    const E = window.ESTRUTURA; if(!E || !lev.unidade) return 0;
    const existentes = ambsDe(lev).map(a => norm(a.name));
    let n = 0;
    for(const loc of E.locaisDe(lev.unidade.code)){
      if(existentes.includes(norm(loc.nome))) continue;
      const a = A().criarAmbiente({ name: loc.nome, andar: loc.andar || (loc.bloco ? 'Bloco ' + loc.bloco : ''), modo: 'levantamento', units: [lev.unidade],
        campanhaId: lev.campanhaId || null, levantamentoId: lev.id, localId: loc.id, bloco: loc.bloco || '', tipoAmbiente: loc.tipo || '', origemImportacao: 'estrutura da unidade' });
      await A().salvar(a); n++;
    }
    return n;
  }
  async function iniciarLevantamento(pre){
    await carregar();
    if(!exigirEstrutura()) return;
    const l = Object.assign({ unidade: null, campanhaId: localStorage.getItem('campanha_ativa') || '' }, pre || {});
    const corpo = ui().abrirModal('Iniciar levantamento patrimonial', formLev(l, true) + `
      <div class="ctl-campo"><label>Ponto de partida</label></div>
      <div class="lv-origem">
        <label><input type="radio" name="fOrig" value="cadastro"><span>Ambientes cadastrados da unidade<small>Escolha a unidade acima.</small></span></label>
        <label><input type="radio" name="fOrig" value="zero" checked><span>Começar do zero<small>Os ambientes e bens são lançados em campo.</small></span></label>
        <label><input type="radio" name="fOrig" value="anterior"><span>Importar o levantamento anterior<small>Traz os ambientes e bens do ano passado como pendentes de conferência.</small></span></label>
        <label><input type="radio" name="fOrig" value="base"><span>Partir da base oficial<small>Cria os ambientes pelos locais da base do ${esc(A().sis())} desta unidade.</small></span></label>
        <label><input type="radio" name="fOrig" value="arquivo"><span>Importar de arquivo<small>Planilha de bens por local (ex.: exportada do sistema patrimonial) ou backup do app.</small></span></label>
      </div>
      <button class="btn btn-primary btn-full" id="fOk" type="button">Iniciar levantamento</button><div class="ctl-dica" id="fMsg"></div>`);
    buscaUnidade(u => { l.unidade = { code: u.code, name: u.name, path: u.path || '' }; $('fUnidSel').textContent = '✓ ' + u.name; painelAmbientesDaUnidade(l); });
    corpo.querySelectorAll('[name="fOrig"]').forEach(r => r.addEventListener('change', () => { const c = corpo.querySelector('[name="fOrig"][value="cadastro"]'); if(c) c._mexeu = true; }));
    painelAmbientesDaUnidade(l);
    // tipo sugerido pela campanha ativa
    if(l.campanhaId && !l.finalidade){ const fc = finalidadeCamp(l.campanhaId); if(fc){ const t = TIPOS().find(x => mesmoTipo(x.nome, fc)); l.finalidade = t ? t.nome : fc; $('fTipo').innerHTML = opcoesTipos(t ? t.nome : fc); } }
    ligarTipo(l, true);
    if(!CAMPANHAS.length || navigator.onLine) buscarCampanhas().then(() => { if($('fCamp') && l._atualizarCamp) l._atualizarCamp(); });
    $('fOk').onclick = async () => {
      const msg = $('fMsg'), tipo = $('fTipo').value;
      if(!l.unidade){ msg.textContent = 'Escolha a unidade.'; return; }
      if(!tipo){ msg.textContent = 'Escolha o tipo de levantamento.'; return; }
      if(!$('fCamp').value){ msg.textContent = 'Escolha a campanha. Se não houver nenhuma, peça à gestão para abrir no painel.'; return; }
      $('fOk').disabled = true;
      const camp = await resolverCampanha($('fCamp').value, tipo, msg);
      $('fOk').disabled = false;
      if(!camp) return;
      const existente = LEVS.find(x => x.status !== 'processado' && x.unidade && x.unidade.code === l.unidade.code && x.campanhaId === camp);
      if(existente && confirm('Já existe um levantamento em andamento desta unidade nesta campanha. Abrir o existente? (Cancelar cria outro.)')){ ui().fecharModal(); abrirLev(existente); return; }
      const lev = novoLev({ unidade: l.unidade, campanhaId: camp, finalidade: tipo, descricao: $('fDesc').value.trim(), observacao: $('fObs').value.trim(), comissao: lerComissao() });
      ativarCampanha(camp);
      await gravar();
      const origem = (corpo.querySelector('[name="fOrig"]:checked') || {}).value;
      // ambientes escritos no assistente: entram na estrutura da unidade
      const novos = $('fAmbNovos') ? $('fAmbNovos').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean) : [];
      if(novos.length && window.ESTRUTURA){
        try{ await ESTRUTURA.gravarLocais(novos.map(t => { const p = t.split(/\s*;\s*/); return { unidade_code: lev.unidade.code, nome: p[0], andar: p[1] || '', bloco: p[2] || '' }; })); }
        catch(e){ alert('Os ambientes não foram cadastrados na estrutura (' + e.message + '). Eles serão criados só neste levantamento.');
          for(const t of novos){ const p = t.split(/\s*;\s*/); const a = A().criarAmbiente({ name: p[0], andar: p[1] || '', units: [lev.unidade], campanhaId: lev.campanhaId, levantamentoId: lev.id }); await A().salvar(a); } }
      }
      ui().fecharModal();
      if(origem === 'cadastro') await fonteCadastro(lev);
      abrirLev(lev);
      if(origem && origem !== 'zero' && origem !== 'cadastro') escolherFonte(lev, origem);
    };
  }
  function editarLev(l){
    if(!l) return;
    ui().abrirModal('Editar levantamento', `<div class="lv-info"><b>Unidade</b> ${esc(l.unidade ? l.unidade.name : '—')}</div>` + formLev(l, false) +
      '<button class="btn btn-primary btn-full" id="fOk" type="button">Salvar</button><div class="ctl-dica" id="fMsg"></div>');
    ligarTipo(l, false);
    buscarCampanhas().then(() => { if($('fCamp') && l._atualizarCamp) l._atualizarCamp(); });
    $('fOk').onclick = async () => {
      const tipo = $('fTipo').value;
      if(!tipo){ $('fMsg').textContent = 'Escolha o tipo de levantamento.'; return; }
      if(!$('fCamp').value){ $('fMsg').textContent = 'Escolha a campanha.'; return; }
      const camp = await resolverCampanha($('fCamp').value, tipo, $('fMsg'));
      if(!camp) return;
      const mudou = camp !== l.campanhaId;
      Object.assign(l, { campanhaId: camp, campanhaNome: nomeCamp(camp) || l.campanhaNome, finalidade: tipo,
        descricao: $('fDesc').value.trim(), observacao: $('fObs').value.trim(), comissao: lerComissao(), alteradoEm: new Date().toISOString() });
      if(mudou) for(const a of ambsDe(l)){ a.campanhaId = camp; await A().salvar(a); }
      await gravar(); ui().fecharModal(); renderAtual();
    };
  }
  function renderAtual(){
    if($('screenLevantamento').style.display === 'block') renderDetalhe();
    else if($('screenLevantamentos').style.display === 'block') renderLista();
    else if($('screenInicio').style.display === 'block') renderInicio();
  }

  /* ---------------- excluir ---------------- */
  async function excluirAmbiente(a){
    if(!a) return;
    const n = (a.items || []).length;
    if(!confirm('Excluir o ambiente "' + a.name + '"' + (n ? ' e os ' + n + ' bens lançados nele' : '') + '? Esta ação não pode ser desfeita.')) return;
    await A().excluirAmbiente(a); A().atualizarTelas(); renderAtual();
  }
  async function excluirLev(l){
    if(!l) return;
    if(l.status === 'processado'){ alert('Este levantamento já foi processado. Para excluir, reabra-o primeiro.'); return; }
    const n = numeros(l);
    const ok = prompt('Excluir o levantamento de "' + (l.unidade ? l.unidade.name : '') + '" com ' + n.total + ' ambientes e ' + n.bens + ' bens?\n\nIsso não pode ser desfeito. Para confirmar, digite EXCLUIR:');
    if(!ok || ok.trim().toUpperCase() !== 'EXCLUIR') return;
    for(const a of n.ambs) await A().excluirAmbiente(a);
    LEVS = LEVS.filter(x => x.id !== l.id); await gravar();
    try{ const fila = (await A().meta.ler('exclusoesLev')) || []; fila.push({ id: l.id, orgId: org().id || null }); await A().meta.gravar('exclusoesLev', fila); }catch(e){}
    A().atualizarTelas(); irPara('levantamentos');
  }

  /* ---------------- conciliação e processamento ---------------- */
  function resumoDaConciliacao(l){
    if(!A().base().length) return null;
    return C().conciliarDe(ambsDe(l), l.unidade);
  }
  function quadroHtml(r){
    if(!r) return '<p class="ctl-dica">Sem base oficial carregada: o processamento registra só o que foi achado em campo. Para conciliar, importe a base em <b>Base oficial e backup</b>.</p>';
    return `<div class="lv-kpis">${C().CATEGORIAS.filter(c => c.id !== 'pendentes').map(c => `<div class="lv-kpi${c.cls === 'erro' && r[c.id].length ? ' alerta' : ''}"><b>${r[c.id].length}</b><span>${esc(c.t)}</span></div>`).join('')}</div>
      <p class="ctl-dica">Conformidade: <b>${r.conformidade != null ? String(r.conformidade).replace('.', ',') + '%' : '—'}</b> de ${r.esperados} esperados${r.valorNao ? ' · valor não localizado: <b>' + ui().dinheiro(r.valorNao) + '</b>' : ''}</p>`;
  }
  function resumoConciliacao(l){
    ui().abrirModal('Conciliação do levantamento', quadroHtml(resumoDaConciliacao(l)) +
      '<button class="btn btn-ghost btn-full" id="rcAbrir" type="button">Abrir a conciliação completa</button>');
    $('rcAbrir').onclick = () => { ui().fecharModal(); C().abrir('conciliacao'); marcar('conciliacao'); };
  }
  function processarLev(l){
    if(!l) return;
    const n = numeros(l), r = resumoDaConciliacao(l);
    const naoConcl = n.ambs.filter(a => a.status !== 'coletado');
    const avisos = [];
    if(!n.total) avisos.push('O levantamento não tem nenhum ambiente.');
    if(naoConcl.length) avisos.push(naoConcl.length + ' ambiente(s) ainda não concluído(s): ' + naoConcl.slice(0, 5).map(a => a.name).join(', ') + (naoConcl.length > 5 ? '…' : ''));
    if(n.pendentes) avisos.push(n.pendentes + ' bem(ns) aguardando conferência (nem confirmados nem marcados como não localizados).');
    if(!(l.comissao && l.comissao.length)) avisos.push('A comissão de inventário não foi informada (dá para informar em Editar).');
    const check = (ok, t) => `<div class="lv-check"><i>${ok ? '✅' : '⚠️'}</i><span>${t}</span></div>`;
    ui().abrirModal('Processar levantamento', `
      <p class="ctl-dica">Processar fecha o levantamento de <b>${esc(l.unidade ? l.unidade.name : '')}</b>: o resultado é registrado, os ambientes ficam só para consulta e saem o relatório e o termo de encerramento. Se precisar corrigir algo depois, dá para reabrir.</p>
      ${check(n.total && !naoConcl.length, n.coletados + ' de ' + n.total + ' ambientes concluídos')}
      ${check(!n.pendentes, n.pendentes ? n.pendentes + ' bens aguardando conferência' : 'Todos os bens conferidos')}
      ${check(l.comissao && l.comissao.length, l.comissao && l.comissao.length ? 'Comissão: ' + esc(l.comissao.map(m => m.nome).join(', ')) : 'Comissão não informada')}
      ${check(!!r, r ? 'Base oficial carregada (' + A().base().length + ' bens)' : 'Sem base oficial para conciliar')}
      <div style="margin-top:12px">${quadroHtml(r)}</div>
      ${avisos.length ? `<label class="ctl-dica" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-top:8px"><input type="checkbox" id="pCiente"> <span>Estou ciente das pendências acima e quero processar assim mesmo.</span></label>` : ''}
      <button class="btn btn-primary btn-full" id="pOk" type="button">⚙ Processar levantamento</button><div class="ctl-dica" id="pMsg"></div>`);
    $('pOk').onclick = async () => {
      if(!n.total){ $('pMsg').textContent = 'Não há ambientes para processar.'; return; }
      if(avisos.length && !$('pCiente').checked){ $('pMsg').textContent = 'Marque que está ciente das pendências para continuar.'; return; }
      const agora = new Date().toISOString(), quem = A().quemSou();
      l.status = 'processado'; l.processadoEm = agora; l.processadoPor = quem;
      l.resultado = { ambientes: n.total, coletados: n.coletados, bens: n.bens, confirmados: n.confirmados, pendentes: n.pendentes, naoLocalizadosAnterior: n.naoLocalizados,
        pendenciasAoProcessar: avisos,
        conciliacao: r ? { conferidos: r.conferidos.length, outroLocal: r.outroLocal.length, naoLocalizados: r.naoLocalizados.length, semRegistro: r.semRegistro.length,
          semPlaqueta: r.semPlaqueta.length, duplicados: r.duplicados.length, esperados: r.esperados, conformidade: r.conformidade, valorNao: r.valorNao,
          listaNaoLocalizados: r.naoLocalizados.slice(0, 2000).map(x => ({ plaqueta: x.ref.plaqueta, descricao: x.ref.descricao, local: [x.ref.localizacao, x.ref.unidade].filter(Boolean).join(' / '), valor: x.ref.valor })),
          listaOutroLocal: r.outroLocal.slice(0, 2000).map(x => ({ plaqueta: x.i.plaqueta, descricao: x.i.description, achadoEm: x.a.name, cadastro: [x.ref.localizacao, x.ref.unidade].filter(Boolean).join(' / ') })) } : null };
      l.codigo = await ui().codigoVerificacao({ id: l.id, em: agora, r: l.resultado });
      for(const a of n.ambs){ a.processado = agora; a.statusAntesDoProcessamento = a.status; if(a.status !== 'coletado'){ a.status = 'coletado'; a.collectedAt = a.collectedAt || agora; }
        A().anotar(a, { tipo: 'processamento', nota: 'Levantamento processado por ' + quem }); await A().salvar(a); }
      await gravar();
      ui().abrirModal('Levantamento processado', `
        <p class="ctl-dica">✅ Levantamento de <b>${esc(l.unidade ? l.unidade.name : '')}</b> processado em ${hoje(agora)}. Código de verificação <b>${esc(l.codigo)}</b>.</p>
        <button class="btn btn-primary btn-full" id="ppRel" type="button" style="margin-bottom:8px">🖨 Relatório de processamento</button>
        <button class="btn btn-ghost btn-full" id="ppTermo" type="button" style="margin-bottom:8px">📜 Termo de encerramento</button>
        <button class="btn btn-ghost btn-full" id="ppFechar" type="button">Fechar</button>`);
      $('ppRel').onclick = () => relatorioProcessamento(l);
      $('ppTermo').onclick = () => { C().novoEncerramento({ unidadeCode: l.unidade && l.unidade.code, comissao: l.comissao, campanha: l.campanhaNome }); };
      $('ppFechar').onclick = () => ui().fecharModal();
      A().atualizarTelas(); renderAtual();
    };
  }
  async function reabrirLev(l){
    if(!l) return;
    const motivo = prompt('Reabrir o levantamento de "' + (l.unidade ? l.unidade.name : '') + '"?\nOs ambientes voltam a aceitar alterações. Informe o motivo:');
    if(motivo === null) return;
    if(!motivo.trim()){ alert('Informe o motivo da reabertura.'); return; }
    const quem = A().quemSou();
    l.status = 'em_andamento'; l.reaberturas = (l.reaberturas || []).concat([{ em: new Date().toISOString(), por: quem, motivo: motivo.trim(), processadoAntesEm: l.processadoEm }]);
    l.processadoEm = null; l.processadoPor = null;
    for(const a of ambsDe(l)){ delete a.processado; if(a.statusAntesDoProcessamento){ a.status = a.statusAntesDoProcessamento; delete a.statusAntesDoProcessamento; } A().anotar(a, { tipo: 'reabertura', nota: 'Levantamento reaberto por ' + quem + ': ' + motivo.trim() }); await A().salvar(a); }
    await gravar(); A().atualizarTelas(); renderAtual();
  }
  function relatorioProcessamento(l){
    const r = l.resultado || {}, c = r.conciliacao, n = numeros(l), o = org();
    const linhas = n.ambs.map(a => { const its = a.items || [];
      return `<tr><td>${esc(a.name)}</td><td>${esc(a.andar || '')}</td><td style="text-align:right">${its.filter(i => i.status === 'confirmed').length}</td><td style="text-align:right">${its.filter(i => i.status === 'discarded' && i.herdado).length}</td><td style="text-align:right">${its.filter(i => i.status === 'pending').length}</td></tr>`; }).join('');
    const tab = (t, lst, cols) => lst && lst.length ? `<h3 style="font-size:14px;margin:18px 0 4px">${t} (${lst.length})</h3><table><tr>${cols.map(x => `<th>${x[0]}</th>`).join('')}</tr>${lst.map(i => `<tr>${cols.map(x => `<td>${esc(x[1](i))}</td>`).join('')}</tr>`).join('')}</table>` : '';
    ui().imprimirDocumento('Relatório de processamento', `
      ${o.nome ? `<div class="org">${esc(o.nome)}</div>` : ''}
      <h1>RELATÓRIO DE PROCESSAMENTO DO LEVANTAMENTO PATRIMONIAL</h1>
      <h2>${esc(l.unidade ? l.unidade.name + ' (' + l.unidade.code + ')' : '')}</h2>
      <p class="meta"><b>Campanha:</b> ${esc(l.campanhaNome || '—')}${l.finalidade ? ' · ' + esc(l.finalidade) : ''}<br>
      ${l.descricao ? `<b>Descrição:</b> ${esc(l.descricao)}<br>` : ''}
      <b>Comissão:</b> ${esc((l.comissao || []).map(m => m.nome + (m.funcao ? ' (' + m.funcao + ')' : '')).join('; ') || 'não informada')}<br>
      <b>Iniciado em:</b> ${hoje(l.criadoEm)} por ${esc(l.criadoPor || '—')}<br>
      <b>Processado em:</b> ${hoje(l.processadoEm)} por ${esc(l.processadoPor || '—')}<br>
      <b>Ambientes:</b> ${r.ambientes || n.total} · <b>Bens confirmados:</b> ${r.confirmados != null ? r.confirmados : n.confirmados} · <b>Aguardando conferência ao processar:</b> ${r.pendentes || 0}</p>
      ${c ? `<table><tr><th>Resultado da conciliação</th><th style="text-align:right">Qtde.</th><th>Providência</th></tr>
        ${[['conferidos','Bens conformes'],['outroLocal','Divergência de localização'],['naoLocalizados','Não localizados'],['semRegistro','Sem registro na base'],['semPlaqueta','Sem plaqueta'],['duplicados','Plaqueta repetida']]
          .map(([k, t]) => `<tr><td>${t}</td><td style="text-align:right">${c[k]}</td><td>${esc(C().PROVIDENCIA[k])}</td></tr>`).join('')}</table>
        <p>Conformidade de <b>${c.conformidade != null ? String(c.conformidade).replace('.', ',') + '%' : '—'}</b> sobre ${c.esperados} bens esperados${c.valorNao ? '; valor dos não localizados: <b>' + ui().dinheiro(c.valorNao) + '</b>' : ''}.</p>` : '<p><i>Processado sem base oficial carregada: não houve conciliação com o cadastro.</i></p>'}
      ${r.pendenciasAoProcessar && r.pendenciasAoProcessar.length ? `<p class="meta"><b>Pendências registradas ao processar:</b><br>${r.pendenciasAoProcessar.map(esc).join('<br>')}</p>` : ''}
      <h3 style="font-size:14px;margin:18px 0 4px">Ambientes levantados</h3>
      <table><tr><th>Ambiente</th><th>Andar</th><th style="text-align:right">Confirmados</th><th style="text-align:right">Não localizados (ano anterior)</th><th style="text-align:right">Aguardando</th></tr>${linhas}</table>
      ${c ? tab('Divergência de localização', c.listaOutroLocal, [['Plaqueta', i => i.plaqueta], ['Descrição', i => i.descricao], ['Achado em', i => i.achadoEm], ['No cadastro', i => i.cadastro]]) : ''}
      ${c ? tab('Não localizados', c.listaNaoLocalizados, [['Plaqueta', i => i.plaqueta], ['Descrição', i => i.descricao], ['Local no cadastro', i => i.local], ['Valor', i => i.valor != null ? ui().dinheiro(i.valor) : '']]) : ''}
      <div class="ass">${((l.comissao && l.comissao.length) ? l.comissao : [{ nome:'' }, { nome:'' }]).map(m => `<div><div style="height:50px"></div><div class="l">${esc(m.nome || '')}<br>${esc(m.funcao || 'Comissão de inventário')}</div></div>`).join('')}</div>
      <div class="cod">Código de verificação ${esc(l.codigo || '—')} · ${esc((window.PRODUTO && PRODUTO.nome) || '')}</div>`);
  }
  /* =================================================================
     COMPARATIVO ANO A ANO: o que entrou, saiu e mudou de sala
     ================================================================= */
  // presente agora = confirmado em campo, ou lançado agora (não herdado) e ainda não conferido
  const presenteAgora = i => i.status === 'confirmed' || (i.status === 'pending' && !i.herdado);
  async function compararAnterior(lev){
    if(!lev) return;
    const locais = LEVS.filter(l => l.id !== lev.id && l.unidade && lev.unidade && l.unidade.code === lev.unidade.code && ambsDe(l).length);
    const corpo = ui().abrirModal('Comparar com o levantamento anterior', `
      <p class="ctl-dica">Compara <b>${esc(lev.unidade ? lev.unidade.name : '')}</b> nesta campanha com um levantamento anterior da mesma unidade: o que <b>entrou</b>, o que <b>saiu</b> e o que <b>mudou de ambiente</b>.</p>
      <div class="ctl-campo"><label>Campanha anterior (nuvem)</label><select id="cmCamp"><option value="">Carregando campanhas…</option></select></div>
      <button class="btn btn-primary btn-full" id="cmNuvem" type="button" style="margin-bottom:12px">Comparar</button>
      ${locais.length ? `<div class="ctl-campo"><label>Ou um levantamento deste aparelho</label></div><div class="ctl-escolha">${locais.map(l => `<button type="button" data-l="${l.id}">${esc(l.campanhaNome || 'Sem campanha')}<small>${ambsDe(l).length} ambientes · ${l.status === 'processado' ? 'processado em ' + hoje(l.processadoEm) : 'em andamento'}</small></button>`).join('')}</div>` : ''}
      <div class="ctl-dica" id="cmMsg"></div>`);
    buscarCampanhas().then(cs => {
      const outras = cs.filter(c => c.id !== lev.campanhaId), s = $('cmCamp'); if(!s) return;
      s.innerHTML = outras.length ? outras.map(c => `<option value="${esc(c.id)}">${esc(String(c.nome).split(' · ')[0])}${c.aberta === false ? ' (encerrada)' : ''}</option>`).join('') : '<option value="">Nenhuma outra campanha na nuvem</option>';
    });
    corpo.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      const l = LEVS.find(x => x.id === b.dataset.l);
      mostrarComparativo(lev, ambsDe(l).map(a => ({ nome: a.name, andar: a.andar, localId: a.localId || null,
        itens: (a.items || []).filter(presenteAgora).map(i => ({ plaqueta: i.plaqueta, descricao: i.description, conservacao: i.conservacao })) })), l.campanhaNome || 'levantamento anterior');
    });
    $('cmNuvem').onclick = async () => {
      const camp = $('cmCamp').value, msg = $('cmMsg'); if(!camp){ msg.textContent = 'Escolha a campanha.'; return; }
      if(!lev.unidade){ msg.textContent = 'Este levantamento não tem unidade.'; return; }
      msg.textContent = 'Buscando o levantamento anterior…';
      try{
        const filtro = '/rest/v1/ambientes?campanha_id=eq.' + camp + '&unidade_code=eq.' + encodeURIComponent(lev.unidade.code);
        let ambs;
        try{ ambs = await ui().nuvem(filtro + '&select=id,nome,andar,local_id&limit=5000'); }
        catch(e){ ambs = await ui().nuvem(filtro + '&select=id,nome,andar&limit=5000'); }
        if(!ambs || !ambs.length){ msg.textContent = 'Essa campanha não tem ambientes desta unidade.'; return; }
        const itens = [];
        for(let i = 0; i < ambs.length; i += 40){
          const ids = ambs.slice(i, i + 40).map(a => a.id).join(',');
          itens.push(...((await ui().nuvem('/rest/v1/itens?ambiente_id=in.(' + ids + ')&select=ambiente_id,descricao,plaqueta,conservacao,status&limit=20000')) || []));
        }
        mostrarComparativo(lev, ambs.map(a => ({ nome: a.nome, andar: a.andar, localId: a.local_id || null,
          itens: itens.filter(i => i.ambiente_id === a.id && i.status === 'confirmed').map(i => ({ plaqueta: i.plaqueta, descricao: i.descricao, conservacao: i.conservacao })) })), nomeCamp(camp));
      }catch(e){ msg.textContent = 'Não foi possível buscar: ' + String(e.message).slice(0, 160); }
    };
  }
  function calcularComparativo(lev, anteriores){
    const P = v => A().normPlaq(v);
    const atuais = ambsDe(lev).map(a => ({ nome: a.name, andar: a.andar, localId: a.localId || null,
      itens: (a.items || []).filter(presenteAgora).map(i => ({ plaqueta: i.plaqueta, descricao: i.description, conservacao: i.conservacao })),
      aConferir: (a.items || []).filter(i => i.status === 'pending' && i.herdado).map(i => P(i.plaqueta)).filter(Boolean) }));
    const chaveAmb = a => a.localId ? 'L:' + a.localId : 'N:' + norm(a.nome);
    // casa os ambientes de antes e de agora (pelo cadastro da estrutura ou pelo nome)
    const antesPorChave = new Map(), agoraPorChave = new Map();
    anteriores.forEach(a => { antesPorChave.set(chaveAmb(a), a); antesPorChave.set('N:' + norm(a.nome), antesPorChave.get('N:' + norm(a.nome)) || a); });
    atuais.forEach(a => agoraPorChave.set(chaveAmb(a), a));
    const parDe = a => antesPorChave.get(chaveAmb(a)) || antesPorChave.get('N:' + norm(a.nome)) || null;
    const ondeAntes = new Map(), ondeAgora = new Map();
    anteriores.forEach(a => a.itens.forEach(i => { const k = P(i.plaqueta); if(k) ondeAntes.set(k, { amb: a, i }); }));
    atuais.forEach(a => a.itens.forEach(i => { const k = P(i.plaqueta); if(k) ondeAgora.set(k, { amb: a, i }); }));
    const aConferir = new Set(atuais.flatMap(a => a.aConferir));
    const entraram = [], sairam = [], mudaram = [], ficaram = [], pendentes = [];
    ondeAgora.forEach((v, k) => {
      const ant = ondeAntes.get(k);
      if(!ant) entraram.push({ plaqueta: v.i.plaqueta, descricao: v.i.descricao, agora: v.amb.nome });
      else if(parDe(v.amb) === ant.amb) ficaram.push(k);
      else mudaram.push({ plaqueta: v.i.plaqueta, descricao: v.i.descricao, antes: ant.amb.nome, agora: v.amb.nome });
    });
    ondeAntes.forEach((v, k) => {
      if(ondeAgora.has(k)) return;
      if(aConferir.has(k)) pendentes.push({ plaqueta: v.i.plaqueta, descricao: v.i.descricao, antes: v.amb.nome });
      else sairam.push({ plaqueta: v.i.plaqueta, descricao: v.i.descricao, antes: v.amb.nome });
    });
    const semPlaqAntes = anteriores.reduce((t, a) => t + a.itens.filter(i => !P(i.plaqueta)).length, 0), semPlaqAgora = atuais.reduce((t, a) => t + a.itens.filter(i => !P(i.plaqueta)).length, 0);
    // por ambiente
    const nomes = new Map();
    atuais.forEach(a => nomes.set(chaveAmb(a), { nome: a.nome, agora: a, antes: parDe(a) }));
    anteriores.forEach(a => { if(![...nomes.values()].some(x => x.antes === a)) nomes.set('ant:' + chaveAmb(a), { nome: a.nome, agora: null, antes: a }); });
    const porAmb = [...nomes.values()].map(x => ({
      nome: x.nome, novo: !x.antes, deixou: !x.agora,
      antes: x.antes ? x.antes.itens.length : 0, agora: x.agora ? x.agora.itens.length : 0,
      entraram: entraram.filter(e => x.agora && e.agora === x.agora.nome).length + mudaram.filter(m => x.agora && m.agora === x.agora.nome).length,
      sairam: sairam.filter(e => x.antes && e.antes === x.antes.nome).length + mudaram.filter(m => x.antes && m.antes === x.antes.nome).length
    })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric:true }));
    return { entraram, sairam, mudaram, ficaram: ficaram.length, pendentes, porAmb, semPlaqAntes, semPlaqAgora,
      totalAntes: anteriores.reduce((t, a) => t + a.itens.length, 0), totalAgora: atuais.reduce((t, a) => t + a.itens.length, 0) };
  }
  function mostrarComparativo(lev, anteriores, rotuloAntes){
    const r = calcularComparativo(lev, anteriores), un = lev.unidade ? lev.unidade.name : '';
    const lista = (titulo, cor, itens, cols) => itens.length ? `<details class="cm-det"><summary><span style="color:${cor}">●</span> ${titulo} <b>${itens.length}</b></summary>
      <div class="cm-lst">${itens.slice(0, 300).map(i => `<div><b>${esc(i.plaqueta || '—')}</b> ${esc(i.descricao || '')}<small>${cols(i)}</small></div>`).join('')}${itens.length > 300 ? '<div><small>… e mais ' + (itens.length - 300) + ' (veja na planilha)</small></div>' : ''}</div></details>` : '';
    ui().abrirModal('Comparativo ano a ano', `
      <p class="ctl-dica"><b>${esc(un)}</b>: ${esc(rotuloAntes)} → ${esc(lev.campanhaNome || 'agora')}</p>
      <div class="lv-kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="lv-kpi"><b>${r.totalAntes}</b><span>bens antes</span></div><div class="lv-kpi"><b>${r.totalAgora}</b><span>bens agora</span></div>
        <div class="lv-kpi"><b>${r.ficaram}</b><span>no mesmo ambiente</span></div>
        <div class="lv-kpi"><b style="color:#1A7F4B">+${r.entraram.length}</b><span>entraram</span></div>
        <div class="lv-kpi${r.sairam.length ? ' alerta' : ''}"><b style="color:#B03A2E">−${r.sairam.length}</b><span>saíram / não achados</span></div>
        <div class="lv-kpi"><b style="color:#B5651D">${r.mudaram.length}</b><span>mudaram de ambiente</span></div>
      </div>
      ${r.pendentes.length ? `<div class="es-aviso">${r.pendentes.length} bem(ns) do levantamento anterior ainda <b>não foram conferidos</b> agora (estão "aguardando conferência"). Eles não contam como saída até a conferência terminar.</div>` : ''}
      <div style="overflow-x:auto;margin-bottom:10px"><table class="es-tab"><thead><tr><th>Ambiente</th><th style="text-align:right">Antes</th><th style="text-align:right">Agora</th><th style="text-align:right">Entraram</th><th style="text-align:right">Saíram</th></tr></thead><tbody>
        ${r.porAmb.map(a => `<tr><td>${esc(a.nome)}${a.novo ? ' <small style="color:#1A7F4B">novo ambiente</small>' : ''}${a.deixou ? ' <small style="color:#B03A2E">não levantado agora</small>' : ''}</td>
          <td style="text-align:right">${a.antes}</td><td style="text-align:right"><b>${a.agora}</b></td><td style="text-align:right;color:#1A7F4B">${a.entraram ? '+' + a.entraram : ''}</td><td style="text-align:right;color:#B03A2E">${a.sairam ? '−' + a.sairam : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${lista('Entraram', '#1A7F4B', r.entraram, i => 'agora em ' + esc(i.agora))}
      ${lista('Mudaram de ambiente', '#B5651D', r.mudaram, i => esc(i.antes) + ' → ' + esc(i.agora))}
      ${lista('Saíram ou não foram achados', '#B03A2E', r.sairam, i => 'estava em ' + esc(i.antes))}
      ${lista('Ainda aguardando conferência', '#7A7A7A', r.pendentes, i => 'estava em ' + esc(i.antes))}
      ${r.semPlaqAntes || r.semPlaqAgora ? `<p class="ctl-dica">Bens sem plaqueta não entram na comparação item a item (antes ${r.semPlaqAntes}, agora ${r.semPlaqAgora}).</p>` : ''}
      <button class="btn btn-primary btn-full" id="cmXls" type="button" style="margin-top:10px">⭳ Baixar planilha do comparativo</button>`);
    $('cmXls').onclick = () => ui().baixarPlanilha('comparativo-' + norm(un).replace(/[^a-z0-9]+/g, '-').slice(0, 40), [
      { nome:'Por ambiente', linhas: r.porAmb.map(a => ({ 'Ambiente': a.nome, 'Bens antes': a.antes, 'Bens agora': a.agora, 'Entraram': a.entraram, 'Saíram': a.sairam, 'Observação': a.novo ? 'ambiente novo' : (a.deixou ? 'não levantado agora' : '') })) },
      { nome:'Entraram', linhas: r.entraram.map(i => ({ 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Ambiente atual': i.agora })) },
      { nome:'Mudaram de ambiente', linhas: r.mudaram.map(i => ({ 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Antes': i.antes, 'Agora': i.agora })) },
      { nome:'Saíram', linhas: r.sairam.map(i => ({ 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Estava em': i.antes })) },
      { nome:'Aguardando conferência', linhas: r.pendentes.map(i => ({ 'Plaqueta': i.plaqueta, 'Descrição': i.descricao, 'Estava em': i.antes })) }
    ]);
  }
  function planilhaDoLev(l){
    const ambs = ambsDe(l), sit = { pending:'aguardando conferência', confirmed:'confirmado', discarded:'não localizado / descartado' };
    ui().baixarPlanilha('levantamento-' + norm(l.unidade ? l.unidade.name : 'unidade').replace(/[^a-z0-9]+/g, '-').slice(0, 40), [
      { nome:'Bens', linhas: ambs.flatMap(a => (a.items || []).map(i => ({ 'Ambiente': a.name, 'Andar': a.andar || '', 'Plaqueta': i.plaqueta || '', 'Descrição': i.description || '',
          'Conservação': i.conservacao || '', 'Situação': sit[i.status] || i.status, 'Veio do levantamento anterior': i.herdado ? 'sim' : '' }))) },
      { nome:'Ambientes', linhas: ambs.map(a => ({ 'Ambiente': a.name, 'Andar': a.andar || '', 'Situação': a.status === 'coletado' ? 'concluído' : 'pendente',
          'Bens': (a.items || []).length, 'Criado em': hoje(a.createdAt), 'Concluído em': hoje(a.collectedAt) })) }
    ]);
  }

  /* =================================================================
     IMPORTAR O LEVANTAMENTO ANTERIOR
     ================================================================= */
  const CONSERVACAO = v => { const t = norm(v);
    if(!t) return null; if(/inserv|irrecuper|antieconom|ocios|sucata/.test(t)) return 'inservivel';
    if(/ruim|precari|danific|defeit|quebrad/.test(t)) return 'ruim'; if(/regular|razoav/.test(t)) return 'regular';
    if(/^bom|otimo|novo|excelente|^bom$/.test(t)) return 'bom'; return ['bom','regular','ruim','inservivel'].includes(t) ? t : null; };
  async function escolherDestinoImportacao(){
    await carregar();
    const abertos = LEVS.filter(l => l.status !== 'processado');
    if(!abertos.length){ iniciarLevantamento(); return; }
    ui().abrirModal('Importar levantamento anterior', `
      <p class="ctl-dica">Para qual levantamento em andamento vão os ambientes e bens importados?</p>
      <div class="ctl-escolha">${abertos.map(l => `<button type="button" data-l="${l.id}">${esc(l.unidade ? l.unidade.name : 'Sem unidade')}<small>${esc(l.campanhaNome || '')}</small></button>`).join('')}</div>
      <button class="btn btn-ghost btn-full" id="idNovo" type="button">+ Iniciar um levantamento novo</button>`);
    document.querySelectorAll('#ctlModalCorpo [data-l]').forEach(b => b.onclick = () => escolherFonte(LEVS.find(l => l.id === b.dataset.l)));
    $('idNovo').onclick = () => iniciarLevantamento();
  }
  function escolherFonte(lev, fonte){
    if(!lev) return;
    if(fonte){ ({ anterior: fonteAnterior, base: fonteBase, arquivo: fonteArquivo })[fonte](lev); return; }
    ui().abrirModal('Ponto de partida', `
      <p class="ctl-dica">Os ambientes e bens importados entram em <b>${esc(lev.unidade ? lev.unidade.name : '')}</b> como <b>aguardando conferência</b>: em campo, você confirma os que achou e marca "Não localizado" nos que sumiram.</p>
      <div class="lv-origem">
        <label><input type="radio" name="iOrig" value="anterior" checked><span>Levantamento anterior<small>De uma campanha passada (na nuvem ou neste aparelho).</small></span></label>
        <label><input type="radio" name="iOrig" value="base"><span>Base oficial<small>Locais e bens da base do ${esc(A().sis())} desta unidade.</small></span></label>
        <label><input type="radio" name="iOrig" value="arquivo"><span>Arquivo<small>Planilha de bens por local ou backup do app.</small></span></label>
      </div><button class="btn btn-primary btn-full" id="iOk" type="button">Continuar</button>`);
    $('iOk').onclick = () => escolherFonte(lev, document.querySelector('[name="iOrig"]:checked').value);
  }
  // grava os ambientes importados no levantamento, juntando com os que já existem
  async function importarAmbientes(lev, lista, origem){
    const existentes = ambsDe(lev);
    let novosAmb = 0, novosBens = 0, repetidos = 0;
    for(const g of lista){
      const itens = (g.itens || []).filter(i => i.plaqueta || i.description);
      let a = existentes.find(x => norm(x.name) === norm(g.nome));
      const jaTem = new Set(a ? (a.items || []).map(i => A().normPlaq(i.plaqueta)).filter(Boolean) : []);
      const herd = itens.filter(i => { const k = A().normPlaq(i.plaqueta); if(k && jaTem.has(k)){ repetidos++; return false; } if(k) jaTem.add(k); return true; })
        .map(i => ({ description: i.description || '', plaqueta: i.plaqueta || null, conservacao: CONSERVACAO(i.conservacao), status: 'pending', herdado: true, origem }));
      if(!a){
        a = A().criarAmbiente({ name: g.nome || 'Local não informado', andar: g.andar || '', modo: g.modo || 'levantamento', units: lev.unidade ? [lev.unidade] : [],
          campanhaId: lev.campanhaId || null, levantamentoId: lev.id, origemImportacao: origem, items: herd });
        existentes.push(a); novosAmb++;
      } else {
        a.items = (a.items || []).concat(A().novosItens(herd));
      }
      novosBens += herd.length;
      A().anotar(a, { tipo: 'importacao', nota: herd.length + ' bens importados — ' + origem });
      await A().salvar(a);
    }
    lev.origem = { tipo: 'importado', detalhe: origem }; await gravar();
    A().atualizarTelas(); ui().fecharModal(); abrirLev(lev);
    alert('Importação concluída: ' + novosAmb + ' ambientes novos e ' + novosBens + ' bens aguardando conferência.' + (repetidos ? ' (' + repetidos + ' bens já estavam no levantamento e foram ignorados.)' : ''));
  }
  /* --- fonte 1: levantamento anterior (nuvem ou aparelho) --- */
  async function fonteAnterior(lev){
    const locais = LEVS.filter(l => l.id !== lev.id && ambsDe(l).length).sort((a, b) => (b.unidade && lev.unidade && b.unidade.code === lev.unidade.code) - (a.unidade && lev.unidade && a.unidade.code === lev.unidade.code));
    const corpo = ui().abrirModal('Importar levantamento anterior', `
      <p class="ctl-dica">Escolha de onde vem o levantamento anterior de <b>${esc(lev.unidade ? lev.unidade.name : '')}</b>.</p>
      <div class="ctl-campo"><label>Da nuvem (campanhas anteriores da organização)</label><select id="iaCamp"><option value="">Carregando campanhas…</option></select></div>
      <label class="ctl-dica" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="iaTodas"> Trazer de todas as unidades (não só desta)</label>
      <button class="btn btn-primary btn-full" id="iaNuvem" type="button" style="margin-bottom:14px">Buscar na nuvem e importar</button>
      ${locais.length ? `<div class="ctl-campo"><label>Ou deste aparelho</label></div><div class="ctl-escolha">${locais.map(l => `<button type="button" data-l="${l.id}">${esc(l.unidade ? l.unidade.name : '—')}<small>${esc(l.campanhaNome || '')} · ${ambsDe(l).length} ambientes · ${l.status === 'processado' ? 'processado' : 'em andamento'}</small></button>`).join('')}</div>` : ''}
      <div class="ctl-dica" id="iaMsg"></div>`);
    buscarCampanhas().then(cs => {
      const outras = cs.filter(c => c.id !== lev.campanhaId);
      $('iaCamp').innerHTML = outras.length ? outras.map(c => `<option value="${esc(c.id)}">${esc(String(c.nome).split(' · ')[0])}${c.aberta === false ? ' (encerrada)' : ''}</option>`).join('') : '<option value="">Nenhuma outra campanha na nuvem</option>';
    });
    corpo.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      const l = LEVS.find(x => x.id === b.dataset.l);
      importarAmbientes(lev, ambsDe(l).map(a => ({ nome: a.name, andar: a.andar, modo: a.modo,
        itens: (a.items || []).filter(i => i.status !== 'discarded').map(i => ({ description: i.description, plaqueta: i.plaqueta, conservacao: i.conservacao })) })),
        'levantamento ' + (l.campanhaNome || '') + ' (deste aparelho)');
    });
    $('iaNuvem').onclick = async () => {
      const camp = $('iaCamp').value, msg = $('iaMsg'); if(!camp){ msg.textContent = 'Escolha a campanha.'; return; }
      msg.textContent = 'Buscando ambientes…';
      try{
        const filtroU = (!$('iaTodas').checked && lev.unidade) ? '&unidade_code=eq.' + encodeURIComponent(lev.unidade.code) : '';
        const ambs = await ui().nuvem('/rest/v1/ambientes?campanha_id=eq.' + camp + filtroU + '&select=id,nome,andar,modo,unidade_code&limit=5000');
        if(!ambs || !ambs.length){ msg.textContent = 'Nenhum ambiente desta unidade nessa campanha.'; return; }
        msg.textContent = 'Buscando os bens de ' + ambs.length + ' ambientes…';
        const itens = [];
        for(let i = 0; i < ambs.length; i += 40){
          const ids = ambs.slice(i, i + 40).map(a => a.id).join(',');
          const parte = await ui().nuvem('/rest/v1/itens?ambiente_id=in.(' + ids + ')&select=ambiente_id,descricao,plaqueta,conservacao,status&limit=20000');
          itens.push(...(parte || []));
        }
        importarAmbientes(lev, ambs.map(a => ({ nome: a.nome, andar: a.andar, modo: a.modo,
          itens: itens.filter(i => i.ambiente_id === a.id && i.status !== 'discarded').map(i => ({ description: i.descricao, plaqueta: i.plaqueta, conservacao: i.conservacao })) })),
          'campanha ' + nomeCamp(camp));
      }catch(e){ msg.textContent = 'Não foi possível buscar na nuvem: ' + String(e.message).slice(0, 160); }
    };
  }
  /* --- fonte 2: base oficial --- */
  function fonteBase(lev){
    const u = lev.unidade, base = A().base();
    if(!base.length){ alert('Nenhuma base oficial carregada. Importe a base em "Base oficial e backup" primeiro.'); return; }
    const chaves = u ? [norm(u.code), norm(u.name)] : [];
    const daUnidade = base.filter(r => r.unidade && chaves.includes(norm(r.unidade)));
    const grupos = new Map();
    daUnidade.forEach(r => { const k = r.localizacao || 'Local não informado'; if(!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
    if(!daUnidade.length){ alert('A base oficial não tem bens com a unidade "' + (u ? u.name : '') + '" (nem pelo código ' + (u ? u.code : '') + '). Confira se a coluna de unidade da base usa o mesmo nome ou código.'); return; }
    if(!confirm('Criar ' + grupos.size + ' ambientes com ' + daUnidade.length + ' bens da base oficial, para conferir em campo?')) return;
    importarAmbientes(lev, [...grupos].map(([nome, rs]) => ({ nome, modo: 'conferencia', itens: rs.map(r => ({ description: r.descricao, plaqueta: r.plaqueta, conservacao: r.situacao })) })),
      'base oficial (' + A().sis() + ')');
  }
  /* --- fonte 3: arquivo (planilha por local ou backup) --- */
  function fonteArquivo(lev){
    ui().abrirModal('Importar de arquivo', `
      <p class="ctl-dica">Use a planilha de <b>bens por local</b> do levantamento anterior (por exemplo, exportada do sistema patrimonial) ou um <b>backup</b> deste app (.json).</p>
      <div class="ctl-campo"><label>Arquivo</label><input type="file" id="iaArq" accept=".csv,.xlsx,.xls,.ods,.json"></div><div id="iaEtapa"></div><div class="ctl-dica" id="iaMsg"></div>`);
    $('iaArq').onchange = async e => {
      const arq = e.target.files[0]; if(!arq) return;
      const msg = $('iaMsg'); msg.textContent = 'Lendo…';
      try{
        if(/\.json$/i.test(arq.name)){
          const d = JSON.parse(await arq.text());
          let ambs = Array.isArray(d.ambientes) ? d.ambientes : [];
          const daU = lev.unidade ? ambs.filter(a => (unidadeDe(a) || {}).code === lev.unidade.code) : [];
          if(daU.length) ambs = daU;
          if(!ambs.length){ msg.textContent = 'O backup não tem ambientes.'; return; }
          if(!confirm('Importar ' + ambs.length + ' ambientes do backup' + (daU.length ? ' (desta unidade)' : ' (o backup não tem esta unidade; serão todos)') + '?')) return;
          importarAmbientes(lev, ambs.map(a => ({ nome: a.name, andar: a.andar, modo: a.modo,
            itens: (a.items || []).filter(i => i.status !== 'discarded').map(i => ({ description: i.description, plaqueta: i.plaqueta, conservacao: i.conservacao })) })), 'backup ' + arq.name);
          return;
        }
        const doc = await ui().lerArquivo(arq);
        msg.textContent = '';
        mapearPlanilha(lev, doc, doc.abas[0], arq.name);
      }catch(err){ msg.textContent = 'Não foi possível ler: ' + err.message; }
    };
  }
  const CAMPOS_ARQ = [
    { id:'local', rot:'Local / ambiente', obrig:true, pista:/local|sala|ambiente|localidade|endereco/ },
    { id:'plaqueta', rot:'Plaqueta / tombamento', pista:/plaqueta|tomb|patrim|n[ºo°]?\s*(do\s*)?bem|numero|etiqueta|^bem$|codigo/ },
    { id:'descricao', rot:'Descrição', pista:/descri|denomina|especifica|material|^item$/ },
    { id:'conservacao', rot:'Estado / conservação', pista:/conserva|estado|situa/ },
    { id:'andar', rot:'Andar / bloco', pista:/andar|pavimento|bloco|piso/ },
    { id:'unidade', rot:'Unidade (para filtrar)', pista:/unidade|setor|lotacao|departamento/ }
  ];
  function mapearPlanilha(lev, doc, aba, nomeArq){
    const linhas = doc.ler(aba).filter(l => Object.values(l).some(v => String(v).trim() !== ''));
    const cab = linhas.length ? Object.keys(linhas[0]) : [], usadas = new Set(), mapa = {};
    CAMPOS_ARQ.forEach(c => { const h = cab.find(x => !usadas.has(x) && c.pista.test(norm(x))); if(h){ mapa[c.id] = h; usadas.add(h); } });
    const op = sel => '<option value="">— não tem —</option>' + cab.map(h => `<option value="${esc(h)}"${h === sel ? ' selected' : ''}>${esc(h)}</option>`).join('');
    $('iaEtapa').innerHTML = `${doc.abas.length > 1 ? `<div class="ctl-campo"><label>Aba</label><select id="iaAba">${doc.abas.map(a => `<option${a === aba ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>` : ''}
      <p class="ctl-dica"><b>${linhas.length}</b> linhas. Confira as colunas:</p>
      <div class="ctl-mapa">${CAMPOS_ARQ.map(c => `<span>${esc(c.rot)}${c.obrig ? ' *' : ''}</span><select data-campo="${c.id}">${op(mapa[c.id])}</select>`).join('')}</div>
      <label class="ctl-dica" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="iaSoUnid" ${mapa.unidade ? 'checked' : ''}> Só as linhas da unidade ${esc(lev.unidade ? lev.unidade.name : '')}</label>
      <button class="btn btn-primary btn-full" id="iaOk" type="button" style="margin-top:8px">Importar</button>`;
    const sa = $('iaAba'); if(sa) sa.onchange = () => mapearPlanilha(lev, doc, sa.value, nomeArq);
    $('iaOk').onclick = () => {
      const m = {}; $('iaEtapa').querySelectorAll('[data-campo]').forEach(s => { if(s.value) m[s.dataset.campo] = s.value; });
      if(!m.local){ $('iaMsg').textContent = 'Indique a coluna do local/ambiente.'; return; }
      if(!m.plaqueta && !m.descricao){ $('iaMsg').textContent = 'Indique a coluna da plaqueta ou da descrição.'; return; }
      const chaves = lev.unidade ? [norm(lev.unidade.code), norm(lev.unidade.name)] : [];
      const filtrar = $('iaSoUnid').checked && m.unidade;
      const g = new Map();
      linhas.forEach(l => {
        if(filtrar && !chaves.some(k => norm(l[m.unidade]).includes(k))) return;
        const local = String(l[m.local] || '').trim() || 'Local não informado';
        if(!g.has(local)) g.set(local, { nome: local, andar: m.andar ? String(l[m.andar] || '').trim() : '', itens: [] });
        g.get(local).itens.push({ plaqueta: m.plaqueta ? String(l[m.plaqueta] || '').trim() : '', description: m.descricao ? String(l[m.descricao] || '').trim() : '', conservacao: m.conservacao ? l[m.conservacao] : '' });
      });
      if(!g.size){ $('iaMsg').textContent = 'Nenhuma linha desta unidade. Desmarque o filtro de unidade ou confira a coluna.'; return; }
      importarAmbientes(lev, [...g.values()], 'planilha ' + nomeArq);
    };
  }

  /* ---------------- início ---------------- */
  window.LEV = {
    vincular, irPara, abrirLev, fonteCadastro, compararAnterior, calcularComparativo, todos: () => LEVS, recarregar: carregar, iniciar: iniciarLevantamento,
    async importarLista(lista){ LEVS = lista; await gravar(); },
    abrirDaUnidade(u){ const l = LEVS.find(x => x.status !== 'processado' && x.unidade && x.unidade.code === u.code) || LEVS.find(x => x.unidade && x.unidade.code === u.code); if(l) abrirLev(l); else iniciarLevantamento({ unidade: { code: u.code, name: u.name, path: u.path || '' } }); },
    async aoIniciar(){
      try{ await this._iniciar(); } finally { document.documentElement.classList.remove('decidindo-tela'); }
    },
    async _iniciar(){
      await carregar();
      if(window.ESTRUTURA) ESTRUTURA.carregar().catch(() => {});
      await garantirVinculos();
      atualizarCabecalho();
      // F5: volta para a tela em que estava; senão, Início (a menos que o app tenha reaberto um ambiente)
      if($('screenCollection').style.display === 'block') return navigator.onLine && buscarCampanhas();
      let t = null; try{ t = JSON.parse(sessionStorage.getItem('app_tela') || 'null'); }catch(e){}
      let ok = false;
      try{
        if(t && t.dest === 'lev'){ const l = LEVS.find(x => x.id === t.id); if(l){ abrirLev(l); ok = true; } }
        else if(t && t.dest === 'amb'){ const a = A().todos().find(x => String(x.id) === String(t.id)); if(a){ A().esconderTelas(); A().abrir(a); const l = t.lev && LEVS.find(x => x.id === t.lev); if(l){ LEV_ABERTO = l; veioDoLev = true; lembrar(t); } ok = true; } }
        else if(t && TELAS_FIXAS.includes(t.dest)){ await irPara(t.dest); ok = true; }
      }catch(e){ ok = false; }
      if(!ok) irPara('inicio');
      if(navigator.onLine) buscarCampanhas();
    }
  };
  const _orgAntes = window.atualizarListaDaOrg;
  window.atualizarListaDaOrg = () => { if(_orgAntes) _orgAntes(); atualizarCabecalho(); if(window.ESTRUTURA) ESTRUTURA.carregar().catch(() => {}); carregar().then(() => { CAMPANHAS = []; try{ CAMPANHAS = JSON.parse(localStorage.getItem(chaveCamp()) || '[]'); }catch(e){} renderAtual(); }); };
  atualizarCabecalho();
})();
