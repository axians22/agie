import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { criarApp } from '../src/app.ts';
import { ErroGoogle, hashToken } from '../src/auth.ts';
import { fazerBackup } from '../src/backup.ts';
import { lerConfig } from '../src/config.ts';
import { ArquivosComprovante, detectarTipoComprovante, LimpezaComprovantes, MAX_COMPROVANTE_BYTES } from '../src/comprovantes.ts';
import { abrirBanco } from '../src/db.ts';
import { endpointPermitido, ServicoPush, type InscricaoPush, type MensagemPush, type ResultadoPush } from '../src/push.ts';
import { Repo } from '../src/repo.ts';

const EMAILS_TESTE = {
  admin: 'admin@teste.local',
  devedorA: 'ana.devedora@teste.local',
  devedorB: 'bruno.devedor@teste.local',
} as const;

const ORIGEM = 'http://localhost:5173';
const RAIZ_COMPROVANTES = mkdtempSync(join(tmpdir(), 'emprestimos-comprovantes-'));
after(() => rmSync(RAIZ_COMPROVANTES, { recursive: true, force: true }));
let pastasComprovantes = 0;

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const PDF = new TextEncoder().encode('%PDF-1.7\nconteudo');
const AGORA = new Date('2026-06-15T15:00:00Z');

function montar(extra: NodeJS.ProcessEnv = {}) {
  const pastaComprovantes = join(RAIZ_COMPROVANTES, String(++pastasComprovantes));
  const config = lerConfig({
    NODE_ENV: 'test',
    COMPROVANTES_DIR: pastaComprovantes,
    ADMIN_EMAILS: EMAILS_TESTE.admin,
    APP_ORIGINS: ORIGEM,
    GOOGLE_CLIENT_ID: 'cliente',
    ...extra,
  });
  const db = abrirBanco(':memory:');
  let momento = AGORA;
  const identidades = new Map<string, { nome: string; avatarUrl: string | null }>();
  const google = {
    async verificar(token: string) {
      if (token === 'token-indisponivel') throw new ErroGoogle(true);
      if (!token.startsWith('valido:')) throw new ErroGoogle(false);
      const email = token.slice(7);
      const extra = identidades.get(email.toLowerCase());
      return { email: email.toLowerCase(), nome: extra?.nome ?? 'Via Google', avatarUrl: extra?.avatarUrl ?? null };
    },
  };
  const enviados: Array<{ endpoint: string; mensagem: MensagemPush }> = [];
  const respostasPush = new Map<string, ResultadoPush>();
  const push = new ServicoPush(db, config, {
    chavePublica: 'chave-publica',
    enviador: {
      async enviar(i: InscricaoPush, mensagem: MensagemPush) {
        const r = respostasPush.get(i.endpoint) ?? 'ok';
        if (r === 'ok') enviados.push({ endpoint: i.endpoint, mensagem });
        return r;
      },
    },
  });
  const comprovantes = new ArquivosComprovante(pastaComprovantes);
  const app = criarApp({ db, config, google, push, comprovantes, agora: () => momento });
  const repo = new Repo(db);
  repo.salvarPix({ chave: 'chave@teste.local', nome: 'Credor', cidade: 'Sao Paulo' }, EMAILS_TESTE.admin);
  const a = repo.criarPessoa({ nome: 'Ana', sobrenome: 'A', telefone: '1', email: EMAILS_TESTE.devedorA });
  const b = repo.criarPessoa({ nome: 'Bruno', sobrenome: 'B', telefone: '2', email: EMAILS_TESTE.devedorB });
  const base = { nome: 'E', valorTotalCentavos: 300000, dataEmprestimo: '2026-01-01', dataPrevistaPagamento: '2026-06-01', numParcelas: 3, jurosAoMesPct: 0, tipoMulta: 0 as const, multaValor: 0 };
  const empA = repo.criarEmprestimo({ ...base, pessoaId: a, primeiroVencimento: '2026-05-10' });
  const empB = repo.criarEmprestimo({ ...base, pessoaId: b, primeiroVencimento: '2026-07-10' });
  repo.registrarPagamento(empA, { data: '2026-05-10', valorCentavos: 50000, observacao: 'SEGREDO-DO-CREDOR' });
  const pagB = repo.registrarPagamento(empB, { data: '2026-05-10', valorCentavos: 1000, observacao: null });

  async function chamar(metodo: string, caminho: string, opts: { cookie?: string; corpo?: unknown; origem?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.origem !== null && metodo !== 'GET') headers.origin = opts.origem ?? ORIGEM;
    if (opts.corpo !== undefined) headers['content-type'] = 'application/json';
    return app.request(caminho, { method: metodo, headers, body: opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo) });
  }
  async function enviarComprovante(cookie: string, emprestimoId: number, bytes: Uint8Array | null = JPG, nome = 'comprovante.jpg', tipo = 'image/jpeg', extra: Record<string, string> = {}) {
    const form = new FormData();
    if (bytes) form.append('arquivo', new File([bytes as Uint8Array<ArrayBuffer>], nome, { type: tipo }));
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return app.request(`/api/devedor/emprestimos/${emprestimoId}/pagamento-informado`, { method: 'POST', headers: { cookie, origin: ORIGEM }, body: form });
  }
  const arquivosEmDisco = () => (existsSync(pastaComprovantes) ? readdirSync(pastaComprovantes) : []);
  async function login(email: string) {
    const r = await chamar('POST', '/api/auth/google', { corpo: { credential: `valido:${email}` } });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }
  return { app, db, repo, identidades, push, enviados, respostasPush, comprovantes, pastaComprovantes, enviarComprovante, arquivosEmDisco, chamar, login, empA, empB, pagB, a, b, avancar: (d: Date) => (momento = d) };
}

type Ctx = ReturnType<typeof montar>;

describe('isolamento entre devedores', () => {
  let t: Ctx;
  let ana: string;
  beforeEach(async () => {
    t = montar();
    ana = await t.login(EMAILS_TESTE.devedorA);
  });

  test('lista só os próprios empréstimos', async () => {
    const r = (await (await t.chamar('GET', '/api/devedor/emprestimos', { cookie: ana })).json()) as { emprestimos: Array<{ id: number }> };
    assert.deepEqual(r.emprestimos.map((e) => e.id), [t.empA]);
  });

  test('o resumo soma só os próprios valores', async () => {
    const r = (await (await t.chamar('GET', '/api/devedor/resumo', { cookie: ana })).json()) as { resumo: { totalEmprestado: number } };
    assert.equal(r.resumo.totalEmprestado, 300000);
  });

  for (const sufixo of ['', '/pix']) {
    test(`empréstimo de outra pessoa responde 404 em ${sufixo || 'detalhe'}`, async () => {
      const r = await t.chamar('GET', `/api/devedor/emprestimos/${t.empB}${sufixo}`, { cookie: ana });
      assert.equal(r.status, 404);
    });
  }

  test('não recebe observações do credor nem dados da pessoa', async () => {
    const texto = await (await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}`, { cookie: ana })).text();
    assert.ok(!texto.includes('SEGREDO-DO-CREDOR'));
    assert.ok(!texto.includes('observacao'));
    assert.ok(!texto.includes('pessoaId'));
    assert.ok(!texto.includes('Bruno'));
  });

  const rotasAdmin: Array<[string, string, unknown?]> = [
    ['GET', '/api/admin/resumo'],
    ['GET', '/api/admin/pessoas'],
    ['GET', '/api/admin/pessoas/2'],
    ['GET', '/api/admin/emprestimos'],
    ['GET', '/api/admin/backup'],
    ['POST', '/api/admin/pessoas', { nome: 'X' }],
    ['DELETE', '/api/admin/pessoas/2'],
    ['POST', '/api/admin/emprestimos/1/pagamentos', { data: '2026-01-01', valorCentavos: 1 }],
    ['POST', '/api/admin/emprestimos/1/parcelas/1/alternar'],
    ['DELETE', '/api/admin/pagamentos/1'],
    ['POST', '/api/admin/importar', { formato: 1, pessoas: [], emprestimos: [], pagamentos: [] }],
  ];
  for (const [m, rota, corpo] of rotasAdmin) {
    test(`devedor não acessa ${m} ${rota}`, async () => {
      assert.equal((await t.chamar(m, rota, { cookie: ana, corpo })).status, 403);
    });
    test(`sem sessão não acessa ${m} ${rota}`, async () => {
      assert.equal((await t.chamar(m, rota, { corpo })).status, 401);
    });
  }

  test('admin não usa rotas de devedor', async () => {
    const admin = await t.login(EMAILS_TESTE.admin);
    assert.equal((await t.chamar('GET', '/api/devedor/resumo', { cookie: admin })).status, 403);
  });
});

describe('login', () => {
  let t: Ctx;
  beforeEach(() => {
    t = montar();
  });

  test('Google com e-mail de devedor entra como devedor, ignorando maiúsculas', async () => {
    const r = await t.chamar('POST', '/api/auth/google', { corpo: { credential: `valido:${EMAILS_TESTE.devedorB.toUpperCase()}`.replace('VALIDO', 'valido') } });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { usuario: { papel: string } }).usuario.papel, 'devedor');
  });

  test('conta sem ficha entra como usuário e não vê dados de ninguém', async () => {
    const r = await t.chamar('POST', '/api/auth/google', { corpo: { credential: 'valido:estranho@teste.local' } });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { usuario: { papel: string } }).usuario.papel, 'devedor');
    const c = await t.login('estranho@teste.local');
    const lista = (await (await t.chamar('GET', '/api/devedor/emprestimos', { cookie: c })).json()) as { emprestimos: unknown[] };
    assert.deepEqual(lista.emprestimos, []);
    const res = (await (await t.chamar('GET', '/api/devedor/resumo', { cookie: c })).json()) as { resumo: { totalEmprestado: number } };
    assert.equal(res.resumo.totalEmprestado, 0);
    for (const id of [t.empA, t.empB]) {
      for (const sufixo of ['', '/pix']) {
        assert.equal((await t.chamar('GET', `/api/devedor/emprestimos/${id}${sufixo}`, { cookie: c })).status, 404);
      }
    }
    assert.equal((await t.chamar('GET', '/api/admin/resumo', { cookie: c })).status, 403);
  });

  test('quem entra aparece em Pessoas com nome, e-mail e foto', async () => {
    const foto = 'https://lh3.googleusercontent.com/a/foto';
    t.identidades.set('novo@teste.local', { nome: 'Maria da Silva', avatarUrl: foto });
    const c = await t.login('novo@teste.local');
    const admin = await t.login(EMAILS_TESTE.admin);
    const r = (await (await t.chamar('GET', '/api/admin/pessoas', { cookie: admin })).json()) as { pessoas: Array<{ id: number; nome: string; sobrenome: string; email: string; avatarUrl: string }> };
    const p = r.pessoas.find((x) => x.email === 'novo@teste.local')!;
    assert.deepEqual([p.nome, p.sobrenome, p.avatarUrl], ['Maria', 'da Silva', foto]);
    assert.ok(!r.pessoas.some((x) => x.email === EMAILS_TESTE.admin));
    const id = t.repo.criarEmprestimo({ pessoaId: p.id, nome: 'N', valorTotalCentavos: 1000, dataEmprestimo: '2026-01-01', dataPrevistaPagamento: '2026-02-01', primeiroVencimento: '2026-02-01', numParcelas: 1, jurosAoMesPct: 0, tipoMulta: 0, multaValor: 0 });
    const lista = (await (await t.chamar('GET', '/api/devedor/emprestimos', { cookie: c })).json()) as { emprestimos: Array<{ id: number }> };
    assert.deepEqual(lista.emprestimos.map((e) => e.id), [id]);
  });

  test('novo login atualiza a foto e não sobrescreve o nome corrigido nem duplica', async () => {
    t.identidades.set('novo@teste.local', { nome: 'Maria Silva', avatarUrl: 'https://lh3.googleusercontent.com/a/1' });
    await t.login('novo@teste.local');
    const id = t.repo.pessoas().find((p) => p.email === 'novo@teste.local')!.id;
    t.repo.atualizarPessoa(id, { nome: 'Maria', sobrenome: 'Corrigida', telefone: '9', email: 'novo@teste.local' });
    t.identidades.set('novo@teste.local', { nome: 'Outro Nome', avatarUrl: 'https://lh3.googleusercontent.com/a/2' });
    await t.login('novo@teste.local');
    const iguais = t.repo.pessoas().filter((p) => p.email === 'novo@teste.local');
    assert.equal(iguais.length, 1);
    assert.deepEqual([iguais[0]!.sobrenome, iguais[0]!.telefone, iguais[0]!.avatarUrl], ['Corrigida', '9', 'https://lh3.googleusercontent.com/a/2']);
  });

  test('conta antiga sem ficha entra na lista ao iniciar o app', () => {
    t.db.prepare("INSERT INTO usuarios (email, nome) VALUES ('antigo@teste.local', 'Conta Antiga')").run();
    t.db.prepare("INSERT INTO usuarios (email, nome) VALUES (?, 'Admin')").run(EMAILS_TESTE.admin);
    t.repo.sincronizarPessoasGoogle(new Set([EMAILS_TESTE.admin]));
    const emails = t.repo.pessoas().map((p) => p.email);
    assert.ok(emails.includes('antigo@teste.local'));
    assert.ok(!emails.includes(EMAILS_TESTE.admin));
  });

  test('excluir a pessoa encerra a sessão e ela só volta com novo login', async () => {
    const c = await t.login('novo@teste.local');
    const id = t.repo.pessoas().find((p) => p.email === 'novo@teste.local')!.id;
    assert.ok(t.repo.removerPessoa(id));
    assert.equal((await t.chamar('GET', '/api/auth/me', { cookie: c })).status, 401);
    t.repo.sincronizarPessoasGoogle(new Set([EMAILS_TESTE.admin]));
    assert.ok(!t.repo.pessoas().some((p) => p.email === 'novo@teste.local'));
  });

  test('token inválido responde 401 e Google fora responde 503', async () => {
    assert.equal((await t.chamar('POST', '/api/auth/google', { corpo: { credential: 'token-ruim-123' } })).status, 401);
    assert.equal((await t.chamar('POST', '/api/auth/google', { corpo: { credential: 'token-indisponivel' } })).status, 503);
  });

  test('cookie protegido e só o hash no banco', async () => {
    const r = await t.chamar('POST', '/api/auth/google', { corpo: { credential: `valido:${EMAILS_TESTE.admin}` } });
    const sc = r.headers.get('set-cookie')!;
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Strict/i);
    const token = sc.split(';')[0]!.split('=')[1]!;
    const linhas = t.db.prepare('SELECT token_hash FROM sessoes').all() as Array<{ token_hash: string }>;
    assert.equal(linhas[0]!.token_hash, hashToken(decodeURIComponent(token)));
    assert.notEqual(linhas[0]!.token_hash, token);
  });

  test('logout revoga a sessão', async () => {
    const c = await t.login(EMAILS_TESTE.devedorA);
    assert.equal((await t.chamar('POST', '/api/auth/logout', { cookie: c })).status, 204);
    assert.equal((await t.chamar('GET', '/api/auth/me', { cookie: c })).status, 401);
  });

  test('sessão expira em 30 dias', async () => {
    const c = await t.login(EMAILS_TESTE.devedorA);
    t.avancar(new Date(AGORA.getTime() + 31 * 86_400_000));
    assert.equal((await t.chamar('GET', '/api/auth/me', { cookie: c })).status, 401);
  });

  test('remover o e-mail da ficha esconde as dívidas na hora', async () => {
    const c = await t.login(EMAILS_TESTE.devedorA);
    t.repo.atualizarPessoa(t.a, { nome: 'Ana', sobrenome: 'A', telefone: '1', email: null });
    const lista = (await (await t.chamar('GET', '/api/devedor/emprestimos', { cookie: c })).json()) as { emprestimos: unknown[] };
    assert.deepEqual(lista.emprestimos, []);
    assert.equal((await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}`, { cookie: c })).status, 404);
  });

  test('POST sem Origin ou de outra origem é recusado', async () => {
    const c = await t.login(EMAILS_TESTE.admin);
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: c, corpo: { nome: 'X' }, origem: null })).status, 403);
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: c, corpo: { nome: 'X' }, origem: 'https://mal.example' })).status, 403);
  });

  test('não existe login sem Google', async () => {
    assert.equal((await t.chamar('POST', '/api/auth/dev', { corpo: { email: EMAILS_TESTE.admin } })).status, 401);
    const cfg = (await (await t.chamar('GET', '/api/auth/config')).json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(cfg), ['googleClientId']);
  });

  test('produção exige toda a configuração', () => {
    const ok = { NODE_ENV: 'production', ADMIN_EMAILS: 'a@b.co', APP_ORIGINS: 'https://app.example', GOOGLE_CLIENT_ID: 'x' };
    for (const campo of Object.keys(ok).filter((k) => k !== 'NODE_ENV')) {
      assert.throws(() => lerConfig({ ...ok, [campo]: '' }), campo);
    }
    const c = lerConfig(ok);
    assert.equal(c.cookieSeguro, true);
    assert.deepEqual([...c.adminEmails], ['a@b.co']);
  });

  test('retorno por redirecionamento exige o token CSRF do Google', async () => {
    const enviar = (cookie: string | null, email: string = EMAILS_TESTE.devedorA) =>
      t.app.request('/api/auth/google/redirect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://accounts.google.com',
          ...(cookie ? { cookie: `g_csrf_token=${cookie}` } : {}),
        },
        body: new URLSearchParams({ credential: `valido:${email}`, g_csrf_token: 'abc' }).toString(),
      });
    for (const r of [await enviar(null), await enviar('diferente')]) {
      assert.equal(r.status, 303);
      assert.equal(r.headers.get('location'), '/entrar?erro=login');
      assert.equal(r.headers.get('set-cookie'), null);
    }
    const semFicha = await enviar('abc', 'estranho@teste.local');
    assert.equal(semFicha.headers.get('location'), '/');
    const ok = await enviar('abc');
    assert.equal(ok.headers.get('location'), '/');
    assert.match(ok.headers.get('set-cookie') ?? '', /emprestimos_sessao=/);
  });
});

describe('admin', () => {
  let t: Ctx;
  let admin: string;
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
  });

  test('vê o total de todos', async () => {
    const r = (await (await t.chamar('GET', '/api/admin/resumo', { cookie: admin })).json()) as { resumo: { totalEmprestado: number; emprestimosAtrasados: number } };
    assert.equal(r.resumo.totalEmprestado, 600000);
    assert.equal(r.resumo.emprestimosAtrasados, 1);
  });

  test('não permite e-mail repetido nem e-mail de admin em devedor', async () => {
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: admin, corpo: { nome: 'X', email: EMAILS_TESTE.devedorA.toUpperCase() } })).status, 409);
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: admin, corpo: { nome: 'X', email: EMAILS_TESTE.admin } })).status, 409);
  });

  test('valida entradas de empréstimo', async () => {
    const ok = { pessoaId: t.a, valorTotalCentavos: 1000, dataEmprestimo: '2026-01-01', dataPrevistaPagamento: '2026-02-01', primeiroVencimento: '2026-02-01', numParcelas: 1 };
    assert.equal((await t.chamar('POST', '/api/admin/emprestimos', { cookie: admin, corpo: ok })).status, 201);
    for (const ruim of [{ ...ok, valorTotalCentavos: -1 }, { ...ok, numParcelas: 0 }, { ...ok, primeiroVencimento: '2026-02-30' }, { ...ok, tipoMulta: 2, multaValor: 101 }, { ...ok, pessoaId: 999 }]) {
      assert.equal((await t.chamar('POST', '/api/admin/emprestimos', { cookie: admin, corpo: ruim })).status, 400);
    }
  });

  test('clicar na parcela quita e clicar de novo desfaz', async () => {
    const rota = `/api/admin/emprestimos/${t.empB}/parcelas/1/alternar`;
    const saldo = async () => ((await (await t.chamar('GET', `/api/admin/emprestimos/${t.empB}`, { cookie: admin })).json()) as { emprestimo: { saldo: { saldo: number } } }).emprestimo.saldo.saldo;
    assert.equal(await saldo(), 299000);
    assert.equal(((await (await t.chamar('POST', rota, { cookie: admin })).json()) as { resultado: string }).resultado, 'marcada');
    assert.equal(await saldo(), 200000);
    assert.equal(((await (await t.chamar('POST', rota, { cookie: admin })).json()) as { resultado: string }).resultado, 'desmarcada');
    assert.equal(await saldo(), 299000);
  });

  test('backup exporta e importa em banco vazio com os mesmos saldos', async () => {
    await t.chamar('POST', `/api/admin/emprestimos/${t.empB}/parcelas/1/alternar`, { cookie: admin });
    const backup = (await (await t.chamar('GET', '/api/admin/backup', { cookie: admin })).json()) as { pagamentos: Array<{ observacao: string | null }> };
    assert.ok(backup.pagamentos.some((p) => p.observacao === 'toggle:parcela:1'));
    assert.equal((await t.chamar('POST', '/api/admin/importar', { cookie: admin, corpo: backup })).status, 409);

    const n = montar();
    n.db.exec('DELETE FROM pessoas');
    const adm = await n.login(EMAILS_TESTE.admin);
    assert.equal((await n.chamar('POST', '/api/admin/importar', { cookie: adm, corpo: backup })).status, 200);
    const antes = t.repo.visoes('2026-06-15').map((v) => v.consolidado.saldo.saldo);
    const depois = n.repo.visoes('2026-06-15').map((v) => v.consolidado.saldo.saldo);
    assert.deepEqual(depois, antes);
    assert.ok(n.repo.pagamentos(t.empB).some((p) => p.parcelaMarcada === 1 && p.observacao === null));
  });

  test('importação inconsistente não grava nada', async () => {
    const n = montar();
    n.db.exec('DELETE FROM pessoas');
    const adm = await n.login(EMAILS_TESTE.admin);
    const ruim = { formato: 1, pessoas: [], emprestimos: [{ id: 1, pessoaId: 99, valorTotalCentavos: 1, dataEmprestimo: '2026-01-01', dataPrevistaPagamento: '2026-01-01', primeiroVencimento: '2026-01-01', numParcelas: 1, criadoEm: '2026-01-01' }], pagamentos: [] };
    assert.equal((await n.chamar('POST', '/api/admin/importar', { cookie: adm, corpo: ruim })).status, 409);
    assert.ok(n.repo.vazio());
  });
});

describe('Pix do devedor', () => {
  test('gera o código da dívida em atraso', async () => {
    const t = montar();
    const ana = await t.login(EMAILS_TESTE.devedorA);
    const r = (await (await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}/pix`, { cookie: ana })).json()) as { codigo: string; valorCentavos: number };
    assert.equal(r.valorCentavos, 150000); // duas parcelas vencidas (200000) menos 50000 pagos
    assert.ok(r.codigo.includes('54071500.00'));
    assert.ok(r.codigo.includes('chave@teste.local'));
  });
  test('sem Pix configurado responde 503', async () => {
    const t = montar();
    t.db.exec('DELETE FROM config_pix');
    const ana = await t.login(EMAILS_TESTE.devedorA);
    assert.equal((await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}/pix`, { cookie: ana })).status, 503);
  });
});

describe('configurações do admin', () => {
  const ROTA = '/api/admin/configuracoes';
  const EXTRA = 'extra@teste.local';
  const PIX = { chave: '529.982.247-25', nome: 'Novo Credor', cidade: 'Curitiba' };
  let t: Ctx;
  let admin: string;
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
  });

  test('salva o Pix normalizado e o devedor passa a pagar nessa chave', async () => {
    const r = await t.chamar('PUT', `${ROTA}/pix`, { cookie: admin, corpo: PIX });
    assert.equal(r.status, 200);
    const ana = await t.login(EMAILS_TESTE.devedorA);
    const q = (await (await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}/pix`, { cookie: ana })).json()) as { codigo: string; recebedor: string };
    assert.ok(q.codigo.includes('52998224725'));
    assert.equal(q.recebedor, 'Novo Credor');
  });

  test('recusa chave inválida sem alterar a atual', async () => {
    const r = await t.chamar('PUT', `${ROTA}/pix`, { cookie: admin, corpo: { ...PIX, chave: '12345' } });
    assert.equal(r.status, 400);
    assert.equal(t.repo.pixConfig()!.chave, 'chave@teste.local');
  });

  test('devedor e visitante não acessam', async () => {
    const ana = await t.login(EMAILS_TESTE.devedorA);
    assert.equal((await t.chamar('GET', ROTA, { cookie: ana })).status, 403);
    assert.equal((await t.chamar('PUT', `${ROTA}/pix`, { cookie: ana, corpo: PIX })).status, 403);
    assert.equal((await t.chamar('GET', ROTA)).status, 401);
  });

  test('admin adicionado entra, vê as configurações e não altera Pix nem admins', async () => {
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA.toUpperCase() } })).status, 201);
    const extra = await t.login(EXTRA);
    const d = (await (await t.chamar('GET', ROTA, { cookie: extra })).json()) as { podeEditar: boolean };
    assert.equal(d.podeEditar, false);
    assert.equal((await t.chamar('GET', '/api/admin/resumo', { cookie: extra })).status, 200);
    assert.equal((await t.chamar('PUT', `${ROTA}/pix`, { cookie: extra, corpo: PIX })).status, 403);
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: extra, corpo: { email: 'x@teste.local' } })).status, 403);
    assert.equal((await t.chamar('DELETE', `${ROTA}/admins/${encodeURIComponent(EMAILS_TESTE.admin)}`, { cookie: extra })).status, 403);
  });

  test('remover admin tira o acesso na hora e o principal não pode ser removido', async () => {
    await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } });
    const extra = await t.login(EXTRA);
    assert.equal((await t.chamar('DELETE', `${ROTA}/admins/${encodeURIComponent(EXTRA)}`, { cookie: admin })).status, 204);
    assert.equal((await t.chamar('GET', '/api/admin/resumo', { cookie: extra })).status, 401);
    const denovo = await t.login(EXTRA);
    assert.equal((await t.chamar('GET', '/api/admin/resumo', { cookie: denovo })).status, 403);
    assert.equal((await t.chamar('DELETE', `${ROTA}/admins/${encodeURIComponent(EMAILS_TESTE.admin)}`, { cookie: admin })).status, 409);
  });

  test('quem só fez login pode virar admin e sai de Pessoas', async () => {
    await t.login(EXTRA);
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } })).status, 201);
    assert.ok(!t.repo.pessoas().some((p) => p.email === EXTRA));
    const extra = await t.login(EXTRA);
    assert.equal((await t.chamar('GET', '/api/admin/resumo', { cookie: extra })).status, 200);
    assert.ok(!t.repo.pessoas().some((p) => p.email === EXTRA));
  });

  test('importar backup mantém quem só fez login', async () => {
    const backup = { formato: 1, pessoas: [{ id: 1, nome: 'Importada', sobrenome: '', telefone: '', email: 'importada@teste.local', criadaEm: '2026-01-01' }], emprestimos: [], pagamentos: [] };
    t.db.exec('DELETE FROM pessoas');
    await t.login('novo@teste.local');
    assert.equal((await t.chamar('POST', '/api/admin/importar', { cookie: admin, corpo: backup })).status, 200);
    assert.deepEqual(t.repo.pessoas().map((p) => p.email).sort(), ['importada@teste.local', 'novo@teste.local']);
  });

  test('um e-mail não pode ser devedor e admin ao mesmo tempo', async () => {
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EMAILS_TESTE.devedorA } })).status, 409);
    await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } });
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: admin, corpo: { nome: 'X', email: EXTRA } })).status, 409);
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } })).status, 409);
  });
});

describe('pedidos de empréstimo', () => {
  const PEDIDO = { valorCentavos: 120000, numParcelas: 3, primeiroVencimento: '2026-07-15', finalidade: 'Reforma' };
  const APROVACAO = { nome: 'Reforma', valorTotalCentavos: 120000, dataEmprestimo: '2026-06-15', primeiroVencimento: '2026-07-15', numParcelas: 3, jurosAoMesPct: 2, tipoMulta: 2, multaValor: 2 };
  let t: Ctx;
  let admin: string;
  let ana: string;
  let bruno: string;
  const pedir = async (cookie = ana, corpo: unknown = PEDIDO) => t.chamar('POST', '/api/devedor/pedidos', { cookie, corpo });
  const novo = async () => ((await (await pedir()).json()) as { id: number }).id;
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
    ana = await t.login(EMAILS_TESTE.devedorA);
    bruno = await t.login(EMAILS_TESTE.devedorB);
  });

  test('pedido chega ao admin como pendente', async () => {
    const id = await novo();
    const r = (await (await t.chamar('GET', '/api/admin/resumo', { cookie: admin })).json()) as { pedidosPendentes: number };
    assert.equal(r.pedidosPendentes, 1);
    const l = (await (await t.chamar('GET', '/api/admin/pedidos', { cookie: admin })).json()) as { pedidos: Array<{ id: number; status: string; pessoa: { email: string } }> };
    assert.deepEqual(l.pedidos.map((p) => [p.id, p.status, p.pessoa.email]), [[id, 'pendente', EMAILS_TESTE.devedorA]]);
  });

  test('só um pedido aguardando por pessoa, e cancelar libera outro', async () => {
    const id = await novo();
    assert.equal((await pedir()).status, 409);
    assert.equal((await t.chamar('POST', `/api/devedor/pedidos/${id}/cancelar`, { cookie: ana })).status, 200);
    assert.equal((await pedir()).status, 201);
  });

  test('recusa valor inválido e vencimento no passado', async () => {
    for (const ruim of [{ ...PEDIDO, valorCentavos: 0 }, { ...PEDIDO, numParcelas: 0 }, { ...PEDIDO, primeiroVencimento: '2026-06-14' }, { ...PEDIDO, pessoaId: 2 }]) {
      assert.equal((await pedir(ana, ruim)).status, 400);
    }
  });

  test('um usuário não vê nem cancela o pedido de outro', async () => {
    const id = await novo();
    const l = (await (await t.chamar('GET', '/api/devedor/pedidos', { cookie: bruno })).json()) as { pedidos: unknown[] };
    assert.deepEqual(l.pedidos, []);
    assert.equal((await t.chamar('POST', `/api/devedor/pedidos/${id}/cancelar`, { cookie: bruno })).status, 404);
  });

  test('usuário não aprova, não recusa e não lista pedidos do admin', async () => {
    const id = await novo();
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: ana, corpo: APROVACAO })).status, 403);
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/recusar`, { cookie: ana, corpo: {} })).status, 403);
    assert.equal((await t.chamar('GET', '/api/admin/pedidos', { cookie: ana })).status, 403);
    assert.equal((await t.chamar('POST', '/api/devedor/pedidos', { cookie: admin, corpo: PEDIDO })).status, 403);
  });

  test('aprovar gera o empréstimo, as parcelas e o QR para quem pediu', async () => {
    const id = await novo();
    const r = await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO });
    assert.equal(r.status, 201);
    const { emprestimoId } = (await r.json()) as { emprestimoId: number };
    const e = (await (await t.chamar('GET', `/api/devedor/emprestimos/${emprestimoId}`, { cookie: ana })).json()) as { emprestimo: { saldo: { parcelas: Array<{ valor: number; vencimento: string }> }; valorPagarAgora: number; dataPrevistaPagamento: string }; pixDisponivel: boolean };
    assert.deepEqual(e.emprestimo.saldo.parcelas.map((p) => [p.valor, p.vencimento]), [[40000, '2026-07-15'], [40000, '2026-08-15'], [40000, '2026-09-15']]);
    assert.equal(e.emprestimo.dataPrevistaPagamento, '2026-09-15');
    assert.equal(e.emprestimo.valorPagarAgora, 40000);
    assert.equal(e.pixDisponivel, true);
    const pix = (await (await t.chamar('GET', `/api/devedor/emprestimos/${emprestimoId}/pix`, { cookie: ana })).json()) as { codigo: string; valorCentavos: number };
    assert.equal(pix.valorCentavos, 40000);
    assert.ok(pix.codigo.includes('5406400.00'));
    assert.equal((await t.chamar('GET', `/api/devedor/emprestimos/${emprestimoId}`, { cookie: bruno })).status, 404);
    const l = (await (await t.chamar('GET', '/api/devedor/pedidos', { cookie: ana })).json()) as { pedidos: Array<{ status: string; emprestimoId: number }> };
    assert.deepEqual([l.pedidos[0]!.status, l.pedidos[0]!.emprestimoId], ['aprovado', emprestimoId]);
  });

  test('aprovar duas vezes gera um único empréstimo', async () => {
    const id = await novo();
    const rs = await Promise.all([1, 2].map(() => t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal(t.repo.visoes('2026-06-15', t.a).length, 2);
  });

  test('não aprova acima do valor pedido nem sem Pix', async () => {
    const id = await novo();
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: { ...APROVACAO, valorTotalCentavos: 120001 } })).status, 400);
    t.db.exec('DELETE FROM config_pix');
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO })).status, 409);
    assert.equal(t.repo.visoes('2026-06-15', t.a).length, 1);
    assert.equal(t.repo.pedido(id)!.status, 'pendente');
  });

  test('aprova valor menor', async () => {
    const id = await novo();
    const r = await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: { ...APROVACAO, valorTotalCentavos: 90000 } });
    const { emprestimoId } = (await r.json()) as { emprestimoId: number };
    assert.equal(t.repo.emprestimo(emprestimoId)!.valorTotalCentavos, 90000);
  });

  test('recusar guarda o motivo, não gera empréstimo e não permite aprovar depois', async () => {
    const id = await novo();
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/recusar`, { cookie: admin, corpo: { motivo: 'Sem limite' } })).status, 200);
    const l = (await (await t.chamar('GET', '/api/devedor/pedidos', { cookie: ana })).json()) as { pedidos: Array<{ status: string; motivoRecusa: string }> };
    assert.deepEqual([l.pedidos[0]!.status, l.pedidos[0]!.motivoRecusa], ['recusado', 'Sem limite']);
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO })).status, 409);
    assert.equal(t.repo.visoes('2026-06-15', t.a).length, 1);
  });

  test('pedido cancelado não pode ser aprovado', async () => {
    const id = await novo();
    await t.chamar('POST', `/api/devedor/pedidos/${id}/cancelar`, { cookie: ana });
    assert.equal((await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO })).status, 409);
  });

  test('quem tem pedido não vira admin e a importação fica bloqueada', async () => {
    const c = await t.login('novo@teste.local');
    assert.equal((await pedir(c)).status, 201);
    assert.equal((await t.chamar('POST', '/api/admin/configuracoes/admins', { cookie: admin, corpo: { email: 'novo@teste.local' } })).status, 409);
    t.db.exec('DELETE FROM emprestimos; DELETE FROM pessoas WHERE via_google = 0');
    const backup = { formato: 1, pessoas: [], emprestimos: [], pagamentos: [] };
    assert.equal((await t.chamar('POST', '/api/admin/importar', { cookie: admin, corpo: backup })).status, 409);
    assert.equal(t.repo.todosPedidos().length, 1);
  });
});

describe('notificações', () => {
  const P256 = Buffer.alloc(65, 4).toString('base64url');
  const AUTH = Buffer.alloc(16, 7).toString('base64url');
  const inscricao = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: P256, auth: AUTH } });
  const PEDIDO = { valorCentavos: 120000, numParcelas: 3, primeiroVencimento: '2026-07-15', finalidade: 'Reforma secreta' };
  const APROVACAO = { nome: 'Reforma', valorTotalCentavos: 120000, dataEmprestimo: '2026-06-15', primeiroVencimento: '2026-07-15', numParcelas: 3 };
  const NOVE_E_MEIA = (data: string) => new Date(`${data}T12:30:00Z`);
  let t: Ctx;
  let admin: string;
  let ana: string;
  let bruno: string;
  const inscrever = (cookie: string, n: string) => t.chamar('POST', '/api/push/inscricao', { cookie, corpo: inscricao(n) });
  const titulos = () => t.enviados.map((e) => e.mensagem.titulo);
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
    ana = await t.login(EMAILS_TESTE.devedorA);
    bruno = await t.login(EMAILS_TESTE.devedorB);
    assert.equal((await inscrever(admin, 'admin')).status, 200);
    assert.equal((await inscrever(ana, 'ana')).status, 200);
    assert.equal((await inscrever(bruno, 'bruno')).status, 200);
  });

  test('só aceita endereços dos serviços de push', async () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/x', 'https://updates.push.services.mozilla.com/x', 'https://wns2-par02p.notify.windows.com/x']) assert.ok(endpointPermitido(ok), ok);
    for (const ruim of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com.mal.example/x', 'https://push.apple.com.mal.example/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'nada']) assert.ok(!endpointPermitido(ruim), ruim);
    const r = await t.chamar('POST', '/api/push/inscricao', { cookie: ana, corpo: { ...inscricao('x'), endpoint: 'https://169.254.169.254/latest/meta-data' } });
    assert.equal(r.status, 400);
  });

  test('exige sessão e chaves válidas', async () => {
    assert.equal((await t.chamar('POST', '/api/push/inscricao', { corpo: inscricao('x') })).status, 401);
    assert.equal((await t.chamar('POST', '/api/push/teste')).status, 401);
    const r = await t.chamar('POST', '/api/push/inscricao', { cookie: ana, corpo: { endpoint: inscricao('x').endpoint, keys: { p256dh: 'a'.repeat(88), auth: 'a'.repeat(22) } } });
    assert.equal(r.status, 400);
  });

  test('pedido avisa só os admins, sem valor nem finalidade', async () => {
    await t.chamar('POST', '/api/devedor/pedidos', { cookie: ana, corpo: PEDIDO });
    await t.push.aguardar();
    assert.deepEqual(t.enviados.map((e) => e.endpoint), [inscricao('admin').endpoint]);
    assert.equal(titulos()[0], 'Novo pedido de empréstimo');
    const texto = JSON.stringify(t.enviados);
    assert.ok(!texto.includes('1200') && !texto.includes('Reforma') && !texto.includes('Ana'));
  });

  test('aprovar e recusar avisam só quem pediu', async () => {
    const pedir = async () => ((await (await t.chamar('POST', '/api/devedor/pedidos', { cookie: ana, corpo: PEDIDO })).json()) as { id: number }).id;
    const id = await pedir();
    await t.push.aguardar();
    t.enviados.length = 0;
    const r = (await (await t.chamar('POST', `/api/admin/pedidos/${id}/aprovar`, { cookie: admin, corpo: APROVACAO })).json()) as { emprestimoId: number };
    await t.push.aguardar();
    assert.deepEqual(t.enviados.map((e) => [e.endpoint, e.mensagem.titulo, e.mensagem.url]), [[inscricao('ana').endpoint, 'Pedido aprovado', `/emprestimos/${r.emprestimoId}`]]);
    const id2 = await pedir();
    await t.push.aguardar();
    t.enviados.length = 0;
    await t.chamar('POST', `/api/admin/pedidos/${id2}/recusar`, { cookie: admin, corpo: { motivo: 'Motivo privado' } });
    await t.push.aguardar();
    assert.deepEqual(t.enviados.map((e) => [e.endpoint, e.mensagem.titulo]), [[inscricao('ana').endpoint, 'Pedido recusado']]);
    assert.ok(!JSON.stringify(t.enviados).includes('Motivo privado'));
  });

  test('confirmar pagamento avisa o dono; desmarcar não avisa', async () => {
    await t.chamar('POST', `/api/admin/emprestimos/${t.empB}/pagamentos`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 100 } });
    await t.push.aguardar();
    assert.deepEqual(t.enviados.map((e) => [e.endpoint, e.mensagem.titulo]), [[inscricao('bruno').endpoint, 'Pagamento confirmado']]);
    t.enviados.length = 0;
    const rota = `/api/admin/emprestimos/${t.empB}/parcelas/1/alternar`;
    await t.chamar('POST', rota, { cookie: admin });
    await t.push.aguardar();
    assert.equal(t.enviados.length, 1);
    t.enviados.length = 0;
    await t.chamar('POST', rota, { cookie: admin });
    await t.push.aguardar();
    assert.equal(t.enviados.length, 0);
  });

  test('falha no envio não impede o pagamento', async () => {
    t.respostasPush.set(inscricao('bruno').endpoint, 'falha');
    const r = await t.chamar('POST', `/api/admin/emprestimos/${t.empB}/pagamentos`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 100 } });
    assert.equal(r.status, 201);
    await t.push.aguardar();
  });

  test('inscrição expirada é apagada', async () => {
    t.respostasPush.set(inscricao('bruno').endpoint, 'expirada');
    await t.chamar('POST', `/api/admin/emprestimos/${t.empB}/pagamentos`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 100 } });
    await t.push.aguardar();
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM push_inscricoes WHERE endpoint = ?').get(inscricao('bruno').endpoint) as { n: number }).n, 0);
  });

  test('uma conta não remove a inscrição de outra, e o mesmo aparelho muda de dono', async () => {
    await t.chamar('DELETE', '/api/push/inscricao', { cookie: bruno, corpo: { endpoint: inscricao('ana').endpoint } });
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM push_inscricoes WHERE endpoint = ?').get(inscricao('ana').endpoint) as { n: number }).n, 1);
    await inscrever(bruno, 'ana');
    await t.chamar('POST', `/api/admin/emprestimos/${t.empA}/pagamentos`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 100 } });
    await t.push.aguardar();
    assert.equal(t.enviados.length, 0);
  });

  test('guarda no máximo 10 aparelhos por conta', async () => {
    for (let i = 0; i < 15; i++) await inscrever(ana, `aparelho-${i}`);
    const n = t.db.prepare('SELECT COUNT(*) AS n FROM push_inscricoes i JOIN usuarios u ON u.id = i.usuario_id WHERE u.email = ?').get(EMAILS_TESTE.devedorA) as { n: number };
    assert.equal(n.n, 10);
  });

  test('teste envia só para a própria conta e tem intervalo', async () => {
    assert.equal((await t.chamar('POST', '/api/push/teste', { cookie: ana })).status, 200);
    assert.deepEqual(t.enviados.map((e) => e.endpoint), [inscricao('ana').endpoint]);
    assert.equal((await t.chamar('POST', '/api/push/teste', { cookie: ana })).status, 409);
  });

  test('lembra 3 dias antes, no dia e em atraso, uma vez por dia', async () => {
    // Bruno: parcelas em 10/07, 10/08 e 10/09, com R$ 10 pagos na primeira.
    assert.equal(await t.push.rodarLembretes(new Date('2026-07-07T11:59:00Z')), 0); // antes das 9h em Brasília
    assert.ok((await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-07'))) >= 1);
    assert.equal(await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-07')), 0);
    assert.ok(t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint && e.mensagem.titulo === 'Parcela vence em 3 dias'));
    t.enviados.length = 0;
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-10'));
    assert.ok(t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint && e.mensagem.titulo === 'Parcela vence hoje'));
    t.enviados.length = 0;
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-11'));
    assert.ok(t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint && e.mensagem.titulo === 'Parcela em atraso'));
    t.enviados.length = 0;
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-12'));
    assert.ok(!t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint));
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-18'));
    assert.ok(t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint && e.mensagem.titulo === 'Parcela em atraso'));
    assert.ok(!t.enviados.some((e) => e.endpoint === inscricao('admin').endpoint));
  });

  test('lembrete que não chegou é tentado de novo', async () => {
    t.respostasPush.set(inscricao('bruno').endpoint, 'falha');
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-07'));
    t.respostasPush.delete(inscricao('bruno').endpoint);
    assert.equal(await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-07')), 1);
  });

  test('parcela quitada não gera lembrete', async () => {
    t.repo.registrarPagamento(t.empB, { data: '2026-06-15', valorCentavos: 299000, observacao: null });
    await t.push.rodarLembretes(NOVE_E_MEIA('2026-07-10'));
    assert.ok(!t.enviados.some((e) => e.endpoint === inscricao('bruno').endpoint));
  });
});

describe('pagamento informado pelo devedor', () => {
  const P256 = Buffer.alloc(65, 4).toString('base64url');
  const AUTH = Buffer.alloc(16, 7).toString('base64url');
  const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
  let t: Ctx;
  let admin: string;
  let ana: string;
  let bruno: string;
  const informar = (cookie = ana, id = t.empA) => t.enviarComprovante(cookie, id);
  const novo = async () => ((await (await informar()).json()) as { id: number }).id;
  const saldo = () => t.repo.visaoPorId(t.empA, '2026-06-15')!.consolidado.saldo.saldo;
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
    ana = await t.login(EMAILS_TESTE.devedorA);
    bruno = await t.login(EMAILS_TESTE.devedorB);
    for (const [c, n] of [[admin, 'admin'], [ana, 'ana'], [bruno, 'bruno']] as const) {
      await t.chamar('POST', '/api/push/inscricao', { cookie: c, corpo: { endpoint: endpoint(n), keys: { p256dh: P256, auth: AUTH } } });
    }
  });

  test('avisa o admin sem dar baixa e sem mostrar valor na notificação', async () => {
    const antes = saldo();
    assert.equal((await informar()).status, 201);
    await t.push.aguardar();
    assert.equal(saldo(), antes);
    assert.deepEqual(t.enviados.map((e) => [e.endpoint, e.mensagem.titulo]), [[endpoint('admin'), 'Pagamento informado']]);
    assert.ok(!JSON.stringify(t.enviados).includes('1500'));
    const r = (await (await t.chamar('GET', '/api/admin/resumo', { cookie: admin })).json()) as { avisosPagamento: number };
    assert.equal(r.avisosPagamento, 1);
    const l = (await (await t.chamar('GET', '/api/admin/avisos-pagamento', { cookie: admin })).json()) as { avisos: Array<{ valorCentavos: number; pessoa: { email: string } }> };
    assert.deepEqual(l.avisos.map((a) => [a.valorCentavos, a.pessoa.email]), [[150000, EMAILS_TESTE.devedorA]]);
  });

  test('o devedor não escolhe o valor, não repete e não informa dívida de outro', async () => {
    assert.equal((await t.enviarComprovante(ana, t.empA, JPG, 'c.jpg', 'image/jpeg', { valorCentavos: '1' })).status, 201);
    assert.equal(t.repo.avisoPendente(t.empA)!.valorCentavos, 150000);
    assert.equal((await informar()).status, 409);
    assert.equal((await informar(ana, t.empB)).status, 404);
  });

  test('confirmar registra o pagamento uma única vez e avisa o devedor', async () => {
    const id = await novo();
    await t.push.aguardar();
    t.enviados.length = 0;
    const antes = saldo();
    const rs = await Promise.all([1, 2].map(() => t.chamar('POST', `/api/admin/avisos-pagamento/${id}/confirmar`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 150000 } })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    await t.push.aguardar();
    assert.equal(saldo(), antes - 150000);
    assert.deepEqual(t.enviados.map((e) => [e.endpoint, e.mensagem.titulo]), [[endpoint('ana'), 'Pagamento confirmado']]);
    const d = await (await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}`, { cookie: ana })).text();
    assert.ok(!d.includes('Informado pelo devedor'));
  });

  test('admin pode confirmar o valor realmente recebido', async () => {
    const id = await novo();
    const antes = saldo();
    await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/confirmar`, { cookie: admin, corpo: { data: '2026-06-14', valorCentavos: 70000 } });
    assert.equal(saldo(), antes - 70000);
    assert.equal((await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/recusar`, { cookie: admin, corpo: {} })).status, 409);
  });

  test('recusa data futura e valor inválido', async () => {
    const id = await novo();
    for (const corpo of [{ data: '2026-06-16', valorCentavos: 100 }, { data: '2026-06-15', valorCentavos: 0 }]) {
      assert.equal((await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/confirmar`, { cookie: admin, corpo })).status, 400);
    }
    assert.equal(t.repo.avisoPendente(t.empA)!.id, id);
  });

  test('recusar não dá baixa, mostra o motivo e permite informar de novo', async () => {
    const id = await novo();
    await t.push.aguardar();
    t.enviados.length = 0;
    const antes = saldo();
    await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/recusar`, { cookie: admin, corpo: { motivo: 'Não caiu' } });
    await t.push.aguardar();
    assert.equal(saldo(), antes);
    assert.deepEqual(t.enviados.map((e) => e.mensagem.titulo), ['Pagamento não confirmado']);
    assert.ok(!JSON.stringify(t.enviados).includes('Não caiu'));
    const d = (await (await t.chamar('GET', `/api/devedor/emprestimos/${t.empA}`, { cookie: ana })).json()) as { avisoPagamento: { status: string; motivo: string } };
    assert.deepEqual([d.avisoPagamento.status, d.avisoPagamento.motivo], ['recusado', 'Não caiu']);
    assert.equal((await informar()).status, 201);
  });

  test('só o dono cancela e só admin responde', async () => {
    const id = await novo();
    assert.equal((await t.chamar('POST', `/api/devedor/avisos-pagamento/${id}/cancelar`, { cookie: bruno })).status, 404);
    for (const acao of ['confirmar', 'recusar']) {
      assert.equal((await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/${acao}`, { cookie: ana, corpo: { data: '2026-06-15', valorCentavos: 1 } })).status, 403);
    }
    assert.equal((await t.chamar('GET', '/api/admin/avisos-pagamento', { cookie: ana })).status, 403);
    assert.equal((await t.chamar('POST', `/api/devedor/avisos-pagamento/${id}/cancelar`, { cookie: ana })).status, 200);
    assert.equal(t.repo.avisoPendente(t.empA), null);
  });

  test('limita avisos repetidos em 24 horas', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await novo();
      await t.chamar('POST', `/api/devedor/avisos-pagamento/${id}/cancelar`, { cookie: ana });
    }
    assert.equal((await informar()).status, 409);
    t.avancar(new Date(AGORA.getTime() + 25 * 3_600_000));
    assert.equal((await informar()).status, 201);
  });

  test('não envia lembrete enquanto o pagamento aguarda confirmação', async () => {
    await novo();
    await t.push.aguardar();
    t.enviados.length = 0;
    await t.push.rodarLembretes(new Date('2026-07-10T12:30:00Z'));
    assert.ok(!t.enviados.some((e) => e.endpoint === endpoint('ana')));
  });
});

describe('comprovantes', () => {
  const novaData = (d: string) => new Date(`${d}T15:00:00Z`);
  let t: Ctx;
  let admin: string;
  let ana: string;
  let bruno: string;
  const enviar = async (bytes: Uint8Array = JPG, nome = 'c.jpg', tipo = 'image/jpeg') => {
    const r = await t.enviarComprovante(ana, t.empA, bytes, nome, tipo);
    assert.equal(r.status, 201);
    return ((await r.json()) as { id: number }).id;
  };
  const rota = (id: number) => `/api/admin/avisos-pagamento/${id}/comprovante`;
  const limpeza = () => new LimpezaComprovantes(t.repo, t.comprovantes);
  beforeEach(async () => {
    t = montar();
    admin = await t.login(EMAILS_TESTE.admin);
    ana = await t.login(EMAILS_TESTE.devedorA);
    bruno = await t.login(EMAILS_TESTE.devedorB);
  });

  test('reconhece os formatos pelo conteúdo', () => {
    assert.equal(detectarTipoComprovante(JPG)?.mime, 'image/jpeg');
    assert.equal(detectarTipoComprovante(PNG)?.mime, 'image/png');
    assert.equal(detectarTipoComprovante(WEBP)?.mime, 'image/webp');
    assert.equal(detectarTipoComprovante(PDF)?.mime, 'application/pdf');
    for (const ruim of ['<svg onload=alert(1)>', '<html>', 'GIF89a', 'texto']) assert.equal(detectarTipoComprovante(new TextEncoder().encode(ruim)), null);
  });

  test('o comprovante é obrigatório', async () => {
    assert.equal((await t.enviarComprovante(ana, t.empA, null)).status, 400);
    assert.equal((await t.enviarComprovante(ana, t.empA, new Uint8Array())).status, 400);
    assert.equal(t.repo.avisoPendente(t.empA), null);
    assert.deepEqual(t.arquivosEmDisco(), []);
  });

  test('recusa arquivo disfarçado e arquivo grande', async () => {
    const falso = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await t.enviarComprovante(ana, t.empA, falso, 'foto.png', 'image/png')).status, 400);
    const grande = new Uint8Array(MAX_COMPROVANTE_BYTES + 1);
    grande.set(JPG);
    assert.equal((await t.enviarComprovante(ana, t.empA, grande)).status, 400);
    assert.deepEqual(t.arquivosEmDisco(), []);
  });

  for (const [nome, bytes, mime] of [['jpg', JPG, 'image/jpeg'], ['png', PNG, 'image/png'], ['webp', WEBP, 'image/webp'], ['pdf', PDF, 'application/pdf']] as const) {
    test(`admin abre comprovante ${nome}, com o tipo real do conteúdo`, async () => {
      const id = await enviar(bytes, '../../etc/passwd', 'text/html');
      const r = await t.chamar('GET', rota(id), { cookie: admin });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), mime);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.ok(r.headers.get('content-disposition')!.startsWith(mime === 'application/pdf' ? 'attachment' : 'inline'));
      assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
      assert.match(t.arquivosEmDisco()[0]!, /^[a-f0-9]{48}\.(jpg|png|webp|pdf)$/);
    });
  }

  test('só admin acessa e o nome em disco nunca aparece', async () => {
    const id = await enviar();
    assert.equal((await t.chamar('GET', rota(id), { cookie: ana })).status, 403);
    assert.equal((await t.chamar('GET', rota(id), { cookie: bruno })).status, 403);
    assert.equal((await t.chamar('GET', rota(id))).status, 401);
    const disco = t.arquivosEmDisco()[0]!;
    for (const [c, url] of [[admin, '/api/admin/avisos-pagamento'], [admin, `/api/admin/emprestimos/${t.empA}/comprovantes`], [ana, `/api/devedor/emprestimos/${t.empA}`]] as const) {
      assert.ok(!(await (await t.chamar('GET', url, { cookie: c })).text()).includes(disco));
    }
  });

  test('não grava arquivo quando já existe aviso aberto', async () => {
    await enviar();
    assert.equal((await t.enviarComprovante(ana, t.empA, PNG, 'c.png', 'image/png')).status, 409);
    assert.equal(t.arquivosEmDisco().length, 1);
  });

  test('cancelar o aviso apaga o arquivo', async () => {
    const id = await enviar();
    await t.chamar('POST', `/api/devedor/avisos-pagamento/${id}/cancelar`, { cookie: ana });
    assert.deepEqual(t.arquivosEmDisco(), []);
    assert.equal((await t.chamar('GET', rota(id), { cookie: admin })).status, 404);
  });

  test('excluir empréstimo ou pessoa apaga os arquivos', async () => {
    await enviar();
    assert.equal((await t.chamar('DELETE', `/api/admin/emprestimos/${t.empA}`, { cookie: admin })).status, 204);
    assert.deepEqual(t.arquivosEmDisco(), []);
    assert.equal((await t.enviarComprovante(bruno, t.empB)).status, 201);
    assert.equal((await t.chamar('DELETE', `/api/admin/pessoas/${t.b}`, { cookie: admin })).status, 204);
    assert.deepEqual(t.arquivosEmDisco(), []);
  });

  test('cron apaga só depois de 3 meses e mantém o histórico', async () => {
    const id = await enviar();
    await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/confirmar`, { cookie: admin, corpo: { data: '2026-06-15', valorCentavos: 150000 } });
    assert.equal(t.repo.avisoPagamento(id)!.comprovanteExpiraEm, '2026-09-15');
    assert.equal((await limpeza().executar(novaData('2026-09-14'))).removidos, 0);
    assert.equal(t.arquivosEmDisco().length, 1);
    assert.equal((await limpeza().executar(novaData('2026-09-15'))).removidos, 1);
    assert.deepEqual(t.arquivosEmDisco(), []);
    assert.equal((await t.chamar('GET', rota(id), { cookie: admin })).status, 404);
    const l = (await (await t.chamar('GET', `/api/admin/emprestimos/${t.empA}/comprovantes`, { cookie: admin })).json()) as { comprovantes: Array<{ status: string; comprovante: { disponivel: boolean; removidoEm: string } }> };
    assert.equal(l.comprovantes[0]!.status, 'confirmado');
    assert.equal(l.comprovantes[0]!.comprovante.disponivel, false);
    assert.ok(l.comprovantes[0]!.comprovante.removidoEm);
    assert.equal(t.repo.pagamentos(t.empA).filter((p) => p.valorCentavos === 150000).length, 1);
    assert.equal((await limpeza().executar(novaData('2026-09-16'))).removidos, 0);
  });

  test('cron não apaga comprovante aguardando conferência', async () => {
    const id = await enviar();
    assert.equal((await limpeza().executar(novaData('2026-12-20'))).removidos, 0);
    assert.equal(t.arquivosEmDisco().length, 1);
    await t.chamar('POST', `/api/admin/avisos-pagamento/${id}/recusar`, { cookie: admin, corpo: {} });
    assert.equal((await limpeza().executar(novaData('2026-12-20'))).removidos, 1);
    assert.deepEqual(t.arquivosEmDisco(), []);
  });

  test('cron remove órfãos antigos e preserva os recentes e outros arquivos', async () => {
    mkdirSync(t.pastaComprovantes, { recursive: true });
    const velho = `${'a'.repeat(48)}.jpg`;
    const recente = `${'b'.repeat(48)}.png`;
    for (const n of [velho, recente, 'nao-apagar.txt']) writeFileSync(join(t.pastaComprovantes, n), 'x');
    const antigo = new Date(Date.now() - 48 * 3_600_000);
    utimesSync(join(t.pastaComprovantes, velho), antigo, antigo);
    utimesSync(join(t.pastaComprovantes, 'nao-apagar.txt'), antigo, antigo);
    const id = await enviar();
    const referenciado = t.repo.avisoPagamento(id)!.comprovanteArquivo!;
    utimesSync(join(t.pastaComprovantes, referenciado), antigo, antigo);
    assert.equal((await limpeza().executar(new Date())).orfaos, 1);
    assert.deepEqual(t.arquivosEmDisco().sort(), [recente, referenciado, 'nao-apagar.txt'].sort());
  });

  test('cron roda uma vez por dia a partir das 3h de Brasília', async () => {
    const l = limpeza();
    assert.equal(await l.executarSeDevido(new Date('2026-07-01T05:59:00Z')), null);
    assert.ok(await l.executarSeDevido(new Date('2026-07-01T06:00:00Z')));
    assert.equal(await l.executarSeDevido(new Date('2026-07-01T20:00:00Z')), null);
    assert.ok(await l.executarSeDevido(new Date('2026-07-02T06:01:00Z')));
  });

  test('final do mês não pula a validade', async () => {
    t.avancar(new Date('2026-11-30T15:00:00Z'));
    const r = await t.enviarComprovante(await t.login(EMAILS_TESTE.devedorA), t.empA);
    const { id } = (await r.json()) as { id: number };
    assert.equal(t.repo.avisoPagamento(id)!.comprovanteExpiraEm, '2027-02-28');
  });
});

describe('backup em arquivo', () => {
  test('cria cópia íntegra e mantém só as recentes', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'emprestimos-bkp-'));
    try {
      const db = abrirBanco(join(pasta, 'origem.db'));
      new Repo(db).criarPessoa({ nome: 'Ana', sobrenome: '', telefone: '', email: null });
      const dir = join(pasta, 'copias');
      const arquivo = fazerBackup(db, dir, '2026-06-01', 2);
      fazerBackup(db, dir, '2026-06-02', 2);
      fazerBackup(db, dir, '2026-06-03', 2);
      assert.ok(!existsSync(arquivo));
      const copia = new DatabaseSync(join(dir, 'emprestimos-2026-06-03.db'));
      assert.equal((copia.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }).n, 1);
      copia.close();
      db.close();
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
