import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { gaxios, OAuth2Client } from 'google-auth-library';
import { normalizarEmail, type Config } from './config.ts';

const DIA_MS = 86_400_000;
export const SESSAO_DIAS = 30;

export interface IdentidadeGoogle {
  email: string;
  nome: string | null;
  avatarUrl: string | null;
}

export interface VerificadorGoogle {
  verificar(token: string): Promise<IdentidadeGoogle>;
}

export class ErroGoogle extends Error {
  readonly indisponivel: boolean;
  constructor(indisponivel: boolean) {
    super(indisponivel ? 'google_indisponivel' : 'token_invalido');
    this.indisponivel = indisponivel;
  }
}

export function avatarSeguro(valor: unknown): string | null {
  if (typeof valor !== 'string' || valor.length > 2048) return null;
  try {
    const u = new URL(valor);
    const ok = u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com');
    return u.protocol === 'https:' && !u.username && !u.password && ok ? u.toString() : null;
  } catch {
    return null;
  }
}

function googleInacessivel(e: unknown): boolean {
  if (e instanceof gaxios.GaxiosError) return true;
  if (!(e instanceof Error)) return false;
  return (
    e.name === 'TimeoutError' ||
    e.name === 'AbortError' ||
    (e instanceof TypeError && /fetch failed/i.test(e.message)) ||
    e.message.startsWith('Failed to retrieve verification certificates')
  );
}

/** Confere assinatura, audiência, emissor, validade e e-mail verificado. Nunca registra o token nem o erro bruto. */
export function criarVerificadorGoogle(clientId: string | null): VerificadorGoogle {
  const cliente = new OAuth2Client({ transporterOptions: { timeout: 5000 } });
  return {
    async verificar(token) {
      if (!clientId) throw new ErroGoogle(true);
      let dados;
      try {
        dados = (await cliente.verifyIdToken({ idToken: token, audience: clientId })).getPayload();
      } catch (e) {
        throw new ErroGoogle(googleInacessivel(e));
      }
      if (!dados?.email || dados.email_verified !== true) throw new ErroGoogle(false);
      return { email: normalizarEmail(dados.email), nome: dados.name ?? null, avatarUrl: avatarSeguro(dados.picture) };
    },
  };
}

export type Papel = 'admin' | 'devedor';

export interface UsuarioSessao {
  id: number;
  email: string;
  nome: string | null;
  avatarUrl: string | null;
  papel: Papel;
  pessoaId: number | null;
}

/** O papel nunca é gravado: vem da lista de admins ou do e-mail na ficha da pessoa, a cada requisição. */
export function resolverPapel(db: DatabaseSync, config: Config, email: string): { papel: Papel; pessoaId: number | null } | null {
  const e = normalizarEmail(email);
  if (config.adminEmails.has(e) || db.prepare('SELECT 1 FROM admins WHERE email = ?').get(e)) return { papel: 'admin', pessoaId: null };
  const p = db.prepare('SELECT id FROM pessoas WHERE lower(email) = ?').get(e) as { id: number } | undefined;
  return p ? { papel: 'devedor', pessoaId: p.id } : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function registrarLogin(db: DatabaseSync, id: IdentidadeGoogle, agora: Date): number {
  const email = normalizarEmail(id.email);
  const r = db
    .prepare(
      `INSERT INTO usuarios (email, nome, avatar_url, ultimo_login) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, avatar_url = excluded.avatar_url, ultimo_login = excluded.ultimo_login
       RETURNING id`,
    )
    .get(email, id.nome, id.avatarUrl, agora.toISOString()) as { id: number };
  return r.id;
}

export function criarSessao(db: DatabaseSync, usuarioId: number, agora: Date): { token: string; expira: Date } {
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(agora.getTime() + SESSAO_DIAS * DIA_MS);
  db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(agora.getTime());
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)').run(hashToken(token), usuarioId, expira.getTime());
  return { token, expira };
}

export function validarSessao(
  db: DatabaseSync,
  config: Config,
  token: string,
  agora: Date,
): { usuario: UsuarioSessao; renovadaAte: Date | null } | null {
  const hash = hashToken(token);
  const s = db
    .prepare(
      `SELECT s.expira_em AS expira, u.id, u.email, u.nome, u.avatar_url AS avatarUrl
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`,
    )
    .get(hash) as { expira: number; id: number; email: string; nome: string | null; avatarUrl: string | null } | undefined;
  if (!s) return null;
  if (s.expira <= agora.getTime()) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hash);
    return null;
  }
  const papel = resolverPapel(db, config, s.email);
  if (!papel) {
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(s.id);
    return null;
  }
  let renovadaAte: Date | null = null;
  const ttl = SESSAO_DIAS * DIA_MS;
  if (s.expira - agora.getTime() < ttl / 2) {
    renovadaAte = new Date(agora.getTime() + ttl);
    db.prepare('UPDATE sessoes SET expira_em = ? WHERE token_hash = ?').run(renovadaAte.getTime(), hash);
  }
  return { usuario: { id: s.id, email: s.email, nome: s.nome, avatarUrl: s.avatarUrl, ...papel }, renovadaAte };
}

export function revogarSessao(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

export function nomeCookie(seguro: boolean): string {
  return seguro ? '__Host-emprestimos_sessao' : 'emprestimos_sessao';
}
