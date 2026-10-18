/* =====================================================================
   PatrimonioSync — camada de sincronização offline-first
   Liga o app de campo (IndexedDB local) ao Supabase, sem alterar o
   banco existente do app. Costura os três descompassos:
     - ID inteiro local  ->  UUID estável (ponte guardada em banco próprio)
     - item aninhado      ->  linha na tabela itens
     - foto base64        ->  arquivo no Storage
   Requisitos que ela introduz no app: login Supabase (para o RLS) e
   uma campanha ativa (coletas pertencem a uma campanha).

   USO (ganchos mínimos no index.html):
     PatrimonioSync.config({ url, anonKey, bucket:'fotos-inventario' });
     await PatrimonioSync.login(email, senha);      // uma vez
     PatrimonioSync.setCampaign(campanhaId);         // após escolher campanha
     PatrimonioSync.markDirty(ambiente.id);          // após dbSaveAmbiente(a)
     PatrimonioSync.start();                          // inicia o loop
     PatrimonioSync.onStatus(s => atualizarBadge(s)); // UI opcional

   IMPORTANTE: não testado contra Supabase ao vivo. É o scaffold correto;
   o primeiro teste em campo valida mapeamento de campos e fotos.
   ===================================================================== */
(function (global) {
  'use strict';

  const APP_DB = 'coleta_patrimonio_db';   // banco do app (não alterar)
  const APP_STORE = 'ambientes';
  const SYNC_DB = 'coleta_patrimonio_sync'; // banco próprio de metadados
  const SYNC_STORE = 'map';                 // localId -> { uuid, itemUuids, synced, lastError, dirtyAt }

  const state = {
    url: null, anonKey: null, bucket: 'fotos-inventario',
    session: null, campanhaId: null,
    running: false, timer: null, backoff: 5000,
    statusCb: null
  };

  /* ---------- IndexedDB helpers ---------- */
  function openDB(name, version, upgrade) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(name, version);
      if (upgrade) r.onupgradeneeded = e => upgrade(e.target.result);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function syncDB() {
    return openDB(SYNC_DB, 1, db => {
      if (!db.objectStoreNames.contains(SYNC_STORE))
        db.createObjectStore(SYNC_STORE, { keyPath: 'localId' });
    });
  }
  async function appAmbientes() {
    // Lê os ambientes do banco do app SEM alterá-lo.
    const db = await openDB(APP_DB);           // sem version: abre o existente
    return new Promise((res, rej) => {
      const tx = db.transaction(APP_STORE, 'readonly');
      const rq = tx.objectStore(APP_STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function mapGet(localId) {
    const db = await syncDB();
    return new Promise(res => {
      const rq = db.transaction(SYNC_STORE, 'readonly').objectStore(SYNC_STORE).get(localId);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  }
  async function mapPut(rec) {
    const db = await syncDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SYNC_STORE, 'readwrite');
      tx.objectStore(SYNC_STORE).put(rec);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function mapAll() {
    const db = await syncDB();
    return new Promise(res => {
      const rq = db.transaction(SYNC_STORE, 'readonly').objectStore(SYNC_STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    });
  }

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      }));

  /* ---------- REST Supabase ---------- */
  function headers(extra) {
    const h = { apikey: state.anonKey, 'Content-Type': 'application/json', ...(extra || {}) };
    if (state.session) h.Authorization = 'Bearer ' + state.session.access_token;
    return h;
  }
  async function rest(path, opts) {
    const r = await fetch(state.url + path, { ...(opts || {}), headers: headers((opts || {}).headers) });
    // acesso vencido: renova o login e tenta de novo uma vez
    if(r.status === 401 && !(opts && opts._renovou) && global.renovarSessao && await global.renovarSessao())
      return rest(path, { ...(opts || {}), _renovou: true });
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()).slice(0, 180));
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  // upsert por PK (merge-duplicates) — reenvio é idempotente
  function upsert(table, rows) {
    return rest('/rest/v1/' + table, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }

  /* ---------- Foto base64 -> Storage ---------- */
  function b64ToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:(.*?);/) || [, 'image/jpeg'])[1];
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function uploadFoto(path, dataUrl) {
    const blob = b64ToBlob(dataUrl);
    const r = await fetch(state.url + '/storage/v1/object/' + state.bucket + '/' + path, {
      method: 'POST',
      headers: { apikey: state.anonKey, Authorization: 'Bearer ' + state.session.access_token,
                 'Content-Type': blob.type, 'x-upsert': 'true' },
      body: blob
    });
    if (!r.ok && r.status !== 409) throw new Error('Storage ' + r.status);
    return path;
  }

  /* ---------- Mapeamento local -> schema Supabase ---------- */
  function mapAmbiente(a, uid, ambienteUuid) {
    const linha = {
      id: ambienteUuid,
      // a campanha escolhida quando o ambiente foi criado; a ativa só para os antigos
      campanha_id: a.campanhaId || state.campanhaId,
      coletor_id: state.session.user.id,
      nome: a.name || 'Sem nome',
      andar: a.andar || '',
      modo: a.modo === 'conferencia' ? 'conferencia' : 'levantamento',
      // 1º vínculo = escopo. a.units guarda objetos {code, name}; o banco
      // espera só o código (texto). Enviar o objeto inteiro fazia a regra de
      // segurança (RLS) nunca bater e devolver 403 ao salvar o ambiente.
      unidade_code: (a.units && a.units[0] && (a.units[0].code || a.units[0])) || null,
      status: a.status === 'coletado' ? 'coletado' : (a.status || 'pendente'),
      coletado_em: a.collectedAt || null,
      criado_em: a.createdAt || new Date().toISOString()
    };
    if(a.orgId) linha.org_id = a.orgId;   // só quando o banco já tem organizações
    // levantamento e processamento: só depois da migração 04
    if(!semColunasLev && a.orgId){
      linha.levantamento_id = ehUuid(a.levantamentoId) ? a.levantamentoId : null;
      linha.processado_em = a.processado || null;
    }
    return linha;
  }
  function mapItem(it, ambienteUuid, itemUuid, uid, fotoPath) {
    const cons = ['bom', 'regular', 'ruim', 'inservivel'].includes(it.conservacao) ? it.conservacao : null;
    return {
      id: itemUuid,
      ambiente_id: ambienteUuid,
      coletor_id: uid,
      descricao: it.description || '(sem descrição)',
      confidence: typeof it.confidence === 'number' ? it.confidence : 0.5,
      plaqueta: it.plaqueta || null,
      conservacao: cons,
      status: it.status === 'confirmed' ? 'confirmed' : (it.status === 'discarded' ? 'discarded' : 'pending'),
      manual: !!it.manual,
      foto_path: fotoPath || null
    };
  }

  /* ---------- Sincronização de um ambiente ---------- */
  async function syncAmbiente(a) {
    const uid = state.session.user.id;
    const inicio = new Date().toISOString();
    let rec = await mapGet(a.id) || { localId: a.id, uuid: uuid(), itemUuids: {}, synced: false };

    // 1) fotos do ambiente -> Storage (path por coletor/ambiente)
    let primeiraFoto = null;
    if (Array.isArray(a.photos)) {
      for (let i = 0; i < a.photos.length; i++) {
        const foto = a.photos[i];
        const dataUrl = typeof foto === 'string' ? foto : (foto && foto.dataUrl);
        if (!dataUrl || !dataUrl.startsWith('data:')) continue;
        const path = uid + '/' + rec.uuid + '/foto_' + i + '.jpg';
        await uploadFoto(path, dataUrl);
        if (!primeiraFoto) primeiraFoto = path;
      }
    }

    // 2) ambiente (sem as colunas novas, se o banco ainda não tiver a migração 04)
    try{ await upsert('ambientes', [mapAmbiente(a, uid, rec.uuid)]); }
    catch(e){
      if(!semColunasLev && /levantamento_id|processado_em|PGRST204/i.test(e.message)){ semColunasLev = true; await upsert('ambientes', [mapAmbiente(a, uid, rec.uuid)]); }
      else throw e;
    }

    // 3) itens (achata o array aninhado; UUID estável por item local)
    const itens = Array.isArray(a.items) ? a.items : [];
    if (itens.length) {
      const rows = itens.map(it => {
        const key = String(it.id);
        if (!rec.itemUuids[key]) rec.itemUuids[key] = uuid();
        return mapItem(it, rec.uuid, rec.itemUuids[key], uid, primeiraFoto);
      });
      await upsert('itens', rows);
    }

    rec.synced = true; rec.lastError = null; rec.syncedAt = new Date().toISOString();
    // só limpa a marca de "alterado" se ninguém mexeu no ambiente durante o envio
    const agora = await mapGet(a.id);
    if(agora && agora.dirtyAt && agora.dirtyAt > inicio){ rec.dirty = true; rec.synced = false; rec.dirtyAt = agora.dirtyAt; }
    else rec.dirty = false;
    await mapPut(rec);

    // 4) trilha de auditoria do ambiente (falha aqui não segura o resto)
    try{ await enviarHistorico(a, rec); }catch(e){ console.warn('eventos', e.message); }
  }

  /* ---------- Eventos: auditoria, termos e transferências ---------- */
  // Só existem no banco depois da migração 03. Cada evento tem id próprio e é
  // enviado uma vez; reenviar é inofensivo (o banco ignora o repetido).
  let semTabelaEventos = false, semColunasLev = false, semTabelaLev = false;
  const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  async function postarEventos(linhas){
    if(!linhas.length || semTabelaEventos) return false;
    try{
      await rest('/rest/v1/eventos', { method:'POST', headers:{ Prefer:'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(linhas) });
      return true;
    }catch(e){
      if(/PGRST20|42P01|does not exist|schema cache|Could not find/i.test(e.message)) semTabelaEventos = true;
      throw e;
    }
  }
  async function enviarHistorico(a, rec){
    if(!a.orgId || !Array.isArray(a.historico) || !a.historico.length) return;
    const ja = new Set(rec.eventosEnviados || []);
    const novos = a.historico.filter(h => ehUuid(h.id) && !ja.has(h.id));
    if(!novos.length) return;
    for(let i = 0; i < novos.length; i += 200){
      const lote = novos.slice(i, i + 200);
      await postarEventos(lote.map(h => ({ id: h.id, org_id: a.orgId, ambiente_id: rec.uuid, tipo: 'auditoria', ocorrido_em: h.em,
        dados: Object.assign({ ambiente: a.name }, h) })));
      lote.forEach(h => ja.add(h.id));
    }
    rec.eventosEnviados = Array.from(ja).slice(-5000);
    await mapPut(rec);
  }
  async function lerMetaDoApp(chave){
    const db = await openDB(APP_DB);
    if(!db.objectStoreNames.contains('meta')) return null;
    return new Promise(res => {
      const rq = db.transaction('meta', 'readonly').objectStore('meta').get(chave);
      rq.onsuccess = () => res(rq.result ? rq.result.value : null); rq.onerror = () => res(null);
    });
  }
  async function gravarMetaDoApp(chave, valor){
    const db = await openDB(APP_DB);
    if(!db.objectStoreNames.contains('meta')) return;
    await new Promise(res => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: chave, value: valor }); tx.oncomplete = res; tx.onerror = res; });
  }
  /* ---------- Levantamentos e exclusões ---------- */
  async function enviarLevantamentos(){
    const org = (global.ORG && global.ORG.id) || null;
    if(!org || semTabelaLev) return;
    const levs = (await lerMetaDoApp('levantamentos:' + org)) || [];
    const rec = (await mapGet('__lev__:' + org)) || { localId: '__lev__:' + org, versoes: {} };
    for(const l of levs){
      if(!ehUuid(l.id)) continue;
      const linha = { id: l.id, org_id: org, campanha_id: ehUuid(l.campanhaId) ? l.campanhaId : null, unidade_code: l.unidade ? l.unidade.code : null,
        unidade_nome: l.unidade ? l.unidade.name : null, finalidade: l.finalidade || null, descricao: l.descricao || null, observacao: l.observacao || null,
        comissao: l.comissao || [], status: l.status === 'processado' ? 'processado' : 'em_andamento', resultado: l.resultado || null, origem: l.origem || null,
        codigo: l.codigo || null, criado_por_nome: l.criadoPor || null, criado_em: l.criadoEm || new Date().toISOString(),
        processado_em: l.processadoEm || null, processado_por_nome: l.processadoPor || null, atualizado_em: new Date().toISOString() };
      const versao = JSON.stringify(Object.assign({}, linha, { atualizado_em: null }));
      if(rec.versoes[l.id] === versao) continue;
      try{ await upsert('levantamentos', [linha]); rec.versoes[l.id] = versao; }
      catch(e){ if(/PGRST20|42P01|does not exist|schema cache|Could not find the table/i.test(e.message)){ semTabelaLev = true; return; } }
    }
    await mapPut(rec);
  }
  async function enviarExclusoes(){
    const fila = (await lerMetaDoApp('exclusoes')) || [];
    if(fila.length){
      const resta = [];
      for(const x of fila){
        const rec = await mapGet(x.localId);
        if(!rec || !rec.uuid){ continue; }                       // nunca foi enviado: nada a apagar na nuvem
        try{
          await rest('/rest/v1/itens?ambiente_id=eq.' + rec.uuid, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
          await rest('/rest/v1/ambientes?id=eq.' + rec.uuid, { method:'DELETE', headers:{ Prefer:'return=minimal' } });
        }catch(e){ resta.push(x); }
      }
      await gravarMetaDoApp('exclusoes', resta);
    }
    const filaLev = (await lerMetaDoApp('exclusoesLev')) || [];
    if(filaLev.length && !semTabelaLev){
      const resta = [];
      for(const x of filaLev){ try{ await rest('/rest/v1/levantamentos?id=eq.' + x.id, { method:'DELETE', headers:{ Prefer:'return=minimal' } }); }catch(e){ resta.push(x); } }
      await gravarMetaDoApp('exclusoesLev', resta);
    }
  }
  async function enviarControle(){
    const org = (global.ORG && global.ORG.id) || null;
    if(!org || semTabelaEventos) return;
    const rec = (await mapGet('__controle__:' + org)) || { localId: '__controle__:' + org, enviados: [] };
    const ja = new Set(rec.enviados || []), linhas = [];
    const mapaAmb = {}; (await mapAll()).forEach(m => { mapaAmb[m.localId] = m.uuid; });
    ((await lerMetaDoApp('termos:' + org)) || []).forEach(t => {
      if(ehUuid(t.id) && !ja.has(t.id)) linhas.push({ id: t.id, org_id: org, ambiente_id: (t.escopo && t.escopo.tipo === 'ambiente' && mapaAmb[t.escopo.id]) || null, tipo: 'termo', ocorrido_em: t.em, dados: t });
    });
    ((await lerMetaDoApp('encerramentos:' + org)) || []).forEach(t => {
      if(ehUuid(t.id) && !ja.has(t.id)) linhas.push({ id: t.id, org_id: org, ambiente_id: null, tipo: 'termo', ocorrido_em: t.em, dados: Object.assign({ especie: 'encerramento' }, t) });
    });
    ((await lerMetaDoApp('transferencias:' + org)) || []).forEach(t => {
      if(ehUuid(t.id) && !ja.has(t.id)) linhas.push({ id: t.id, org_id: org, ambiente_id: mapaAmb[t.para && t.para.id] || null, tipo: 'transferencia', ocorrido_em: t.em, dados: Object.assign({}, t, { assinatura: t.aceitoEm ? t.assinatura : null }) });
      if(t.aceitoEm && ehUuid(t.aceiteId) && !ja.has(t.aceiteId)) linhas.push({ id: t.aceiteId, org_id: org, ambiente_id: mapaAmb[t.para && t.para.id] || null, tipo: 'aceite', ocorrido_em: t.aceitoEm,
        dados: { transferencia: t.id, recebedor: t.recebedor, assinatura: t.assinatura, item: t.item } });
    });
    if(!linhas.length) return;
    await postarEventos(linhas);
    linhas.forEach(l => ja.add(l.id));
    rec.enviados = Array.from(ja).slice(-10000);
    await mapPut(rec);
  }

  /* ---------- Passo de sync (todos os pendentes) ---------- */
  async function syncNow() {
    if (!state.session) return report({ error: 'não autenticado' });
    if (!state.campanhaId) return report({ error: 'sem campanha ativa' });
    if (!navigator.onLine) return report({ offline: true });

    const ambientes = await appAmbientes();
    const mapa = {}; (await mapAll()).forEach(m => mapa[m.localId] = m);
    const pend = ambientes.filter(a => { const m = mapa[a.id]; return !m || !m.synced || m.dirty; });

    let ok = 0, fail = 0;
    for (const a of pend) {
      try { await syncAmbiente(a); ok++; }
      catch (e) {
        fail++;
        const rec = (await mapGet(a.id)) || { localId: a.id, uuid: uuid(), itemUuids: {} };
        rec.synced = false; rec.dirty = true; rec.lastError = String(e.message || e);
        await mapPut(rec);
      }
    }
    try{ await enviarControle(); }catch(e){ console.warn('controle', e.message); }
    try{ await enviarLevantamentos(); }catch(e){ console.warn('levantamentos', e.message); }
    try{ await enviarExclusoes(); }catch(e){ console.warn('exclusões', e.message); }
    state.backoff = fail ? Math.min(state.backoff * 2, 120000) : 5000;
    report({ synced: ok, failed: fail, pending: pend.length - ok, total: ambientes.length });
    return { ok, fail };
  }

  function report(s) { try { state.statusCb && state.statusCb(s); } catch (_) {} }

  /* ---------- Loop de fundo ---------- */
  function loop() {
    if (!state.running) return;
    syncNow().finally(() => {
      state.timer = setTimeout(loop, state.backoff);
    });
  }

  /* ---------- API pública ---------- */
  const API = {
    config(o) { Object.assign(state, o || {}); return API; },
    async login(email, senha) {
      const data = await rest('/auth/v1/token?grant_type=password', {
        method: 'POST', body: JSON.stringify({ email, password: senha })
      });
      state.session = data; return data.user;
    },
    async restoreSession(session) { state.session = session; },
    logout() { state.session = null; },
    currentUser() { return state.session && state.session.user; },
    setCampaign(id) { state.campanhaId = id; return API; },
    // Lista campanhas abertas para o coletor escolher
    async campanhasAbertas() {
      return rest('/rest/v1/campanhas?aberta=eq.true&select=id,nome,inventario_id&order=nome');
    },
    async markDirty(localId) {
      const rec = (await mapGet(localId)) || { localId, uuid: uuid(), itemUuids: {} };
      rec.synced = false; rec.dirty = true; rec.dirtyAt = new Date().toISOString();
      await mapPut(rec);
    },
    onStatus(cb) { state.statusCb = cb; return API; },
    syncNow,
    start() {
      if (state.running) return;
      state.running = true;
      window.addEventListener('online', () => { state.backoff = 3000; syncNow(); });
      loop();
    },
    stop() { state.running = false; clearTimeout(state.timer); },
    async pendingCount() {
      const [ambs, mapa] = [await appAmbientes(), await mapAll()];
      const m = {}; mapa.forEach(x => m[x.localId] = x);
      return ambs.filter(a => { const r = m[a.id]; return !r || !r.synced || r.dirty; }).length;
    }
  };

  global.PatrimonioSync = API;
})(window);
