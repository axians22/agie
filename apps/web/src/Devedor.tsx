import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { adicionaMeses, gerarParcelas, hojeBrasil, parseMoeda } from '@emprestimos/dominio';
import QRCode from 'qrcode';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { api, mensagemErro, useDados, type EmprestimoDto, type PedidoDto, type Resumo, type Usuario } from './api.ts';
import {
  CampoInteiro, ConvitePush, Notificacoes, useSincronizarPush, CampoMoeda, CartaoEmprestimo, Carregando, dataBr, Falha, InstalarApp, ListaParcelas, moeda, Modal, Navegacao, Progresso,
  SeloEmprestimo, SeloPedido, Tela, textoEncargos, tituloEmprestimo, useAtualizacao, useAviso, Vazio,
} from './comum.tsx';

type Lista = { emprestimos: EmprestimoDto[]; hoje: string };

function Inicio({ usuario }: { usuario: Usuario }) {
  const { dados, erro, recarregar } = useDados<Lista>('/devedor/emprestimos');
  const resumo = useDados<{ resumo: Resumo }>('/devedor/resumo');
  const primeiroNome = usuario.nome?.split(' ')[0];
  const r = resumo.dados?.resumo;
  const atrasados = dados?.emprestimos.filter((e) => e.temAtraso) ?? [];
  const proximas = (dados?.emprestimos ?? [])
    .flatMap((e) => e.saldo.parcelas.filter((p) => p.restante > 0 && p.status !== 'atrasada').slice(0, 1).map((p) => ({ e, p })))
    .sort((a, b) => a.p.vencimento.localeCompare(b.p.vencimento));

  return (
    <Tela titulo={primeiroNome ? `Olá, ${primeiroNome}` : 'Início'}>
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && (!dados || !r) && <Carregando />}
      {dados && r && (
        <>
          <ConvitePush />
          <section className="destaque">
            <div className="rotulo">Você deve no total</div>
            <div className="valor-grande">{moeda(r.totalAReceber)}</div>
            <Progresso pago={r.totalPago} total={r.totalPago + r.totalAReceber} />
            <div className="suave">Já pago: {moeda(r.totalPago)}</div>
          </section>

          {atrasados.length > 0 && (
            <Link to="/atrasados" className="alerta">
              <strong>{atrasados.length === 1 ? '1 empréstimo em atraso' : `${atrasados.length} empréstimos em atraso`}</strong>
              <span>Pagar agora: {moeda(atrasados.reduce((s, e) => s + e.valorPagarAgora, 0))} ›</span>
            </Link>
          )}

          <div className="grade2">
            <div className="cartao"><div className="rotulo">Em aberto</div><div className="valor">{r.emprestimosAtivos}</div></div>
            <div className="cartao"><div className="rotulo">Em atraso</div><div className={`valor ${r.emprestimosAtrasados ? 'txt-ruim' : ''}`}>{r.emprestimosAtrasados}</div></div>
          </div>

          <Link to="/pedidos/novo" className="btn">Pedir empréstimo</Link>

          {proximas.length > 0 && (
            <section>
              <h2>Próximos vencimentos</h2>
              <ul className="lista cartao sem-pad">
                {proximas.slice(0, 4).map(({ e, p }) => (
                  <li key={e.id}>
                    <Link className="item" to={`/emprestimos/${e.id}`}>
                      <span className="cresce min0">
                        <strong className="corta bloco">{tituloEmprestimo(e)}</strong>
                        <span className="suave">Parcela {p.numero} · {dataBr(p.vencimento)}</span>
                      </span>
                      <strong>{moeda(p.restante)}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {dados.emprestimos.length === 0 && <Vazio titulo="Você não tem empréstimos." />}
        </>
      )}
    </Tela>
  );
}

function Emprestimos() {
  const { dados, erro, recarregar } = useDados<Lista>('/devedor/emprestimos');
  return (
    <Tela titulo="Meus empréstimos">
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados?.emprestimos.length === 0 && <Vazio titulo="Você não tem empréstimos." />}
      <div className="grade">
        {dados?.emprestimos.map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} />)}
      </div>
    </Tela>
  );
}

function Atrasados() {
  const { dados, erro, recarregar } = useDados<Lista>('/devedor/emprestimos');
  const lista = dados?.emprestimos.filter((e) => e.temAtraso) ?? [];
  return (
    <Tela titulo="Atrasados">
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados && lista.length === 0 && <Vazio titulo="Nada em atraso."><span className="suave">Seus pagamentos estão em dia.</span></Vazio>}
      {lista.length > 0 && (
        <section className="destaque ruim">
          <div className="rotulo">Para regularizar agora</div>
          <div className="valor-grande">{moeda(lista.reduce((s, e) => s + e.valorPagarAgora, 0))}</div>
          <div className="suave">Inclui juros e multa até hoje</div>
        </section>
      )}
      <div className="grade">
        {lista.map((e) => <CartaoEmprestimo key={e.id} e={e} para={`/emprestimos/${e.id}`} />)}
      </div>
    </Tela>
  );
}

const MAX_COMPROVANTE = 8 * 1024 * 1024;
const TIPOS_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const tamanhoArquivo = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`);

interface DadosPix {
  codigo: string;
  valorCentavos: number;
  recebedor: string;
}

function PagarPix({ emprestimoId, aoFechar, aoInformar }: { emprestimoId: number; aoFechar: () => void; aoInformar: () => void }) {
  const avisar = useAviso();
  const [confirmando, setConfirmando] = useState(false);
  const [informando, setInformando] = useState(false);
  const [comprovante, setComprovante] = useState<File | null>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const [pix, setPix] = useState<DadosPix | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copia, setCopia] = useState<'ok' | 'falhou' | null>(null);

  useEffect(() => {
    let ativo = true;
    api<DadosPix>('GET', `/devedor/emprestimos/${emprestimoId}/pix`)
      .then(async (d) => {
        const img = await QRCode.toDataURL(d.codigo, { width: 560, margin: 2, errorCorrectionLevel: 'M' });
        if (ativo) {
          setPix(d);
          setQr(img);
        }
      })
      .catch((e) => ativo && setErro(mensagemErro(e)));
    return () => {
      ativo = false;
    };
  }, [emprestimoId]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pix!.codigo);
      setCopia('ok');
    } catch {
      setCopia('falhou');
    }
  };

  const escolher = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    setErro(null);
    if (f.type && !TIPOS_COMPROVANTE.includes(f.type)) {
      setComprovante(null);
      return setErro('Envie uma imagem JPG, PNG ou WEBP, ou um PDF.');
    }
    if (f.size === 0 || f.size > MAX_COMPROVANTE) {
      setComprovante(null);
      return setErro('O comprovante precisa ter até 8 MB.');
    }
    setComprovante(f);
  };

  const informar = async () => {
    if (!comprovante) return setErro('Escolha o comprovante do Pix.');
    setErro(null);
    setInformando(true);
    try {
      const form = new FormData();
      form.append('arquivo', comprovante);
      await api('POST', `/devedor/emprestimos/${emprestimoId}/pagamento-informado`, form);
      avisar('Pagamento informado ao credor.');
      aoInformar();
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setInformando(false);
    }
  };

  return (
    <Modal titulo="Pagar com Pix" aoFechar={aoFechar}>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {!pix && !erro && <Carregando />}
      {pix && qr && (
        <>
          <div className="pix-valor">{moeda(pix.valorCentavos)}</div>
          <p className="suave centro">Para {pix.recebedor}</p>
          <img className="qr" src={qr} alt="QR Code do Pix" />
          <button className="btn" onClick={copiar}>{copia === 'ok' ? 'Código copiado ✓' : 'Copiar código Pix'}</button>
          {copia === 'falhou' && <p className="erro" role="alert">Não foi possível copiar. Toque no código abaixo e copie.</p>}
          <textarea className="pix-codigo" readOnly rows={3} value={pix.codigo} aria-label="Código Pix Copia e Cola" onFocus={(e) => e.target.select()} />
          <p className="suave peq">Pague este valor exato e depois envie o comprovante. A baixa aparece quando o credor confirmar o recebimento.</p>
          {!confirmando && <button className="btn" onClick={() => setConfirmando(true)}>Já paguei</button>}
          {confirmando && (
            <>
              <p role="status"><strong>Envie o comprovante do Pix de {moeda(pix.valorCentavos)}</strong></p>
              <p className="suave peq">Imagem JPG, PNG ou WEBP, ou PDF, com até 8 MB.</p>
              <input ref={seletor} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden aria-label="Arquivo do comprovante" onChange={escolher} />
              {comprovante && <p className="arquivo-escolhido quebra">{comprovante.name} · {tamanhoArquivo(comprovante.size)}</p>}
              <button className="btn sec" disabled={informando} onClick={() => seletor.current?.click()}>{comprovante ? 'Trocar arquivo' : 'Escolher imagem ou PDF'}</button>
              <button className="btn" disabled={informando || !comprovante} onClick={informar}>{informando ? 'Enviando...' : 'Enviar comprovante'}</button>
              <button className="btn sec" disabled={informando} onClick={() => { setConfirmando(false); setComprovante(null); setErro(null); }}>Ainda não paguei</button>
            </>
          )}
        </>
      )}
      <button className="btn sec" onClick={aoFechar}>Fechar</button>
    </Modal>
  );
}

function Detalhe() {
  const { id } = useParams();
  const { dados, erro, recarregar } = useDados<{ emprestimo: EmprestimoDto; pixDisponivel: boolean; avisoPagamento: { id: number; status: 'pendente' | 'recusado'; valorCentavos: number; motivo: string | null } | null }>(`/devedor/emprestimos/${id}`);
  const avisar = useAviso();
  const aviso = dados?.avisoPagamento;
  const aguardando = aviso?.status === 'pendente';
  const cancelarAviso = async () => {
    try {
      await api('POST', `/devedor/avisos-pagamento/${aviso!.id}/cancelar`);
      avisar('Aviso de pagamento cancelado.');
    } catch (x) {
      avisar(mensagemErro(x));
    } finally {
      recarregar();
    }
  };
  const [pagando, setPagando] = useState(false);
  const e = dados?.emprestimo;
  return (
    <Tela titulo={e ? tituloEmprestimo(e) : 'Empréstimo'} voltar>
      {erro && !e && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !e && <Carregando />}
      {e && (
        <div className="colunas">
          <div>
            <section className={`destaque ${e.temAtraso ? 'ruim' : ''}`}>
              <div className="linha"><div className="rotulo">Saldo devedor</div><SeloEmprestimo e={e} /></div>
              <div className="valor-grande">{moeda(e.saldo.saldo)}</div>
              <Progresso pago={e.saldo.totalPago} total={e.saldo.totalDevido} />
              <div className="linha suave"><span>Pago {moeda(e.saldo.totalPago)}</span><span>Total {moeda(e.saldo.totalDevido)}</span></div>
              {e.saldo.credito > 0 && <div className="txt-ok">Crédito a seu favor: {moeda(e.saldo.credito)}</div>}
              {aguardando && (
                <div className="aviso-pagamento" role="status">
                  <strong>Pagamento de {moeda(aviso!.valorCentavos)} informado</strong>
                  <span>Aguardando a confirmação do credor.</span>
                  <button className="link-txt" onClick={cancelarAviso}>Cancelar aviso</button>
                </div>
              )}
              {aviso?.status === 'recusado' && (
                <p className="erro quebra" role="status">Pagamento não confirmado{aviso.motivo ? `: ${aviso.motivo}` : '.'}</p>
              )}
              {!aguardando && dados?.pixDisponivel && e.valorPagarAgora > 0 && (
                <button className="btn" onClick={() => setPagando(true)}>Pagar {moeda(e.valorPagarAgora)} com Pix</button>
              )}
            </section>
            <section className="cartao">
              <dl className="dados">
                <div><dt>Valor emprestado</dt><dd>{moeda(e.valorTotalCentavos)}</dd></div>
                <div><dt>Data do empréstimo</dt><dd>{dataBr(e.dataEmprestimo)}</dd></div>
                <div><dt>Parcelas</dt><dd>{e.numParcelas}</dd></div>
                {e.encargos.total > 0 && <div><dt>Juros e multa até hoje</dt><dd className="txt-ruim">{moeda(e.encargos.total)}</dd></div>}
              </dl>
              <p className="suave peq">{textoEncargos(e)}</p>
            </section>
            {e.pagamentos.length > 0 && (
              <section>
                <h2>Pagamentos</h2>
                <ul className="lista cartao sem-pad">
                  {e.pagamentos.map((p) => (
                    <li key={p.id} className="item"><span className="cresce">{dataBr(p.data)}</span><strong className="txt-ok">{moeda(p.valorCentavos)}</strong></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <section>
            <h2>Parcelas</h2>
            <div className="cartao sem-pad"><ListaParcelas parcelas={e.saldo.parcelas} encargos={e.encargos} /></div>
          </section>
          {pagando && <PagarPix emprestimoId={e.id} aoFechar={() => setPagando(false)} aoInformar={() => { setPagando(false); recarregar(); }} />}
        </div>
      )}
    </Tela>
  );
}

function Pedidos() {
  const avisar = useAviso();
  const { dados, erro, recarregar } = useDados<{ pedidos: PedidoDto[] }>('/devedor/pedidos');
  useAtualizacao(recarregar);
  const [cancelando, setCancelando] = useState<PedidoDto | null>(null);
  const aberto = dados?.pedidos.some((p) => p.status === 'pendente');

  const cancelar = async () => {
    if (!cancelando) return;
    try {
      await api('POST', `/devedor/pedidos/${cancelando.id}/cancelar`);
      avisar('Pedido cancelado.');
    } catch (x) {
      avisar(mensagemErro(x));
    } finally {
      setCancelando(null);
      recarregar();
    }
  };

  return (
    <Tela titulo="Meus pedidos">
      {erro && !dados && <Falha mensagem={erro} tentar={recarregar} />}
      {!erro && !dados && <Carregando />}
      {dados && !aberto && <Link to="/pedidos/novo" className="btn">Pedir empréstimo</Link>}
      {dados?.pedidos.length === 0 && <Vazio titulo="Você ainda não fez pedidos." />}
      <div className="grade">
        {dados?.pedidos.map((p) => (
          <article key={p.id} className="cartao">
            <div className="linha">
              <strong className="valor">{moeda(p.valorCentavos)}</strong>
              <SeloPedido status={p.status} />
            </div>
            <p className="suave">{p.numParcelas}x · 1º vencimento em {dataBr(p.primeiroVencimento)}</p>
            {p.finalidade && <p className="suave quebra">{p.finalidade}</p>}
            {p.status === 'pendente' && <p className="suave peq">Aguardando a resposta do credor.</p>}
            {p.status === 'recusado' && p.motivoRecusa && <p className="quebra">Motivo: {p.motivoRecusa}</p>}
            <div className="pedido-acoes">
              {p.status === 'aprovado' && p.emprestimoId && <Link className="btn" to={`/emprestimos/${p.emprestimoId}`}>Ver parcelas e pagar</Link>}
              {p.status === 'pendente' && <button className="btn sec" onClick={() => setCancelando(p)}>Cancelar pedido</button>}
            </div>
          </article>
        ))}
      </div>
      {cancelando && (
        <Modal titulo="Cancelar pedido?" aoFechar={() => setCancelando(null)}>
          <p>O pedido de {moeda(cancelando.valorCentavos)} deixará de ser analisado.</p>
          <button className="btn perigo" onClick={cancelar}>Cancelar pedido</button>
          <button className="btn sec" onClick={() => setCancelando(null)}>Voltar</button>
        </Modal>
      )}
    </Tela>
  );
}

function NovoPedido() {
  const navegar = useNavigate();
  const avisar = useAviso();
  const hoje = hojeBrasil();
  const lista = useDados<{ pedidos: PedidoDto[] }>('/devedor/pedidos');
  const [f, setF] = useState({ valor: '', numParcelas: '1', primeiroVencimento: adicionaMeses(hoje, 1), finalidade: '' });
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

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    const valorCentavos = parseMoeda(f.valor);
    const numParcelas = Number(f.numParcelas);
    if (!valorCentavos) return setErro('Informe um valor válido.');
    if (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 360) return setErro('O número de parcelas deve ser de 1 a 360.');
    if (f.primeiroVencimento < hoje) return setErro('O primeiro vencimento não pode estar no passado.');
    setSalvando(true);
    try {
      await api('POST', '/devedor/pedidos', { valorCentavos, numParcelas, primeiroVencimento: f.primeiroVencimento, finalidade: f.finalidade.trim() || null });
      avisar('Pedido enviado.');
      navegar('/pedidos', { replace: true });
    } catch (x) {
      setErro(mensagemErro(x));
    } finally {
      setSalvando(false);
    }
  };

  if (lista.erro && !lista.dados) return <Tela titulo="Pedir empréstimo" voltar><Falha mensagem={lista.erro} tentar={lista.recarregar} /></Tela>;
  if (!lista.dados) return <Tela titulo="Pedir empréstimo" voltar><Carregando /></Tela>;
  if (lista.dados.pedidos.some((p) => p.status === 'pendente')) {
    return (
      <Tela titulo="Pedir empréstimo" voltar>
        <Vazio titulo="Você já tem um pedido aguardando resposta."><Link className="btn" to="/pedidos">Ver meus pedidos</Link></Vazio>
      </Tela>
    );
  }
  return (
    <Tela titulo="Pedir empréstimo" voltar>
      <form className="form" onSubmit={enviar}>
        <label>Valor (R$)<CampoMoeda required {...campo('valor')} /></label>
        <label>Número de parcelas<CampoInteiro required max={360} {...campo('numParcelas')} /></label>
        <label>1º vencimento desejado<input required type="date" min={hoje} {...campo('primeiroVencimento')} /></label>
        <label>Para que é o empréstimo? (opcional)<input maxLength={80} placeholder="Ex.: Reforma" {...campo('finalidade')} /></label>
        {previa && (
          <p className="previa">{previa.n}x de {moeda(previa.primeira.valor)}{previa.ultima.valor !== previa.primeira.valor ? ` (última ${moeda(previa.ultima.valor)})` : ''}, até {dataBr(previa.ultima.vencimento)}</p>
        )}
        <small>O credor pode aprovar um valor menor e ajustar as parcelas, os vencimentos, os juros e a multa por atraso. Confira as condições depois da aprovação.</small>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="btn" disabled={salvando}>{salvando ? 'Enviando...' : 'Enviar pedido'}</button>
      </form>
    </Tela>
  );
}

function Config({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  return (
    <Tela titulo="Config">
      <section className="cartao">
        <h2>Meus dados</h2>
        <dl className="dados">
          <div><dt>Nome</dt><dd>{usuario.nome ?? '-'}</dd></div>
          <div><dt>E-mail</dt><dd className="quebra">{usuario.email}</dd></div>
          {usuario.telefone && <div><dt>Telefone</dt><dd>{usuario.telefone}</dd></div>}
        </dl>
        <p className="suave peq">Algum dado errado? Fale com o credor.</p>
      </section>
      <Notificacoes />
      <section className="cartao"><h2>Instalar no celular</h2><InstalarApp /></section>
      <button className="btn sec" onClick={aoSair}>Sair</button>
    </Tela>
  );
}

export function AppDevedor({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  const { dados } = useDados<{ resumo: Resumo }>('/devedor/resumo');
  useSincronizarPush();
  return (
    <div className="app">
      <Navegacao papel="devedor" atrasados={dados?.resumo.emprestimosAtrasados} />
      <Routes>
        <Route path="/" element={<Inicio usuario={usuario} />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/pedidos/novo" element={<NovoPedido />} />
        <Route path="/emprestimos" element={<Emprestimos />} />
        <Route path="/emprestimos/:id" element={<Detalhe />} />
        <Route path="/atrasados" element={<Atrasados />} />
        <Route path="/config" element={<Config usuario={usuario} aoSair={aoSair} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
