import { useMemo, useRef, useState, type FormEvent } from 'react';
import { adicionaMeses, gerarParcelas, hojeBrasil, parseMoeda, type TipoMulta } from '@emprestimos/dominio';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { api, mensagemErro, useDados, type EmprestimoDto, type PagamentoDto, type PessoaDto, type Resumo, type Usuario } from './api.ts';
import {
  CartaoEmprestimo, Carregando, dataBr, Falha, Icone, InstalarApp, ListaParcelas, moeda, Modal, Navegacao, Progresso,
  reaisCampo, SeloEmprestimo, Tela, textoEncargos, tituloEmprestimo, useAviso, Vazio,
} from './comum.tsx';

type ListaE = { emprestimos: EmprestimoDto[]; hoje: string };
const nomePessoa = (p?: Pick<PessoaDto, 'nome' | 'sobrenome'>) => (p ? `${p.nome} ${p.sobrenome}`.trim() : '');
const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Inicio() {
  const r = useDados<{ resumo: Resumo }>('/admin/resumo');
  const l = useDados<ListaE>('/admin/emprestimos');
  const res = r.dados?.resumo;
  const atrasados = (l.dados?.emprestimos ?? []).filter((e) => e.temAtraso);
  return (
    <Tela titulo="Início">
      {(r.erro || l.erro) && !res && <Falha mensagem={(r.erro ?? l.erro)!} tentar={() => { r.recarregar(); l.recarregar(); }} />}
      {!r.erro && !res && <Carregando />}
      {res && (
        <>
          <section className="destaque">
            <div className="rotulo">A receber</div>
            <div className="valor-grande">{moeda(res.totalAReceber)}</div>
            <div className="suave">{res.emprestimosAtivos} empréstimo(s) em aberto</div>
          </section>
          <div className="grade2">
            <div className="cartao"><div className="rotulo">Emprestado</div><div className="valor">{moeda(res.totalEmprestado)}</div></div>
            <div className="cartao"><div className="rotulo">Recebido</div><div className="valor txt-ok">{moeda(res.totalPago)}</div></div>
          </div>
          <Link to="/emprestimos/novo" className="btn">Novo empréstimo</Link>
          {atrasados.length > 0 && (
            <section>
              <div className="linha"><h2>Em atraso ({atrasados.length})</h2><Link to="/atrasados" className="link-txt">Ver todos</Link></div>
              <div className="grade">
                {atrasados.slice(0, 3).map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} subtitulo={nomePessoa(e.pessoa)} />)}
              </div>
            </section>
          )}
        </>
      )}
    </Tela>
  );
}

function Pessoas() {
  const { dados, erro, recarregar } = useDados<{ pessoas: PessoaDto[] }>('/admin/pessoas');
  const [busca, setBusca] = useState('');
  const lista = (dados?.pessoas ?? []).filter((p) => normal(`${p.nome} ${p.sobrenome} ${p.telefone} ${p.email ?? ''}`).includes(normal(busca)));
  return (
    <Tela titulo="Pessoas" acao={<Link to="/pessoas/nova" className="btn-icone laranja" aria-label="Nova pessoa"><Icone nome="mais" /></Link>}>
      <input className="busca" type="search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados && lista.length === 0 && <Vazio titulo={busca ? 'Ninguém encontrado.' : 'Nenhuma pessoa cadastrada.'} />}
      <div className="grade">
        {lista.map((p) => (
          <Link key={p.id} to={`/pessoas/${p.id}`} className="cartao link">
            <div className="linha">
              <div className="min0">
                <strong className="corta bloco">{nomePessoa(p)}</strong>
                <span className="suave corta bloco">{p.email ?? 'Sem e-mail: não vê as dívidas no app'}</span>
              </div>
              <div className="dir">
                <strong className={p.temAtraso ? 'txt-ruim' : ''}>{moeda(p.saldoCentavos ?? 0)}</strong>
                <div className="suave peq">{p.emprestimos} empréstimo(s)</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Tela>
  );
}

function PessoaDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAviso();
  const { dados, erro, recarregar } = useDados<{ pessoa: PessoaDto; emprestimos: EmprestimoDto[] }>(`/admin/pessoas/${id}`);
  const [excluindo, setExcluindo] = useState(false);
  const p = dados?.pessoa;
  const remover = async () => {
    try {
      await api('DELETE', `/admin/pessoas/${id}`);
      avisar('Pessoa excluída.');
      navegar('/pessoas', { replace: true });
    } catch (e) {
      avisar(mensagemErro(e));
    }
  };
  return (
    <Tela titulo={p ? nomePessoa(p) : 'Pessoa'} voltar acao={p && <Link to={`/pessoas/${id}/editar`} className="link-txt">Editar</Link>}>
      {erro && !p && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !p && <Carregando />}
      {p && dados && (
        <>
          <section className="cartao">
            <dl className="dados">
              <div><dt>Telefone</dt><dd>{p.telefone ? <a href={`tel:${p.telefone.replace(/[^\d+]/g, '')}`}>{p.telefone}</a> : '-'}</dd></div>
              <div><dt>E-mail do login</dt><dd className="quebra">{p.email ?? 'Não cadastrado'}</dd></div>
            </dl>
            {!p.email && <p className="suave peq">Cadastre o e-mail Google para esta pessoa acessar as próprias dívidas.</p>}
          </section>
          <Link to={`/emprestimos/novo?pessoa=${p.id}`} className="btn">Novo empréstimo</Link>
          <h2>Empréstimos</h2>
          {dados.emprestimos.length === 0 && <Vazio titulo="Nenhum empréstimo." />}
          <div className="grade">
            {dados.emprestimos.map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} />)}
          </div>
          <button className="btn perigo" onClick={() => setExcluindo(true)}>Excluir pessoa</button>
          {excluindo && (
            <Modal titulo="Excluir pessoa?" aoFechar={() => setExcluindo(false)}>
              <p>{nomePessoa(p)}, os {dados.emprestimos.length} empréstimo(s) e todos os pagamentos serão apagados. Isso não pode ser desfeito.</p>
              <button className="btn perigo" onClick={remover}>Excluir</button>
              <button className="btn sec" onClick={() => setExcluindo(false)}>Cancelar</button>
            </Modal>
          )}
        </>
      )}
    </Tela>
  );
}

function PessoaForm() {
  const { id } = useParams();
  const { dados, erro } = useDados<{ pessoa: PessoaDto }>(id ? `/admin/pessoas/${id}` : '/auth/me');
  if (id && erro && !dados) return <Tela titulo="Editar pessoa" voltar><Falha mensagem={erro} /></Tela>;
  if (id && !dados) return <Tela titulo="Editar pessoa" voltar><Carregando /></Tela>;
  return <PessoaCampos key={id ?? 'nova'} id={id} inicial={id ? dados!.pessoa : undefined} />;
}

function PessoaCampos({ id, inicial }: { id?: string; inicial?: PessoaDto }) {
  const navegar = useNavigate();
  const avisar = useAviso();
  const [f, setF] = useState({ nome: inicial?.nome ?? '', sobrenome: inicial?.sobrenome ?? '', telefone: inicial?.telefone ?? '', email: inicial?.email ?? '' });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = { ...f, email: f.email.trim() || null };
      if (id) await api('PUT', `/admin/pessoas/${id}`, corpo);
      else await api('POST', '/admin/pessoas', corpo);
      avisar('Pessoa salva.');
      navegar(-1);
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Tela titulo={id ? 'Editar pessoa' : 'Nova pessoa'} voltar>
      <form className="form" onSubmit={salvar}>
        <label>Nome<input required maxLength={100} autoComplete="given-name" {...campo('nome')} /></label>
        <label>Sobrenome<input maxLength={100} autoComplete="family-name" {...campo('sobrenome')} /></label>
        <label>Telefone<input type="tel" inputMode="tel" maxLength={40} autoComplete="tel" {...campo('telefone')} /></label>
        <label>E-mail Google<input type="email" inputMode="email" maxLength={254} autoCapitalize="none" autoComplete="email" {...campo('email')} />
          <small>Com este e-mail a pessoa entra no app e vê somente as próprias dívidas.</small>
        </label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="btn" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
      </form>
    </Tela>
  );
}

function Emprestimos() {
  const { dados, erro, recarregar } = useDados<ListaE>('/admin/emprestimos');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'atraso' | 'dia' | 'quitados'>('todos');
  const lista = (dados?.emprestimos ?? []).filter((e) => {
    if (filtro === 'atraso' && !e.temAtraso) return false;
    if (filtro === 'dia' && (e.temAtraso || e.saldo.quitado)) return false;
    if (filtro === 'quitados' && !e.saldo.quitado) return false;
    return normal(`${e.nome ?? ''} ${nomePessoa(e.pessoa)}`).includes(normal(busca));
  });
  const FILTROS = [['todos', 'Todos'], ['atraso', 'Atrasados'], ['dia', 'Em dia'], ['quitados', 'Quitados']] as const;
  return (
    <Tela titulo="Empréstimos" acao={<Link to="/emprestimos/novo" className="btn-icone laranja" aria-label="Novo empréstimo"><Icone nome="mais" /></Link>}>
      <input className="busca" type="search" placeholder="Buscar por nome ou pessoa" aria-label="Buscar empréstimo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="chips" role="group" aria-label="Filtrar">
        {FILTROS.map(([v, r]) => <button key={v} className={filtro === v ? 'chip ativo' : 'chip'} aria-pressed={filtro === v} onClick={() => setFiltro(v)}>{r}</button>)}
      </div>
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados && lista.length === 0 && <Vazio titulo="Nenhum empréstimo encontrado." />}
      <div className="grade">
        {lista.map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} subtitulo={nomePessoa(e.pessoa)} />)}
      </div>
    </Tela>
  );
}

function Atrasados() {
  const { dados, erro, recarregar } = useDados<ListaE>('/admin/emprestimos');
  const lista = (dados?.emprestimos ?? []).filter((e) => e.temAtraso);
  return (
    <Tela titulo="Atrasados">
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados && lista.length === 0 && <Vazio titulo="Nada em atraso." />}
      {lista.length > 0 && (
        <section className="destaque ruim">
          <div className="rotulo">Vencido com encargos</div>
          <div className="valor-grande">{moeda(lista.reduce((s, e) => s + e.valorPagarAgora, 0))}</div>
          <div className="suave">{lista.length} empréstimo(s)</div>
        </section>
      )}
      <div className="grade">
        {lista.map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} subtitulo={nomePessoa(e.pessoa)} />)}
      </div>
    </Tela>
  );
}

function FormPagamento({ emprestimoId, pagamento, sugestao, aoFechar, aoSalvar }: {
  emprestimoId: number;
  pagamento?: PagamentoDto;
  sugestao: number;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [valor, setValor] = useState(pagamento ? reaisCampo(pagamento.valorCentavos) : sugestao > 0 ? reaisCampo(sugestao) : '');
  const [data, setData] = useState(pagamento?.data ?? hojeBrasil());
  const [obs, setObs] = useState(pagamento?.observacao ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const valorCentavos = parseMoeda(valor);
    if (!valorCentavos) return setErro('Informe um valor válido.');
    setOcupado(true);
    setErro(null);
    try {
      const corpo = { data, valorCentavos, observacao: obs.trim() || null };
      if (pagamento) await api('PUT', `/admin/pagamentos/${pagamento.id}`, corpo);
      else await api('POST', `/admin/emprestimos/${emprestimoId}/pagamentos`, corpo);
      aoSalvar();
    } catch (x) {
      setErro(mensagemErro(x));
      setOcupado(false);
    }
  };
  const remover = async () => {
    setOcupado(true);
    try {
      await api('DELETE', `/admin/pagamentos/${pagamento!.id}`);
      aoSalvar();
    } catch (x) {
      setErro(mensagemErro(x));
      setOcupado(false);
    }
  };

  return (
    <Modal titulo={pagamento ? 'Editar pagamento' : 'Registrar pagamento'} aoFechar={aoFechar}>
      <form className="form" onSubmit={salvar}>
        <label>Valor (R$)<input required inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label>Data<input required type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label>Observação interna<input maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} /><small>O devedor não vê este campo.</small></label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="btn" disabled={ocupado}>Salvar</button>
        {pagamento && <button type="button" className="btn perigo" disabled={ocupado} onClick={remover}>Excluir pagamento</button>}
        <button type="button" className="btn sec" onClick={aoFechar}>Cancelar</button>
      </form>
    </Modal>
  );
}

function EmprestimoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAviso();
  const { dados, erro, recarregar } = useDados<{ emprestimo: EmprestimoDto }>(`/admin/emprestimos/${id}`);
  const [form, setForm] = useState<{ pagamento?: PagamentoDto } | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const e = dados?.emprestimo;

  const alternar = async (n: number) => {
    setOcupado(true);
    try {
      const r = await api<{ resultado: string }>('POST', `/admin/emprestimos/${id}/parcelas/${n}/alternar`);
      avisar(r.resultado === 'marcada' ? `Parcela ${n} marcada como paga.` : r.resultado === 'desmarcada' ? `Pagamento da parcela ${n} desfeito.` : `A parcela ${n} já estava paga por outros pagamentos.`);
      recarregar();
    } catch (x) {
      avisar(mensagemErro(x));
    } finally {
      setOcupado(false);
    }
  };
  const remover = async () => {
    try {
      await api('DELETE', `/admin/emprestimos/${id}`);
      avisar('Empréstimo excluído.');
      navegar(-1);
    } catch (x) {
      avisar(mensagemErro(x));
    }
  };

  return (
    <Tela titulo={e ? tituloEmprestimo(e) : 'Empréstimo'} voltar acao={e && <Link to={`/emprestimos/${id}/editar`} className="link-txt">Editar</Link>}>
      {erro && !e && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !e && <Carregando />}
      {e && (
        <div className="colunas">
          <div>
            <section className={`destaque ${e.temAtraso ? 'ruim' : ''}`}>
              <div className="linha"><Link to={`/pessoas/${e.pessoa?.id}`} className="link-txt corta">{nomePessoa(e.pessoa)}</Link><SeloEmprestimo e={e} /></div>
              <div className="rotulo">Saldo devedor</div>
              <div className="valor-grande">{moeda(e.saldo.saldo)}</div>
              <Progresso pago={e.saldo.totalPago} total={e.saldo.totalDevido} />
              <div className="linha suave"><span>Pago {moeda(e.saldo.totalPago)}</span><span>Total {moeda(e.saldo.totalDevido)}</span></div>
              {e.saldo.credito > 0 && <div className="txt-ok">Crédito do devedor: {moeda(e.saldo.credito)}</div>}
              <button className="btn" onClick={() => setForm({})}>Registrar pagamento</button>
            </section>
            <section className="cartao">
              <dl className="dados">
                <div><dt>Valor emprestado</dt><dd>{moeda(e.valorTotalCentavos)}</dd></div>
                <div><dt>Data do empréstimo</dt><dd>{dataBr(e.dataEmprestimo)}</dd></div>
                <div><dt>Previsão de quitação</dt><dd>{dataBr(e.dataPrevistaPagamento)}</dd></div>
                {e.encargos.total > 0 && <div><dt>Juros e multa até hoje</dt><dd className="txt-ruim">{moeda(e.encargos.total)}</dd></div>}
              </dl>
              <p className="suave peq">{textoEncargos(e)}</p>
            </section>
            <section>
              <h2>Pagamentos</h2>
              {e.pagamentos.length === 0 && <div className="cartao suave">Nenhum pagamento registrado.</div>}
              {e.pagamentos.length > 0 && (
                <ul className="lista cartao sem-pad">
                  {e.pagamentos.map((p) => (
                    <li key={p.id}>
                      <button className="item" onClick={() => setForm({ pagamento: p })} aria-label={`Editar pagamento de ${dataBr(p.data)}`}>
                        <span className="cresce min0">
                          <span className="bloco">{dataBr(p.data)}</span>
                          <span className="suave peq bloco corta">{p.parcelaMarcada ? `Parcela ${p.parcelaMarcada} marcada` : p.observacao}</span>
                        </span>
                        <strong className="txt-ok">{moeda(p.valorCentavos)}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div>
            <section>
              <h2>Parcelas</h2>
              <p className="suave peq">Toque em uma parcela para marcar como paga ou desfazer.</p>
              <div className="cartao sem-pad"><ListaParcelas parcelas={e.saldo.parcelas} encargos={e.encargos} aoAlternar={alternar} ocupado={ocupado} /></div>
            </section>
            <button className="btn perigo" onClick={() => setExcluindo(true)}>Excluir empréstimo</button>
          </div>
          {form && (
            <FormPagamento
              emprestimoId={e.id}
              pagamento={form.pagamento}
              sugestao={e.valorPagarAgora}
              aoFechar={() => setForm(null)}
              aoSalvar={() => { setForm(null); avisar('Pagamento salvo.'); recarregar(); }}
            />
          )}
          {excluindo && (
            <Modal titulo="Excluir empréstimo?" aoFechar={() => setExcluindo(false)}>
              <p>O empréstimo e seus {e.pagamentos.length} pagamento(s) serão apagados. Isso não pode ser desfeito.</p>
              <button className="btn perigo" onClick={remover}>Excluir</button>
              <button className="btn sec" onClick={() => setExcluindo(false)}>Cancelar</button>
            </Modal>
          )}
        </div>
      )}
    </Tela>
  );
}

function EmprestimoForm() {
  const { id } = useParams();
  const pessoas = useDados<{ pessoas: PessoaDto[] }>('/admin/pessoas');
  const atual = useDados<{ emprestimo: EmprestimoDto }>(id ? `/admin/emprestimos/${id}` : '/auth/me');
  const titulo = id ? 'Editar empréstimo' : 'Novo empréstimo';
  const erro = pessoas.erro ?? (id ? atual.erro : null);
  if (erro) return <Tela titulo={titulo} voltar><Falha mensagem={erro} /></Tela>;
  if (!pessoas.dados || (id && !atual.dados)) return <Tela titulo={titulo} voltar><Carregando /></Tela>;
  if (pessoas.dados.pessoas.length === 0) {
    return <Tela titulo={titulo} voltar><Vazio titulo="Cadastre uma pessoa primeiro."><Link className="btn" to="/pessoas/nova">Nova pessoa</Link></Vazio></Tela>;
  }
  return <EmprestimoCampos key={id ?? 'novo'} id={id} pessoas={pessoas.dados.pessoas} inicial={id ? atual.dados!.emprestimo : undefined} />;
}

function EmprestimoCampos({ id, pessoas, inicial }: { id?: string; pessoas: PessoaDto[]; inicial?: EmprestimoDto }) {
  const navegar = useNavigate();
  const avisar = useAviso();
  const pessoaUrl = new URLSearchParams(location.search).get('pessoa');
  const hoje = hojeBrasil();
  const [f, setF] = useState({
    pessoaId: String(inicial?.pessoa?.id ?? pessoaUrl ?? pessoas[0]!.id),
    nome: inicial?.nome ?? '',
    valor: inicial ? reaisCampo(inicial.valorTotalCentavos) : '',
    dataEmprestimo: inicial?.dataEmprestimo ?? hoje,
    primeiroVencimento: inicial?.primeiroVencimento ?? adicionaMeses(hoje, 1),
    numParcelas: String(inicial?.numParcelas ?? 1),
    juros: inicial ? String(inicial.jurosAoMesPct).replace('.', ',') : '0',
    tipoMulta: String(inicial?.tipoMulta ?? 0),
    multa: inicial ? (inicial.tipoMulta === 1 ? reaisCampo(inicial.multaValor) : String(inicial.multaValor).replace('.', ',')) : '0',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const previa = useMemo(() => {
    const v = parseMoeda(f.valor);
    const n = Number(f.numParcelas);
    if (!v || !Number.isInteger(n) || n < 1 || n > 360 || !f.primeiroVencimento) return null;
    const p = gerarParcelas(v, n, f.primeiroVencimento);
    return { primeira: p[0]!, ultima: p[p.length - 1]!, n };
  }, [f.valor, f.numParcelas, f.primeiroVencimento]);

  const numero = (t: string) => {
    const v = Number(t.trim().replace(',', '.') || '0');
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    const valorTotalCentavos = parseMoeda(f.valor);
    const numParcelas = Number(f.numParcelas);
    const jurosAoMesPct = numero(f.juros);
    const tipoMulta = Number(f.tipoMulta) as TipoMulta;
    const multaValor = tipoMulta === 0 ? 0 : tipoMulta === 1 ? parseMoeda(f.multa || '0') : numero(f.multa);
    if (!valorTotalCentavos) return setErro('Informe um valor válido.');
    if (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 360) return setErro('O número de parcelas deve ser de 1 a 360.');
    if (jurosAoMesPct === null || jurosAoMesPct > 100) return setErro('Informe juros de 0 a 100%.');
    if (multaValor === null || (tipoMulta === 2 && multaValor > 100)) return setErro('Informe uma multa válida.');
    setSalvando(true);
    try {
      const corpo = {
        pessoaId: Number(f.pessoaId),
        nome: f.nome.trim() || null,
        valorTotalCentavos,
        dataEmprestimo: f.dataEmprestimo,
        primeiroVencimento: f.primeiroVencimento,
        dataPrevistaPagamento: adicionaMeses(f.primeiroVencimento, numParcelas - 1),
        numParcelas,
        jurosAoMesPct,
        tipoMulta,
        multaValor,
      };
      if (id) {
        await api('PUT', `/admin/emprestimos/${id}`, corpo);
        avisar('Empréstimo salvo.');
        navegar(-1);
      } else {
        const r = await api<{ id: number }>('POST', '/admin/emprestimos', corpo);
        avisar('Empréstimo criado.');
        navegar(`/emprestimos/${r.id}`, { replace: true });
      }
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Tela titulo={id ? 'Editar empréstimo' : 'Novo empréstimo'} voltar>
      <form className="form" onSubmit={salvar}>
        <label>Pessoa<select {...campo('pessoaId')}>{pessoas.map((p) => <option key={p.id} value={p.id}>{nomePessoa(p)}</option>)}</select></label>
        <label>Nome do empréstimo (opcional)<input maxLength={80} placeholder="Ex.: Reforma" {...campo('nome')} /></label>
        <label>Valor (R$)<input required inputMode="decimal" placeholder="0,00" {...campo('valor')} /></label>
        <div className="campos2">
          <label>Data do empréstimo<input required type="date" {...campo('dataEmprestimo')} /></label>
          <label>1º vencimento<input required type="date" {...campo('primeiroVencimento')} /></label>
        </div>
        <label>Número de parcelas<input required type="number" inputMode="numeric" min={1} max={360} {...campo('numParcelas')} /></label>
        {previa && (
          <p className="previa">{previa.n}x de {moeda(previa.primeira.valor)}{previa.ultima.valor !== previa.primeira.valor ? ` (última ${moeda(previa.ultima.valor)})` : ''}, até {dataBr(previa.ultima.vencimento)}</p>
        )}
        <fieldset>
          <legend>Por atraso</legend>
          <label>Juros ao mês (%)<input inputMode="decimal" {...campo('juros')} /></label>
          <label>Multa<select {...campo('tipoMulta')}><option value="0">Sem multa</option><option value="1">Valor fixo (R$)</option><option value="2">Percentual (%)</option></select></label>
          {f.tipoMulta !== '0' && <label>{f.tipoMulta === '1' ? 'Valor da multa (R$)' : 'Multa (%)'}<input inputMode="decimal" {...campo('multa')} /></label>}
        </fieldset>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="btn" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
      </form>
    </Tela>
  );
}

type PixDto = { chave: string; nome: string; cidade: string };
type ConfiguracoesDto = { pix: PixDto | null; admins: Array<{ email: string; principal: boolean }>; podeEditar: boolean };

function ConfigPix({ pix, podeEditar, aoSalvar }: { pix: PixDto | null; podeEditar: boolean; aoSalvar: () => void }) {
  const avisar = useAviso();
  const [f, setF] = useState<PixDto>(pix ?? { chave: '', nome: '', cidade: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campo = (k: keyof PixDto) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await api('PUT', '/admin/configuracoes/pix', f);
      avisar('Dados do Pix salvos.');
      aoSalvar();
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setSalvando(false);
    }
  };

  if (!podeEditar) {
    return pix ? (
      <dl className="dados">
        <div><dt>Chave</dt><dd className="quebra">{pix.chave}</dd></div>
        <div><dt>Recebedor</dt><dd>{pix.nome}</dd></div>
        <div><dt>Cidade</dt><dd>{pix.cidade}</dd></div>
      </dl>
    ) : <p className="suave peq">O administrador principal ainda não configurou o Pix.</p>;
  }
  return (
    <form className="form" onSubmit={salvar}>
      {!pix && <p className="erro" role="status">Enquanto o Pix não for salvo, os devedores não conseguem gerar o QR Code.</p>}
      <label>Chave Pix<input required maxLength={100} autoCapitalize="none" autoCorrect="off" spellCheck={false} {...campo('chave')} />
        <small>CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória.</small></label>
      <label>Nome do recebedor<input required maxLength={25} {...campo('nome')} /></label>
      <label>Cidade<input required maxLength={15} {...campo('cidade')} /></label>
      <small>Depois de salvar, gere um QR e confira o nome e a chave no app do banco antes de pagar.</small>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button className="btn" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar Pix'}</button>
    </form>
  );
}

function ConfigAdmins({ admins, podeEditar, aoMudar }: { admins: ConfiguracoesDto['admins']; podeEditar: boolean; aoMudar: () => void }) {
  const avisar = useAviso();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api('POST', '/admin/configuracoes/admins', { email });
      setEmail('');
      avisar('Administrador adicionado.');
      aoMudar();
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setOcupado(false);
    }
  };
  const remover = async () => {
    if (!removendo) return;
    setErro(null);
    try {
      await api('DELETE', `/admin/configuracoes/admins/${encodeURIComponent(removendo)}`);
      avisar('Administrador removido.');
      aoMudar();
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setRemovendo(null);
    }
  };

  return (
    <>
      <ul className="lista lista-admins">
        {admins.map((a) => (
          <li key={a.email} className="linha">
            <div className="min0">
              <span className="quebra bloco">{a.email}</span>
              <span className="suave peq">{a.principal ? 'Principal' : 'Administrador'}</span>
            </div>
            {podeEditar && !a.principal && <button className="link-txt" aria-label={`Remover ${a.email}`} onClick={() => setRemovendo(a.email)}>Remover</button>}
          </li>
        ))}
      </ul>
      {podeEditar && (
        <form className="form" onSubmit={adicionar}>
          <label>Adicionar e-mail Google<input required type="email" inputMode="email" maxLength={254} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
            <small>Essa pessoa verá todos os empréstimos, mas não poderá alterar o Pix nem os administradores.</small></label>
          <button className="btn sec" disabled={ocupado}>{ocupado ? 'Adicionando...' : 'Adicionar administrador'}</button>
        </form>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {removendo && (
        <Modal titulo="Remover administrador?" aoFechar={() => setRemovendo(null)}>
          <p className="quebra">{removendo} perderá o acesso de administrador na hora.</p>
          <button className="btn perigo" onClick={remover}>Remover</button>
          <button className="btn sec" onClick={() => setRemovendo(null)}>Cancelar</button>
        </Modal>
      )}
    </>
  );
}

function Config({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  const avisar = useAviso();
  const arquivo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const conf = useDados<ConfiguracoesDto>('/admin/configuracoes');

  const importar = async (file: File | undefined) => {
    if (!file) return;
    setErro(null);
    try {
      const r = await api<{ importado: { pessoas: number; emprestimos: number; pagamentos: number } }>('POST', '/admin/importar', JSON.parse(await file.text()));
      avisar(`Importados: ${r.importado.pessoas} pessoas, ${r.importado.emprestimos} empréstimos e ${r.importado.pagamentos} pagamentos.`);
    } catch (e) {
      setErro(e instanceof SyntaxError ? 'O arquivo não é um backup válido.' : mensagemErro(e));
    } finally {
      if (arquivo.current) arquivo.current.value = '';
    }
  };

  return (
    <Tela titulo="Config">
      <section className="cartao">
        <h2>Conta</h2>
        <dl className="dados"><div><dt>E-mail</dt><dd className="quebra">{usuario.email}</dd></div><div><dt>Perfil</dt><dd>Administrador</dd></div></dl>
      </section>
      {conf.erro && !conf.dados && <Falha mensagem={conf.erro} tentar={conf.recarregar} />}
      {!conf.erro && !conf.dados && <Carregando />}
      {conf.dados && (
        <>
          <section className="cartao">
            <h2>Pix para receber</h2>
            <ConfigPix key={JSON.stringify(conf.dados.pix)} pix={conf.dados.pix} podeEditar={conf.dados.podeEditar} aoSalvar={conf.recarregar} />
          </section>
          <section className="cartao">
            <h2>Administradores</h2>
            <ConfigAdmins admins={conf.dados.admins} podeEditar={conf.dados.podeEditar} aoMudar={conf.recarregar} />
          </section>
        </>
      )}
      <section className="cartao"><h2>Instalar no celular</h2><InstalarApp /></section>
      <section className="cartao">
        <h2>Backup</h2>
        <p className="suave peq">Baixe uma cópia de todos os dados. Guarde em local seguro, pois contém dados financeiros.</p>
        <a className="btn sec" href="/api/admin/backup" download>Baixar backup</a>
        <p className="suave peq">Para trazer os dados do app antigo, envie o backup JSON. Só funciona com o sistema vazio.</p>
        <input ref={arquivo} type="file" accept="application/json,.json" hidden aria-label="Arquivo de backup" onChange={(e) => importar(e.target.files?.[0])} />
        <button className="btn sec" onClick={() => arquivo.current?.click()}>Importar backup</button>
        {erro && <p className="erro" role="alert">{erro}</p>}
      </section>
      <button className="btn sec" onClick={aoSair}>Sair</button>
    </Tela>
  );
}

export function AppAdmin({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  const { dados } = useDados<{ resumo: Resumo }>('/admin/resumo');
  return (
    <div className="app">
      <Navegacao papel="admin" atrasados={dados?.resumo.emprestimosAtrasados} />
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/pessoas" element={<Pessoas />} />
        <Route path="/pessoas/nova" element={<PessoaForm />} />
        <Route path="/pessoas/:id" element={<PessoaDetalhe />} />
        <Route path="/pessoas/:id/editar" element={<PessoaForm />} />
        <Route path="/emprestimos" element={<Emprestimos />} />
        <Route path="/emprestimos/novo" element={<EmprestimoForm />} />
        <Route path="/emprestimos/:id" element={<EmprestimoDetalhe />} />
        <Route path="/emprestimos/:id/editar" element={<EmprestimoForm />} />
        <Route path="/atrasados" element={<Atrasados />} />
        <Route path="/config" element={<Config usuario={usuario} aoSair={aoSair} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
