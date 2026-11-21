import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { colarMoeda, mascaraInteiro, mascaraMoeda, mascaraPercentual, type ParcelaEstado, type StatusParcela } from '@emprestimos/dominio';
import { api, mensagemErro, type EmprestimoDto, type Papel, type StatusPedido } from './api.ts';
import { ativarPush, desativarPush, lerEstadoPush, sincronizarPush, type EstadoPush } from './push.ts';

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (centavos: number) => fmtMoeda.format(centavos / 100);
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const reaisCampo = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');

export function tituloEmprestimo(e: Pick<EmprestimoDto, 'id' | 'nome'>) {
  return e.nome || `Empréstimo #${e.id}`;
}

const ICONES: Record<string, ReactNode> = {
  inicio: <path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-6h4v6" />,
  pessoas: <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-1.5a4 4 0 0 0-3-3.9M16 4.2a3.5 3.5 0 0 1 0 6.6" />,
  emprestimos: <path d="M3 7h18v12H3zM3 11h18M7 15h3" />,
  pedidos: <path d="M9 4h6v3H9zM9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M9 12h6M9 16h4" />,
  atrasados: <path d="M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  config: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4L10.700 6a7.600 7.600 0 0 0-1.700 1l-2.400-1-2 3.400 2 1.600a7.600 7.600 0 0 0 0 2l-2 1.600 2 3.400 2.400-1a7.600 7.600 0 0 0 1.700 1l.3 2.500h4l.3-2.500a7.600 7.600 0 0 0 1.700-1l2.400 1 2-3.400Z" />,
  voltar: <path d="m15 5-7 7 7 7" />,
  mais: <path d="M12 5v14M5 12h14" />,
};

export function Icone({ nome }: { nome: keyof typeof ICONES | string }) {
  return (
    <svg className="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONES[nome]}
    </svg>
  );
}

export function Navegacao({ papel, atrasados, pedidos }: { papel: Papel; atrasados?: number; pedidos?: number }) {
  const itens =
    papel === 'admin'
      ? [
          ['/', 'Início', 'inicio'],
          ['/pedidos', 'Pedidos', 'pedidos'],
          ['/pessoas', 'Pessoas', 'pessoas'],
          ['/emprestimos', 'Empréstimos', 'emprestimos'],
          // No celular cabem cinco itens; os atrasados continuam acessíveis pelo Início.
          ['/atrasados', 'Atrasados', 'atrasados', 'nav-largo'],
          ['/config', 'Config', 'config'],
        ]
      : [
          ['/', 'Início', 'inicio'],
          ['/pedidos', 'Pedidos', 'pedidos'],
          ['/emprestimos', 'Empréstimos', 'emprestimos'],
          ['/atrasados', 'Atrasados', 'atrasados'],
          ['/config', 'Config', 'config'],
        ];
  return (
    <nav className="nav" aria-label="Navegação principal">
      <div className="nav-marca"><img src="/icons/icone.svg" alt="" width="30" height="30" />Empréstimos</div>
      {itens.map(([para, rotulo, icone, extra]) => (
        <NavLink key={para} to={para!} end={para === '/'} className={`nav-item ${extra ?? ''}`}>
          <span className="nav-icone">
            <Icone nome={icone!} />
            {para === '/atrasados' && !!atrasados && <span className="nav-ponto" aria-label={`${atrasados} em atraso`} />}
            {para === '/pedidos' && !!pedidos && <span className="nav-contagem" aria-label={`${pedidos} aguardando`}>{pedidos > 9 ? '9+' : pedidos}</span>}
          </span>
          <span>{rotulo}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Tela({ titulo, voltar, acao, children }: { titulo: string; voltar?: boolean; acao?: ReactNode; children: ReactNode }) {
  const navegar = useNavigate();
  useEffect(() => {
    document.title = `${titulo} · Empréstimos`;
    window.scrollTo(0, 0);
  }, [titulo]);
  return (
    <main className="tela">
      <header className="topo">
        {voltar && (
          <button className="btn-icone" onClick={() => navegar(-1)} aria-label="Voltar">
            <Icone nome="voltar" />
          </button>
        )}
        <h1>{titulo}</h1>
        {acao && <div className="topo-acao">{acao}</div>}
      </header>
      {children}
    </main>
  );
}

export function Carregando() {
  return (
    <div className="estado" role="status">
      <span className="giro" />
      Carregando...
    </div>
  );
}

export function Falha({ mensagem, tentar }: { mensagem: string; tentar?: () => void }) {
  return (
    <div className="estado" role="alert">
      <p>{mensagem}</p>
      {tentar && <button className="btn sec" onClick={tentar}>Tentar de novo</button>}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="estado">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

const STATUS: Record<StatusParcela, [string, string]> = {
  paga: ['Paga', 'ok'],
  parcial: ['Parcial', 'aviso'],
  emAberto: ['Em aberto', 'neutro'],
  atrasada: ['Atrasada', 'ruim'],
};

export function Selo({ status }: { status: StatusParcela }) {
  const [rotulo, classe] = STATUS[status];
  return <span className={`selo ${classe}`}>{rotulo}</span>;
}

export function SeloEmprestimo({ e }: { e: Pick<EmprestimoDto, 'saldo' | 'temAtraso'> }) {
  if (e.saldo.quitado) return <span className="selo ok">Quitado</span>;
  if (e.temAtraso) return <span className="selo ruim">Em atraso</span>;
  return <span className="selo neutro">Em dia</span>;
}

type PropsCampoNumerico = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode' | 'max'> & {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
};

/** Dinheiro em reais. Sempre digita no fim, porque a máscara preenche da direita para a esquerda. */
export function CampoMoeda({ value, onChange, ...resto }: PropsCampoNumerico) {
  const ref = useRef<HTMLInputElement>(null);
  const mostrar = mascaraMoeda(value);
  const irParaFim = () => {
    const el = ref.current;
    // Não desfaz uma seleção: a pessoa pode ter selecionado tudo para apagar ou substituir.
    if (el && document.activeElement === el && el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length);
  };
  useLayoutEffect(irParaFim, [mostrar]);
  const colar = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const v = colarMoeda(e.clipboardData.getData('text'));
    if (v !== null) onChange({ target: { value: v } });
  };
  return (
    <input
      placeholder="0,00"
      {...resto}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={mostrar}
      onChange={(e) => onChange({ target: { value: mascaraMoeda(e.target.value) } })}
      onPaste={colar}
      onFocus={() => requestAnimationFrame(irParaFim)}
      onClick={irParaFim}
    />
  );
}

/** Número inteiro positivo, como a quantidade de parcelas. */
export function CampoInteiro({ value, onChange, max, ...resto }: PropsCampoNumerico & { max: number }) {
  const colar = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!/^\s*\d+\s*$/.test(e.clipboardData.getData('text'))) e.preventDefault();
  };
  return (
    <input
      {...resto}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange({ target: { value: mascaraInteiro(e.target.value, value, max) } })}
      onPaste={colar}
    />
  );
}

/** Percentual de 0 a 100, com até duas casas. */
export function CampoPercentual({ value, onChange, ...resto }: PropsCampoNumerico) {
  const colar = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!/^\s*\d+(?:[.,]\d+)?\s*%?\s*$/.test(e.clipboardData.getData('text'))) e.preventDefault();
  };
  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange({ target: { value: mascaraPercentual(e.target.value, value) } })}
      onPaste={colar}
    />
  );
}

const SELOS_PEDIDO: Record<StatusPedido, [string, string]> = {
  pendente: ['aviso', 'Aguardando'],
  aprovado: ['ok', 'Aprovado'],
  recusado: ['ruim', 'Recusado'],
  cancelado: ['neutro', 'Cancelado'],
};

export function SeloPedido({ status }: { status: StatusPedido }) {
  const [classe, texto] = SELOS_PEDIDO[status];
  return <span className={`selo ${classe}`}>{texto}</span>;
}

/** Atualiza a tela a cada 30 segundos e quando o app volta para a frente. */
export function useAtualizacao(recarregar: () => void, intervalo = 30_000) {
  useEffect(() => {
    const atualizar = () => {
      if (!document.hidden) recarregar();
    };
    const t = setInterval(atualizar, intervalo);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [recarregar, intervalo]);
}

export function Progresso({ pago, total }: { pago: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0;
  return (
    <div className="progresso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% pago`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CartaoEmprestimo({ e, para, subtitulo }: { e: EmprestimoDto; para: string; subtitulo?: string }) {
  const proxima = e.saldo.parcelas.find((p) => p.restante > 0);
  return (
    <Link to={para} className="cartao link">
      <div className="linha">
        <div className="min0">
          <strong className="corta">{tituloEmprestimo(e)}</strong>
          {subtitulo && <div className="suave corta">{subtitulo}</div>}
        </div>
        <SeloEmprestimo e={e} />
      </div>
      <div className="linha base">
        <div>
          <div className="rotulo">Saldo devedor</div>
          <div className={`valor ${e.temAtraso ? 'txt-ruim' : ''}`}>{moeda(e.saldo.saldo)}</div>
        </div>
        {proxima && (
          <div className="dir">
            <div className="rotulo">{proxima.status === 'atrasada' ? 'Venceu em' : 'Próximo vencimento'}</div>
            <div>{dataBr(proxima.vencimento)}</div>
          </div>
        )}
      </div>
      <Progresso pago={e.saldo.totalPago} total={e.saldo.totalDevido} />
    </Link>
  );
}

export function ListaParcelas({ parcelas, encargos, aoAlternar, ocupado }: {
  parcelas: ParcelaEstado[];
  encargos: EmprestimoDto['encargos'];
  aoAlternar?: (numero: number) => void;
  ocupado?: boolean;
}) {
  return (
    <ul className="lista">
      {parcelas.map((p) => {
        const enc = encargos.porParcela.find((x) => x.numeroParcela === p.numero);
        const conteudo = (
          <>
            <span className={`numero ${p.status}`}>{p.status === 'paga' ? '✓' : p.numero}</span>
            <span className="cresce min0">
              <strong>{moeda(p.valor)}</strong>
              <span className="suave bloco">
                Vence {dataBr(p.vencimento)}
                {p.pago > 0 && p.restante > 0 ? ` · falta ${moeda(p.restante)}` : ''}
              </span>
              {enc && <span className="txt-ruim bloco peq">+ {moeda(enc.total)} de juros e multa</span>}
            </span>
            <Selo status={p.status} />
          </>
        );
        return (
          <li key={p.numero}>
            {aoAlternar ? (
              <button className="item" disabled={ocupado} onClick={() => aoAlternar(p.numero)} aria-label={`Parcela ${p.numero}: alternar pagamento`}>
                {conteudo}
              </button>
            ) : (
              <div className="item">{conteudo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function textoEncargos(e: Pick<EmprestimoDto, 'jurosAoMesPct' | 'tipoMulta' | 'multaValor'>) {
  const partes: string[] = [];
  if (e.jurosAoMesPct > 0) partes.push(`Juros de ${e.jurosAoMesPct.toLocaleString('pt-BR')}% ao mês`);
  if (e.tipoMulta === 1 && e.multaValor > 0) partes.push(`multa de ${moeda(e.multaValor)}`);
  if (e.tipoMulta === 2 && e.multaValor > 0) partes.push(`multa de ${e.multaValor.toLocaleString('pt-BR')}%`);
  return partes.length ? `${partes.join(' e ')} por atraso` : 'Sem juros ou multa por atraso';
}

export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={(e) => { e.preventDefault(); aoFechar(); }} aria-label={titulo}>
      <h2>{titulo}</h2>
      {children}
    </dialog>
  );
}

const ContextoAviso = createContext<(m: string) => void>(() => {});
export const useAviso = () => useContext(ContextoAviso);

export function ProvedorAviso({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const avisar = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3500);
  }, []);
  return (
    <ContextoAviso.Provider value={avisar}>
      {children}
      {msg && <div className="aviso" role="status">{msg}</div>}
    </ContextoAviso.Provider>
  );
}

interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let eventoInstalar: EventoInstalar | null = null;
const ouvintes = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e as EventoInstalar;
  ouvintes.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  eventoInstalar = null;
  ouvintes.forEach((f) => f());
});

export const appInstalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const ehIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function useEstadoPush() {
  const [estado, setEstado] = useState<EstadoPush>('carregando');
  useEffect(() => {
    let ativo = true;
    lerEstadoPush().then((e) => ativo && setEstado(e)).catch(() => ativo && setEstado('indisponivel'));
    return () => {
      ativo = false;
    };
  }, []);
  return [estado, setEstado] as const;
}

export function useSincronizarPush() {
  useEffect(() => {
    sincronizarPush().catch(() => {});
  }, []);
}

/** Seção da tela Config. */
export function Notificacoes() {
  const avisar = useAviso();
  const [estado, setEstado] = useEstadoPush();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (acao: () => Promise<void>) => {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const ativar = () => executar(async () => {
    const novo = await ativarPush();
    setEstado(novo);
    if (novo === 'ligada') avisar('Notificações ativadas.');
  });
  const desativar = () => executar(async () => {
    await desativarPush();
    setEstado('desligada');
    avisar('Notificações desativadas neste aparelho.');
  });
  const testar = () => executar(async () => {
    await api('POST', '/push/teste');
    avisar('Notificação de teste enviada.');
  });

  return (
    <section className="cartao bloco-acoes">
      <h2>Notificações</h2>
      {estado === 'carregando' && <p className="suave">Verificando este aparelho...</p>}
      {estado === 'indisponivel' && <p className="suave">Este navegador não permite notificações. No Android, use o Chrome.</p>}
      {estado === 'instalar-ios' && <p className="suave">No iPhone, primeiro adicione o app à Tela de Início e abra por lá. É necessário o iOS 16.4 ou mais novo.</p>}
      {estado === 'negada' && <p className="suave">As notificações estão bloqueadas. Libere nas configurações do navegador ou do celular e abra o app de novo.</p>}
      {estado === 'desligada' && (
        <>
          <p className="suave">Receba avisos de pedidos, pagamentos e vencimentos neste aparelho.</p>
          <button className="btn" disabled={ocupado} onClick={ativar}>Ativar notificações</button>
        </>
      )}
      {estado === 'ligada' && (
        <>
          <p className="suave">Ativadas neste aparelho. Os avisos não mostram valores na tela bloqueada.</p>
          <button className="btn sec" disabled={ocupado} onClick={testar}>Enviar notificação de teste</button>
          <button className="btn sec" disabled={ocupado} onClick={desativar}>Desativar notificações</button>
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </section>
  );
}

const CHAVE_DISPENSA_PUSH = 'emprestimos-push-dispensado';

/** Convite no Início, que some ao ativar ou ao tocar em "Agora não". */
export function ConvitePush() {
  const avisar = useAviso();
  const [estado, setEstado] = useEstadoPush();
  const [ocupado, setOcupado] = useState(false);
  const [dispensado, setDispensado] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_DISPENSA_PUSH) === '1';
    } catch {
      return false;
    }
  });
  if (estado !== 'desligada' || dispensado) return null;

  const ativar = async () => {
    setOcupado(true);
    try {
      const novo = await ativarPush();
      setEstado(novo);
      if (novo === 'ligada') avisar('Notificações ativadas.');
    } catch (e) {
      avisar(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const dispensar = () => {
    setDispensado(true);
    try {
      localStorage.setItem(CHAVE_DISPENSA_PUSH, '1');
    } catch {
      // Sem armazenamento, o convite volta na próxima visita.
    }
  };
  return (
    <section className="cartao bloco-acoes">
      <strong>Ativar notificações?</strong>
      <p className="suave">Receba avisos de pedidos, pagamentos e vencimentos.</p>
      <div className="grade2">
        <button className="btn sec" onClick={dispensar}>Agora não</button>
        <button className="btn" disabled={ocupado} onClick={ativar}>Ativar</button>
      </div>
    </section>
  );
}

export function InstalarApp() {
  const [, atualizar] = useState(0);
  useEffect(() => {
    const f = () => atualizar((n) => n + 1);
    ouvintes.add(f);
    return () => void ouvintes.delete(f);
  }, []);
  if (appInstalado()) return <p className="suave">O app já está instalado neste aparelho.</p>;
  if (eventoInstalar) {
    return (
      <button
        className="btn"
        onClick={async () => {
          const e = eventoInstalar!;
          await e.prompt();
          await e.userChoice;
          eventoInstalar = null;
          atualizar((n) => n + 1);
        }}
      >
        Instalar app
      </button>
    );
  }
  if (ehIOS()) {
    return (
      <ol className="passos">
        <li>Abra esta página no <strong>Safari</strong>.</li>
        <li>Toque em <strong>Compartilhar</strong>.</li>
        <li>Toque em <strong>Adicionar à Tela de Início</strong>.</li>
      </ol>
    );
  }
  return (
    <ol className="passos">
      <li>Abra o menu <strong>⋮</strong> do navegador.</li>
      <li>Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</li>
    </ol>
  );
}
