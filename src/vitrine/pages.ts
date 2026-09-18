/**
 * Rotas curtas HTTPS da Vitrine. Sem query.
 * `/planos` serve a landing; o JS rola até `#planos`.
 * `/app` = área logada (alias `/conta`).
 */
export const PAGE_MAP: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/planos': 'index.html',
  '/planos.html': 'index.html',
  '/privacidade': 'privacidade.html',
  '/privacidade.html': 'privacidade.html',
  '/termos': 'termos.html',
  '/termos.html': 'termos.html',
  '/entrar': 'entrar.html',
  '/entrar.html': 'entrar.html',
  '/cadastro': 'cadastro.html',
  '/cadastro.html': 'cadastro.html',
  '/app': 'conta.html',
  '/app.html': 'conta.html',
  '/conta': 'conta.html',
  '/conta.html': 'conta.html',
};
