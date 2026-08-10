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
    return {
      id: ambienteUuid,
      campanha_id: state.campanhaId,
      coletor_id: state.session.user.id,
      nome: a.name || 'Sem nome',
      andar: a.andar || '',
      modo: a.modo === 'conferencia' ? 'conferencia' : 'levantamento',
      unidade_code: (a.units && a.units[0]) || null,   // 1º vínculo = escopo
      status: a.status === 'coletado' ? 'coletado' : (a.status || 'pendente'),
      coletado_em: a.collectedAt || null,
      criado_em: a.createdAt || new Date().toISOString()
    };
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

    // 2) ambiente
    await upsert('ambientes', [mapAmbiente(a, uid, rec.uuid)]);

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
