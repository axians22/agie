import { dirname, join } from 'node:path';

export interface Config {
  producao: boolean;
  porta: number;
  dbPath: string;
  webDist: string;
  backupDir: string | null;
  comprovantesDir: string;
  googleClientId: string | null;
  adminEmails: Set<string>;
  origens: Set<string>;
  cookieSeguro: boolean;
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === 'production';
  const adminEmails = new Set(lista(env.ADMIN_EMAILS).map(normalizarEmail));

  const origens = new Set(lista(env.APP_ORIGINS).map((o) => new URL(o).origin));
  if (producao) {
    if (adminEmails.size === 0) throw new Error('Defina ADMIN_EMAILS.');
    if (origens.size === 0) throw new Error('Defina APP_ORIGINS.');
    if (!env.GOOGLE_CLIENT_ID) throw new Error('Defina GOOGLE_CLIENT_ID.');
  }

  const dbPath = env.DB_PATH ?? './data/emprestimos.db';

  return {
    producao,
    porta: Number(env.PORT ?? 3000),
    dbPath,
    webDist: env.WEB_DIST ?? '../web/dist',
    backupDir: env.BACKUP_DIR ?? null,
    comprovantesDir: env.COMPROVANTES_DIR ?? join(dirname(dbPath), 'comprovantes'),
    googleClientId: env.GOOGLE_CLIENT_ID ?? null,
    adminEmails,
    origens,
    cookieSeguro: producao || env.COOKIE_SECURE === 'true',
  };
}
