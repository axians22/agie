import type { DatabaseSync } from 'node:sqlite';
import { adicionaMeses, dataValida, gerarBrCode, hojeBrasil, normalizarChavePix } from '@emprestimos/dominio';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  criarSessao,
  ErroGoogle,
  nomeCookie,
  registrarLogin,
  revogarSessao,
  validarSessao,
  type UsuarioSessao,
  type VerificadorGoogle,
} from './auth.ts';
import { normalizarEmail, type Config } from './config.ts';
import { ErroImportacao, Repo, type EmprestimoVisao, type Pedido } from './repo.ts';

type Ambiente = { Variables: { usuario: UsuarioSessao } };

export interface Dependencias {
  db: DatabaseSync;
  config: Config;
  google: VerificadorGoogle;
  agora?: () => Date;
}

const ROTAS_PUBLICAS = new Set(['/api/saude', '/api/auth/config', '/api/auth/google', '/api/auth/google/redirect', '/api/auth/logout']);
const LIMITE_JSON = 100 * 1024;
const LIMITE_BACKUP = 10 * 1024 * 1024;

const data = z.string().refine(dataValida, 'data inválida');
const textoOpc = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const esquemaPessoa = z.strictObject({
  nome: z.string().trim().min(1).max(100),
  sobrenome: z.string().trim().max(100).default(''),
  telefone: z.string().trim().max(40).default(''),
  email: z.preprocess((v) => (v === '' ? null : v), z.email().max(254).nullable().default(null)),
});

const esquemaEmprestimo = z
  .strictObject({
    pessoaId: z.number().int().positive(),
    nome: textoOpc(80),
    valorTotalCentavos: z.number().int().positive().max(1_000_000_000_00),
    dataEmprestimo: data,
    dataPrevistaPagamento: data,
    primeiroVencimento: data,
    numParcelas: z.number().int().min(1).max(360),
    jurosAoMesPct: z.number().min(0).max(100).default(0),
    tipoMulta: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    multaValor: z.number().min(0).max(1_000_000_000_00).default(0),
  })
  .refine((e) => e.tipoMulta !== 2 || e.multaValor <= 100, { message: 'multa percentual acima de 100%' })
  .refine((e) => e.tipoMulta !== 1 || Number.isInteger(e.multaValor), { message: 'multa fixa deve estar em centavos' });

const esquemaPagamento = z.strictObject({
  data,
  valorCentavos: z.number().int().positive().max(1_000_000_000_00),
  observacao: textoOpc(500),
});

const esquemaPedido = z.strictObject({
  valorCentavos: z.number().int().positive().max(1_000_000_000_00),
  numParcelas: z.number().int().min(1).max(360),
  primeiroVencimento: data,
  finalidade: textoOpc(80),
});

const esquemaAprovacao = z
  .strictObject({
    nome: textoOpc(80),
    valorTotalCentavos: z.number().int().positive().max(1_000_000_000_00),
    dataEmprestimo: data,
    primeiroVencimento: data,
    numParcelas: z.number().int().min(1).max(360),
    jurosAoMesPct: z.number().min(0).max(100).default(0),
    tipoMulta: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    multaValor: z.number().min(0).max(1_000_000_000_00).default(0),
  })
  .refine((e) => e.tipoMulta !== 2 || e.multaValor <= 100, { message: 'multa percentual acima de 100%' })
  .refine((e) => e.tipoMulta !== 1 || Number.isInteger(e.multaValor), { message: 'multa fixa deve estar em centavos' })
  .refine((e) => e.primeiroVencimento >= e.dataEmprestimo, { path: ['primeiroVencimento'], message: 'vencimento antes do empréstimo' });

const esquemaRecusa = z.strictObject({ motivo: textoOpc(300) });

const esquemaPix = z.strictObject({
  chave: z.string().trim().min(1).max(100),
  nome: z.string().trim().min(1).max(25),
  cidade: z.string().trim().min(1).max(15),
});
const esquemaAdmin = z.strictObject({ email: z.string().trim().pipe(z.email().max(254)) });

const dataBackup = z.string().refine((v) => dataValida(v.slice(0, 10)), 'data inválida');
const esquemaBackup = z.object({
  formato: z.literal(1),
  pessoas: z.array(z.object({
    id: z.number().int().positive(),
    nome: z.string().min(1).max(100),
    sobrenome: z.string().max(100).nullish().transform((v) => v ?? ''),
    telefone: z.string().max(40).nullish().transform((v) => v ?? ''),
    email: z.string().max(254).nullish().transform((v) => v || null),
    criadaEm: z.string().max(40),
  })),
  emprestimos: z.array(z.object({
    id: z.number().int().positive(),
    pessoaId: z.number().int().positive(),
    nome: z.string().max(200).nullish().transform((v) => v ?? null),
    valorTotalCentavos: z.number().int().nonnegative(),
    dataEmprestimo: dataBackup,
    dataPrevistaPagamento: dataBackup,
    primeiroVencimento: dataBackup,
    numParcelas: z.number().int().min(1).max(1200),
    jurosAoMesPct: z.number().min(0).default(0),
    tipoMulta: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    multaValor: z.number().min(0).default(0),
    criadoEm: z.string().max(40),
  })),
  pagamentos: z.array(z.object({
    id: z.number().int().positive(),
    emprestimoId: z.number().int().positive(),
    data: dataBackup,
    valorCentavos: z.number().int().positive(),
    observacao: z.string().max(2000).nullish().transform((v) => v ?? null),
    criadoEm: z.string().max(40),
  })),
});

class ErroHttp extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 503;
  readonly codigo: string;
  constructor(status: 400 | 401 | 403 | 404 | 409 | 503, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const naoEncontrado = () => new ErroHttp(404, 'NAO_ENCONTRADO', 'Não encontrado.');

function idParam(c: Context, nome = 'id'): number {
  const v = c.req.param(nome) ?? '';
  if (!/^[1-9]\d{0,14}$/.test(v)) throw naoEncontrado();
  return Number(v);
}

async function corpo<T extends z.ZodType>(c: Context, esquema: T): Promise<z.output<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ErroHttp(400, 'JSON_INVALIDO', 'Dados inválidos.');
  }
  const r = esquema.safeParse(json);
  if (!r.success) {
    const campo = r.error.issues[0]?.path.join('.') || 'dados';
    throw new ErroHttp(400, 'VALIDACAO', `Campo inválido: ${campo}.`);
  }
  return r.data;
}

function dtoAdmin(v: EmprestimoVisao) {
  return {
    ...v.emprestimo,
    pessoa: { id: v.pessoa.id, nome: v.pessoa.nome, sobrenome: v.pessoa.sobrenome, telefone: v.pessoa.telefone, email: v.pessoa.email },
    saldo: v.consolidado.saldo,
    encargos: v.consolidado.encargos,
    temAtraso: v.consolidado.temAtraso,
    valorPagarAgora: v.valorPagarAgora,
    pagamentos: v.pagamentos,
  };
}

/** Lista explícita do que o devedor vê: nunca inclui observações do credor nem dados de outra pessoa. */
function dtoDevedor(v: EmprestimoVisao) {
  const e = v.emprestimo;
  return {
    id: e.id,
    nome: e.nome,
    valorTotalCentavos: e.valorTotalCentavos,
    dataEmprestimo: e.dataEmprestimo,
    dataPrevistaPagamento: e.dataPrevistaPagamento,
    primeiroVencimento: e.primeiroVencimento,
    numParcelas: e.numParcelas,
    jurosAoMesPct: e.jurosAoMesPct,
    tipoMulta: e.tipoMulta,
    multaValor: e.multaValor,
    saldo: v.consolidado.saldo,
    encargos: v.consolidado.encargos,
    temAtraso: v.consolidado.temAtraso,
    valorPagarAgora: v.valorPagarAgora,
    pagamentos: v.pagamentos.map((p) => ({ id: p.id, data: p.data, valorCentavos: p.valorCentavos })),
  };
}

/** Lista explícita do que o usuário vê do próprio pedido: não inclui quem decidiu. */
function dtoPedido(p: Pedido) {
  return {
    id: p.id,
    valorCentavos: p.valorCentavos,
    numParcelas: p.numParcelas,
    primeiroVencimento: p.primeiroVencimento,
    finalidade: p.finalidade,
    status: p.status,
    motivoRecusa: p.motivoRecusa,
    emprestimoId: p.emprestimoId,
    criadoEm: p.criadoEm,
    decididoEm: p.decididoEm,
  };
}

export function criarApp({ db, config, google, agora = () => new Date() }: Dependencias) {
  const repo = new Repo(db);
  repo.sincronizarPessoasGoogle(config.adminEmails);
  const app = new Hono<Ambiente>();
  const hoje = () => hojeBrasil(agora());
  const cookie = nomeCookie(config.cookieSeguro);

  const gravarCookie = (c: Context, token: string, expira: Date) =>
    setCookie(c, cookie, token, { httpOnly: true, sameSite: 'Strict', secure: config.cookieSeguro, path: '/', expires: expira });

  const dtoUsuario = (u: UsuarioSessao) => {
    const pessoa = u.pessoaId ? repo.pessoa(u.pessoaId) : null;
    return {
      email: u.email,
      nome: pessoa ? `${pessoa.nome} ${pessoa.sobrenome}`.trim() : u.nome,
      avatarUrl: u.avatarUrl,
      papel: u.papel,
      telefone: pessoa?.telefone ?? null,
    };
  };

  function entrar(c: Context, identidade: { email: string; nome: string | null; avatarUrl: string | null }) {
    if (!config.adminEmails.has(normalizarEmail(identidade.email)) && !repo.ehAdminCadastrado(identidade.email)) {
      repo.registrarPessoaGoogle(identidade);
    }
    const momento = agora();
    const usuarioId = registrarLogin(db, identidade, momento);
    const { token, expira } = criarSessao(db, usuarioId, momento);
    gravarCookie(c, token, expira);
    return validarSessao(db, config, token, momento)!.usuario;
  }

  async function verificarGoogle(credencial: string) {
    try {
      return await google.verificar(credencial);
    } catch (e) {
      if (e instanceof ErroGoogle && e.indisponivel) {
        throw new ErroHttp(503, 'GOOGLE_INDISPONIVEL', 'Não foi possível falar com o Google. Tente novamente.');
      }
      throw new ErroHttp(401, 'LOGIN_INVALIDO', 'Não foi possível entrar com o Google.');
    }
  }

  app.onError((e, c) => {
    if (e instanceof ErroHttp) return c.json({ erro: e.codigo, mensagem: e.message }, e.status);
    if (e instanceof ErroImportacao) return c.json({ erro: 'IMPORTACAO', mensagem: e.message }, 409);
    console.error('erro interno', e instanceof Error ? e.name : 'desconhecido');
    return c.json({ erro: 'INTERNO', mensagem: 'Erro interno.' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; img-src 'self' data: https://*.googleusercontent.com; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'; frame-ancestors 'none'",
    );
    if (config.cookieSeguro) c.header('Strict-Transport-Security', 'max-age=31536000');
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  });

  const limite = (maxSize: number) =>
    bodyLimit({ maxSize, onError: () => { throw new ErroHttp(400, 'MUITO_GRANDE', 'Dados grandes demais.'); } });
  app.use('/api/*', async (c, next) => (c.req.path === '/api/admin/importar' ? limite(LIMITE_BACKUP) : limite(LIMITE_JSON))(c, next));

  // CSRF: o retorno do Google por redirecionamento tem verificação própria.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.path !== '/api/auth/google/redirect') {
      const origem = c.req.header('origin');
      if (!origem || !config.origens.has(origem)) throw new ErroHttp(403, 'ORIGEM_INVALIDA', 'Origem não permitida.');
    }
    await next();
  });

  // Fechado por padrão: toda rota da API exige sessão, exceto a lista pública.
  app.use('/api/*', async (c, next) => {
    if (ROTAS_PUBLICAS.has(c.req.path)) return next();
    const token = getCookie(c, cookie);
    const sessao = token ? validarSessao(db, config, token, agora()) : null;
    if (!sessao) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Faça login para continuar.');
    if (sessao.renovadaAte) gravarCookie(c, token!, sessao.renovadaAte);
    c.set('usuario', sessao.usuario);
    await next();
  });

  app.use('/api/admin/*', async (c, next) => {
    if (c.get('usuario').papel !== 'admin') throw new ErroHttp(403, 'PROIBIDO', 'Acesso negado.');
    await next();
  });
  app.use('/api/devedor/*', async (c, next) => {
    const u = c.get('usuario');
    if (u.papel !== 'devedor') throw new ErroHttp(403, 'PROIBIDO', 'Acesso negado.');
    await next();
  });

  app.get('/api/saude', (c) => c.json({ ok: true }));

  // ---------- Login ----------
  app.get('/api/auth/config', (c) => c.json({ googleClientId: config.googleClientId }));

  app.post('/api/auth/google', async (c) => {
    const { credential } = await corpo(c, z.strictObject({ credential: z.string().min(10).max(8192) }));
    return c.json({ usuario: dtoUsuario(entrar(c, await verificarGoogle(credential))) });
  });

  // Usado no app instalado do iPhone, onde o popup do Google pode não abrir.
  app.post('/api/auth/google/redirect', async (c) => {
    try {
      const form = await c.req.parseBody();
      const csrf = getCookie(c, 'g_csrf_token');
      if (!csrf || typeof form.g_csrf_token !== 'string' || form.g_csrf_token !== csrf || typeof form.credential !== 'string' || form.credential.length > 8192) {
        return c.redirect('/entrar?erro=login', 303);
      }
      entrar(c, await verificarGoogle(form.credential));
      return c.redirect('/', 303);
    } catch {
      return c.redirect('/entrar?erro=login', 303);
    }
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, cookie);
    if (token) revogarSessao(db, token);
    deleteCookie(c, cookie, { path: '/', secure: config.cookieSeguro, sameSite: 'Strict', httpOnly: true });
    return c.body(null, 204);
  });

  app.get('/api/auth/me', (c) => c.json({ usuario: dtoUsuario(c.get('usuario')), pixDisponivel: !!repo.pixConfig() }));

  // ---------- Devedor: sempre filtrado pela pessoa da sessão ----------
  // Sem ficha, usa um id que não existe: as consultas voltam vazias. Nunca passe undefined, que significa "todos".
  const doDevedor = (c: Context<Ambiente>) => c.get('usuario').pessoaId ?? 0;

  function emprestimoDoDevedor(c: Context<Ambiente>): EmprestimoVisao {
    const v = repo.visaoPorId(idParam(c), hoje());
    if (!v || v.emprestimo.pessoaId !== doDevedor(c)) throw naoEncontrado();
    return v;
  }

  app.get('/api/devedor/resumo', (c) => c.json({ resumo: repo.resumo(hoje(), doDevedor(c)), hoje: hoje() }));
  app.get('/api/devedor/emprestimos', (c) => c.json({ emprestimos: repo.visoes(hoje(), doDevedor(c)).map(dtoDevedor), hoje: hoje() }));
  app.get('/api/devedor/emprestimos/:id', (c) => c.json({ emprestimo: dtoDevedor(emprestimoDoDevedor(c)), pixDisponivel: !!repo.pixConfig(), hoje: hoje() }));
  app.get('/api/devedor/emprestimos/:id/pix', (c) => {
    const v = emprestimoDoDevedor(c);
    const pix = repo.pixConfig();
    if (!pix) throw new ErroHttp(503, 'PIX_NAO_CONFIGURADO', 'Pix ainda não configurado.');
    if (v.valorPagarAgora <= 0) throw new ErroHttp(409, 'NADA_A_PAGAR', 'Não há valor em aberto.');
    const txid = `EMP${v.emprestimo.id}D${hoje().replaceAll('-', '')}`;
    return c.json({
      codigo: gerarBrCode({ ...pix, valorCentavos: v.valorPagarAgora, txid }),
      valorCentavos: v.valorPagarAgora,
      txid,
      recebedor: pix.nome,
    });
  });

  app.get('/api/devedor/pedidos', (c) => c.json({ pedidos: repo.pedidosDaPessoa(doDevedor(c)).map(dtoPedido), hoje: hoje() }));
  app.post('/api/devedor/pedidos', async (c) => {
    const pessoaId = doDevedor(c);
    if (!pessoaId) throw new ErroHttp(409, 'SEM_CADASTRO', 'Saia e entre de novo para fazer um pedido.');
    const d = await corpo(c, esquemaPedido);
    if (d.primeiroVencimento < hoje()) throw new ErroHttp(400, 'VENCIMENTO_PASSADO', 'O primeiro vencimento não pode estar no passado.');
    const id = repo.criarPedido(pessoaId, d);
    if (id === null) throw new ErroHttp(409, 'PEDIDO_ABERTO', 'Você já tem um pedido aguardando resposta.');
    return c.json({ id }, 201);
  });
  app.post('/api/devedor/pedidos/:id/cancelar', (c) => {
    const id = idParam(c);
    const p = repo.pedido(id);
    if (!p || p.pessoaId !== doDevedor(c)) throw naoEncontrado();
    if (!repo.cancelarPedido(id, p.pessoaId, agora())) throw new ErroHttp(409, 'PEDIDO_DECIDIDO', 'Este pedido já foi respondido.');
    return c.json({ ok: true });
  });

  // ---------- Admin ----------
  app.get('/api/admin/resumo', (c) => {
    return c.json({ resumo: repo.resumo(hoje()), pedidosPendentes: repo.contarPedidosPendentes(), hoje: hoje() });
  });

  app.get('/api/admin/pessoas', (c) => {
    const visoes = repo.visoes(hoje());
    return c.json({
      pessoas: repo.pessoas().map((p) => {
        const minhas = visoes.filter((v) => v.pessoa.id === p.id);
        return {
          ...p,
          saldoCentavos: minhas.reduce((s, v) => s + v.consolidado.saldo.saldo, 0),
          emprestimos: minhas.length,
          temAtraso: minhas.some((v) => v.consolidado.temAtraso),
        };
      }),
    });
  });

  const garantirEmailLivre = (email: string | null, ignorar?: number) => {
    if (email && repo.emailEmUso(email, ignorar)) throw new ErroHttp(409, 'EMAIL_EM_USO', 'Este e-mail já está em outra pessoa.');
    if (email && (config.adminEmails.has(normalizarEmail(email)) || repo.ehAdminCadastrado(email))) throw new ErroHttp(409, 'EMAIL_ADMIN', 'Este e-mail é de um administrador.');
  };

  app.post('/api/admin/pessoas', async (c) => {
    const d = await corpo(c, esquemaPessoa);
    garantirEmailLivre(d.email);
    return c.json({ id: repo.criarPessoa(d) }, 201);
  });
  app.get('/api/admin/pessoas/:id', (c) => {
    const p = repo.pessoa(idParam(c));
    if (!p) throw naoEncontrado();
    return c.json({ pessoa: p, emprestimos: repo.visoes(hoje(), p.id).map(dtoAdmin), hoje: hoje() });
  });
  app.put('/api/admin/pessoas/:id', async (c) => {
    const id = idParam(c);
    const d = await corpo(c, esquemaPessoa);
    garantirEmailLivre(d.email, id);
    if (!repo.atualizarPessoa(id, d)) throw naoEncontrado();
    return c.json({ ok: true });
  });
  app.delete('/api/admin/pessoas/:id', (c) => {
    if (!repo.removerPessoa(idParam(c))) throw naoEncontrado();
    return c.body(null, 204);
  });

  app.get('/api/admin/emprestimos', (c) => c.json({ emprestimos: repo.visoes(hoje()).map(dtoAdmin), hoje: hoje() }));
  app.post('/api/admin/emprestimos', async (c) => {
    const d = await corpo(c, esquemaEmprestimo);
    if (!repo.pessoa(d.pessoaId)) throw new ErroHttp(400, 'PESSOA_INVALIDA', 'Pessoa não encontrada.');
    return c.json({ id: repo.criarEmprestimo(d) }, 201);
  });
  app.get('/api/admin/emprestimos/:id', (c) => {
    const v = repo.visaoPorId(idParam(c), hoje());
    if (!v) throw naoEncontrado();
    return c.json({ emprestimo: dtoAdmin(v), hoje: hoje() });
  });
  app.put('/api/admin/emprestimos/:id', async (c) => {
    const id = idParam(c);
    const d = await corpo(c, esquemaEmprestimo);
    if (!repo.pessoa(d.pessoaId)) throw new ErroHttp(400, 'PESSOA_INVALIDA', 'Pessoa não encontrada.');
    if (!repo.atualizarEmprestimo(id, d)) throw naoEncontrado();
    return c.json({ ok: true });
  });
  app.delete('/api/admin/emprestimos/:id', (c) => {
    if (!repo.removerEmprestimo(idParam(c))) throw naoEncontrado();
    return c.body(null, 204);
  });

  app.post('/api/admin/emprestimos/:id/pagamentos', async (c) => {
    const id = idParam(c);
    const d = await corpo(c, esquemaPagamento);
    if (!repo.emprestimo(id)) throw naoEncontrado();
    return c.json({ id: repo.registrarPagamento(id, d) }, 201);
  });
  app.post('/api/admin/emprestimos/:id/parcelas/:numero/alternar', (c) => {
    const r = repo.alternarParcela(idParam(c), idParam(c, 'numero'), hoje());
    if (!r) throw naoEncontrado();
    return c.json({ resultado: r });
  });
  app.put('/api/admin/pagamentos/:id', async (c) => {
    const id = idParam(c);
    const d = await corpo(c, esquemaPagamento);
    if (!repo.atualizarPagamento(id, d)) throw naoEncontrado();
    return c.json({ ok: true });
  });
  app.delete('/api/admin/pagamentos/:id', (c) => {
    if (!repo.removerPagamento(idParam(c))) throw naoEncontrado();
    return c.body(null, 204);
  });

  const dtoPedidoAdmin = (p: Pedido) => {
    const pessoa = repo.pessoa(p.pessoaId)!;
    return {
      ...dtoPedido(p),
      pessoa: { id: pessoa.id, nome: pessoa.nome, sobrenome: pessoa.sobrenome, telefone: pessoa.telefone, email: pessoa.email, avatarUrl: pessoa.avatarUrl },
    };
  };
  const pedidoPendente = (id: number) => {
    const p = repo.pedido(id);
    if (!p) throw naoEncontrado();
    if (p.status !== 'pendente') throw new ErroHttp(409, 'PEDIDO_DECIDIDO', 'Este pedido já foi respondido.');
    return p;
  };

  app.get('/api/admin/pedidos', (c) => c.json({ pedidos: repo.todosPedidos().map(dtoPedidoAdmin), hoje: hoje() }));
  app.get('/api/admin/pedidos/:id', (c) => {
    const p = repo.pedido(idParam(c));
    if (!p) throw naoEncontrado();
    const visoes = repo.visoes(hoje(), p.pessoaId);
    return c.json({
      pedido: dtoPedidoAdmin(p),
      historico: {
        saldoCentavos: visoes.reduce((s, v) => s + v.consolidado.saldo.saldo, 0),
        emprestimos: visoes.length,
        atrasados: visoes.filter((v) => v.consolidado.temAtraso).length,
      },
      pixConfigurado: !!repo.pixConfig(),
      hoje: hoje(),
    });
  });
  app.post('/api/admin/pedidos/:id/aprovar', async (c) => {
    const id = idParam(c);
    const p = pedidoPendente(id);
    const d = await corpo(c, esquemaAprovacao);
    if (!repo.pixConfig()) throw new ErroHttp(409, 'PIX_NAO_CONFIGURADO', 'Configure o Pix em Config antes de aprovar.');
    if (d.valorTotalCentavos > p.valorCentavos) throw new ErroHttp(400, 'VALOR_ACIMA', 'O valor aprovado não pode ser maior que o pedido.');
    const dataPrevistaPagamento = adicionaMeses(d.primeiroVencimento, d.numParcelas - 1);
    const emprestimoId = repo.aprovarPedido(id, { ...d, dataPrevistaPagamento }, c.get('usuario').email, agora());
    if (emprestimoId === null) throw new ErroHttp(409, 'PEDIDO_DECIDIDO', 'Este pedido já foi respondido.');
    return c.json({ emprestimoId }, 201);
  });
  app.post('/api/admin/pedidos/:id/recusar', async (c) => {
    const id = idParam(c);
    pedidoPendente(id);
    const { motivo } = await corpo(c, esquemaRecusa);
    if (!repo.recusarPedido(id, motivo, c.get('usuario').email, agora())) throw new ErroHttp(409, 'PEDIDO_DECIDIDO', 'Este pedido já foi respondido.');
    return c.json({ ok: true });
  });

  // ---------- Configurações: Pix e administradores só mudam pelo admin principal ----------
  const ehPrincipal = (c: Context<Ambiente>) => config.adminEmails.has(normalizarEmail(c.get('usuario').email));
  const exigirPrincipal = (c: Context<Ambiente>) => {
    if (!ehPrincipal(c)) throw new ErroHttp(403, 'SO_PRINCIPAL', 'Só o administrador principal pode alterar isso.');
  };

  app.get('/api/admin/configuracoes', (c) =>
    c.json({
      pix: repo.pixConfig(),
      admins: [
        ...[...config.adminEmails].sort().map((email) => ({ email, principal: true })),
        ...repo.adminsCadastrados().filter((email) => !config.adminEmails.has(email)).map((email) => ({ email, principal: false })),
      ],
      podeEditar: ehPrincipal(c),
    }),
  );

  app.put('/api/admin/configuracoes/pix', async (c) => {
    exigirPrincipal(c);
    const d = await corpo(c, esquemaPix);
    const chave = normalizarChavePix(d.chave);
    if (!chave) {
      throw new ErroHttp(400, 'CHAVE_INVALIDA', 'Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória.');
    }
    const pix = { chave, nome: d.nome, cidade: d.cidade };
    try {
      gerarBrCode(pix);
    } catch {
      throw new ErroHttp(400, 'PIX_INVALIDO', 'Nome e cidade precisam ter letras ou números.');
    }
    repo.salvarPix(pix, c.get('usuario').email);
    return c.json({ pix });
  });

  app.post('/api/admin/configuracoes/admins', async (c) => {
    exigirPrincipal(c);
    const email = normalizarEmail((await corpo(c, esquemaAdmin)).email);
    if (config.adminEmails.has(email) || repo.ehAdminCadastrado(email)) throw new ErroHttp(409, 'EMAIL_ADMIN', 'Este e-mail já é de um administrador.');
    if (!repo.promoverAdmin(email, c.get('usuario').email)) {
      throw new ErroHttp(409, 'EMAIL_EM_USO', 'Esta pessoa tem empréstimos, pedidos ou cadastro manual e não pode virar administrador.');
    }
    return c.json({ email }, 201);
  });

  app.delete('/api/admin/configuracoes/admins/:email', (c) => {
    exigirPrincipal(c);
    const email = normalizarEmail(c.req.param('email'));
    if (config.adminEmails.has(email)) throw new ErroHttp(409, 'ADMIN_PRINCIPAL', 'O administrador principal não pode ser removido.');
    if (!repo.removerAdmin(email)) throw naoEncontrado();
    return c.body(null, 204);
  });

  app.get('/api/admin/backup', (c) => {
    c.header('Content-Disposition', `attachment; filename="emprestimos-backup-${hoje()}.json"`);
    return c.json(repo.exportar(agora()));
  });
  app.post('/api/admin/importar', async (c) => {
    const b = await corpo(c, esquemaBackup);
    try {
      return c.json({ importado: repo.importar(b) });
    } catch (e) {
      if (e instanceof ErroImportacao) throw e;
      throw new ErroImportacao('O backup tem dados inconsistentes e nada foi importado.');
    }
  });

  app.all('/api/*', () => {
    throw naoEncontrado();
  });

  return app;
}
