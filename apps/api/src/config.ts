export interface PixConfig {
  chave: string;
  nome: string;
  cidade: string;
}

export interface Config {
  producao: boolean;
  porta: number;
  dbPath: string;
  webDist: string;
  backupDir: string | null;
  googleClientId: string | null;
  adminEmails: Set<string>;
  origens: Set<string>;
  cookieSeguro: boolean;
  pix: PixConfig | null;
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

  const pix =
    env.PIX_CHAVE && env.PIX_NOME && env.PIX_CIDADE
      ? { chave: env.PIX_CHAVE, nome: env.PIX_NOME, cidade: env.PIX_CIDADE }
      : null;
  if (producao && !pix) throw new Error('Defina PIX_CHAVE, PIX_NOME e PIX_CIDADE.');

  return {
    producao,
    porta: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? './data/emprestimos.db',
    webDist: env.WEB_DIST ?? '../web/dist',
    backupDir: env.BACKUP_DIR ?? null,
    googleClientId: env.GOOGLE_CLIENT_ID ?? null,
    adminEmails,
    origens,
    cookieSeguro: producao || env.COOKIE_SECURE === 'true',
    pix,
  };
}
