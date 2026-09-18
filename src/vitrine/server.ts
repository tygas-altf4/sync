import { createVitrineServer } from './http.js';
import { createVitrineStore } from './store.js';

const port = Number(process.env['PORT'] ?? 3000);
const { mode } = createVitrineStore();
const server = createVitrineServer();

server.listen(port, () => {
  console.log(`Plvria Sync hotsite DRAFT  http://127.0.0.1:${port}`);
  console.log(`Store: ${mode}  (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; anon não select leads)`);
  console.log('Não publicar em produção sem ok do Dinheiro Bot + Thiago. DNS/Cloudflare fora deste PR.');
});
