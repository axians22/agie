import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hojeBrasil } from '@emprestimos/dominio';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { criarApp } from './app.ts';
import { criarVerificadorGoogle } from './auth.ts';
import { fazerBackup } from './backup.ts';
import { lerConfig } from './config.ts';
import { abrirBanco } from './db.ts';

const config = lerConfig();
const db = abrirBanco(config.dbPath);
const app = criarApp({ db, config, google: criarVerificadorGoogle(config.googleClientId) });

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

serve({ fetch: app.fetch, port: config.porta }, ({ port }) => console.log(`API em http://localhost:${port}`));
