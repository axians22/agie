import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hojeBrasil } from '@emprestimos/dominio';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { criarApp } from './app.ts';
import { criarVerificadorGoogle } from './auth.ts';
import { ArquivosComprovante, LimpezaComprovantes } from './comprovantes.ts';
import { fazerBackup } from './backup.ts';
import { lerConfig } from './config.ts';
import { abrirBanco } from './db.ts';
import { criarServicoPush } from './push.ts';
import { Repo } from './repo.ts';

const config = lerConfig();
const db = abrirBanco(config.dbPath);
const push = criarServicoPush(db, config);
const comprovantes = new ArquivosComprovante(config.comprovantesDir);
const app = criarApp({ db, config, google: criarVerificadorGoogle(config.googleClientId), push, comprovantes });

const raizWeb = resolve(config.webDist);
app.use('/sw.js', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-cache');
});
app.use('/assets/*', async (c, next) => {
  await next();
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
app.use('*', serveStatic({ root: raizWeb }));
app.get('*', async (c) => {
  try {
    c.header('Cache-Control', 'no-cache');
    return c.html(await readFile(resolve(raizWeb, 'index.html'), 'utf8'));
  } catch {
    return c.text('Interface web não compilada.', 503);
  }
});

if (config.backupDir) {
  const pasta = config.backupDir;
  const rodar = () => {
    try {
      fazerBackup(db, pasta, hojeBrasil());
    } catch (e) {
      console.error('falha no backup', e instanceof Error ? e.message : 'desconhecido');
    }
  };
  rodar();
  setInterval(rodar, 6 * 60 * 60 * 1000).unref();
}

if (push.disponivel) {
  const lembrar = () => void push.rodarLembretes().catch(() => console.error('falha nos lembretes'));
  setTimeout(lembrar, 30_000).unref();
  setInterval(lembrar, 15 * 60 * 1000).unref();
}

const limpeza = new LimpezaComprovantes(new Repo(db), comprovantes);
const limparComprovantes = () => void limpeza.executarSeDevido().catch(() => console.error('falha na limpeza de comprovantes'));
setTimeout(limparComprovantes, 60_000).unref();
setInterval(limparComprovantes, 15 * 60 * 1000).unref();

serve({ fetch: app.fetch, port: config.porta }, ({ port }) => console.log(`API em http://localhost:${port}`));
