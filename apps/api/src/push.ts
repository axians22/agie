import type { DatabaseSync } from 'node:sqlite';
import { hojeBrasil, horaBrasil } from '@emprestimos/dominio';
import webpush from 'web-push';
import type { Config } from './config.ts';
import { Repo } from './repo.ts';

export interface InscricaoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Aparece na tela bloqueada: nunca inclui valores nem nomes. */
export interface MensagemPush {
  titulo: string;
  corpo: string;
  url: string;
  tag: string;
}

export type ResultadoPush = 'ok' | 'expirada' | 'falha';

export interface EnviadorPush {
  enviar(inscricao: InscricaoPush, mensagem: MensagemPush, validadeSegundos: number): Promise<ResultadoPush>;
}

const MAX_INSCRICOES_POR_USUARIO = 10;
const HORA_LEMBRETES = 9;
const DIA_S = 86_400;
const DIAS_GUARDAR_LEMBRETE = 40;
const SERVICOS_PUSH = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];

/** O servidor faz POST neste endereço, então só aceita os serviços de push dos navegadores. */
export function endpointPermitido(valor: string): boolean {
  try {
    const u = new URL(valor);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return u.hostname === 'fcm.googleapis.com' || SERVICOS_PUSH.some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}

export function chavesInscricaoValidas(p256dh: string, auth: string): boolean {
  const b64 = /^[A-Za-z0-9_-]+$/;
  return (
    b64.test(p256dh) && b64.test(auth) &&
    Buffer.from(p256dh, 'base64url').length === 65 && Buffer.from(auth, 'base64url').length === 16
  );
}

function somarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * DIA_S * 1000).toISOString().slice(0, 10);
}

function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / (DIA_S * 1000));
}

const LEMBRETES = {
  tres: { titulo: 'Parcela vence em 3 dias', corpo: 'Abra o app para ver os detalhes.' },
  hoje: { titulo: 'Parcela vence hoje', corpo: 'Abra o app para ver os detalhes.' },
  atraso: { titulo: 'Parcela em atraso', corpo: 'Abra o app para regularizar.' },
} as const;

export class ServicoPush {
  readonly chavePublica: string | null;
  private readonly db: DatabaseSync;
  private readonly config: Config;
  private readonly repo: Repo;
  private readonly enviador: EnviadorPush | null;
  private readonly pendentes = new Set<Promise<unknown>>();
  private lembretesRodando = false;

  constructor(db: DatabaseSync, config: Config, opcoes: { enviador: EnviadorPush; chavePublica: string } | null = null) {
    this.db = db;
    this.config = config;
    this.repo = new Repo(db);
    this.enviador = opcoes?.enviador ?? null;
    this.chavePublica = opcoes?.chavePublica ?? null;
  }

  get disponivel(): boolean {
    return !!this.enviador && !!this.chavePublica;
  }

  salvarInscricao(usuarioId: number, i: InscricaoPush): void {
    this.db
      .prepare(
        `INSERT INTO push_inscricoes (endpoint, usuario_id, p256dh, auth) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
           criada_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(i.endpoint, usuarioId, i.p256dh, i.auth);
    this.db
      .prepare(
        `DELETE FROM push_inscricoes WHERE usuario_id = ? AND endpoint NOT IN (
           SELECT endpoint FROM push_inscricoes WHERE usuario_id = ? ORDER BY criada_em DESC, rowid DESC LIMIT ?)`,
      )
      .run(usuarioId, usuarioId, MAX_INSCRICOES_POR_USUARIO);
  }

  removerInscricao(usuarioId: number, endpoint: string): void {
    this.db.prepare('DELETE FROM push_inscricoes WHERE usuario_id = ? AND endpoint = ?').run(usuarioId, endpoint);
  }

  /** Envia e devolve em quantos aparelhos chegou. Inscrição vencida é apagada. */
  private async enviarPara(usuarioIds: number[], mensagem: MensagemPush, validade: number): Promise<number> {
    if (!this.enviador || usuarioIds.length === 0) return 0;
    const consulta = this.db.prepare('SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE usuario_id = ?');
    const inscricoes = usuarioIds.flatMap((id) => consulta.all(id) as unknown as InscricaoPush[]);
    const resultados = await Promise.all(
      inscricoes.map(async (i) => {
        const r = await this.enviador!.enviar(i, mensagem, validade).catch((): ResultadoPush => 'falha');
        if (r === 'expirada') this.db.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?').run(i.endpoint);
        return r;
      }),
    );
    return resultados.filter((r) => r === 'ok').length;
  }

  /** Não atrasa nem derruba a ação do usuário: uma falha de push nunca desfaz um pagamento ou uma aprovação. */
  private disparar(envio: () => Promise<unknown>): void {
    if (!this.disponivel) return;
    const p: Promise<unknown> = envio()
      .catch(() => console.error('falha ao enviar notificação'))
      .finally(() => this.pendentes.delete(p));
    this.pendentes.add(p);
  }

  async aguardar(): Promise<void> {
    await Promise.all([...this.pendentes]);
  }

  paraPessoa(pessoaId: number, mensagem: MensagemPush): void {
    this.disparar(async () => {
      const u = this.db
        .prepare('SELECT u.id FROM usuarios u JOIN pessoas p ON lower(p.email) = u.email WHERE p.id = ?')
        .get(pessoaId) as { id: number } | undefined;
      if (u) await this.enviarPara([u.id], mensagem, 3 * DIA_S);
    });
  }

  paraAdmins(mensagem: MensagemPush): void {
    this.disparar(async () => {
      const contas = this.db
        .prepare('SELECT u.id, u.email, EXISTS (SELECT 1 FROM admins a WHERE a.email = u.email) AS cadastrado FROM usuarios u')
        .all() as Array<{ id: number; email: string; cadastrado: number }>;
      const ids = contas.filter((c) => c.cadastrado || this.config.adminEmails.has(c.email)).map((c) => c.id);
      await this.enviarPara(ids, mensagem, 3 * DIA_S);
    });
  }

  async teste(usuarioId: number): Promise<number> {
    return this.enviarPara(usuarioId ? [usuarioId] : [], { titulo: 'Notificações ativadas', corpo: 'Este aparelho vai receber os avisos do app.', url: '/', tag: 'teste' }, 600);
  }

  /** Avisa 3 dias antes, no dia e, em atraso, no primeiro dia e a cada 7 dias. Pode rodar várias vezes ao dia. */
  async rodarLembretes(agora: Date = new Date()): Promise<number> {
    if (!this.disponivel || this.lembretesRodando || horaBrasil(agora) < HORA_LEMBRETES) return 0;
    this.lembretesRodando = true;
    try {
      const hoje = hojeBrasil(agora);
      const em3 = somarDias(hoje, 3);
      this.db.prepare('DELETE FROM push_lembretes WHERE data < ?').run(somarDias(hoje, -DIAS_GUARDAR_LEMBRETE));
      const destinos = this.db
        .prepare(
          `SELECT DISTINCT p.id AS pessoaId, u.id AS usuarioId FROM push_inscricoes i
           JOIN usuarios u ON u.id = i.usuario_id JOIN pessoas p ON lower(p.email) = u.email`,
        )
        .all() as Array<{ pessoaId: number; usuarioId: number }>;
      let enviados = 0;
      for (const { pessoaId, usuarioId } of destinos) {
        const grupos = { tres: new Set<number>(), hoje: new Set<number>(), atraso: new Set<number>() };
        for (const v of this.repo.visoes(hoje, pessoaId)) {
          // Já informou o pagamento: não cobra enquanto o credor não responder.
          if (this.repo.avisoPendente(v.emprestimo.id)) continue;
          for (const p of v.consolidado.saldo.parcelas) {
            if (p.restante <= 0) continue;
            if (p.vencimento === em3) grupos.tres.add(v.emprestimo.id);
            else if (p.vencimento === hoje) grupos.hoje.add(v.emprestimo.id);
            else if (p.vencimento < hoje && (diasEntre(p.vencimento, hoje) - 1) % 7 === 0) grupos.atraso.add(v.emprestimo.id);
          }
        }
        for (const tipo of ['tres', 'hoje', 'atraso'] as const) {
          const ids = [...grupos[tipo]];
          if (ids.length === 0) continue;
          const chave = `${tipo}:${pessoaId}:${hoje}`;
          if (this.db.prepare('SELECT 1 FROM push_lembretes WHERE chave = ?').get(chave)) continue;
          const url = ids.length === 1 ? `/emprestimos/${ids[0]}` : tipo === 'atraso' ? '/atrasados' : '/emprestimos';
          const entregues = await this.enviarPara([usuarioId], { ...LEMBRETES[tipo], url, tag: `lembrete-${tipo}` }, DIA_S);
          if (entregues > 0) {
            this.db.prepare('INSERT OR IGNORE INTO push_lembretes (chave, data) VALUES (?, ?)').run(chave, hoje);
            enviados += 1;
          }
        }
      }
      return enviados;
    } finally {
      this.lembretesRodando = false;
    }
  }
}

function enviadorReal(chaves: { publica: string; privada: string }, assunto: string): EnviadorPush {
  return {
    async enviar(i, mensagem, validade) {
      try {
        await webpush.sendNotification(
          { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
          JSON.stringify(mensagem),
          { TTL: validade, urgency: 'normal', timeout: 10_000, vapidDetails: { subject: assunto, publicKey: chaves.publica, privateKey: chaves.privada } },
        );
        return 'ok';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'expirada' : 'falha';
      }
    },
  };
}

/** As chaves ficam no banco, para o deploy não exigir configuração e os aparelhos continuarem inscritos. */
export function criarServicoPush(db: DatabaseSync, config: Config): ServicoPush {
  const assunto = [...config.origens].find((o) => o.startsWith('https://'));
  if (!assunto) return new ServicoPush(db, config);
  let linha = db.prepare('SELECT chave_publica AS publica, chave_privada AS privada FROM config_push WHERE id = 1').get() as
    | { publica: string; privada: string }
    | undefined;
  if (!linha) {
    const novas = webpush.generateVAPIDKeys();
    db.prepare('INSERT OR IGNORE INTO config_push (id, chave_publica, chave_privada) VALUES (1, ?, ?)').run(novas.publicKey, novas.privateKey);
    linha = db.prepare('SELECT chave_publica AS publica, chave_privada AS privada FROM config_push WHERE id = 1').get() as { publica: string; privada: string };
  }
  return new ServicoPush(db, config, { enviador: enviadorReal(linha, assunto), chavePublica: linha.publica });
}
