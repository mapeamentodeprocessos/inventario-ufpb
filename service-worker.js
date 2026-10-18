// Versão do cache. SEMPRE que publicar uma alteração no app, troque o número
// abaixo (v3, v4, ...). Isso apaga o cache antigo e garante que todo mundo
// receba a versão nova em vez de continuar usando a guardada no aparelho.
const CACHE_NAME = 'coleta-patrimonio-v13';

const APP_SHELL = [
  './',
  './index.html',
  './croqui.html',
  './config.js',
  './sync.js',
  './controle.js',
  './levantamentos.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('Falha ao pré-cachear o app shell', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// É a página do app (HTML)? Essas precisam vir da rede primeiro, senão o
// aparelho fica rodando uma versão antiga do sistema mesmo depois de publicada
// uma correção.
function ehPaginaDoApp(request) {
  if (request.mode === 'navigate') return true;
  const aceita = request.headers.get('accept') || '';
  if (aceita.includes('text/html')) return true;
  return /\.html(\?|$)/.test(new URL(request.url).pathname);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // DADOS (Supabase: banco, login, arquivos, funções): sempre direto na rede.
  // Nunca guardar em cache — a resposta depende de quem está logado e precisa
  // ser a atual. O app já guarda a própria cópia offline no aparelho.
  const destino = new URL(event.request.url);
  if (/\.supabase\.co$/.test(destino.hostname) || /\/(rest|auth|storage|functions)\/v1\//.test(destino.pathname)) return;

  // PÁGINAS (index.html, gestao.html...): rede primeiro, cache só como
  // salva-vidas quando o servidor está fora de alcance (uso offline em campo).
  if (ehPaginaDoApp(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // DEMAIS RECURSOS (ícones, fontes, bibliotecas): responde do cache na hora e
  // atualiza por baixo dos panos para a próxima vez.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
