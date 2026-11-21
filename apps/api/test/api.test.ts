import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { criarApp } from '../src/app.ts';
import { ErroGoogle, hashToken } from '../src/auth.ts';
import { fazerBackup } from '../src/backup.ts';
import { lerConfig } from '../src/config.ts';
import { abrirBanco } from '../src/db.ts';
import { Repo } from '../src/repo.ts';

const EMAILS_TESTE = {
  admin: 'admin@teste.local',
  devedorA: 'ana.devedora@teste.local',
  devedorB: 'bruno.devedor@teste.local',
} as const;

const ORIGEM = 'http://localhost:5173';
const AGORA = new Date('2026-06-15T15:00:00Z');

function montar(extra: NodeJS.ProcessEnv = {}) {
  const config = lerConfig({
    NODE_ENV: 'test',
    ADMIN_EMAILS: EMAILS_TESTE.admin,
    APP_ORIGINS: ORIGEM,
    GOOGLE_CLIENT_ID: 'cliente',
    ...extra,
  });
  const db = abrirBanco(':memory:');
  let momento = AGORA;
  const google = {
    async verificar(token: string) {
      if (token === 'token-indisponivel') throw new ErroGoogle(true);
      if (!token.startsWith('valido:')) throw new ErroGoogle(false);
      return { email: token.slice(7), nome: 'Via Google', avatarUrl: null };
    },
  };
  const app = criarApp({ db, config, google, agora: () => momento });
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
  async function login(email: string) {
    const r = await chamar('POST', '/api/auth/google', { corpo: { credential: `valido:${email}` } });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }
  return { app, db, repo, chamar, login, empA, empB, pagB, a, b, avancar: (d: Date) => (momento = d) };
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

  test('e-mail desconhecido é recusado e nenhum usuário é criado', async () => {
    const r = await t.chamar('POST', '/api/auth/google', { corpo: { credential: 'valido:estranho@teste.local' } });
    assert.equal(r.status, 403);
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM usuarios').get() as { n: number }).n, 0);
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

  test('remover o e-mail da ficha tira o acesso na hora', async () => {
    const c = await t.login(EMAILS_TESTE.devedorA);
    t.repo.atualizarPessoa(t.a, { nome: 'Ana', sobrenome: 'A', telefone: '1', email: null });
    assert.equal((await t.chamar('GET', '/api/devedor/resumo', { cookie: c })).status, 401);
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
    const negado = await enviar('abc', 'estranho@teste.local');
    assert.equal(negado.headers.get('location'), '/entrar?erro=acesso');
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
    assert.equal((await t.chamar('DELETE', `${ROTA}/admins/${encodeURIComponent(EMAILS_TESTE.admin)}`, { cookie: admin })).status, 409);
  });

  test('um e-mail não pode ser devedor e admin ao mesmo tempo', async () => {
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EMAILS_TESTE.devedorA } })).status, 409);
    await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } });
    assert.equal((await t.chamar('POST', '/api/admin/pessoas', { cookie: admin, corpo: { nome: 'X', email: EXTRA } })).status, 409);
    assert.equal((await t.chamar('POST', `${ROTA}/admins`, { cookie: admin, corpo: { email: EXTRA } })).status, 409);
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
