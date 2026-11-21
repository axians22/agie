import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, Navigate, Route, Routes, useParams } from 'react-router';
import { api, mensagemErro, useDados, type EmprestimoDto, type Resumo, type Usuario } from './api.ts';
import {
  CartaoEmprestimo, Carregando, dataBr, Falha, InstalarApp, ListaParcelas, moeda, Modal, Navegacao, Progresso,
  SeloEmprestimo, Tela, textoEncargos, tituloEmprestimo, Vazio,
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

interface DadosPix {
  codigo: string;
  valorCentavos: number;
  recebedor: string;
}

function PagarPix({ emprestimoId, aoFechar }: { emprestimoId: number; aoFechar: () => void }) {
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
          <p className="suave peq">Pague este valor exato. A baixa aparece aqui depois que o credor confirmar o recebimento.</p>
        </>
      )}
      <button className="btn sec" onClick={aoFechar}>Fechar</button>
    </Modal>
  );
}

function Detalhe({ pixDisponivel }: { pixDisponivel: boolean }) {
  const { id } = useParams();
  const { dados, erro, recarregar } = useDados<{ emprestimo: EmprestimoDto }>(`/devedor/emprestimos/${id}`);
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
              {pixDisponivel && e.valorPagarAgora > 0 && (
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
          {pagando && <PagarPix emprestimoId={e.id} aoFechar={() => setPagando(false)} />}
        </div>
      )}
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
      <section className="cartao"><h2>Instalar no celular</h2><InstalarApp /></section>
      <button className="btn sec" onClick={aoSair}>Sair</button>
    </Tela>
  );
}

export function AppDevedor({ usuario, pixDisponivel, aoSair }: { usuario: Usuario; pixDisponivel: boolean; aoSair: () => void }) {
  const { dados } = useDados<{ resumo: Resumo }>('/devedor/resumo');
  return (
    <div className="app">
      <Navegacao papel="devedor" atrasados={dados?.resumo.emprestimosAtrasados} />
      <Routes>
        <Route path="/" element={<Inicio usuario={usuario} />} />
        <Route path="/emprestimos" element={<Emprestimos />} />
        <Route path="/emprestimos/:id" element={<Detalhe pixDisponivel={pixDisponivel} />} />
        <Route path="/atrasados" element={<Atrasados />} />
        <Route path="/config" element={<Config usuario={usuario} aoSair={aoSair} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
