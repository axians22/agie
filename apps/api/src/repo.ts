import type { DatabaseSync } from 'node:sqlite';
import {
  consolidar,
  gerarParcelas,
  resumir,
  valorParaPagarAgora,
  type Consolidado,
  type TipoMulta,
} from '@emprestimos/dominio';
import { normalizarEmail } from './config.ts';
import { transacao } from './db.ts';

export interface Pessoa {
  id: number;
  nome: string;
  sobrenome: string;
  telefone: string;
  email: string | null;
  avatarUrl: string | null;
  criadaEm: string;
}

export interface Emprestimo {
  id: number;
  pessoaId: number;
  nome: string | null;
  valorTotalCentavos: number;
  dataEmprestimo: string;
  dataPrevistaPagamento: string;
  primeiroVencimento: string;
  numParcelas: number;
  jurosAoMesPct: number;
  tipoMulta: TipoMulta;
  multaValor: number;
  criadoEm: string;
}

export interface Pagamento {
  id: number;
  emprestimoId: number;
  data: string;
  valorCentavos: number;
  observacao: string | null;
  parcelaMarcada: number | null;
  criadoEm: string;
}

export type DadosPessoa = Pick<Pessoa, 'nome' | 'sobrenome' | 'telefone' | 'email'>;
export type DadosEmprestimo = Omit<Emprestimo, 'id' | 'criadoEm'>;
export type DadosPagamento = Pick<Pagamento, 'data' | 'valorCentavos' | 'observacao'>;

const C_PESSOA = 'id, nome, sobrenome, telefone, email, avatar_url AS avatarUrl, criada_em AS criadaEm';
const C_EMP = `id, pessoa_id AS pessoaId, nome, valor_total_centavos AS valorTotalCentavos,
  data_emprestimo AS dataEmprestimo, data_prevista_pagamento AS dataPrevistaPagamento,
  primeiro_vencimento AS primeiroVencimento, num_parcelas AS numParcelas,
  juros_ao_mes_pct AS jurosAoMesPct, tipo_multa AS tipoMulta, multa_valor AS multaValor, criado_em AS criadoEm`;
const C_PAG = `id, emprestimo_id AS emprestimoId, data, valor_centavos AS valorCentavos, observacao,
  parcela_marcada AS parcelaMarcada, criado_em AS criadoEm`;

const MARCA = /^toggle:parcela:(\d+)$/;

export interface EmprestimoVisao {
  emprestimo: Emprestimo;
  pessoa: Pessoa;
  pagamentos: Pagamento[];
  consolidado: Consolidado;
  valorPagarAgora: number;
}

export type StatusPedido = 'pendente' | 'aprovado' | 'recusado' | 'cancelado';

export interface Pedido {
  id: number;
  pessoaId: number;
  valorCentavos: number;
  numParcelas: number;
  primeiroVencimento: string;
  finalidade: string | null;
  status: StatusPedido;
  motivoRecusa: string | null;
  emprestimoId: number | null;
  criadoEm: string;
  decididoEm: string | null;
}

export type DadosPedido = Pick<Pedido, 'valorCentavos' | 'numParcelas' | 'primeiroVencimento' | 'finalidade'>;

const C_PEDIDO = `id, pessoa_id AS pessoaId, valor_centavos AS valorCentavos, num_parcelas AS numParcelas,
  primeiro_vencimento AS primeiroVencimento, finalidade, status, motivo_recusa AS motivoRecusa,
  emprestimo_id AS emprestimoId, criado_em AS criadoEm, decidido_em AS decididoEm`;

export interface DadosPixConfig {
  chave: string;
  nome: string;
  cidade: string;
}

export interface IdentidadePessoa {
  email: string;
  nome: string | null;
  avatarUrl: string | null;
}

export class Repo {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // Configurações
  pixConfig(): DadosPixConfig | null {
    const r = this.db.prepare('SELECT chave, nome, cidade FROM config_pix WHERE id = 1').get() as unknown as DadosPixConfig | undefined;
    return r ? { chave: r.chave, nome: r.nome, cidade: r.cidade } : null;
  }
  salvarPix(d: DadosPixConfig, por: string): void {
    this.db
      .prepare(
        `INSERT INTO config_pix (id, chave, nome, cidade, atualizado_por) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET chave = excluded.chave, nome = excluded.nome, cidade = excluded.cidade,
           atualizado_por = excluded.atualizado_por, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(d.chave, d.nome, d.cidade, por);
  }
  adminsCadastrados(): string[] {
    return (this.db.prepare('SELECT email FROM admins ORDER BY email').all() as Array<{ email: string }>).map((a) => a.email);
  }
  ehAdminCadastrado(email: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM admins WHERE email = ?').get(normalizarEmail(email));
  }
  /** Transforma em admin. A ficha criada pelo login sai junto, desde que não tenha empréstimos. */
  promoverAdmin(email: string, por: string): boolean {
    const e = normalizarEmail(email);
    return transacao(this.db, () => {
      const p = this.db
        .prepare('SELECT id, via_google AS viaGoogle, (SELECT COUNT(*) FROM emprestimos WHERE pessoa_id = pessoas.id) + (SELECT COUNT(*) FROM pedidos WHERE pessoa_id = pessoas.id) AS n FROM pessoas WHERE lower(email) = ?')
        .get(e) as { id: number; viaGoogle: number; n: number } | undefined;
      if (p && (!p.viaGoogle || p.n > 0)) return false;
      if (p) this.db.prepare('DELETE FROM pessoas WHERE id = ?').run(p.id);
      this.db.prepare('INSERT INTO admins (email, criado_por) VALUES (?, ?)').run(e, por);
      return true;
    });
  }
  removerAdmin(email: string): boolean {
    const e = normalizarEmail(email);
    return transacao(this.db, () => {
      if (this.db.prepare('DELETE FROM admins WHERE email = ?').run(e).changes === 0) return false;
      this.db.prepare('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE email = ?)').run(e);
      return true;
    });
  }

  // Pessoas que entraram com Google
  private gravarPessoaGoogle(id: IdentidadePessoa): void {
    const email = normalizarEmail(id.email);
    const partes = (id.nome ?? '').trim().split(/\s+/).filter(Boolean);
    const nome = (partes[0] ?? email.split('@')[0]!).slice(0, 100);
    const sobrenome = partes.slice(1).join(' ').slice(0, 100);
    this.db
      .prepare('INSERT INTO pessoas (nome, sobrenome, email, avatar_url, via_google) VALUES (?, ?, ?, ?, 1) ON CONFLICT DO NOTHING')
      .run(nome, sobrenome, email, id.avatarUrl);
    // Nome e telefone podem ter sido corrigidos pelo admin; só a foto acompanha o Google.
    if (id.avatarUrl) this.db.prepare('UPDATE pessoas SET avatar_url = ? WHERE lower(email) = ?').run(id.avatarUrl, email);
  }
  registrarPessoaGoogle(id: IdentidadePessoa): void {
    transacao(this.db, () => this.gravarPessoaGoogle(id));
  }
  /** Traz para Pessoas quem já tinha entrado no app antes desta lista existir. */
  sincronizarPessoasGoogle(principais: Set<string>): void {
    transacao(this.db, () => {
      const contas = this.db
        .prepare(
          `SELECT email, nome, avatar_url AS avatarUrl FROM usuarios u
           WHERE NOT EXISTS (SELECT 1 FROM admins a WHERE a.email = u.email)
             AND NOT EXISTS (SELECT 1 FROM pessoas p WHERE lower(p.email) = u.email)`,
        )
        .all() as unknown as IdentidadePessoa[];
      for (const c of contas) if (!principais.has(c.email)) this.gravarPessoaGoogle(c);
    });
  }

  // Pessoas
  pessoas(): Pessoa[] {
    return this.db.prepare(`SELECT ${C_PESSOA} FROM pessoas ORDER BY nome COLLATE NOCASE, id`).all() as unknown as Pessoa[];
  }
  pessoa(id: number): Pessoa | null {
    return (this.db.prepare(`SELECT ${C_PESSOA} FROM pessoas WHERE id = ?`).get(id) as unknown as Pessoa) ?? null;
  }
  emailEmUso(email: string, ignorarId?: number): boolean {
    const r = this.db.prepare('SELECT id FROM pessoas WHERE lower(email) = ?').get(normalizarEmail(email)) as { id: number } | undefined;
    return !!r && r.id !== ignorarId;
  }
  criarPessoa(d: DadosPessoa): number {
    const r = this.db
      .prepare('INSERT INTO pessoas (nome, sobrenome, telefone, email) VALUES (?, ?, ?, ?)')
      .run(d.nome, d.sobrenome, d.telefone, d.email ? normalizarEmail(d.email) : null);
    return Number(r.lastInsertRowid);
  }
  atualizarPessoa(id: number, d: DadosPessoa): boolean {
    const r = this.db
      .prepare('UPDATE pessoas SET nome = ?, sobrenome = ?, telefone = ?, email = ? WHERE id = ?')
      .run(d.nome, d.sobrenome, d.telefone, d.email ? normalizarEmail(d.email) : null, id);
    return Number(r.changes) > 0;
  }
  removerPessoa(id: number): boolean {
    return transacao(this.db, () => {
      const p = this.db.prepare('SELECT email FROM pessoas WHERE id = ?').get(id) as { email: string | null } | undefined;
      if (!p) return false;
      this.db.prepare('DELETE FROM pessoas WHERE id = ?').run(id);
      // Encerra a conta junto, para a pessoa não voltar à lista sem um novo login.
      if (p.email) this.db.prepare('DELETE FROM usuarios WHERE email = ? AND email NOT IN (SELECT email FROM admins)').run(normalizarEmail(p.email));
      return true;
    });
  }

  // Pedidos de empréstimo
  pedido(id: number): Pedido | null {
    return (this.db.prepare(`SELECT ${C_PEDIDO} FROM pedidos WHERE id = ?`).get(id) as unknown as Pedido) ?? null;
  }
  pedidosDaPessoa(pessoaId: number): Pedido[] {
    return this.db.prepare(`SELECT ${C_PEDIDO} FROM pedidos WHERE pessoa_id = ? ORDER BY id DESC`).all(pessoaId) as unknown as Pedido[];
  }
  todosPedidos(): Pedido[] {
    return this.db
      .prepare(`SELECT ${C_PEDIDO} FROM pedidos ORDER BY status = 'pendente' DESC, CASE WHEN status = 'pendente' THEN id ELSE -id END`)
      .all() as unknown as Pedido[];
  }
  contarPedidosPendentes(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE status = 'pendente'").get() as { n: number }).n;
  }
  /** Devolve null se a pessoa já tem um pedido aguardando. */
  criarPedido(pessoaId: number, d: DadosPedido): number | null {
    return transacao(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM pedidos WHERE pessoa_id = ? AND status = 'pendente'").get(pessoaId)) return null;
      const r = this.db
        .prepare('INSERT INTO pedidos (pessoa_id, valor_centavos, num_parcelas, primeiro_vencimento, finalidade) VALUES (?,?,?,?,?)')
        .run(pessoaId, d.valorCentavos, d.numParcelas, d.primeiroVencimento, d.finalidade);
      return Number(r.lastInsertRowid);
    });
  }
  cancelarPedido(id: number, pessoaId: number, agora: Date): boolean {
    const r = this.db
      .prepare("UPDATE pedidos SET status = 'cancelado', decidido_em = ? WHERE id = ? AND pessoa_id = ? AND status = 'pendente'")
      .run(agora.toISOString(), id, pessoaId);
    return Number(r.changes) > 0;
  }
  recusarPedido(id: number, motivo: string | null, por: string, agora: Date): boolean {
    const r = this.db
      .prepare("UPDATE pedidos SET status = 'recusado', motivo_recusa = ?, decidido_por = ?, decidido_em = ? WHERE id = ? AND status = 'pendente'")
      .run(motivo, por, agora.toISOString(), id);
    return Number(r.changes) > 0;
  }
  /** Gera o empréstimo e fecha o pedido juntos. Devolve null se o pedido já foi decidido. */
  aprovarPedido(id: number, d: Omit<DadosEmprestimo, 'pessoaId'>, por: string, agora: Date): number | null {
    return transacao(this.db, () => {
      const p = this.pedido(id);
      if (!p || p.status !== 'pendente') return null;
      const emprestimoId = this.criarEmprestimo({ ...d, pessoaId: p.pessoaId });
      this.db
        .prepare("UPDATE pedidos SET status = 'aprovado', emprestimo_id = ?, decidido_por = ?, decidido_em = ? WHERE id = ?")
        .run(emprestimoId, por, agora.toISOString(), id);
      return emprestimoId;
    });
  }

  // Empréstimos
  emprestimo(id: number): Emprestimo | null {
    return (this.db.prepare(`SELECT ${C_EMP} FROM emprestimos WHERE id = ?`).get(id) as unknown as Emprestimo) ?? null;
  }
  criarEmprestimo(d: DadosEmprestimo): number {
    const r = this.db
      .prepare(
        `INSERT INTO emprestimos (pessoa_id, nome, valor_total_centavos, data_emprestimo, data_prevista_pagamento,
          primeiro_vencimento, num_parcelas, juros_ao_mes_pct, tipo_multa, multa_valor) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(d.pessoaId, d.nome, d.valorTotalCentavos, d.dataEmprestimo, d.dataPrevistaPagamento, d.primeiroVencimento, d.numParcelas, d.jurosAoMesPct, d.tipoMulta, d.multaValor);
    return Number(r.lastInsertRowid);
  }
  atualizarEmprestimo(id: number, d: DadosEmprestimo): boolean {
    const r = this.db
      .prepare(
        `UPDATE emprestimos SET pessoa_id=?, nome=?, valor_total_centavos=?, data_emprestimo=?, data_prevista_pagamento=?,
          primeiro_vencimento=?, num_parcelas=?, juros_ao_mes_pct=?, tipo_multa=?, multa_valor=? WHERE id=?`,
      )
      .run(d.pessoaId, d.nome, d.valorTotalCentavos, d.dataEmprestimo, d.dataPrevistaPagamento, d.primeiroVencimento, d.numParcelas, d.jurosAoMesPct, d.tipoMulta, d.multaValor, id);
    return Number(r.changes) > 0;
  }
  removerEmprestimo(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM emprestimos WHERE id = ?').run(id).changes) > 0;
  }

  // Pagamentos
  pagamentos(emprestimoId: number): Pagamento[] {
    return this.db
      .prepare(`SELECT ${C_PAG} FROM pagamentos WHERE emprestimo_id = ? ORDER BY data DESC, id DESC`)
      .all(emprestimoId) as unknown as Pagamento[];
  }
  pagamento(id: number): Pagamento | null {
    return (this.db.prepare(`SELECT ${C_PAG} FROM pagamentos WHERE id = ?`).get(id) as unknown as Pagamento) ?? null;
  }
  registrarPagamento(emprestimoId: number, d: DadosPagamento): number {
    const r = this.db
      .prepare('INSERT INTO pagamentos (emprestimo_id, data, valor_centavos, observacao) VALUES (?,?,?,?)')
      .run(emprestimoId, d.data, d.valorCentavos, d.observacao);
    return Number(r.lastInsertRowid);
  }
  atualizarPagamento(id: number, d: DadosPagamento): boolean {
    const r = this.db
      .prepare('UPDATE pagamentos SET data=?, valor_centavos=?, observacao=? WHERE id=?')
      .run(d.data, d.valorCentavos, d.observacao, id);
    return Number(r.changes) > 0;
  }
  removerPagamento(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM pagamentos WHERE id = ?').run(id).changes) > 0;
  }

  /** Clique na parcela: quita o que falta ou, se já foi marcada assim, desfaz. */
  alternarParcela(emprestimoId: number, numero: number, hoje: string): 'marcada' | 'desmarcada' | 'jaPaga' | null {
    return transacao(this.db, () => {
      const e = this.emprestimo(emprestimoId);
      if (!e || numero < 1 || numero > e.numParcelas) return null;
      const removidas = this.db
        .prepare('DELETE FROM pagamentos WHERE emprestimo_id = ? AND parcela_marcada = ?')
        .run(emprestimoId, numero);
      if (Number(removidas.changes) > 0) return 'desmarcada';
      const c = consolidar(e, this.basePagamentos(emprestimoId), hoje);
      const falta = c.saldo.parcelas.find((p) => p.numero === numero)?.restante ?? 0;
      if (falta === 0) return 'jaPaga';
      this.db
        .prepare('INSERT INTO pagamentos (emprestimo_id, data, valor_centavos, parcela_marcada) VALUES (?,?,?,?)')
        .run(emprestimoId, hoje, falta, numero);
      return 'marcada';
    });
  }

  private basePagamentos(emprestimoId: number) {
    return this.pagamentos(emprestimoId).map((p) => ({ data: p.data, valor: p.valorCentavos }));
  }

  // Visões
  private visao(e: Emprestimo, pessoa: Pessoa, pagamentos: Pagamento[], hoje: string): EmprestimoVisao {
    const consolidado = consolidar(e, pagamentos.map((p) => ({ data: p.data, valor: p.valorCentavos })), hoje);
    return { emprestimo: e, pessoa, pagamentos, consolidado, valorPagarAgora: valorParaPagarAgora(consolidado) };
  }

  visaoPorId(id: number, hoje: string): EmprestimoVisao | null {
    const e = this.emprestimo(id);
    if (!e) return null;
    return this.visao(e, this.pessoa(e.pessoaId)!, this.pagamentos(id), hoje);
  }

  /** Com pessoaId, devolve somente os empréstimos dessa pessoa. */
  visoes(hoje: string, pessoaId?: number): EmprestimoVisao[] {
    const emprestimos = (
      pessoaId === undefined
        ? this.db.prepare(`SELECT ${C_EMP} FROM emprestimos ORDER BY criado_em DESC, id DESC`).all()
        : this.db.prepare(`SELECT ${C_EMP} FROM emprestimos WHERE pessoa_id = ? ORDER BY criado_em DESC, id DESC`).all(pessoaId)
    ) as unknown as Emprestimo[];
    return emprestimos.map((e) => this.visao(e, this.pessoa(e.pessoaId)!, this.pagamentos(e.id), hoje));
  }

  resumo(hoje: string, pessoaId?: number) {
    return resumir(this.visoes(hoje, pessoaId).map((v) => ({ valorTotalCentavos: v.emprestimo.valorTotalCentavos, consolidado: v.consolidado })));
  }

  // Backup no formato do app Flutter (formato 1)
  exportar(agora: Date) {
    const pessoas = this.db.prepare(`SELECT ${C_PESSOA} FROM pessoas ORDER BY id`).all() as unknown as Pessoa[];
    const emprestimos = this.db.prepare(`SELECT ${C_EMP} FROM emprestimos ORDER BY id`).all() as unknown as Emprestimo[];
    const pagamentos = this.db.prepare(`SELECT ${C_PAG} FROM pagamentos ORDER BY id`).all() as unknown as Pagamento[];
    return {
      formato: 1,
      geradoEm: agora.toISOString(),
      pessoas: pessoas.map((p) => ({ ...p })),
      emprestimos: emprestimos.map((e) => ({ ...e })),
      pagamentos: pagamentos.map(({ parcelaMarcada, ...p }) => ({
        ...p,
        observacao: parcelaMarcada ? `toggle:parcela:${parcelaMarcada}` : p.observacao,
      })),
    };
  }

  vazio(): boolean {
    const r = this.db.prepare('SELECT (SELECT COUNT(*) FROM pessoas) + (SELECT COUNT(*) FROM emprestimos) AS n').get() as { n: number };
    return r.n === 0;
  }

  /** Importa um backup para um banco vazio e confere que os totais não mudaram. */
  importar(b: BackupEntrada): { pessoas: number; emprestimos: number; pagamentos: number } {
    return transacao(this.db, () => {
      const manuais = this.db.prepare('SELECT (SELECT COUNT(*) FROM pessoas WHERE via_google = 0 OR email IS NULL) + (SELECT COUNT(*) FROM emprestimos) + (SELECT COUNT(*) FROM pedidos) AS n').get() as { n: number };
      if (manuais.n > 0) throw new ErroImportacao('O banco já tem dados. A importação só é feita antes de cadastrar pessoas, empréstimos e pedidos.');
      // Quem só fez login sai antes da importação e volta depois, sem disputar os ids do backup.
      const contasGoogle = this.db
        .prepare("SELECT email, trim(nome || ' ' || sobrenome) AS nome, avatar_url AS avatarUrl FROM pessoas")
        .all() as unknown as IdentidadePessoa[];
      this.db.exec('DELETE FROM pessoas');
      const insP = this.db.prepare('INSERT INTO pessoas (id, nome, sobrenome, telefone, email, criada_em) VALUES (?,?,?,?,?,?)');
      for (const p of b.pessoas) insP.run(p.id, p.nome, p.sobrenome, p.telefone, p.email ? normalizarEmail(p.email) : null, p.criadaEm);
      const insE = this.db.prepare(
        `INSERT INTO emprestimos (id, pessoa_id, nome, valor_total_centavos, data_emprestimo, data_prevista_pagamento,
         primeiro_vencimento, num_parcelas, juros_ao_mes_pct, tipo_multa, multa_valor, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const e of b.emprestimos) {
        gerarParcelas(e.valorTotalCentavos, e.numParcelas, e.primeiroVencimento.slice(0, 10));
        insE.run(e.id, e.pessoaId, e.nome, e.valorTotalCentavos, e.dataEmprestimo.slice(0, 10), e.dataPrevistaPagamento.slice(0, 10), e.primeiroVencimento.slice(0, 10), e.numParcelas, e.jurosAoMesPct, e.tipoMulta, e.multaValor, e.criadoEm);
      }
      const insPg = this.db.prepare('INSERT INTO pagamentos (id, emprestimo_id, data, valor_centavos, observacao, parcela_marcada, criado_em) VALUES (?,?,?,?,?,?,?)');
      for (const p of b.pagamentos) {
        const marca = p.observacao ? MARCA.exec(p.observacao) : null;
        insPg.run(p.id, p.emprestimoId, p.data.slice(0, 10), p.valorCentavos, marca ? null : p.observacao, marca ? Number(marca[1]) : null, p.criadoEm);
      }
      const somaP = (this.db.prepare('SELECT COALESCE(SUM(valor_centavos),0) AS s FROM pagamentos').get() as { s: number }).s;
      const somaE = (this.db.prepare('SELECT COALESCE(SUM(valor_total_centavos),0) AS s FROM emprestimos').get() as { s: number }).s;
      if (somaP !== b.pagamentos.reduce((s, p) => s + p.valorCentavos, 0) || somaE !== b.emprestimos.reduce((s, e) => s + e.valorTotalCentavos, 0)) {
        throw new ErroImportacao('Os totais importados não conferem com o backup.');
      }
      for (const c of contasGoogle) this.gravarPessoaGoogle(c);
      return { pessoas: b.pessoas.length, emprestimos: b.emprestimos.length, pagamentos: b.pagamentos.length };
    });
  }
}

export class ErroImportacao extends Error {}

export interface BackupEntrada {
  pessoas: Array<Pick<Pessoa, 'id' | 'nome' | 'sobrenome' | 'telefone' | 'email' | 'criadaEm'>>;
  emprestimos: Emprestimo[];
  pagamentos: Array<Omit<Pagamento, 'parcelaMarcada'>>;
}
