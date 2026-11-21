import { useCallback, useEffect, useState } from 'react';
import type { Encargos, Resumo, Saldo, TipoMulta } from '@emprestimos/dominio';

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export const EVENTO_SESSAO_EXPIRADA = 'sessao-expirada';

export async function api<T = unknown>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, 'SEM_CONEXAO', 'Sem conexão. Verifique sua internet e tente de novo.');
  }
  if (r.status === 204) return undefined as T;
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && caminho !== '/auth/me') window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    throw new ErroApi(r.status, dados?.erro ?? 'ERRO', dados?.mensagem ?? 'Algo deu errado. Tente de novo.');
  }
  return dados as T;
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export function useDados<T>(caminho: string) {
  const [estado, setEstado] = useState<{ caminho: string; dados: T | null; erro: string | null }>({ caminho, dados: null, erro: null });
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    api<T>('GET', caminho)
      .then((dados) => ativo && setEstado({ caminho, dados, erro: null }))
      .catch((e) => ativo && setEstado((s) => ({ caminho, dados: s.caminho === caminho ? s.dados : null, erro: mensagemErro(e) })));
    return () => {
      ativo = false;
    };
  }, [caminho, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const atual = estado.caminho === caminho;
  return { dados: atual ? estado.dados : null, erro: atual ? estado.erro : null, recarregar };
}

export type Papel = 'admin' | 'devedor';

export interface Usuario {
  email: string;
  nome: string | null;
  avatarUrl: string | null;
  papel: Papel;
  telefone: string | null;
}

export interface PagamentoDto {
  id: number;
  data: string;
  valorCentavos: number;
  observacao?: string | null;
  parcelaMarcada?: number | null;
}

export interface EmprestimoDto {
  id: number;
  pessoaId?: number;
  nome: string | null;
  valorTotalCentavos: number;
  dataEmprestimo: string;
  dataPrevistaPagamento: string;
  primeiroVencimento: string;
  numParcelas: number;
  jurosAoMesPct: number;
  tipoMulta: TipoMulta;
  multaValor: number;
  saldo: Saldo;
  encargos: Encargos;
  temAtraso: boolean;
  valorPagarAgora: number;
  pagamentos: PagamentoDto[];
  pessoa?: PessoaDto;
}

export interface PessoaDto {
  id: number;
  nome: string;
  sobrenome: string;
  telefone: string;
  email: string | null;
  saldoCentavos?: number;
  emprestimos?: number;
  temAtraso?: boolean;
}

export type { Resumo };
