/* =====================================================================
   Estrutura organizacional: UNIDADES (hierarquia) + AMBIENTES de cada unidade
   ---------------------------------------------------------------------
   Toda organização (pública ou privada) precisa da sua hierarquia para fazer
   o levantamento: secretarias, departamentos, setores… e, dentro de cada
   unidade, os ambientes (salas, laboratórios, depósitos).
   - Unidades: tabela "unidades" (código, nome, código superior).
   - Ambientes cadastrados: tabela "locais" (migração 05), por unidade.
   Gestor e administrador cadastram e alteram; os demais consultam.
   O levantamento parte dos ambientes cadastrados da unidade.
   ===================================================================== */
(function(){
  'use strict';
  const A = () => window.APP, ui = () => window.CONTROLE.ui;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const org = () => window.ORG || {};
  const podeEditar = () => !!(org().id && ['admin','gestor'].includes(org().papel));
  const unidades = () => (A() && A().unidades ? A().unidades() : []) || [];
  const TIPOS_AMB = ['Sala', 'Gabinete', 'Sala de aula', 'Laboratório', 'Auditório', 'Sala de reunião', 'Recepção', 'Copa / cozinha', 'Banheiro',
    'Depósito / almoxarifado', 'Arquivo', 'Corredor / circulação', 'Garagem', 'Área externa', 'Outro'];

  /* ---------------- dados ---------------- */
  const CH = () => 'locais:' + (org().id || 'legado');
  let LOCAIS = [], semTabela = false, carregado = false;
  function lerCache(){ try{ LOCAIS = JSON.parse(localStorage.getItem(CH()) || '[]') || []; }catch(e){ LOCAIS = []; } }
  function gravarCache(){ try{ localStorage.setItem(CH(), JSON.stringify(LOCAIS)); }catch(e){} }
  const naoExiste = e => /locais|PGRST205|PGRST204|42P01|does not exist|schema cache|Could not find/i.test(String(e && e.message || e));
  // confere no banco o papel de quem está usando (o guardado no aparelho pode estar desatualizado)
  async function atualizarPapel(){
    const s = ui().sessao(); if(!s || !s.user || !s.user.id || !org().id) return;
    try{
      const r = await ui().nuvem('/rest/v1/membros?org_id=eq.' + org().id + '&user_id=eq.' + s.user.id + '&ativo=eq.true&select=papel');
      const papel = r && r[0] && r[0].papel;
      if(papel && window.ORG && window.ORG.papel !== papel){
        window.ORG.papel = papel;
        try{ const o = JSON.parse(localStorage.getItem('org_ativa') || 'null'); if(o && o.id === window.ORG.id){ o.papel = papel; localStorage.setItem('org_ativa', JSON.stringify(o)); } }catch(e){}
      }
    }catch(e){}
  }
  const quemSou = () => { const s = ui().sessao(); return (s && s.user && (s.user.email || s.user.nomeGoogle)) || 'esta conta'; };
  async function carregar(){
    lerCache();
    if(!org().id || !navigator.onLine || !ui().sessao()) { carregado = true; return LOCAIS; }
    await atualizarPapel();
    try{
      const todas = [];
      for(let ini = 0; ini < 200000; ini += 1000){
        const parte = await ui().nuvem('/rest/v1/locais?org_id=eq.' + org().id + '&select=*&order=unidade_code,nome&limit=1000&offset=' + ini);
        todas.push(...(parte || [])); if(!parte || parte.length < 1000) break;
      }
      LOCAIS = todas; semTabela = false; gravarCache();
    }catch(e){ if(naoExiste(e)) semTabela = true; }
    carregado = true;
    return LOCAIS;
  }
  const locaisDe = (code, comInativos) => LOCAIS.filter(l => l.unidade_code === code && (comInativos || l.ativo !== false))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric:true }));
  const descLocal = l => [l.bloco && ('Bloco ' + String(l.bloco).replace(/^bloco\s*/i, '')), l.andar, l.tipo].filter(Boolean).join(' · ');

  // estrutura de unidades guardada no aparelho (mesma chave que o app usa)
  function salvarUnidadesLocal(lista){
    try{ localStorage.setItem('estrutura:' + (org().id || 'legado'), JSON.stringify(lista.map(u => ({ code:u.code, name:u.name, parent_code:u.parent_code || null })))); }catch(e){}
    if(window.definirEstrutura) window.definirEstrutura(lista);
  }
  function exigirNuvem(){
    if(!org().id){ alert('A estrutura é da organização: entre numa organização para cadastrar.'); return false; }
    if(!podeEditar()){ alert('Você entrou como ' + quemSou() + ', com o papel "' + (org().papel || 'sem papel') + '" nesta organização.\n\nCadastrar, importar e alterar a estrutura é só para gestor ou administrador. O administrador muda o papel no painel de gestão, em Administração → Membros.'); return false; }
    if(!navigator.onLine){ alert('Sem internet. A estrutura é compartilhada com toda a equipe, por isso é cadastrada com o aparelho conectado.'); return false; }
    return true;
  }

  /* ---------------- gravações ---------------- */
  async function gravarUnidade(u, novo){
    if(novo){
      await ui().nuvem('/rest/v1/unidades', { method:'POST', headers:{ Prefer:'return=minimal' },
        body: JSON.stringify([{ org_id: org().id, code: u.code, name: u.name, parent_code: u.parent_code || null, ativo: true }]) });
      salvarUnidadesLocal(unidades().concat([u]));
    } else {
      await ui().nuvem('/rest/v1/unidades?org_id=eq.' + org().id + '&code=eq.' + encodeURIComponent(u.code), { method:'PATCH', headers:{ Prefer:'return=minimal' },
        body: JSON.stringify({ name: u.name, parent_code: u.parent_code || null }) });
      salvarUnidadesLocal(unidades().map(x => x.code === u.code ? Object.assign({}, x, { name:u.name, parent_code:u.parent_code || null }) : x));
    }
  }
  async function desativarUnidade(u){
    await ui().nuvem('/rest/v1/unidades?org_id=eq.' + org().id + '&code=eq.' + encodeURIComponent(u.code), { method:'PATCH', headers:{ Prefer:'return=minimal' }, body: JSON.stringify({ ativo:false }) });
    salvarUnidadesLocal(unidades().filter(x => x.code !== u.code));
  }
  async function gravarLocais(linhas){
    if(semTabela) throw new Error('o cadastro de ambientes ainda não foi ativado no banco (migração 05)');
    const r = await ui().nuvem('/rest/v1/locais?on_conflict=org_id,unidade_code,nome', { method:'POST',
      headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(linhas.map(l => ({ org_id: org().id, unidade_code: l.unidade_code, nome: l.nome, codigo: l.codigo || null, bloco: l.bloco || null,
        andar: l.andar || null, tipo: l.tipo || null, responsavel: l.responsavel || null, ativo: true, atualizado_em: new Date().toISOString() }))) });
    (r || []).forEach(n => { const i = LOCAIS.findIndex(x => x.id === n.id); if(i >= 0) LOCAIS[i] = n; else LOCAIS.push(n); });
    gravarCache();
    return r || [];
  }
  async function alterarLocal(l, dados){
    const r = await ui().nuvem('/rest/v1/locais?id=eq.' + l.id, { method:'PATCH', headers:{ Prefer:'return=representation' },
      body: JSON.stringify(Object.assign({}, dados, { atualizado_em: new Date().toISOString() })) });
    const n = r && r[0]; if(n){ const i = LOCAIS.findIndex(x => x.id === n.id); if(i >= 0) LOCAIS[i] = n; }
    gravarCache();
    return n;
  }
  // usado em campo: cadastra um ambiente novo na unidade e devolve o registro
  async function cadastrarRapido(unidade, dados){
    if(!podeEditar() || !navigator.onLine || !org().id || semTabela || !unidade) return null;
    try{ const r = await gravarLocais([Object.assign({ unidade_code: unidade.code }, dados)]); return r[0] || null; }catch(e){ return null; }
  }

  /* ---------------- tela ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  .es-no{border-left:2px solid var(--border-soft,#ECE8DD);margin-left:10px;padding-left:8px}
  .es-un{display:flex;align-items:center;gap:8px;padding:8px 10px;margin:4px 0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;cursor:pointer}
  .es-un .tg{width:16px;color:var(--text-muted);font-size:12px;flex-shrink:0}
  .es-un .nm{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--text-primary)}
  .es-un .nm small{display:block;font-weight:400;font-size:11px;color:var(--text-faint);font-family:var(--font-mono,monospace)}
  .es-cont{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--text-muted);white-space:nowrap;text-align:right}
  .es-cont b{color:var(--verde,#1A4731)}
  .es-cont .zero{color:#B5651D}
  .es-amb{display:flex;align-items:center;gap:8px;padding:6px 10px;margin:3px 0 3px 14px;border:1px dashed var(--border);border-radius:9px;font-size:13px;background:var(--bg-main,transparent)}
  .es-amb .nm{flex:1;min-width:0}
  .es-amb small{display:block;font-size:11px;color:var(--text-faint)}
  .es-amb button,.es-un button{background:none;border:0;cursor:pointer;color:var(--text-muted);font-size:14px;padding:2px 5px}
  .es-acoes-un{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px 14px}
  .es-acoes-un .lv-btn{font-size:12px;padding:5px 9px}
  .es-aviso{background:#FFF7E8;border:1px solid #F0D9A8;color:#7A4B00;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5;margin-bottom:12px}
  .es-ok{background:var(--success-bg,#E8F2EC);border:1px solid #c4dccb;color:var(--verde,#1A4731)}
  .es-marca{background:#FFF1C9;border-radius:3px}
  .es-abas{display:flex;gap:4px;margin:4px 0 10px;border-bottom:1px solid var(--border)}
  .es-abas button{font-family:inherit;font-size:13px;font-weight:600;padding:8px 12px;border:0;border-bottom:2px solid transparent;background:none;color:var(--text-muted);cursor:pointer}
  .es-abas button.on{color:var(--verde,#1A4731);border-bottom-color:var(--verde,#1A4731)}
  .es-tab{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
  .es-tab th{text-align:left;font-family:var(--font-mono,monospace);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);padding:8px;border-bottom:1px solid var(--border);background:var(--bg-main,#F6F3EC)}
  .es-tab td{padding:8px;border-bottom:1px solid var(--border-soft,#ECE8DD);vertical-align:top}
  .es-tab tr[data-un]{cursor:pointer}
  .es-tab tr[data-un]:hover td{background:var(--success-bg,#E8F2EC)}
  .es-tab td code{font-family:var(--font-mono,monospace);font-size:11px;color:var(--text-muted)}
  .es-tab td small{display:block;color:var(--text-faint);font-size:11px}
  .es-mais{display:block;margin:10px auto;font-family:inherit}
  .lv-btn.pri{background:var(--verde,#1A4731);color:#fff;border-color:var(--verde,#1A4731)}
  .es-sel{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .es-sel button{font-family:inherit;font-size:12.5px;padding:6px 10px;border-radius:16px;border:1px solid var(--border);background:var(--bg-card);cursor:pointer;color:var(--text-primary)}
  .es-sel button.on{border-color:var(--verde,#1A4731);background:var(--success-bg,#E8F2EC);font-weight:600}
  .es-sel button small{color:var(--text-faint);margin-left:4px}
  `;
  document.head.appendChild(css);
  const app = document.querySelector('.app');
  const tela = document.createElement('div'); tela.id = 'screenEstrutura'; tela.className = 'tela-extra'; tela.style.display = 'none';
  tela.innerHTML = `
    <div class="lv-titulo">Estrutura organizacional</div>
    <p class="lv-sub">A hierarquia da organização: as <b>unidades</b> (secretarias, diretorias, departamentos, setores…) e, dentro de cada uma, os <b>ambientes</b> (salas, laboratórios, depósitos…). Todo levantamento parte daqui.</p>
    <div class="lv-kpis" id="esResumo"></div>
    <div id="esAviso"></div>
    <div class="lv-btns" id="esAcoes" style="margin-bottom:10px">
      <button class="lv-btn pri" type="button" data-a="nova">＋ Cadastrar unidade</button>
      <button class="lv-btn" type="button" data-a="importar">⇪ Importar estrutura</button>
      <button class="lv-btn" type="button" data-a="exportar">⇩ Exportar estrutura</button>
      <button class="lv-btn" type="button" data-a="modelo">⇩ Planilha modelo</button>
    </div>
    <div class="es-abas"><button type="button" data-v="lista" class="on">Lista de cadastradas</button><button type="button" data-v="arvore">Hierarquia (árvore)</button></div>
    <div class="ctl-barra"><input type="search" id="esBusca" placeholder="Buscar unidade, código ou ambiente…">
      <select id="esFiltro"><option value="">Todas</option><option value="com">Com ambientes</option><option value="sem">Sem ambientes</option></select></div>
    <div id="esArvore"></div>`;
  if(app) app.appendChild(tela);

  const ABERTOS = new Set();
  let filtro = '', visao = 'lista', filtroAmb = '', limite = 100;
  try{ visao = localStorage.getItem('estrutura_visao') || 'lista'; }catch(e){}
  tela.querySelectorAll('.es-abas [data-v]').forEach(b => b.onclick = () => { visao = b.dataset.v; limite = 100; try{ localStorage.setItem('estrutura_visao', visao); }catch(e){} render(); });
  tela.querySelector('#esFiltro').onchange = e => { filtroAmb = e.target.value; limite = 100; render(); };
  tela.querySelectorAll('#esAcoes [data-a]').forEach(b => b.onclick = () => ({ nova: () => formUnidade(null, null, true), importar: importarPlanilha, modelo: baixarModelo, exportar })[b.dataset.a]());
  function filhosMapa(){
    const us = unidades(), cods = new Set(us.map(u => u.code)), m = new Map();
    us.forEach(u => { const p = u.parent_code && cods.has(u.parent_code) ? u.parent_code : ''; if(!m.has(p)) m.set(p, []); m.get(p).push(u); });
    m.forEach(l => l.sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR', { numeric:true })));
    return m;
  }
  function render(){
    if(!$('esArvore')) return;
    const us = unidades(), ed = podeEditar();
    const comAmb = new Set(LOCAIS.filter(l => l.ativo !== false).map(l => l.unidade_code));
    const nAmb = LOCAIS.filter(l => l.ativo !== false && us.some(u => u.code === l.unidade_code)).length;
    $('esResumo').innerHTML = `
      <div class="lv-kpi"><b>${us.length}</b><span>unidades</span></div>
      <div class="lv-kpi"><b>${nAmb}</b><span>ambientes cadastrados</span></div>
      <div class="lv-kpi"><b>${us.filter(u => comAmb.has(u.code)).length}</b><span>unidades com ambientes</span></div>`;
    const avisos = [];
    if(!us.length) avisos.push(ed
      ? '<b>A organização ainda não tem estrutura.</b> Cadastre as unidades (uma a uma, ou importando a planilha) e depois os ambientes de cada unidade. Sem a estrutura não é possível iniciar levantamentos.'
      : '<b>A organização ainda não tem estrutura cadastrada.</b> Peça à gestão patrimonial (gestor ou administrador) para cadastrar as unidades e os ambientes.');
    else if(!ed) avisos.push('Você entrou como <b>' + esc(quemSou()) + '</b>' + (org().papel ? ', com o papel <b>' + esc(org().papel) + '</b>' : '') + '. Você pode consultar e exportar a estrutura; cadastrar, importar e alterar é só para <b>gestor</b> ou <b>administrador</b> (o administrador muda o papel no painel de gestão, em Administração → Membros).');
    if(semTabela && ed) avisos.push('O cadastro de ambientes por unidade ainda não foi ativado no banco: rode a <b>migração 05</b> no Supabase. As unidades já podem ser cadastradas.');
    if(ed && !navigator.onLine) avisos.push('Sem internet: a estrutura pode ser consultada, mas só é alterada com o aparelho conectado.');
    $('esAviso').innerHTML = avisos.map(t => `<div class="es-aviso">${t}</div>`).join('');
    tela.querySelectorAll('#esAcoes [data-a="nova"],#esAcoes [data-a="importar"]').forEach(b => { b.style.opacity = ed ? '' : '.55'; b.title = ed ? '' : 'Só gestor ou administrador'; });
    tela.querySelectorAll('.es-abas [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === visao));
    const m = filhosMapa();
    let html = '';
    if(visao === 'lista'){ $('esArvore').innerHTML = listaHtml(us, m, ed); ligarLista(); return; }
    if(filtro.length >= 2){
      // busca: unidades e ambientes que batem, com o caminho
      const q = norm(filtro);
      const achou = us.filter(u => norm(u.name).includes(q) || norm(u.code).includes(q) || locaisDe(u.code).some(l => norm(l.nome).includes(q))).slice(0, 150);
      html = achou.length ? achou.map(u => noHtml(u, m, ed, true, q)).join('') : '<div class="lv-vazio">Nada encontrado.</div>';
    } else {
      const raizes = m.get('') || [];
      html = raizes.length ? raizes.map(u => noHtml(u, m, ed, false, '')).join('') : '';
    }
    $('esArvore').innerHTML = html;
    ligar();
  }
  // visão em lista: todas as unidades cadastradas, com superior e ambientes
  function listaHtml(us, m, ed){
    const q = norm(filtro);
    let lst = us.slice().sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR', { numeric:true }));
    if(q.length >= 1) lst = lst.filter(u => norm(u.name).includes(q) || norm(u.code).includes(q) || locaisDe(u.code).some(l => norm(l.nome).includes(q)));
    if(filtroAmb) lst = lst.filter(u => filtroAmb === 'com' ? locaisDe(u.code).length : !locaisDe(u.code).length);
    if(!us.length) return '<div class="lv-vazio">Nenhuma unidade cadastrada ainda. Use <b>＋ Cadastrar unidade</b> ou <b>⇪ Importar estrutura</b>.</div>';
    if(!lst.length) return '<div class="lv-vazio">Nada encontrado.</div>';
    const porCod = new Map(us.map(u => [u.code, u]));
    const linhas = lst.slice(0, limite).map(u => {
      const sup = u.parent_code && porCod.get(u.parent_code), ambs = locaisDe(u.code), subs = (m.get(u.code) || []).length;
      return `<tr data-un="${esc(u.code)}"><td><code>${marca(u.code, q)}</code></td><td><b>${marca(u.name, q)}</b>${subs ? '<small>' + subs + ' subunidade(s)</small>' : ''}</td>
        <td>${sup ? esc(sup.name) + '<small>' + esc(sup.code) + '</small>' : '<small>— topo —</small>'}</td>
        <td>${ambs.length ? '<b style="color:var(--verde,#1A4731)">' + ambs.length + '</b><small>' + ambs.slice(0, 3).map(l => esc(l.nome)).join(', ') + (ambs.length > 3 ? '…' : '') + '</small>' : '<span style="color:#B5651D">nenhum</span>'}</td></tr>`;
    }).join('');
    return `<p class="lv-sub" style="margin:0 0 8px">${lst.length} unidade(s)${lst.length > limite ? ' — mostrando ' + limite : ''}. Toque numa unidade para ver os ambientes${ed ? ' e editar' : ''}.</p>
      <div style="overflow-x:auto"><table class="es-tab"><thead><tr><th>Código</th><th>Unidade</th><th>Superior</th><th>Ambientes</th></tr></thead><tbody>${linhas}</tbody></table></div>
      ${lst.length > limite ? '<button class="lv-btn es-mais" type="button" id="esMais">Mostrar mais ' + Math.min(100, lst.length - limite) + '</button>' : ''}`;
  }
  function ligarLista(){
    const arv = $('esArvore');
    arv.querySelectorAll('tr[data-un]').forEach(tr => tr.onclick = () => abrirUnidadeNaArvore(tr.dataset.un));
    const mais = $('esMais'); if(mais) mais.onclick = () => { limite += 100; render(); };
  }
  function abrirUnidadeNaArvore(code){
    let c = code; while(c){ ABERTOS.add(c); const u = unPorCodigo(c); c = u && u.parent_code; }
    visao = 'arvore'; filtro = ''; const b = $('esBusca'); if(b) b.value = '';
    render();
    setTimeout(() => { const el = document.querySelector('#esArvore [data-un="' + (window.CSS && CSS.escape ? CSS.escape(code) : code) + '"]'); if(el){ el.scrollIntoView({ block:'center' }); el.style.outline = '2px solid var(--verde,#1A4731)'; } }, 50);
  }
  function marca(txt, q){
    const t = esc(txt); if(!q) return t;
    const i = norm(txt).indexOf(q); if(i < 0) return t;
    return esc(String(txt).slice(0, i)) + '<span class="es-marca">' + esc(String(txt).slice(i, i + q.length)) + '</span>' + esc(String(txt).slice(i + q.length));
  }
  function noHtml(u, m, ed, plano, q){
    const filhos = m.get(u.code) || [], ambs = locaisDe(u.code), aberto = plano || ABERTOS.has(u.code);
    let h = `<div class="es-un" data-un="${esc(u.code)}"><span class="tg">${(filhos.length || ambs.length || ed) ? (aberto ? '▾' : '▸') : '·'}</span>
      <span class="nm">${marca(u.name, q)}<small>${esc(u.code)}${plano && u.path ? ' · ' + esc(u.path) : ''}</small></span>
      <span class="es-cont">${filhos.length ? filhos.length + ' sub' + (ambs.length ? ' · ' : '') : ''}${ambs.length ? '<b>' + ambs.length + ' amb.</b>' : (filhos.length ? '' : '<span class="zero">sem ambientes</span>')}</span></div>`;
    if(aberto){
      h += '<div class="es-no">';
      h += ambs.filter(l => !q || !plano || norm(l.nome).includes(q) || norm(u.name).includes(q) || norm(u.code).includes(q)).map(l =>
        `<div class="es-amb" data-loc="${esc(l.id)}"><span>🚪</span><span class="nm">${marca(l.nome, q)}${descLocal(l) ? '<small>' + esc(descLocal(l)) + '</small>' : ''}</span>
          ${ed ? '<button type="button" data-ed-loc title="Editar ambiente">✎</button><button type="button" data-rm-loc title="Desativar ambiente">🗑</button>' : ''}</div>`).join('');
      if(ed) h += `<div class="es-acoes-un"><button class="lv-btn" type="button" data-novo-amb="${esc(u.code)}">＋ Ambientes</button>
        <button class="lv-btn" type="button" data-nova-sub="${esc(u.code)}">＋ Subunidade</button>
        <button class="lv-btn" type="button" data-ed-un="${esc(u.code)}">✎ Unidade</button></div>`;
      if(!plano) h += filhos.map(f => noHtml(f, m, ed, false, '')).join('');
      h += '</div>';
    }
    return h;
  }
  const unPorCodigo = c => unidades().find(u => u.code === c);
  function ligar(){
    const arv = $('esArvore');
    arv.querySelectorAll('.es-un').forEach(el => el.onclick = () => { const c = el.dataset.un; if(ABERTOS.has(c)) ABERTOS.delete(c); else ABERTOS.add(c); if(filtro.length < 2) render(); });
    arv.querySelectorAll('[data-novo-amb]').forEach(b => b.onclick = () => formAmbientes(unPorCodigo(b.dataset.novoAmb)));
    arv.querySelectorAll('[data-nova-sub]').forEach(b => b.onclick = () => formUnidade(null, unPorCodigo(b.dataset.novaSub)));
    arv.querySelectorAll('[data-ed-un]').forEach(b => b.onclick = () => formUnidade(unPorCodigo(b.dataset.edUn), null));
    arv.querySelectorAll('[data-ed-loc]').forEach(b => b.onclick = () => formAmbiente(LOCAIS.find(l => l.id === b.closest('[data-loc]').dataset.loc)));
    arv.querySelectorAll('[data-rm-loc]').forEach(b => b.onclick = async () => {
      const l = LOCAIS.find(x => x.id === b.closest('[data-loc]').dataset.loc); if(!l || !exigirNuvem()) return;
      if(!confirm('Desativar o ambiente "' + l.nome + '"? Ele deixa de aparecer nos próximos levantamentos (os levantamentos já feitos não mudam).')) return;
      try{ await alterarLocal(l, { ativo:false }); render(); }catch(e){ alert('Não foi possível desativar: ' + e.message); }
    });
  }
  $('esBusca') && ($('esBusca').oninput = e => { filtro = e.target.value.trim(); limite = 100; render(); });

  /* ---------------- formulários ---------------- */
  function proximoCodigo(pai){
    const irmaos = unidades().filter(u => (u.parent_code || '') === (pai ? pai.code : '') || (!pai && !u.parent_code));
    const pref = pai ? pai.code + '.' : '';
    let n = 1; const usados = new Set(unidades().map(u => u.code));
    irmaos.forEach(u => { const s = String(u.code).slice(pref.length); if(/^\d+$/.test(s)) n = Math.max(n, +s + 1); });
    let c; do{ c = pref + String(n++).padStart(2, '0'); } while(usados.has(c));
    return c;
  }
  function formUnidade(u, pai, escolherSuperior){
    if(!exigirNuvem()) return;
    const novo = !u;
    const superior = novo ? pai : unPorCodigo(u.parent_code);
    const rotulo = x => x.code + ' · ' + x.name;
    ui().abrirModal(novo ? (pai ? 'Nova subunidade' : 'Nova unidade principal') : 'Editar unidade', `
      ${escolherSuperior ? `<div class="ctl-campo"><label>Unidade superior (deixe vazio para o topo da hierarquia)</label>
          <input id="euSup" list="euSupLista" placeholder="Digite o nome ou o código da unidade de cima…" autocomplete="off">
          <datalist id="euSupLista">${unidades().map(x => `<option value="${esc(rotulo(x))}">`).join('')}</datalist></div>`
        : superior ? `<div class="lv-info"><b>Unidade superior</b> ${esc(superior.name)} <small>(${esc(superior.code)})</small></div>` : (novo ? '<p class="ctl-dica">Unidade do topo da hierarquia (ex.: Reitoria, Secretaria, Diretoria, Matriz).</p>' : '')}
      <div class="ctl-campo"><label>Nome da unidade *</label><input id="euNome" maxlength="200" value="${esc(u ? u.name : '')}" placeholder="Ex.: Departamento de Patrimônio"></div>
      <div class="ctl-campo"><label>Código ${novo ? '*' : '(não muda)'}</label><input id="euCod" maxlength="60" value="${esc(u ? u.code : proximoCodigo(pai))}" ${novo ? '' : 'disabled'}>
        <div class="ctl-dica">${novo ? 'Sugestão automática. Pode usar o código do seu sistema (SIPAC, SIADS, TOTVS…).' : ''}</div></div>
      ${!novo ? `<div class="ctl-campo"><label>Mover para baixo de</label><select id="euPai"><option value="">— topo da hierarquia —</option>${unidades().filter(x => x.code !== u.code && !String(x.code).startsWith(u.code + '.'))
          .map(x => `<option value="${esc(x.code)}"${x.code === u.parent_code ? ' selected' : ''}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></div>` : ''}
      <button class="btn btn-primary btn-full" id="euOk" type="button">${novo ? 'Cadastrar unidade' : 'Salvar'}</button>
      ${!novo ? '<button class="btn btn-secondary btn-full" id="euDesat" type="button" style="margin-top:8px">Desativar unidade</button>' : ''}
      <div class="ctl-dica" id="euMsg"></div>`);
    let paiEscolhido = pai;
    if(escolherSuperior) $('euSup').oninput = () => {
      const v = $('euSup').value.trim(), achado = unidades().find(x => rotulo(x) === v) || unidades().find(x => x.code === v);
      paiEscolhido = achado || null;
      if(achado || !v) $('euCod').value = proximoCodigo(paiEscolhido);
    };
    $('euOk').onclick = async () => {
      const nome = $('euNome').value.trim(), cod = $('euCod').value.trim(), msg = $('euMsg');
      if(escolherSuperior && $('euSup').value.trim() && !paiEscolhido){ msg.textContent = 'Escolha a unidade superior na lista (ou deixe vazio).'; return; }
      pai = paiEscolhido;
      if(nome.length < 2){ msg.textContent = 'Informe o nome da unidade.'; return; }
      if(novo && !cod){ msg.textContent = 'Informe o código.'; return; }
      if(novo && unPorCodigo(cod)){ msg.textContent = 'Já existe uma unidade com o código ' + cod + '.'; return; }
      msg.textContent = 'Gravando…'; $('euOk').disabled = true;
      try{
        const dado = { code: novo ? cod : u.code, name: nome, parent_code: novo ? (pai ? pai.code : null) : ($('euPai').value || null) };
        await gravarUnidade(dado, novo);
        if(dado.parent_code) ABERTOS.add(dado.parent_code); ABERTOS.add(dado.code);
        ui().fecharModal(); render();
        if(novo && !semTabela && confirm('Unidade cadastrada. Cadastrar agora os ambientes dela (salas, laboratórios…)?')) formAmbientes(unPorCodigo(dado.code));
      }catch(e){ msg.textContent = 'Não foi possível gravar: ' + e.message; $('euOk').disabled = false; }
    };
    if(!novo) $('euDesat').onclick = async () => {
      const subs = unidades().filter(x => x.parent_code === u.code), ambs = locaisDe(u.code);
      if(subs.length){ alert('Esta unidade tem ' + subs.length + ' subunidade(s). Mova ou desative as subunidades antes.'); return; }
      if(!confirm('Desativar a unidade "' + u.name + '"' + (ambs.length ? ' e seus ' + ambs.length + ' ambientes' : '') + '? Os levantamentos já feitos não mudam.')) return;
      try{ if(ambs.length && !semTabela) for(const l of ambs) await alterarLocal(l, { ativo:false }); await desativarUnidade(u); ui().fecharModal(); render(); }
      catch(e){ $('euMsg').textContent = 'Não foi possível desativar: ' + e.message; }
    };
  }
  const opcoesTipo = sel => '<option value="">—</option>' + TIPOS_AMB.map(t => `<option${t === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
  // um ou vários ambientes de uma vez
  function formAmbientes(u, aoTerminar){
    if(!u || !exigirNuvem()) return;
    if(semTabela){ alert('O cadastro de ambientes ainda não foi ativado no banco. Rode a migração 05 no Supabase.'); return; }
    const ja = locaisDe(u.code);
    ui().abrirModal('Ambientes da unidade', `
      <div class="lv-info"><b>Unidade</b> ${esc(u.name)} <small>(${esc(u.code)})</small>${ja.length ? '<br><b>Já cadastrados</b> ' + ja.length + ': ' + ja.slice(0, 8).map(l => esc(l.nome)).join(', ') + (ja.length > 8 ? '…' : '') : ''}</div>
      <div class="ctl-campo"><label>Ambientes — um por linha *</label>
        <textarea id="eaLista" rows="6" placeholder="Sala 101; Térreo; Bloco A; Sala&#10;Laboratório de Química; 1º andar&#10;Almoxarifado"></textarea>
        <div class="ctl-dica">Em cada linha: <b>nome</b> e, se quiser, separados por ponto e vírgula: <b>andar</b>; <b>bloco</b>; <b>tipo</b>. Nomes repetidos atualizam o que já existe.</div></div>
      <div class="ctl-campo"><label>Tipo padrão (para as linhas sem tipo)</label><select id="eaTipo">${opcoesTipo('')}</select></div>
      <button class="btn btn-primary btn-full" id="eaOk" type="button">Cadastrar ambientes</button><div class="ctl-dica" id="eaMsg"></div>`);
    $('eaOk').onclick = async () => {
      const tipoPad = $('eaTipo').value, msg = $('eaMsg');
      const linhas = $('eaLista').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => {
        const p = s.split(/\s*;\s*/); return { unidade_code: u.code, nome: p[0], andar: p[1] || '', bloco: p[2] || '', tipo: p[3] || tipoPad || '' };
      }).filter(l => l.nome);
      if(!linhas.length){ msg.textContent = 'Escreva ao menos um ambiente.'; return; }
      const vistos = new Set(), unicos = linhas.filter(l => { const k = norm(l.nome); if(vistos.has(k)) return false; vistos.add(k); return true; });
      msg.textContent = 'Gravando ' + unicos.length + '…'; $('eaOk').disabled = true;
      try{ await gravarLocais(unicos); ABERTOS.add(u.code); ui().fecharModal(); render(); if(aoTerminar) aoTerminar(); }
      catch(e){ msg.textContent = 'Não foi possível gravar: ' + e.message; $('eaOk').disabled = false; }
    };
  }
  function formAmbiente(l){
    if(!l || !exigirNuvem()) return;
    const u = unPorCodigo(l.unidade_code);
    ui().abrirModal('Editar ambiente', `
      <div class="lv-info"><b>Unidade</b> ${esc(u ? u.name : l.unidade_code)}</div>
      <div class="ctl-campo"><label>Nome *</label><input id="elNome" value="${esc(l.nome)}" maxlength="200"></div>
      <div style="display:flex;gap:8px"><div class="ctl-campo" style="flex:1"><label>Andar</label><input id="elAndar" value="${esc(l.andar || '')}"></div>
        <div class="ctl-campo" style="flex:1"><label>Bloco</label><input id="elBloco" value="${esc(l.bloco || '')}"></div></div>
      <div style="display:flex;gap:8px"><div class="ctl-campo" style="flex:1"><label>Tipo</label><select id="elTipo">${opcoesTipo(l.tipo || '')}</select></div>
        <div class="ctl-campo" style="flex:1"><label>Código (opcional)</label><input id="elCod" value="${esc(l.codigo || '')}"></div></div>
      <div class="ctl-campo"><label>Responsável (opcional)</label><input id="elResp" value="${esc(l.responsavel || '')}"></div>
      <button class="btn btn-primary btn-full" id="elOk" type="button">Salvar</button><div class="ctl-dica" id="elMsg"></div>`);
    $('elOk').onclick = async () => {
      const nome = $('elNome').value.trim(); if(!nome){ $('elMsg').textContent = 'Informe o nome.'; return; }
      try{ await alterarLocal(l, { nome, andar: $('elAndar').value.trim() || null, bloco: $('elBloco').value.trim() || null, tipo: $('elTipo').value || null,
        codigo: $('elCod').value.trim() || null, responsavel: $('elResp').value.trim() || null }); ui().fecharModal(); render(); }
      catch(e){ $('elMsg').textContent = /duplicate|23505|locais_unico/i.test(e.message) ? 'Já existe um ambiente com esse nome nesta unidade.' : 'Não foi possível salvar: ' + e.message; }
    };
  }

  /* ---------------- planilha ---------------- */
  const COLS = {
    codigo:   ['codigo da unidade','cod unidade','codigo unidade','codigo','code','cod','id unidade','codigo uorg','uorg'],
    unidade:  ['unidade','nome da unidade','nome unidade','unidade organizacional','setor','departamento','lotacao','name','nome'],
    superior: ['codigo superior','cod superior','superior','unidade superior','codigo da unidade superior','parent','parent_code','pai','vinculada a','subordinada a'],
    ambiente: ['ambiente','nome do ambiente','sala','local','localizacao','localidade','dependencia','espaco'],
    andar:    ['andar','pavimento','piso'],
    bloco:    ['bloco','predio','edificio'],
    tipo:     ['tipo','tipo do ambiente','tipo de ambiente','finalidade do ambiente'],
    responsavel: ['responsavel','responsavel pelo ambiente','chefe']
  };
  function acharColunas(cab){
    const n = cab.map(norm), r = {};
    Object.keys(COLS).forEach(k => { for(const nome of COLS[k]){ const i = n.indexOf(nome); if(i >= 0 && !Object.values(r).includes(cab[i])){ r[k] = cab[i]; break; } } });
    // "nome" só vale para unidade quando não há outra coluna de unidade
    return r;
  }
  function importarPlanilha(){
    if(!exigirNuvem()) return;
    ui().abrirModal('Importar estrutura (planilha)', `
      <p class="ctl-dica">Uma linha por <b>unidade</b> ou por <b>ambiente</b>. Colunas reconhecidas: <b>Código da unidade</b>, <b>Unidade</b>, <b>Código superior</b>, <b>Ambiente</b>, <b>Andar</b>, <b>Bloco</b>, <b>Tipo</b>, <b>Responsável</b>.
      Sem "Código superior", a hierarquia é deduzida pelos pontos do código (ex.: 02.01 fica dentro de 02). Unidades e ambientes que já existem são atualizados.</p>
      <div class="ctl-campo"><label>Arquivo (.xlsx, .xls, .ods ou .csv)</label><input type="file" id="eiArq" accept=".xlsx,.xls,.ods,.csv"></div>
      <div id="eiPrevia"></div><div class="ctl-dica" id="eiMsg"></div>`);
    $('eiArq').onchange = async e => {
      const arq = e.target.files[0]; if(!arq) return;
      const msg = $('eiMsg'); msg.textContent = 'Lendo…';
      try{
        const f = await ui().lerArquivo(arq), linhas = f.ler(f.abas[0]);
        if(!linhas.length){ msg.textContent = 'A planilha está vazia.'; return; }
        const c = acharColunas(Object.keys(linhas[0]));
        if(!c.codigo && !c.unidade){ msg.textContent = 'Não achei a coluna de unidade (código ou nome). Use a planilha modelo.'; return; }
        const val = (l, k) => c[k] ? String(l[c[k]] == null ? '' : l[c[k]]).trim() : '';
        const existentes = unidades(), porNome = new Map(existentes.map(u => [norm(u.name), u])), porCod = new Map(existentes.map(u => [u.code, u]));
        const novasUn = new Map(), ambs = [], erros = [];
        linhas.forEach((l, i) => {
          let cod = val(l, 'codigo'); const nome = val(l, 'unidade');
          if(!cod && nome){ const u = porNome.get(norm(nome)) || [...novasUn.values()].find(x => norm(x.name) === norm(nome)); if(u) cod = u.code; }
          if(!cod){ if(nome || val(l, 'ambiente')) erros.push('linha ' + (i + 2) + ': unidade sem código e não encontrada pelo nome'); return; }
          if(nome && (!porCod.has(cod) || norm(porCod.get(cod).name) !== norm(nome) || val(l, 'superior'))){
            let pai = val(l, 'superior') || null;
            if(!pai && cod.includes('.')) pai = cod.split('.').slice(0, -1).join('.');
            if(!pai && porCod.has(cod)) pai = porCod.get(cod).parent_code || null;
            novasUn.set(cod, { code: cod, name: nome, parent_code: pai });
          }
          const amb = val(l, 'ambiente');
          if(amb) ambs.push({ unidade_code: cod, nome: amb, andar: val(l, 'andar'), bloco: val(l, 'bloco'), tipo: val(l, 'tipo'), responsavel: val(l, 'responsavel') });
        });
        const ambUnicos = [...new Map(ambs.map(a => [a.unidade_code + '|' + norm(a.nome), a])).values()];
        const semUn = ambUnicos.filter(a => !porCod.has(a.unidade_code) && !novasUn.has(a.unidade_code));
        semUn.forEach(a => erros.push('ambiente "' + a.nome + '": unidade ' + a.unidade_code + ' não existe e não tem nome na planilha'));
        const ambOk = ambUnicos.filter(a => !semUn.includes(a));
        msg.textContent = '';
        $('eiPrevia').innerHTML = `<div class="lv-info"><b>${novasUn.size}</b> unidades a cadastrar ou atualizar<br><b>${ambOk.length}</b> ambientes a cadastrar ou atualizar
          ${semTabela && ambOk.length ? '<br><span style="color:#B5651D">Os ambientes ficam de fora: rode a migração 05 no Supabase.</span>' : ''}
          ${erros.length ? '<br><span style="color:#C0392B">' + erros.length + ' linha(s) ignorada(s): ' + esc(erros.slice(0, 4).join('; ')) + (erros.length > 4 ? '…' : '') + '</span>' : ''}</div>
          <button class="btn btn-primary btn-full" id="eiOk" type="button">Importar</button>`;
        $('eiOk').onclick = async () => {
          $('eiOk').disabled = true; msg.textContent = 'Gravando…';
          try{
            const un = [...novasUn.values()];
            for(let i = 0; i < un.length; i += 500)
              await ui().nuvem('/rest/v1/unidades?on_conflict=org_id,code', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify(un.slice(i, i + 500).map(u => ({ org_id: org().id, code: u.code, name: u.name, parent_code: u.parent_code, ativo: true }))) });
            const lista = existentes.filter(u => !novasUn.has(u.code)).concat(un);
            salvarUnidadesLocal(lista);
            if(ambOk.length && !semTabela) for(let i = 0; i < ambOk.length; i += 500) await gravarLocais(ambOk.slice(i, i + 500));
            ui().fecharModal(); render();
            alert('Estrutura importada: ' + un.length + ' unidades e ' + (semTabela ? 0 : ambOk.length) + ' ambientes.');
          }catch(err){ msg.textContent = 'Falha ao importar: ' + err.message; $('eiOk').disabled = false; }
        };
      }catch(err){ msg.textContent = 'Não foi possível ler o arquivo: ' + err.message; }
    };
  }
  function baixarModelo(){
    ui().baixarPlanilha('modelo-estrutura-organizacional', [{ nome:'Estrutura', linhas:[
      { 'Código da unidade':'01', 'Unidade':'SECRETARIA DE ADMINISTRAÇÃO', 'Código superior':'', 'Ambiente':'', 'Andar':'', 'Bloco':'', 'Tipo':'', 'Responsável':'' },
      { 'Código da unidade':'01.01', 'Unidade':'DEPARTAMENTO DE PATRIMÔNIO', 'Código superior':'01', 'Ambiente':'Sala 101', 'Andar':'Térreo', 'Bloco':'A', 'Tipo':'Sala', 'Responsável':'Maria Silva' },
      { 'Código da unidade':'01.01', 'Unidade':'DEPARTAMENTO DE PATRIMÔNIO', 'Código superior':'01', 'Ambiente':'Almoxarifado', 'Andar':'Térreo', 'Bloco':'A', 'Tipo':'Depósito / almoxarifado', 'Responsável':'' },
      { 'Código da unidade':'01.02', 'Unidade':'DEPARTAMENTO DE COMPRAS', 'Código superior':'01', 'Ambiente':'Sala 201', 'Andar':'1º andar', 'Bloco':'A', 'Tipo':'Sala', 'Responsável':'' }
    ] }, { nome:'Como preencher', linhas:[
      { 'Coluna':'Código da unidade', 'O que é':'Código da unidade no seu sistema (ou um código seu, ex.: 01, 01.01). Obrigatório.' },
      { 'Coluna':'Unidade', 'O que é':'Nome da unidade (secretaria, diretoria, departamento, setor…).' },
      { 'Coluna':'Código superior', 'O que é':'Código da unidade de cima. Se ficar vazio, é deduzido pelos pontos do código.' },
      { 'Coluna':'Ambiente', 'O que é':'Sala, laboratório, depósito… da unidade. Uma linha por ambiente; repita a unidade em cada linha.' },
      { 'Coluna':'Andar / Bloco / Tipo / Responsável', 'O que é':'Opcionais. Ajudam a achar o ambiente em campo e a montar a planta.' }
    ] }]);
  }
  function exportar(){
    const us = unidades(), linhas = [];
    us.slice().sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR', { numeric:true })).forEach(u => {
      const ambs = locaisDe(u.code), base = { 'Código da unidade': u.code, 'Unidade': u.name, 'Código superior': u.parent_code || '', 'Caminho': u.path || '' };
      if(!ambs.length) linhas.push(Object.assign({}, base, { 'Ambiente':'', 'Andar':'', 'Bloco':'', 'Tipo':'', 'Responsável':'' }));
      ambs.forEach(l => linhas.push(Object.assign({}, base, { 'Ambiente': l.nome, 'Andar': l.andar || '', 'Bloco': l.bloco || '', 'Tipo': l.tipo || '', 'Responsável': l.responsavel || '' })));
    });
    ui().baixarPlanilha('estrutura-' + (org().sigla || 'organizacao').toLowerCase(), [{ nome:'Estrutura', linhas }]);
  }

  /* ---------------- seletor usado ao criar ambiente em campo ---------------- */
  // mostra os ambientes cadastrados da unidade; ao tocar, devolve o escolhido
  function montarSeletor(caixa, unidade, jaUsados, aoEscolher, selecionado){
    if(!caixa) return;
    if(!unidade){ caixa.innerHTML = ''; return; }
    const usados = new Set((jaUsados || []).map(norm));
    const ls = locaisDe(unidade.code);
    if(!ls.length){
      caixa.innerHTML = `<p class="field-hint" style="margin-top:8px">${semTabela ? '' : 'Esta unidade ainda não tem ambientes cadastrados na estrutura.'}${podeEditar() && !semTabela ? ' O ambiente que você criar aqui é cadastrado nela também.' : (!semTabela ? ' A gestão patrimonial pode cadastrá-los em "Estrutura organizacional".' : '')}</p>`;
      return;
    }
    caixa.innerHTML = `<p class="field-hint" style="margin:10px 0 0">Ambientes cadastrados desta unidade — toque para usar:</p><div class="es-sel">${ls.map(l =>
      `<button type="button" data-id="${esc(l.id)}" class="${l.id === selecionado ? 'on' : ''}"${usados.has(norm(l.nome)) && l.id !== selecionado ? ' disabled style="opacity:.45"' : ''}>${esc(l.nome)}${l.andar ? '<small>' + esc(l.andar) + '</small>' : ''}</button>`).join('')}</div>`;
    caixa.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { const l = LOCAIS.find(x => x.id === b.dataset.id); if(l) aoEscolher(l); });
  }

  /* ---------------- abrir ---------------- */
  async function abrir(codigoUnidade){
    if(codigoUnidade){
      let c = codigoUnidade; while(c){ ABERTOS.add(c); const u = unPorCodigo(c); c = u && u.parent_code; }
    }
    if(window.LEV && LEV.irPara) await LEV.irPara('estrutura');
    else { A().esconderTelas(); tela.style.display = 'block'; render(); await carregar(); render(); }
  }
  window.addEventListener('online', () => { if(tela.style.display === 'block') carregar().then(render); });

  window.ESTRUTURA = {
    abrir, carregar, render, locaisDe, descLocal, podeEditar, montarSeletor, cadastrarRapido, formAmbientes,
    temUnidades: () => unidades().length > 0,
    get semTabela(){ return semTabela; },
    gravarLocais
  };
  // carrega já no início (cache do aparelho e, com internet, a nuvem)
  lerCache();
  setTimeout(() => { carregar().catch(() => {}); }, 1500);
})();
