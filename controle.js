/* =====================================================================
   CONCILIAÇÃO E CONTROLE
   - importar a base oficial (Excel ou CSV) indicando o que é cada coluna
   - conciliação físico × cadastro: conferidos, em outro local, não
     localizados, sem registro, sem plaqueta, plaqueta repetida
   - transferência de bens entre ambientes, com aceite assinado
   - termo de responsabilidade por ambiente ou por unidade, assinado na tela
   - histórico (trilha de auditoria) de cada bem e geral
   Usa a ponte window.APP criada pelo index.html.
   ===================================================================== */
(function(){
  'use strict';
  const A = () => window.APP;
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const org = () => window.ORG || {};
  const nomeOrg = () => org().nome || '';
  const rotMatricula = () => org().rotulo_matricula || 'Matrícula';
  const produto = () => (window.PRODUTO && window.PRODUTO.nome) || 'Levantamento Patrimonial';
  const dataHora = iso => { if(!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }); };
  const dinheiro = v => (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }) : '';
  const unidadeDe = a => { const u = a && a.units && a.units[0]; return u ? { code: u.code || String(u), name: u.name || u.code || String(u) } : null; };
  const CONS = { bom:'Bom', regular:'Regular', ruim:'Ruim', inservivel:'Inservível' };

  // ---------------- bibliotecas sob demanda ----------------
  function carregarScript(src){
    return new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => falha(new Error('Não foi possível baixar um componente (sem internet?).'));
      document.head.appendChild(s);
    });
  }
  async function planilhas(){
    if(!window.XLSX) await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    return window.XLSX;
  }

  // ---------------- dados guardados no aparelho ----------------
  const ESTADO = { termos: [], transferencias: [], encerramentos: [] };
  const chave = nome => nome + ':' + (org().id || 'legado');
  async function carregarEstado(){
    try{
      ESTADO.termos = (await A().meta.ler(chave('termos'))) || [];
      ESTADO.transferencias = (await A().meta.ler(chave('transferencias'))) || [];
      ESTADO.encerramentos = (await A().meta.ler(chave('encerramentos'))) || [];
    }catch(e){}
  }
  async function gravar(nome){ await A().meta.gravar(chave(nome), ESTADO[nome]); }

  // ---------------- janela (modal) ----------------
  function abrirModal(titulo, html){
    $('ctlModalTitulo').textContent = titulo;
    $('ctlModalCorpo').innerHTML = html;
    $('ctlModal').style.display = 'flex';
    $('ctlModal').scrollTop = 0;
    return $('ctlModalCorpo');
  }
  function fecharModal(){ $('ctlModal').style.display = 'none'; $('ctlModalCorpo').innerHTML = ''; }
  $('ctlModalFechar').onclick = fecharModal;
  $('ctlModal').addEventListener('click', e => { if(e.target === $('ctlModal')) fecharModal(); });

  // ---------------- assinatura na tela ----------------
  function areaDeAssinatura(caixa, rotulo){
    caixa.className = 'ctl-assin';
    caixa.innerHTML = '<canvas></canvas><div class="linha"></div><div class="rot">' + esc(rotulo) + '</div><button type="button" class="limpar">limpar</button>';
    const cv = caixa.querySelector('canvas'), ctx = cv.getContext('2d');
    let tracou = false, desenhando = false;
    function ajustar(){
      const r = caixa.getBoundingClientRect(), k = window.devicePixelRatio || 1;
      cv.width = Math.max(1, r.width * k); cv.height = Math.max(1, r.height * k);
      ctx.setTransform(k, 0, 0, k, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213d';
    }
    requestAnimationFrame(ajustar);
    const ponto = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => { desenhando = true; cv.setPointerCapture(e.pointerId); const p = ponto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .1, p.y + .1); ctx.stroke(); tracou = true; });
    cv.addEventListener('pointermove', e => { if(!desenhando) return; const p = ponto(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    const parar = () => { desenhando = false; };
    cv.addEventListener('pointerup', parar); cv.addEventListener('pointercancel', parar);
    caixa.querySelector('.limpar').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); tracou = false; };
    return {
      vazia: () => !tracou,
      imagem: () => {
        // reduz para um PNG leve
        const o = document.createElement('canvas'); o.width = 480; o.height = Math.round(480 * cv.height / cv.width);
        const c2 = o.getContext('2d'); c2.drawImage(cv, 0, 0, o.width, o.height);   // fundo transparente: assina por cima da linha
        return o.toDataURL('image/png');
      }
    };
  }

  // ---------------- código de verificação ----------------
  async function codigoVerificacao(obj){
    const txt = JSON.stringify(obj);
    try{
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      return hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12);
    }catch(e){
      let h = 0; for(let i = 0; i < txt.length; i++){ h = (h * 31 + txt.charCodeAt(i)) | 0; }
      return ('00000000' + (h >>> 0).toString(16).toUpperCase()).slice(-8);
    }
  }

  // ---------------- documento para imprimir / salvar em PDF ----------------
  function imprimirDocumento(titulo, corpo){
    const w = window.open('', '_blank');
    if(!w){ alert('O navegador bloqueou a janela do documento. Permita janelas deste site e tente de novo.'); return null; }
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{font-family:Georgia,"Times New Roman",serif;color:#1c1c1a;max-width:820px;margin:24px auto;padding:0 22px;font-size:13.5px;line-height:1.55}' +
      'h1{font-size:17px;text-align:center;letter-spacing:.5px;margin:6px 0 2px}h2{font-size:13px;text-align:center;font-weight:normal;margin:0 0 18px;color:#55534d}' +
      '.org{text-align:center;font-weight:bold;font-size:14px;text-transform:uppercase;letter-spacing:.5px}' +
      'table{width:100%;border-collapse:collapse;margin:12px 0;font-family:Arial,sans-serif;font-size:11.5px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eef2ee}' +
      '.ass{display:flex;gap:30px;margin-top:34px;flex-wrap:wrap}.ass div{flex:1;min-width:220px;text-align:center;font-size:12px}.ass img{height:70px;display:block;margin:0 auto -6px}' +
      '.ass .l{border-top:1px solid #1c1c1a;padding-top:4px}.cod{margin-top:26px;font-family:monospace;font-size:11px;color:#55534d;text-align:center}' +
      '.meta{font-family:Arial,sans-serif;font-size:12px}.meta b{display:inline-block;min-width:150px}' +
      '@media print{body{margin:0}.naoimprime{display:none}}</style></head><body>' +
      '<p class="naoimprime" style="text-align:right;font-family:Arial,sans-serif"><button onclick="print()" style="padding:8px 14px;font-size:14px">Imprimir / salvar em PDF</button></p>' +
      corpo + '</body></html>');
    w.document.close();
    setTimeout(() => { try{ w.focus(); w.print(); }catch(e){} }, 500);
    return w;
  }

  // ---------------- baixar planilha ----------------
  async function baixarPlanilha(nomeArq, abas){
    try{
      const X = await planilhas(), wb = X.utils.book_new();
      abas.forEach(a => X.utils.book_append_sheet(wb, X.utils.json_to_sheet(a.linhas.length ? a.linhas : [{ 'Situação': 'Nenhum registro' }]), a.nome.slice(0, 31)));
      X.writeFile(wb, nomeArq + '.xlsx');
    }catch(e){
      // sem internet: CSV com tudo junto
      const linhas = abas.flatMap(a => a.linhas.map(l => Object.assign({ Categoria: a.nome }, l)));
      const cols = [...new Set(linhas.flatMap(l => Object.keys(l)))];
      const csv = [cols.join(';')].concat(linhas.map(l => cols.map(c => '"' + String(l[c] == null ? '' : l[c]).replace(/"/g, '""') + '"').join(';'))).join('\r\n');
      const b = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8' }), u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = nomeArq + '.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
    }
  }
  const carimbo = () => new Date().toISOString().slice(0, 10);

  /* =================================================================
     0) NUVEM: base oficial compartilhada pela organização
     ================================================================= */
  function sessao(){ try{ return JSON.parse(localStorage.getItem('supa_session') || 'null'); }catch(e){ return null; } }
  async function nuvem(caminho, opts){
    const s = sessao();
    if(!window.__SUPA_URL || !s || !s.access_token) throw new Error('sem login');
    const h = Object.assign({ apikey: window.__SUPA_ANON, Authorization: 'Bearer ' + s.access_token, 'Content-Type':'application/json' }, (opts && opts.headers) || {});
    const r = await fetch(window.__SUPA_URL + caminho, Object.assign({}, opts || {}, { headers: h }));
    if(!r.ok) throw new Error((await r.text()).slice(0, 200));
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  const podeGerirBase = () => !!(org().id && ['gestor','admin'].includes(org().papel) && sessao());
  async function baixarBaseDaNuvem(){
    const o = org(); if(!o.id || !navigator.onLine || !sessao()) return;
    try{
      const ult = await nuvem('/rest/v1/base_oficial?org_id=eq.' + o.id + '&select=atualizado_em&order=atualizado_em.desc&limit=1');
      if(!ult || !ult.length) return;                       // a organização ainda não publicou base
      const marca = ult[0].atualizado_em, chaveMarca = 'baseNuvemEm:' + o.id;
      if((await A().meta.ler(chaveMarca)) === marca && A().base().length) return;
      const todas = [];
      for(let ini = 0; ini < 300000; ini += 1000){
        const parte = await nuvem('/rest/v1/base_oficial?org_id=eq.' + o.id + '&select=plaqueta_key,plaqueta,descricao,localizacao,unidade,responsavel,valor,aquisicao,situacao&order=plaqueta_key&limit=1000&offset=' + ini);
        todas.push(...(parte || [])); if(!parte || parte.length < 1000) break;
      }
      await A().definirBase(todas.map(r => ({ plaqueta: r.plaqueta, plaquetaKey: r.plaqueta_key, descricao: r.descricao || '', localizacao: r.localizacao || '',
        unidade: r.unidade || '', responsavel: r.responsavel || '', valor: r.valor != null ? Number(r.valor) : null, aquisicao: r.aquisicao || '', situacao: r.situacao || '' })));
      await A().meta.gravar(chaveMarca, marca);
    }catch(e){ /* sem a migração 03 ou sem internet: segue com a base do aparelho */ }
  }
  async function publicarBaseNaNuvem(base){
    const o = org(), lote = 1000;
    await nuvem('/rest/v1/rpc/substituir_base_oficial', { method:'POST', body: JSON.stringify({ p_org: o.id, p_linhas: base.slice(0, lote) }) });
    for(let i = lote; i < base.length; i += lote){
      await nuvem('/rest/v1/base_oficial', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(base.slice(i, i + lote).map(r => ({ org_id: o.id, plaqueta_key: r.plaquetaKey, plaqueta: r.plaqueta, descricao: r.descricao, localizacao: r.localizacao,
          unidade: r.unidade, responsavel: r.responsavel, valor: r.valor, aquisicao: r.aquisicao, situacao: r.situacao }))) });
    }
    const ult = await nuvem('/rest/v1/base_oficial?org_id=eq.' + o.id + '&select=atualizado_em&order=atualizado_em.desc&limit=1');
    if(ult && ult.length) await A().meta.gravar('baseNuvemEm:' + o.id, ult[0].atualizado_em);
  }

  /* =================================================================
     1) IMPORTAR A BASE OFICIAL
     ================================================================= */
  const CAMPOS_BASE = [
    { id:'plaqueta',    rot:'Plaqueta / nº de patrimônio', obrig:true, pista:/plaqueta|tomb|patrim|n[ºo°]?\s*(do\s*)?bem|numero|etiqueta|rfid|codigo do bem|^codigo$|^cod$/ },
    { id:'descricao',   rot:'Descrição do bem', pista:/descri|denomina|especifica|nome do bem|^bem$|material|^item$/ },
    { id:'localizacao', rot:'Local / sala', pista:/local|sala|ambiente|endereco|predio|bloco/ },
    { id:'unidade',     rot:'Unidade / setor', pista:/unidade|setor|departamento|lotacao|centro de custo|filial|orgao|divisao/ },
    { id:'responsavel', rot:'Responsável', pista:/responsavel|detentor|carga|guardiao|usuario|servidor/ },
    { id:'valor',       rot:'Valor', pista:/valor|custo|preco|vlr/ },
    { id:'aquisicao',   rot:'Data de aquisição', pista:/aquisi|data de entrada|incorpora|compra|tombamento em/ },
    { id:'situacao',    rot:'Situação no cadastro', pista:/situa|estado|status|conserva/ }
  ];
  function adivinharColunas(cab){
    const usadas = new Set(), mapa = {};
    CAMPOS_BASE.forEach(c => {
      const col = cab.find(h => !usadas.has(h) && c.pista.test(norm(h)));
      if(col){ mapa[c.id] = col; usadas.add(col); }
    });
    return mapa;
  }
  function numeroBR(v){
    if(typeof v === 'number') return v;
    let t = String(v || '').replace(/[^\d,.-]/g, '');
    if(!t) return null;
    if(t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t); return isFinite(n) ? n : null;
  }
  function dataLegivel(v){
    if(v instanceof Date) return v.toLocaleDateString('pt-BR');
    if(typeof v === 'number' && v > 20000 && v < 80000){ const d = new Date(Math.round((v - 25569) * 86400000)); return d.toLocaleDateString('pt-BR', { timeZone:'UTC' }); }
    return String(v || '').trim();
  }
  async function lerArquivo(arquivo){
    const nome = arquivo.name.toLowerCase();
    if(/\.(xlsx|xls|ods)$/.test(nome)){
      const X = await planilhas();
      const wb = X.read(await arquivo.arrayBuffer(), { type:'array', cellDates:true });
      return { abas: wb.SheetNames, ler: aba => X.utils.sheet_to_json(wb.Sheets[aba], { defval:'', raw:true }) };
    }
    if(typeof Papa === 'undefined') throw new Error('O leitor de CSV não carregou (sem internet?).');
    const texto = await arquivo.text();
    const r = Papa.parse(texto, { header:true, skipEmptyLines:true });
    return { abas:['CSV'], ler: () => r.data || [] };
  }
  window.abrirImportacaoBase = function(){
    const corpo = abrirModal('Importar base oficial', `
      <p class="ctl-dica">Use a planilha exportada do <b>${esc(A().sis())}</b> (ou de qualquer controle que a organização tenha). Pode ser Excel (.xlsx, .xls), LibreOffice (.ods) ou CSV. Na próxima etapa você indica o que é cada coluna.</p>
      <div class="ctl-campo"><label>Arquivo</label><input type="file" id="ibArq" accept=".csv,.xlsx,.xls,.ods,text/csv"></div>
      <div id="ibEtapa2"></div>
      <div class="ctl-dica" id="ibMsg"></div>`);
    corpo.querySelector('#ibArq').onchange = async e => {
      const arq = e.target.files[0]; if(!arq) return;
      const msg = $('ibMsg'); msg.textContent = 'Lendo o arquivo…';
      try{
        const doc = await lerArquivo(arq);
        msg.textContent = '';
        montarEtapa2(doc, doc.abas[0]);
      }catch(err){ msg.textContent = 'Não foi possível ler: ' + err.message; }
    };
  };
  function montarEtapa2(doc, aba){
    const linhas = doc.ler(aba).filter(l => Object.values(l).some(v => String(v).trim() !== ''));
    const cab = linhas.length ? Object.keys(linhas[0]) : [];
    const mapa = adivinharColunas(cab);
    const op = sel => '<option value="">— não tem —</option>' + cab.map(h => `<option value="${esc(h)}"${h === sel ? ' selected' : ''}>${esc(h)}</option>`).join('');
    const box = $('ibEtapa2');
    box.innerHTML = `
      ${doc.abas.length > 1 ? `<div class="ctl-campo"><label>Aba da planilha</label><select id="ibAba">${doc.abas.map(a => `<option${a === aba ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>` : ''}
      <p class="ctl-dica"><b>${linhas.length}</b> linhas encontradas. Confira o que é cada coluna (já tentei adivinhar):</p>
      <div class="ctl-mapa">${CAMPOS_BASE.map(c => `<span>${esc(c.rot)}${c.obrig ? ' *' : ''}</span><select data-campo="${c.id}">${op(mapa[c.id])}</select>`).join('')}</div>
      <div class="ctl-previa"><table><tr>${cab.slice(0, 8).map(h => `<th>${esc(h)}</th>`).join('')}</tr>${linhas.slice(0, 4).map(l => `<tr>${cab.slice(0, 8).map(h => `<td>${esc(dataLegivel(l[h]))}</td>`).join('')}</tr>`).join('')}</table></div>
      <p class="ctl-dica">A base atual deste aparelho (${A().base().length} bens) será substituída por esta.</p>
      ${podeGerirBase() ? `<label class="ctl-dica" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="ibNuvem" checked> <span>Publicar para toda a equipe da organização (os aparelhos dos coletores baixam esta base sozinhos)</span></label>` : ''}
      <button class="btn btn-primary btn-full" id="ibOk" type="button">Importar</button>`;
    const sa = $('ibAba'); if(sa) sa.onchange = () => montarEtapa2(doc, sa.value);
    $('ibOk').onclick = async () => {
      const m = {}; box.querySelectorAll('[data-campo]').forEach(s => { if(s.value) m[s.dataset.campo] = s.value; });
      if(!m.plaqueta){ $('ibMsg').textContent = 'Indique qual coluna tem o número da plaqueta.'; return; }
      const vistos = new Set(), base = [];
      linhas.forEach(l => {
        const plaq = String(l[m.plaqueta] == null ? '' : l[m.plaqueta]).trim(); if(!plaq) return;
        const k = A().normPlaq(plaq); if(!k || vistos.has(k)) return; vistos.add(k);
        base.push({
          plaqueta: plaq, plaquetaKey: k,
          descricao: m.descricao ? String(l[m.descricao] || '').trim() : '',
          localizacao: m.localizacao ? String(l[m.localizacao] || '').trim() : '',
          unidade: m.unidade ? String(l[m.unidade] || '').trim() : '',
          responsavel: m.responsavel ? String(l[m.responsavel] || '').trim() : '',
          valor: m.valor ? numeroBR(l[m.valor]) : null,
          aquisicao: m.aquisicao ? dataLegivel(l[m.aquisicao]) : '',
          situacao: m.situacao ? String(l[m.situacao] || '').trim() : ''
        });
      });
      await A().definirBase(base);
      let nuvemMsg = '';
      if($('ibNuvem') && $('ibNuvem').checked){
        $('ibMsg').textContent = 'Publicando para a equipe…';
        try{ await publicarBaseNaNuvem(base); nuvemMsg = '\n\nPublicada para toda a equipe.'; }
        catch(e){ nuvemMsg = '\n\nNão foi possível publicar para a equipe agora (' + e.message.slice(0, 120) + '). A base ficou neste aparelho.'; }
      }
      fecharModal();
      alert(base.length + ' bens importados da base oficial.' + (linhas.length - base.length > 0 ? ' (' + (linhas.length - base.length) + ' linhas sem plaqueta ou repetidas foram ignoradas.)' : '') + nuvemMsg);
      if($('screenControle').style.display === 'block') mostrarAba('conciliacao');
    };
  }

  /* =================================================================
     2) CONCILIAÇÃO FÍSICO × CADASTRO
     ================================================================= */
  function conciliar(){
    const ambs = A().ambientes(), base = A().base(), np = A().normPlaq;
    const porChave = new Map(); base.forEach(r => { if(r.plaquetaKey) porChave.set(r.plaquetaKey, r); });
    const R = { conferidos:[], outroLocal:[], semRegistro:[], semPlaqueta:[], duplicados:[], naoLocalizados:[], pendentes:[] };
    const vistos = new Map();
    ambs.forEach(a => (a.items || []).forEach(i => {
      if(i.status === 'discarded') return;
      const x = { i, a };
      if(i.status !== 'confirmed') R.pendentes.push(x);
      const k = np(i.plaqueta);
      if(!k){ R.semPlaqueta.push(x); return; }
      if(!vistos.has(k)) vistos.set(k, []);
      vistos.get(k).push(x);
      const ref = porChave.get(k);
      if(!ref){ R.semRegistro.push(x); return; }
      x.ref = ref;
      (A().refNoAmbiente(ref, a) ? R.conferidos : R.outroLocal).push(x);
    }));
    vistos.forEach((lst, k) => { if(lst.length > 1) lst.forEach(x => R.duplicados.push(Object.assign({ repete: lst.length }, x))); });
    const unidadesLev = new Set();
    ambs.forEach(a => { const u = unidadeDe(a); if(u){ unidadesLev.add(norm(u.code)); unidadesLev.add(norm(u.name)); } });
    base.forEach(r => {
      if(vistos.has(r.plaquetaKey)) return;
      const noEscopo = ambs.some(a => A().refNoAmbiente(r, a)) || (!!r.unidade && unidadesLev.has(norm(r.unidade)));
      R.naoLocalizados.push({ ref: r, noEscopo });
    });
    return R;
  }
  const CATEGORIAS = [
    { id:'conferidos',     t:'Conferidos',              cls:'ok',     ajuda:'Achados no local em que o cadastro diz que estão.' },
    { id:'outroLocal',     t:'Em outro local',          cls:'alerta', ajuda:'Achados, mas o cadastro aponta outro local ou unidade: regularize a transferência no sistema.' },
    { id:'naoLocalizados', t:'Não localizados',         cls:'erro',   ajuda:'Constam no cadastro e não foram achados em nenhum ambiente levantado.' },
    { id:'semRegistro',    t:'Sem registro na base',    cls:'alerta', ajuda:'Têm plaqueta, mas ela não existe no cadastro: verifique incorporação ou erro de digitação.' },
    { id:'semPlaqueta',    t:'Sem plaqueta',            cls:'alerta', ajuda:'Bens achados sem número de patrimônio: precisam ser emplaquetados ou identificados.' },
    { id:'duplicados',     t:'Plaqueta repetida',       cls:'erro',   ajuda:'O mesmo número foi lançado em mais de um lugar: confira qual é o correto.' },
    { id:'pendentes',      t:'Ainda não confirmados',   cls:'',       ajuda:'Lançados em campo, mas ainda sem confirmação do agente.' }
  ];
  let _cat = 'naoLocalizados', _escopo = 'levantadas', _busca = '', _unidade = '', _limite = 200;

  function linhaDeAchado(x, extra){
    const u = unidadeDe(x.a);
    return `<div class="ctl-linha">
      <span class="p">${esc(x.i.plaqueta || 'sem plaqueta')}</span> · <span class="d">${esc(x.i.description || '(sem descrição)')}</span>
      <div class="m">Achado em: <b>${esc(x.a.name)}</b>${u ? ' · ' + esc(u.name) : ''}${x.i.conservacao ? ' · ' + esc(CONS[x.i.conservacao] || x.i.conservacao) : ''}${x.i.status !== 'confirmed' ? ' · <i>não confirmado</i>' : ''}</div>
      ${x.ref ? `<div class="m">No cadastro: ${esc([x.ref.localizacao, x.ref.unidade].filter(Boolean).join(' · ') || 'sem local informado')}${x.ref.responsavel ? ' · resp.: ' + esc(x.ref.responsavel) : ''}${x.ref.valor != null ? ' · ' + dinheiro(x.ref.valor) : ''}</div>` : ''}
      ${extra || ''}
      <div class="acoes"><button type="button" class="item-extra-btn" data-abrir="${x.a.id}">Abrir ambiente</button></div>
    </div>`;
  }
  function linhaDeBase(n){
    const r = n.ref;
    return `<div class="ctl-linha">
      <span class="p">${esc(r.plaqueta)}</span> · <span class="d">${esc(r.descricao || '(sem descrição no cadastro)')}</span>
      <div class="m">No cadastro: ${esc([r.localizacao, r.unidade].filter(Boolean).join(' · ') || 'sem local informado')}${r.responsavel ? ' · resp.: ' + esc(r.responsavel) : ''}${r.valor != null ? ' · ' + dinheiro(r.valor) : ''}${r.aquisicao ? ' · aquisição ' + esc(r.aquisicao) : ''}</div>
      ${n.noEscopo ? '' : '<div class="m"><i>De local ainda não levantado</i></div>'}
    </div>`;
  }
  function filtrar(lista, cat){
    const q = norm(_busca);
    return lista.filter(x => {
      if(cat === 'naoLocalizados'){
        if(_escopo === 'levantadas' && !x.noEscopo) return false;
        const r = x.ref;
        if(_unidade && norm(r.unidade) !== norm(_unidade) && !(A().ambientes().some(a => { const u = unidadeDe(a); return u && (u.code === _unidade) && A().refNoAmbiente(r, a); }))) return false;
        return !q || norm([r.plaqueta, r.descricao, r.localizacao, r.unidade, r.responsavel].join(' ')).includes(q);
      }
      const u = unidadeDe(x.a);
      if(_unidade && !(u && u.code === _unidade)) return false;
      return !q || norm([x.i.plaqueta, x.i.description, x.a.name, u && u.name, x.ref && x.ref.descricao].join(' ')).includes(q);
    });
  }
  function telaConciliacao(box){
    const R = conciliar(), base = A().base();
    const esperados = R.conferidos.length + R.outroLocal.length + R.naoLocalizados.filter(n => n.noEscopo).length;
    const acuracia = esperados ? Math.round(R.conferidos.length / esperados * 1000) / 10 : null;
    const valorNao = R.naoLocalizados.filter(n => n.noEscopo).reduce((t, n) => t + (typeof n.ref.valor === 'number' ? n.ref.valor : 0), 0);
    const unidades = new Map(); A().ambientes().forEach(a => { const u = unidadeDe(a); if(u) unidades.set(u.code, u.name); });
    const cont = id => id === 'naoLocalizados' ? R.naoLocalizados.filter(n => _escopo === 'tudo' || n.noEscopo).length : R[id].length;
    box.innerHTML = `
      ${base.length ? `<div class="ctl-indice">${acuracia != null ? `Acuracidade do cadastro nos locais levantados: <b>${String(acuracia).replace('.', ',')}%</b><br>` : ''}
        ${R.conferidos.length} conferidos de ${esperados} esperados · base com ${base.length} bens${valorNao ? ` · valor dos não localizados: <b style="font-size:15px;color:var(--danger)">${dinheiro(valorNao)}</b>` : ''}</div>`
        : `<div class="ctl-vazio" style="margin-bottom:14px">Para conciliar, importe a base oficial do <b>${esc(A().sis())}</b> (botão abaixo). Sem ela, dá para ver só bens sem plaqueta, plaquetas repetidas e pendências.<br><br><button class="btn btn-primary btn-sm" type="button" id="ctlImportar">Importar base</button></div>`}
      <div class="ctl-cards">${CATEGORIAS.map(c => `<button type="button" class="ctl-card ${c.cls}${c.id === _cat ? ' on' : ''}" data-cat="${c.id}"><span class="n">${cont(c.id)}</span><span class="t">${c.t}</span></button>`).join('')}</div>
      <p class="ctl-dica">${esc((CATEGORIAS.find(c => c.id === _cat) || {}).ajuda || '')}</p>
      <div class="ctl-barra">
        <input type="search" id="ctlBusca" placeholder="Buscar plaqueta, descrição, local…" value="${esc(_busca)}">
        <select id="ctlUnidade"><option value="">Todas as unidades</option>${[...unidades].map(([c, n]) => `<option value="${esc(c)}"${c === _unidade ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        ${_cat === 'naoLocalizados' ? `<select id="ctlEscopo"><option value="levantadas"${_escopo === 'levantadas' ? ' selected' : ''}>Só dos locais levantados</option><option value="tudo"${_escopo === 'tudo' ? ' selected' : ''}>Toda a base</option></select>` : ''}
      </div>
      <div class="ctl-lista" id="ctlLista"></div>
      <div class="ctl-acoes-fim">
        <button class="btn btn-ghost" type="button" id="ctlExcel">⭳ Baixar planilha (Excel)</button>
        <button class="btn btn-ghost" type="button" id="ctlRelatorio">🖨 Relatório para imprimir / PDF</button>
        ${base.length ? '<button class="btn btn-primary" type="button" id="ctlEncerrar">📜 Termo de encerramento</button>' : ''}
        ${base.length ? '<button class="btn btn-ghost" type="button" id="ctlImportar2">Trocar base oficial</button>' : ''}
      </div>`;
    const lista = filtrar(R[_cat], _cat);
    const alvo = $('ctlLista');
    if(!lista.length) alvo.innerHTML = '<div class="ctl-vazio">Nada nesta categoria' + (_busca || _unidade ? ' com esse filtro' : '') + '.</div>';
    else{
      alvo.innerHTML = lista.slice(0, _limite).map(x => _cat === 'naoLocalizados' ? linhaDeBase(x)
        : linhaDeAchado(x, _cat === 'duplicados' ? `<div class="m"><span class="tag erro">${x.repete}×</span>mesmo número em ${x.repete} lançamentos</div>` : '')).join('') +
        (lista.length > _limite ? `<button type="button" class="btn btn-ghost btn-full" id="ctlMais">Mostrar mais (${lista.length - _limite} restantes)</button>` : '');
    }
    box.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { _cat = b.dataset.cat; _limite = 200; mostrarAba('conciliacao'); });
    const bu = $('ctlBusca'); bu.oninput = () => { _busca = bu.value; clearTimeout(bu._t); bu._t = setTimeout(() => { mostrarAba('conciliacao'); const n = $('ctlBusca'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $('ctlUnidade').onchange = e => { _unidade = e.target.value; mostrarAba('conciliacao'); };
    const es = $('ctlEscopo'); if(es) es.onchange = e => { _escopo = e.target.value; mostrarAba('conciliacao'); };
    const mais = $('ctlMais'); if(mais) mais.onclick = () => { _limite += 300; mostrarAba('conciliacao'); };
    [$('ctlImportar'), $('ctlImportar2')].forEach(b => { if(b) b.onclick = () => window.abrirImportacaoBase(); });
    alvo.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => abrirAmbienteId(b.dataset.abrir));
    $('ctlExcel').onclick = () => exportarConciliacao(R);
    $('ctlRelatorio').onclick = () => relatorioConciliacao(R, acuracia, esperados, valorNao);
    const enc = $('ctlEncerrar'); if(enc) enc.onclick = () => novoEncerramento();
  }
  function abrirAmbienteId(id){
    const a = A().todos().find(x => String(x.id) === String(id)); if(!a) return;
    $('screenControle').style.display = 'none';
    A().esconderTelas(); A().abrir(a);
  }
  const linhaPlanilhaAchado = x => { const u = unidadeDe(x.a); return {
    'Plaqueta': x.i.plaqueta || '', 'Descrição (campo)': x.i.description || '', 'Conservação': CONS[x.i.conservacao] || '',
    'Confirmado': x.i.status === 'confirmed' ? 'sim' : 'não', 'Ambiente': x.a.name, 'Andar': x.a.andar || '', 'Unidade': u ? u.name : '', 'Código da unidade': u ? u.code : '',
    'Descrição (cadastro)': x.ref ? x.ref.descricao : '', 'Local no cadastro': x.ref ? x.ref.localizacao : '', 'Unidade no cadastro': x.ref ? x.ref.unidade : '',
    'Responsável no cadastro': x.ref ? x.ref.responsavel : '', 'Valor': x.ref && x.ref.valor != null ? x.ref.valor : '' }; };
  function exportarConciliacao(R){
    baixarPlanilha('conciliacao-' + carimbo(), [
      { nome:'Resumo', linhas: CATEGORIAS.map(c => ({ 'Categoria': c.t, 'Quantidade': c.id === 'naoLocalizados' ? R.naoLocalizados.filter(n => n.noEscopo).length : R[c.id].length, 'O que significa': c.ajuda })) },
      { nome:'Conferidos', linhas: R.conferidos.map(linhaPlanilhaAchado) },
      { nome:'Em outro local', linhas: R.outroLocal.map(linhaPlanilhaAchado) },
      { nome:'Não localizados', linhas: R.naoLocalizados.map(n => ({ 'Plaqueta': n.ref.plaqueta, 'Descrição': n.ref.descricao, 'Local no cadastro': n.ref.localizacao, 'Unidade no cadastro': n.ref.unidade,
          'Responsável': n.ref.responsavel, 'Valor': n.ref.valor != null ? n.ref.valor : '', 'Aquisição': n.ref.aquisicao, 'Local já levantado?': n.noEscopo ? 'sim' : 'não' })) },
      { nome:'Sem registro na base', linhas: R.semRegistro.map(linhaPlanilhaAchado) },
      { nome:'Sem plaqueta', linhas: R.semPlaqueta.map(linhaPlanilhaAchado) },
      { nome:'Plaqueta repetida', linhas: R.duplicados.map(x => Object.assign({ 'Vezes lançada': x.repete }, linhaPlanilhaAchado(x))) }
    ]);
  }
  function relatorioConciliacao(R, acuracia, esperados, valorNao){
    const tab = (titulo, linhas, cols) => linhas.length ? `<h3 style="font-size:14px;margin:18px 0 4px">${esc(titulo)} (${linhas.length})</h3><table><tr>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}</tr>${linhas.map(l => `<tr>${cols.map(c => `<td>${esc(c[1](l))}</td>`).join('')}</tr>`).join('')}</table>` : '';
    const ach = [['Plaqueta', x => x.i.plaqueta || '—'], ['Descrição', x => x.i.description], ['Achado em', x => x.a.name + (unidadeDe(x.a) ? ' · ' + unidadeDe(x.a).name : '')], ['No cadastro', x => x.ref ? [x.ref.localizacao, x.ref.unidade].filter(Boolean).join(' · ') : '']];
    const nao = R.naoLocalizados.filter(n => n.noEscopo);
    imprimirDocumento('Relatório de conciliação', `
      ${nomeOrg() ? `<div class="org">${esc(nomeOrg())}</div>` : ''}
      <h1>RELATÓRIO DE CONCILIAÇÃO FÍSICO × CADASTRO</h1>
      <h2>Base: ${esc(A().sis())} · emitido em ${dataHora(new Date().toISOString())}</h2>
      <p class="meta"><b>Acuracidade:</b> ${acuracia != null ? String(acuracia).replace('.', ',') + '%' : '—'} (${R.conferidos.length} conferidos de ${esperados} esperados nos locais levantados)<br>
      ${CATEGORIAS.map(c => `<b>${esc(c.t)}:</b> ${c.id === 'naoLocalizados' ? nao.length : R[c.id].length}`).join('<br>')}
      ${valorNao ? `<br><b>Valor dos não localizados:</b> ${dinheiro(valorNao)}` : ''}</p>
      ${tab('Em outro local', R.outroLocal, ach)}
      ${tab('Não localizados', nao, [['Plaqueta', n => n.ref.plaqueta], ['Descrição', n => n.ref.descricao], ['Local no cadastro', n => [n.ref.localizacao, n.ref.unidade].filter(Boolean).join(' · ')], ['Responsável', n => n.ref.responsavel], ['Valor', n => n.ref.valor != null ? dinheiro(n.ref.valor) : '']])}
      ${tab('Sem registro na base', R.semRegistro, ach)}
      ${tab('Sem plaqueta', R.semPlaqueta, ach)}
      ${tab('Plaqueta repetida', R.duplicados, ach)}
      <div class="cod">Gerado por ${esc(produto())}</div>`);
  }

  /* ---------- termo de encerramento do inventário ---------- */
  const PROVIDENCIA = { conferidos:'Nenhuma: localizado no local previsto', outroLocal:'Regularizar a transferência no sistema patrimonial',
    naoLocalizados:'Abrir apuração de possível extravio', semRegistro:'Incorporar / promover o tombamento', semPlaqueta:'Providenciar o emplaquetamento',
    duplicados:'Conferir a plaqueta correta e corrigir o lançamento' };
  function novoEncerramento(){
    const unidNome = _unidade ? ((unidadeDe(A().ambientes().find(a => (unidadeDe(a) || {}).code === _unidade)) || {}).name || _unidade) : '';
    abrirModal('Termo de encerramento do inventário', `
      <p class="ctl-dica">Encerra formalmente o inventário com o resultado da conciliação ${unidNome ? 'da unidade <b>' + esc(unidNome) + '</b>' : 'de <b>todas as unidades levantadas</b>'} (para outra unidade, escolha-a no filtro antes). O documento sai pronto para assinatura da comissão.</p>
      <div class="ctl-campo"><label>Campanha / exercício</label><input id="enCamp" placeholder="Ex.: Inventário anual 2026"></div>
      <div class="ctl-campo"><label>Cidade</label><input id="enCidade" placeholder="Ex.: Campina Grande"></div>
      ${[1,2,3,4].map(n => `<div class="ctl-campo"><label>Comissão — membro ${n}${n === 1 ? ' (presidente)' : ''}</label><input id="enM${n}" placeholder="Nome"></div>`).join('')}
      <div class="ctl-campo"><label>Observações (opcional)</label><textarea id="enObs" rows="3"></textarea></div>
      <button class="btn btn-primary btn-full" id="enOk" type="button">Gerar termo de encerramento</button>`);
    $('enOk').onclick = async () => {
      const membros = [1,2,3,4].map(n => $('enM' + n).value.trim()).filter(Boolean);
      const R = conciliar(), f = lst => _unidade ? lst.filter(x => x.a ? ((unidadeDe(x.a) || {}).code === _unidade) : true) : lst;
      const ambs = A().ambientes().filter(a => !_unidade || (unidadeDe(a) || {}).code === _unidade);
      const nao = R.naoLocalizados.filter(n => n.noEscopo && (!_unidade || ambs.some(a => A().refNoAmbiente(n.ref, a)) || norm(n.ref.unidade) === norm(unidNome)));
      const q = { conferidos: f(R.conferidos).length, outroLocal: f(R.outroLocal).length, naoLocalizados: nao.length, semRegistro: f(R.semRegistro).length,
                  semPlaqueta: f(R.semPlaqueta).length, duplicados: f(R.duplicados).length };
      const esperados = q.conferidos + q.outroLocal + q.naoLocalizados;
      const datas = ambs.flatMap(a => [a.createdAt, a.collectedAt]).filter(Boolean).sort();
      const agentes = [...new Set(ambs.flatMap(a => [a.createdBy, a.collectedBy].concat((a.historico || []).map(h => h.quem))).filter(x => x && x !== 'não identificado'))];
      await carregarEstado();
      const ano = new Date().getFullYear(), seq = ESTADO.encerramentos.filter(t => (t.numero || '').indexOf('TE-' + ano) === 0).length + 1;
      const t = { id: A().novoId(), numero: 'TE-' + ano + '-' + String(seq).padStart(4, '0'), em: new Date().toISOString(), campanha: $('enCamp').value.trim(),
        cidade: $('enCidade').value.trim(), unidade: unidNome || 'Todas as unidades levantadas', membros, obs: $('enObs').value.trim(), base: A().sis(),
        baseTotal: A().base().length, quadro: q, esperados, conformidade: esperados ? Math.round(q.conferidos / esperados * 1000) / 10 : null,
        valorNao: nao.reduce((t2, n) => t2 + (typeof n.ref.valor === 'number' ? n.ref.valor : 0), 0),
        naoLocalizados: nao.map(n => ({ plaqueta: n.ref.plaqueta, descricao: n.ref.descricao, local: [n.ref.localizacao, n.ref.unidade].filter(Boolean).join(' / '), valor: n.ref.valor })),
        ambientes: ambs.length, coletados: ambs.filter(a => a.status === 'coletado').length, agentes, periodo: datas.length ? [datas[0], datas[datas.length - 1]] : null };
      t.codigo = await codigoVerificacao({ n: t.numero, e: t.em, q: t.quadro, nl: t.naoLocalizados.map(x => x.plaqueta) });
      ESTADO.encerramentos.unshift(t); await gravar('encerramentos');
      fecharModal(); imprimirEncerramento(t);
    };
  }
  function imprimirEncerramento(t){
    const dia = new Date(t.em), fmt = n => Number(n).toLocaleString('pt-BR');
    const linhaQ = (id, rot) => `<tr><td>${rot}</td><td style="text-align:right">${fmt(t.quadro[id])}</td><td>${PROVIDENCIA[id]}</td></tr>`;
    imprimirDocumento('Termo de encerramento ' + t.numero, `
      ${nomeOrg() ? `<div class="org">${esc(nomeOrg())}</div>` : ''}
      <h1>TERMO DE ENCERRAMENTO DE INVENTÁRIO</h1>
      <h2>Nº ${esc(t.numero)}${t.campanha ? ' · ' + esc(t.campanha) : ''}</h2>
      <p class="meta"><b>Abrangência:</b> ${esc(t.unidade)}<br>
      <b>Período de coleta:</b> ${t.periodo ? new Date(t.periodo[0]).toLocaleDateString('pt-BR') + ' a ' + new Date(t.periodo[1]).toLocaleDateString('pt-BR') : '—'}<br>
      <b>Base confrontada:</b> ${esc(t.base)} (${fmt(t.baseTotal)} bens)<br>
      <b>Ambientes levantados:</b> ${fmt(t.ambientes)} (${fmt(t.coletados)} concluídos)</p>
      <p>Em ${dia.toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' })}, a comissão de inventário abaixo assinada declara encerrado o levantamento patrimonial
      da abrangência acima, realizado com o confronto entre a base de bens do ${esc(t.base)} e o levantamento físico feito em campo, com o resultado a seguir.</p>
      <table><tr><th>Categoria</th><th style="text-align:right">Quantidade</th><th>Providência</th></tr>
        ${linhaQ('conferidos', 'Bens conformes')}${linhaQ('outroLocal', 'Divergência de localização')}${linhaQ('naoLocalizados', 'Não localizados')}
        ${linhaQ('semRegistro', 'Sem registro na base')}${linhaQ('semPlaqueta', 'Sem plaqueta')}${linhaQ('duplicados', 'Plaqueta repetida')}</table>
      <p>O índice de conformidade apurado foi de <b>${t.conformidade != null ? String(t.conformidade).replace('.', ',') + '%' : '—'}</b> em relação aos ${fmt(t.esperados)} bens esperados nos locais levantados.
      ${t.quadro.naoLocalizados ? `Os ${fmt(t.quadro.naoLocalizados)} bens não localizados${t.valorNao ? ', no valor total de ' + dinheiro(t.valorNao) + ',' : ''} devem ser objeto de apuração.` : 'Todos os bens esperados foram localizados.'}</p>
      ${t.naoLocalizados.length ? `<h3 style="font-size:14px;margin:18px 0 4px">Anexo — bens não localizados</h3><table><tr><th>Plaqueta</th><th>Descrição</th><th>Local na base</th><th>Valor</th></tr>
        ${t.naoLocalizados.map(n => `<tr><td>${esc(n.plaqueta)}</td><td>${esc(n.descricao)}</td><td>${esc(n.local)}</td><td>${n.valor != null ? dinheiro(n.valor) : ''}</td></tr>`).join('')}</table>` : ''}
      ${t.agentes.length ? `<p class="meta"><b>Agentes do levantamento:</b> ${esc(t.agentes.join(', '))}</p>` : ''}
      ${t.obs ? `<p><b>Observações:</b> ${esc(t.obs)}</p>` : ''}
      <p style="margin-top:22px">${esc(t.cidade || '________________')}, ${dia.toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' })}.</p>
      <div class="ass">${(t.membros.length ? t.membros : ['', '', '']).map((m, i) => `<div><div style="height:60px"></div><div class="l">${esc(m || '')}<br>${i === 0 ? 'Presidente da comissão' : 'Membro da comissão'}</div></div>`).join('')}</div>
      <div class="cod">Código de verificação ${esc(t.codigo)} · ${esc(produto())}</div>`);
  }

  /* =================================================================
     3) TRANSFERÊNCIAS ENTRE AMBIENTES
     ================================================================= */
  const MOTIVOS = ['Remanejamento entre setores', 'Mudança de sala', 'Empréstimo temporário', 'Envio para manutenção', 'Retorno de manutenção', 'Devolução ao patrimônio', 'Outro'];
  function transferir(itemId){
    const origem = A().atual(); if(!origem) return;
    const item = (origem.items || []).find(i => i.id === itemId); if(!item) return;
    const destinos = A().ambientes().filter(a => a.id !== origem.id);
    if(!destinos.length){ alert('Não há outro ambiente cadastrado para receber o bem. Crie o ambiente de destino primeiro.'); return; }
    let escolhido = null;
    const corpo = abrirModal('Transferir bem', `
      <div class="ctl-linha" style="margin-bottom:12px"><span class="p">${esc(item.plaqueta || 'sem plaqueta')}</span> · <span class="d">${esc(item.description || '(sem descrição)')}</span><div class="m">Sai de: <b>${esc(origem.name)}</b>${unidadeDe(origem) ? ' · ' + esc(unidadeDe(origem).name) : ''}</div></div>
      <div class="ctl-campo"><label>Para qual ambiente?</label><input type="search" id="trBusca" placeholder="Buscar ambiente ou unidade…"></div>
      <div class="ctl-escolha" id="trLista"></div>
      <div class="ctl-campo"><label>Motivo</label><select id="trMotivo">${MOTIVOS.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="ctl-campo"><label>Observação (opcional)</label><input id="trObs" placeholder="Ex.: memorando, chamado, prazo de devolução"></div>
      <div class="ctl-campo"><label>Quem recebe</label><input id="trRecNome" placeholder="Nome de quem fica responsável no destino"></div>
      <div class="ctl-campo"><label>${esc(rotMatricula())} de quem recebe (opcional)</label><input id="trRecMat"></div>
      <div class="ctl-campo"><label>Aceite de quem recebe</label><div id="trAss"></div></div>
      <p class="ctl-dica">Se quem recebe não estiver presente, deixe a assinatura em branco: a transferência fica "aguardando aceite" e pode ser assinada depois, na aba Transferências.</p>
      <button class="btn btn-primary btn-full" id="trOk" type="button">Transferir</button>
      <div class="ctl-dica" id="trMsg"></div>`);
    const pad = areaDeAssinatura($('trAss'), 'assinatura de quem recebe');
    function listar(){
      const q = norm($('trBusca').value);
      const lst = destinos.filter(a => !q || norm(a.name + ' ' + ((unidadeDe(a) || {}).name || '') + ' ' + (a.andar || '')).includes(q)).slice(0, 60);
      $('trLista').innerHTML = lst.map(a => `<button type="button" data-id="${a.id}" class="${escolhido && escolhido.id === a.id ? 'on' : ''}">${esc(a.name)}<small>${esc([unidadeDe(a) && unidadeDe(a).name, a.andar].filter(Boolean).join(' · ') || 'sem unidade')}</small></button>`).join('') || '<div class="ctl-dica">Nenhum ambiente com esse nome.</div>';
      $('trLista').querySelectorAll('button').forEach(b => b.onclick = () => { escolhido = destinos.find(a => String(a.id) === b.dataset.id); listar(); });
    }
    $('trBusca').oninput = listar; listar();
    $('trOk').onclick = async () => {
      if(!escolhido){ $('trMsg').textContent = 'Escolha o ambiente de destino.'; return; }
      const nomeRec = $('trRecNome').value.trim();
      if(!pad.vazia() && !nomeRec){ $('trMsg').textContent = 'Informe o nome de quem assinou o recebimento.'; return; }
      await carregarEstado();
      const ass = pad.vazia() ? null : pad.imagem();
      const de = { id: origem.id, nome: origem.name, unidade: (unidadeDe(origem) || {}).name || '' };
      const para = { id: escolhido.id, nome: escolhido.name, unidade: (unidadeDe(escolhido) || {}).name || '' };
      const idx = origem.items.indexOf(item);
      if(idx < 0) return;
      origem.items.splice(idx, 1);
      escolhido.items = escolhido.items || [];
      item.transferidoEm = new Date().toISOString();
      escolhido.items.push(item);
      A().marcarTransferencia(item.id, 'para ' + para.nome + (para.unidade ? ' (' + para.unidade + ')' : ''), 'de ' + de.nome + (de.unidade ? ' (' + de.unidade + ')' : ''));
      await A().salvar(origem); await A().salvar(escolhido);
      const reg = { id: A().novoId(), em: new Date().toISOString(), por: A().quemSou(),
        item: { id: item.id, plaqueta: item.plaqueta || '', descricao: item.description || '' }, de, para,
        motivo: $('trMotivo').value, obs: $('trObs').value.trim(),
        recebedor: { nome: nomeRec, matricula: $('trRecMat').value.trim() },
        assinatura: ass, aceitoEm: ass ? new Date().toISOString() : null, aceiteId: ass ? A().novoId() : null, situacao: ass ? 'aceita' : 'aguardando aceite' };
      ESTADO.transferencias.unshift(reg); await gravar('transferencias');
      fecharModal(); A().atualizarTelas();
      if(confirm('Bem transferido para "' + para.nome + '".' + (ass ? '' : ' A transferência está aguardando o aceite de quem recebe.') + '\n\nQuer imprimir a guia de transferência?')) guiaTransferencia(reg);
    };
  }
  function guiaTransferencia(t){
    imprimirDocumento('Guia de transferência', `
      ${nomeOrg() ? `<div class="org">${esc(nomeOrg())}</div>` : ''}
      <h1>GUIA DE TRANSFERÊNCIA DE BEM PATRIMONIAL</h1>
      <h2>Emitida em ${dataHora(t.em)}</h2>
      <table><tr><th>Plaqueta</th><th>Descrição</th></tr><tr><td>${esc(t.item.plaqueta || '—')}</td><td>${esc(t.item.descricao)}</td></tr></table>
      <p class="meta"><b>Origem:</b> ${esc(t.de.nome)}${t.de.unidade ? ' · ' + esc(t.de.unidade) : ''}<br>
      <b>Destino:</b> ${esc(t.para.nome)}${t.para.unidade ? ' · ' + esc(t.para.unidade) : ''}<br>
      <b>Motivo:</b> ${esc(t.motivo)}${t.obs ? ' — ' + esc(t.obs) : ''}<br>
      <b>Registrada por:</b> ${esc(t.por)}<br>
      <b>Situação:</b> ${t.aceitoEm ? 'aceita em ' + dataHora(t.aceitoEm) : 'aguardando aceite'}</p>
      <div class="ass">
        <div><div style="height:70px"></div><div class="l">${esc(t.por)}<br>Quem entrega</div></div>
        <div>${t.assinatura ? `<img src="${t.assinatura}" alt="">` : '<div style="height:70px"></div>'}<div class="l">${esc(t.recebedor.nome || '')}${t.recebedor.matricula ? '<br>' + esc(rotMatricula()) + ' ' + esc(t.recebedor.matricula) : ''}<br>Quem recebe</div></div>
      </div>
      <div class="cod">Registro ${esc(t.id.slice(0, 8).toUpperCase())} · ${esc(produto())}</div>`);
  }
  function registrarAceite(t){
    abrirModal('Registrar aceite', `
      <div class="ctl-linha" style="margin-bottom:12px"><span class="p">${esc(t.item.plaqueta || 'sem plaqueta')}</span> · <span class="d">${esc(t.item.descricao)}</span><div class="m">${esc(t.de.nome)} → <b>${esc(t.para.nome)}</b></div></div>
      <div class="ctl-campo"><label>Quem recebe</label><input id="acNome" value="${esc(t.recebedor.nome || '')}"></div>
      <div class="ctl-campo"><label>${esc(rotMatricula())} (opcional)</label><input id="acMat" value="${esc(t.recebedor.matricula || '')}"></div>
      <div class="ctl-campo"><label>Assinatura</label><div id="acAss"></div></div>
      <button class="btn btn-primary btn-full" id="acOk" type="button">Registrar aceite</button><div class="ctl-dica" id="acMsg"></div>`);
    const pad = areaDeAssinatura($('acAss'), 'assinatura de quem recebe');
    $('acOk').onclick = async () => {
      if(!$('acNome').value.trim()){ $('acMsg').textContent = 'Informe o nome de quem recebe.'; return; }
      if(pad.vazia()){ $('acMsg').textContent = 'Falta a assinatura.'; return; }
      t.recebedor = { nome: $('acNome').value.trim(), matricula: $('acMat').value.trim() };
      t.assinatura = pad.imagem(); t.aceitoEm = new Date().toISOString(); t.aceiteId = A().novoId(); t.situacao = 'aceita';
      await gravar('transferencias');
      const destino = A().todos().find(a => a.id === t.para.id);
      if(destino){ A().anotar(destino, { tipo:'aceite', itemId: t.item.id, plaq: t.item.plaqueta, desc: t.item.descricao, nota: 'Recebimento aceito por ' + t.recebedor.nome }); await A().salvar(destino); }
      fecharModal(); mostrarAba('transferencias');
    };
  }
  let _filtroTr = 'todas';
  function telaTransferencias(box){
    const lst = ESTADO.transferencias.filter(t => _filtroTr === 'todas' || t.situacao === _filtroTr);
    const aguard = ESTADO.transferencias.filter(t => t.situacao !== 'aceita').length;
    box.innerHTML = `
      <p class="ctl-dica">Para transferir um bem, abra o ambiente onde ele está e toque em <b>⇄ Transferir</b> no cartão do bem.</p>
      <div class="ctl-barra"><select id="trFiltro">
        <option value="todas"${_filtroTr === 'todas' ? ' selected' : ''}>Todas (${ESTADO.transferencias.length})</option>
        <option value="aguardando aceite"${_filtroTr === 'aguardando aceite' ? ' selected' : ''}>Aguardando aceite (${aguard})</option>
        <option value="aceita"${_filtroTr === 'aceita' ? ' selected' : ''}>Aceitas (${ESTADO.transferencias.length - aguard})</option></select></div>
      <div class="ctl-lista">${lst.length ? lst.map(t => `<div class="ctl-linha">
        <span class="tag ${t.situacao === 'aceita' ? 'ok' : 'alerta'}">${esc(t.situacao)}</span><span class="p">${esc(t.item.plaqueta || 'sem plaqueta')}</span> · <span class="d">${esc(t.item.descricao)}</span>
        <div class="m">${esc(t.de.nome)} → <b>${esc(t.para.nome)}</b> · ${esc(t.motivo)} · ${dataHora(t.em)} · por ${esc(t.por)}</div>
        ${t.recebedor && t.recebedor.nome ? `<div class="m">Recebedor: ${esc(t.recebedor.nome)}</div>` : ''}
        <div class="acoes">${t.situacao !== 'aceita' ? `<button type="button" class="item-extra-btn" data-aceite="${t.id}">✍ Registrar aceite</button>` : ''}<button type="button" class="item-extra-btn" data-guia="${t.id}">🖨 Guia</button></div>
      </div>`).join('') : '<div class="ctl-vazio">Nenhuma transferência registrada.</div>'}</div>
      ${ESTADO.transferencias.length ? '<div class="ctl-acoes-fim"><button class="btn btn-ghost" type="button" id="trExcel">⭳ Baixar planilha (Excel)</button></div>' : ''}`;
    $('trFiltro').onchange = e => { _filtroTr = e.target.value; mostrarAba('transferencias'); };
    box.querySelectorAll('[data-aceite]').forEach(b => b.onclick = () => registrarAceite(ESTADO.transferencias.find(t => t.id === b.dataset.aceite)));
    box.querySelectorAll('[data-guia]').forEach(b => b.onclick = () => guiaTransferencia(ESTADO.transferencias.find(t => t.id === b.dataset.guia)));
    const ex = $('trExcel'); if(ex) ex.onclick = () => baixarPlanilha('transferencias-' + carimbo(), [{ nome:'Transferências', linhas: ESTADO.transferencias.map(t => ({
      'Data': dataHora(t.em), 'Plaqueta': t.item.plaqueta, 'Descrição': t.item.descricao, 'Origem': t.de.nome, 'Unidade de origem': t.de.unidade,
      'Destino': t.para.nome, 'Unidade de destino': t.para.unidade, 'Motivo': t.motivo, 'Observação': t.obs, 'Registrada por': t.por,
      'Recebedor': t.recebedor ? t.recebedor.nome : '', 'Situação': t.situacao, 'Aceite em': dataHora(t.aceitoEm) })) }]);
  }

  /* =================================================================
     4) TERMO DE RESPONSABILIDADE
     ================================================================= */
  function bensDoEscopo(ambs, comPendentes){
    return ambs.flatMap(a => (a.items || [])
      .filter(i => i.status === 'confirmed' || (comPendentes && i.status === 'pending'))
      .map(i => ({ plaqueta: i.plaqueta || '', descricao: i.description || '', conservacao: CONS[i.conservacao] || '', ambiente: a.name })));
  }
  function novoTermo(escopo, ambs){
    if(!ambs.length){ alert('Esta unidade ainda não tem ambientes levantados.'); return; }
    const prev = bensDoEscopo(ambs, false), prevTodos = bensDoEscopo(ambs, true);
    abrirModal('Termo de responsabilidade', `
      <div class="ctl-linha" style="margin-bottom:12px"><span class="d">${esc(escopo.nome)}</span><div class="m">${escopo.tipo === 'unidade' ? ambs.length + ' ambientes · ' : ''}${prev.length} bens confirmados${prevTodos.length > prev.length ? ' · ' + (prevTodos.length - prev.length) + ' ainda não confirmados' : ''}</div></div>
      <label class="ctl-dica" style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="tmPend"> Incluir os bens ainda não confirmados</label>
      <div class="ctl-campo"><label>Responsável pelos bens *</label><input id="tmNome" placeholder="Nome completo"></div>
      <div class="ctl-campo"><label>${esc(rotMatricula())}</label><input id="tmMat"></div>
      <div class="ctl-campo"><label>Cargo ou função</label><input id="tmCargo" placeholder="Ex.: chefe do setor, coordenador, gerente"></div>
      <div class="ctl-campo"><label>Assinatura do responsável *</label><div id="tmAssR"></div></div>
      <div class="ctl-campo"><label>Assinatura do agente patrimonial (${esc(A().quemSou())})</label><div id="tmAssA"></div></div>
      <button class="btn btn-primary btn-full" id="tmOk" type="button">Registrar e gerar o termo</button>
      <div class="ctl-dica" id="tmMsg"></div>`);
    const pr = areaDeAssinatura($('tmAssR'), 'responsável'), pa = areaDeAssinatura($('tmAssA'), 'agente patrimonial');
    $('tmOk').onclick = async () => {
      const nome = $('tmNome').value.trim(), msg = $('tmMsg');
      if(!nome){ msg.textContent = 'Informe o nome do responsável.'; return; }
      if(pr.vazia()){ msg.textContent = 'Falta a assinatura do responsável.'; return; }
      const itens = bensDoEscopo(ambs, $('tmPend').checked);
      if(!itens.length){ msg.textContent = 'Não há bens confirmados neste escopo. Confirme os bens na coleta ou marque a opção de incluir os não confirmados.'; return; }
      await carregarEstado();
      const ano = new Date().getFullYear(), seq = ESTADO.termos.filter(t => (t.numero || '').indexOf('TR-' + ano) === 0).length + 1;
      const termo = { id: A().novoId(), numero: 'TR-' + ano + '-' + String(seq).padStart(4, '0'), em: new Date().toISOString(),
        escopo, responsavel: { nome, matricula: $('tmMat').value.trim(), cargo: $('tmCargo').value.trim() },
        agente: A().quemSou(), itens, assinaturas: { responsavel: pr.imagem(), agente: pa.vazia() ? null : pa.imagem() } };
      termo.codigo = await codigoVerificacao({ n: termo.numero, e: termo.em, r: termo.responsavel, i: termo.itens });
      ESTADO.termos.unshift(termo); await gravar('termos');
      for(const a of ambs){ A().anotar(a, { tipo:'termo', nota: 'Termo ' + termo.numero + ' assinado por ' + nome }); await A().salvar(a); }
      fecharModal(); imprimirTermo(termo);
      if($('screenControle').style.display === 'block') mostrarAba('termos');
    };
  }
  function imprimirTermo(t){
    imprimirDocumento('Termo ' + t.numero, `
      ${nomeOrg() ? `<div class="org">${esc(nomeOrg())}</div>` : ''}
      <h1>TERMO DE RESPONSABILIDADE PATRIMONIAL</h1>
      <h2>Nº ${esc(t.numero)} · ${dataHora(t.em)}</h2>
      <p>Eu, <b>${esc(t.responsavel.nome)}</b>${t.responsavel.matricula ? ', ' + esc(rotMatricula()) + ' ' + esc(t.responsavel.matricula) : ''}${t.responsavel.cargo ? ', ' + esc(t.responsavel.cargo) : ''},
      declaro ter recebido e assumo a guarda, a conservação e o uso adequado dos bens patrimoniais relacionados abaixo, localizados em
      <b>${esc(t.escopo.nome)}</b>${t.escopo.unidade && t.escopo.unidade !== t.escopo.nome ? ' (' + esc(t.escopo.unidade) + ')' : ''}, comprometendo-me a comunicar
      ao setor de patrimônio qualquer movimentação, dano, extravio ou necessidade de manutenção.</p>
      <table><tr><th>#</th><th>Plaqueta</th><th>Descrição</th><th>Conservação</th>${t.escopo.tipo === 'unidade' ? '<th>Ambiente</th>' : ''}</tr>
      ${t.itens.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.plaqueta || '—')}</td><td>${esc(i.descricao)}</td><td>${esc(i.conservacao)}</td>${t.escopo.tipo === 'unidade' ? `<td>${esc(i.ambiente)}</td>` : ''}</tr>`).join('')}</table>
      <p class="meta"><b>Total de bens:</b> ${t.itens.length}</p>
      <div class="ass">
        <div><img src="${t.assinaturas.responsavel}" alt=""><div class="l">${esc(t.responsavel.nome)}<br>Responsável</div></div>
        <div>${t.assinaturas.agente ? `<img src="${t.assinaturas.agente}" alt="">` : '<div style="height:70px"></div>'}<div class="l">${esc(t.agente)}<br>Agente patrimonial</div></div>
      </div>
      <div class="cod">Código de verificação ${esc(t.codigo)} · ${esc(produto())}</div>`);
  }
  function termoDoAmbiente(){
    const a = A().atual(); if(!a) return;
    const u = unidadeDe(a);
    novoTermo({ tipo:'ambiente', id: a.id, nome: a.name, unidade: u ? u.name : '' }, [a]);
  }
  function termoDaUnidade(u){
    const ambs = A().ambientes().filter(a => { const x = unidadeDe(a); return x && x.code === u.code; });
    novoTermo({ tipo:'unidade', code: u.code, nome: u.name, unidade: u.name }, ambs);
  }
  function telaTermos(box){
    const unidades = new Map(); A().ambientes().forEach(a => { const u = unidadeDe(a); if(u) unidades.set(u.code, u); });
    box.innerHTML = `
      <p class="ctl-dica">O termo registra quem fica responsável pelos bens de um ambiente ou de uma unidade inteira, com assinatura na tela. Gere pelo botão <b>✍ Termo de responsabilidade</b> dentro do ambiente, pelo botão <b>Termo</b> da unidade, ou aqui:</p>
      <div class="ctl-barra"><select id="tmUnid"><option value="">Escolha uma unidade…</option>${[...unidades.values()].map(u => `<option value="${esc(u.code)}">${esc(u.name)}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" type="button" id="tmNovo">Novo termo da unidade</button></div>
      <div class="ctl-lista">${ESTADO.termos.length ? ESTADO.termos.map(t => `<div class="ctl-linha">
        <span class="p">${esc(t.numero)}</span> · <span class="d">${esc(t.escopo.nome)}</span>
        <div class="m">${esc(t.responsavel.nome)}${t.responsavel.cargo ? ' · ' + esc(t.responsavel.cargo) : ''} · ${t.itens.length} bens · ${dataHora(t.em)} · código ${esc(t.codigo)}</div>
        <div class="acoes"><button type="button" class="item-extra-btn" data-termo="${t.id}">🖨 Reimprimir</button></div>
      </div>`).join('') : '<div class="ctl-vazio">Nenhum termo registrado ainda.</div>'}</div>
      ${ESTADO.encerramentos.length ? `<h3 style="font-family:var(--font-display);font-size:16px;margin:18px 0 8px">Termos de encerramento</h3><div class="ctl-lista">${ESTADO.encerramentos.map(t => `<div class="ctl-linha">
        <span class="p">${esc(t.numero)}</span> · <span class="d">${esc(t.unidade)}</span>
        <div class="m">${t.campanha ? esc(t.campanha) + ' · ' : ''}conformidade ${t.conformidade != null ? String(t.conformidade).replace('.', ',') + '%' : '—'} · ${dataHora(t.em)} · código ${esc(t.codigo)}</div>
        <div class="acoes"><button type="button" class="item-extra-btn" data-enc="${t.id}">🖨 Reimprimir</button></div></div>`).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-enc]').forEach(b => b.onclick = () => imprimirEncerramento(ESTADO.encerramentos.find(t => t.id === b.dataset.enc)));
    $('tmNovo').onclick = () => { const c = $('tmUnid').value; if(!c){ alert('Escolha a unidade.'); return; } termoDaUnidade(unidades.get(c)); };
    box.querySelectorAll('[data-termo]').forEach(b => b.onclick = () => imprimirTermo(ESTADO.termos.find(t => t.id === b.dataset.termo)));
  }

  /* =================================================================
     5) HISTÓRICO (TRILHA DE AUDITORIA)
     ================================================================= */
  const CAMPO = { description:'descrição', plaqueta:'plaqueta', conservacao:'conservação', status:'situação', reconectaEnviado:'destinação',
                  nome:'nome do ambiente', andar:'andar', unidade:'unidade', estado:'situação do ambiente' };
  function textoEvento(h){
    switch(h.tipo){
      case 'ambiente_criado': return h.nota || 'Ambiente criado';
      case 'ambiente_alterado': return 'Alterou ' + (CAMPO[h.campo] || h.campo) + ': ' + h.de + ' → ' + h.para;
      case 'item_incluido': return 'Bem incluído';
      case 'item_alterado': return 'Alterou ' + (CAMPO[h.campo] || h.campo) + ': ' + h.de + ' → ' + h.para;
      case 'item_removido': return 'Bem removido do ambiente';
      case 'transferido_saida': return 'Transferido ' + (h.nota || '');
      case 'transferido_entrada': return 'Recebido por transferência ' + (h.nota || '');
      default: return h.nota || h.tipo;
    }
  }
  function todosOsEventos(){
    return A().ambientes().flatMap(a => (a.historico || []).map(h => Object.assign({ amb: a.name, ambId: a.id }, h)))
      .sort((x, y) => (y.em || '').localeCompare(x.em || ''));
  }
  const linhaEvento = h => `<div class="ctl-linha">
    ${h.plaq || h.desc ? `<span class="p">${esc(h.plaq || 'sem plaqueta')}</span> · <span class="d">${esc(h.desc || '')}</span><br>` : ''}
    <span>${esc(textoEvento(h))}</span>
    <div class="m">${dataHora(h.em)} · ${esc(h.quem || '')} · ${esc(h.amb || '')}</div></div>`;
  let _buscaH = '', _limiteH = 150;
  function telaHistorico(box){
    const q = norm(_buscaH), ev = todosOsEventos().filter(h => !q || norm([h.plaq, h.desc, h.quem, h.amb, textoEvento(h)].join(' ')).includes(q));
    box.innerHTML = `
      <p class="ctl-dica">Tudo o que muda num bem ou ambiente fica registrado aqui: quem fez, quando e o valor anterior. Não dá para apagar.</p>
      <div class="ctl-barra"><input type="search" id="hBusca" placeholder="Buscar plaqueta, pessoa, ambiente…" value="${esc(_buscaH)}"></div>
      <div class="ctl-lista">${ev.length ? ev.slice(0, _limiteH).map(linhaEvento).join('') : '<div class="ctl-vazio">Nenhum registro' + (q ? ' com essa busca' : ' ainda') + '.</div>'}</div>
      ${ev.length > _limiteH ? '<button type="button" class="btn btn-ghost btn-full" id="hMais">Mostrar mais</button>' : ''}
      ${ev.length ? '<div class="ctl-acoes-fim"><button class="btn btn-ghost" type="button" id="hExcel">⭳ Baixar planilha (Excel)</button></div>' : ''}`;
    const b = $('hBusca'); b.oninput = () => { _buscaH = b.value; clearTimeout(b._t); b._t = setTimeout(() => { mostrarAba('historico'); const n = $('hBusca'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    const m = $('hMais'); if(m) m.onclick = () => { _limiteH += 300; mostrarAba('historico'); };
    const x = $('hExcel'); if(x) x.onclick = () => baixarPlanilha('historico-' + carimbo(), [{ nome:'Histórico', linhas: ev.map(h => ({
      'Data e hora': dataHora(h.em), 'Quem': h.quem, 'Ambiente': h.amb, 'Plaqueta': h.plaq || '', 'Bem': h.desc || '', 'O que aconteceu': textoEvento(h) })) }]);
  }
  function historicoDoItem(itemId){
    const ev = todosOsEventos().filter(h => h.itemId === itemId);
    const tr = ESTADO.transferencias.filter(t => t.item.id === itemId);
    abrirModal('Histórico do bem', (ev.length ? `<div class="ctl-lista">${ev.map(linhaEvento).join('')}</div>` : '<div class="ctl-vazio">Sem registros para este bem.</div>') +
      (tr.length ? `<p class="ctl-dica" style="margin-top:12px"><b>${tr.length}</b> transferência(s) — detalhes na aba Transferências.</p>` : ''));
  }

  /* =================================================================
     TELA E NAVEGAÇÃO
     ================================================================= */
  let _aba = 'conciliacao';
  async function mostrarAba(aba){
    _aba = aba;
    document.querySelectorAll('.ctl-aba').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
    await carregarEstado();
    const box = $('ctlConteudo');
    ({ conciliacao: telaConciliacao, transferencias: telaTransferencias, termos: telaTermos, historico: telaHistorico })[aba](box);
  }
  function abrirControle(aba){
    A().esconderTelas();
    $('screenControle').style.display = 'block';
    window.scrollTo({ top:0, behavior:'instant' });
    mostrarAba(aba || _aba);
  }
  $('abrirControleBtn').onclick = () => abrirControle();
  $('backFromControleBtn').onclick = () => { $('screenControle').style.display = 'none'; A().voltarLista(); };
  document.querySelectorAll('.ctl-aba').forEach(b => b.onclick = () => mostrarAba(b.dataset.aba));
  $('termoAmbienteBtn').onclick = () => termoDoAmbiente();

  window.CONTROLE = {
    abrir: abrirControle, conciliar, transferir, historicoDoItem, termoDoAmbiente, termoDaUnidade,
    exportar: () => ({ termos: ESTADO.termos, transferencias: ESTADO.transferencias, encerramentos: ESTADO.encerramentos }),
    async importar(d){
      if(Array.isArray(d.encerramentos)){ ESTADO.encerramentos = d.encerramentos; await gravar('encerramentos'); }
      if(Array.isArray(d.termos)){ ESTADO.termos = d.termos; await gravar('termos'); }
      if(Array.isArray(d.transferencias)){ ESTADO.transferencias = d.transferencias; await gravar('transferencias'); }
    },
    estado: ESTADO,
    recarregar: carregarEstado,
    baixarBaseDaNuvem
  };
  carregarEstado();
  // base compartilhada: na abertura, ao voltar a internet e ao trocar de organização
  setTimeout(baixarBaseDaNuvem, 2500);
  window.addEventListener('online', () => setTimeout(baixarBaseDaNuvem, 2000));
  const _orgAntes = window.atualizarListaDaOrg;
  window.atualizarListaDaOrg = () => { if(_orgAntes) _orgAntes(); carregarEstado(); setTimeout(baixarBaseDaNuvem, 800); };
})();
