import { createAuthService } from './auth.js';
import { createVitrineServer } from './http.js';
import { loadPublicConfig } from './public-config.js';
import { createVitrineStore } from './store.js';

const port = Number(process.env['PORT'] ?? 3000);
const { mode } = createVitrineStore();
const publicConfig = loadPublicConfig();
const auth = createAuthService();
const server = createVitrineServer();

server.listen(port, () => {
  console.log(`Plvria Sync hotsite DRAFT  http://127.0.0.1:${port}`);
  console.log(`Store: ${mode}  Auth: ${auth.mode}  Turnstile: ${publicConfig.turnstileMode}`);
  console.log('Service role só no servidor. Anon não select leads. Captcha antes do insert.');
  console.log('Não publicar em produção sem ok do Dinheiro Bot + Thiago. DNS/Cloudflare fora deste PR.');
});
