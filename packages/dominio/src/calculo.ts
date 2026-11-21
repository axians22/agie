/**
 * Regras de cálculo dos empréstimos. Dinheiro sempre em centavos (inteiro) e
 * datas sempre como texto 'AAAA-MM-DD', para não depender de fuso horário.
 * O saldo devedor é a verdade; as parcelas são uma previsão recalculada.
 */

export type DataISO = string;
export type TipoMulta = 0 | 1 | 2;
export const MULTA_NENHUMA = 0;
export const MULTA_FIXA = 1;
export const MULTA_PERCENTUAL = 2;

export type StatusParcela = 'emAberto' | 'parcial' | 'paga' | 'atrasada';

export interface ParcelaPrevista {
  numero: number;
  vencimento: DataISO;
  valor: number;
}

export interface PagamentoBase {
  data: DataISO;
  valor: number;
}

export interface ConfigEncargos {
  jurosAoMesPct: number;
  tipoMulta: TipoMulta;
  /** Centavos (multa fixa) ou % (multa percentual). */
  multaValor: number;
}

export interface EncargoParcela {
  numeroParcela: number;
  multa: number;
  juros: number;
  total: number;
}

export interface Encargos {
  porParcela: EncargoParcela[];
  total: number;
}

export interface ParcelaEstado extends ParcelaPrevista {
  pago: number;
  restante: number;
  status: StatusParcela;
}

export interface Saldo {
  totalPrincipal: number;
  encargos: number;
  totalDevido: number;
  totalPago: number;
  saldo: number;
  credito: number;
  quitado: boolean;
  parcelas: ParcelaEstado[];
}

export interface EmprestimoBase extends ConfigEncargos {
  valorTotalCentavos: number;
  numParcelas: number;
  primeiroVencimento: DataISO;
}

export interface Consolidado {
  encargos: Encargos;
  saldo: Saldo;
  temAtraso: boolean;
}

export const SEM_ENCARGOS: ConfigEncargos = { jurosAoMesPct: 0, tipoMulta: 0, multaValor: 0 };

/** Arredonda ao inteiro mais próximo, com meio centavo para longe do zero. */
export function arredondar(valor: number): number {
  return valor < 0 ? -Math.round(-valor) : Math.round(valor);
}

export function percentual(centavos: number, pct: number): number {
  return arredondar((centavos * pct) / 100);
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataValida(iso: unknown): iso is DataISO {
  if (typeof iso !== 'string') return false;
  const m = RE_DATA.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === iso;
}

function partes(iso: DataISO): [number, number, number] {
  const m = RE_DATA.exec(iso);
  if (!m) throw new RangeError(`data inválida: ${iso}`);
  return [+m[1]!, +m[2]!, +m[3]!];
}

function diaAbsoluto(iso: DataISO): number {
  const [a, m, d] = partes(iso);
  return Date.UTC(a, m - 1, d) / 86_400_000;
}

function iso(ano: number, mes: number, dia: number): DataISO {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Soma meses preservando o dia; se ele não existir no destino, usa o último dia do mês. */
export function adicionaMeses(base: DataISO, meses: number): DataISO {
  const [a, m, d] = partes(base);
  const totalMes = m - 1 + meses;
  const ano = a + Math.floor(totalMes / 12);
  const mes = (((totalMes % 12) + 12) % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return iso(ano, mes, Math.min(d, ultimoDia));
}

/** Divide o total em parcelas mensais; o resto em centavos vai para a última. */
export function gerarParcelas(valorTotal: number, numParcelas: number, primeiroVencimento: DataISO): ParcelaPrevista[] {
  if (!Number.isInteger(numParcelas) || numParcelas < 1) throw new RangeError('numParcelas deve ser >= 1');
  if (!Number.isInteger(valorTotal) || valorTotal < 0) throw new RangeError('valorTotal não pode ser negativo');
  const valorBase = Math.trunc(valorTotal / numParcelas);
  const resto = valorTotal - valorBase * numParcelas;
  return Array.from({ length: numParcelas }, (_, i) => ({
    numero: i + 1,
    vencimento: adicionaMeses(primeiroVencimento, i),
    valor: i === numParcelas - 1 ? valorBase + resto : valorBase,
  }));
}

function ordenar(parcelas: ParcelaPrevista[]): ParcelaPrevista[] {
  return [...parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

function somaPagamentos(pagamentos: PagamentoBase[]): number {
  return pagamentos.reduce((s, p) => s + p.valor, 0);
}

/**
 * Multa (uma vez) e juros simples por dias/30 sobre o que está em aberto em cada
 * parcela vencida. Pagamentos cobrem primeiro a parcela mais antiga.
 */
export function calcularEncargos(
  parcelas: ParcelaPrevista[],
  pagamentos: PagamentoBase[],
  config: ConfigEncargos,
  hoje: DataISO,
): Encargos {
  const temJuros = config.jurosAoMesPct > 0;
  const temMulta = config.tipoMulta !== MULTA_NENHUMA && config.multaValor > 0;
  if (!temJuros && !temMulta) return { porParcela: [], total: 0 };

  let restantePago = somaPagamentos(pagamentos);
  const porParcela: EncargoParcela[] = [];
  let total = 0;

  for (const p of ordenar(parcelas)) {
    const cobre = restantePago >= p.valor ? p.valor : Math.max(restantePago, 0);
    const aberto = Math.max(p.valor - cobre, 0);
    restantePago = Math.max(restantePago - cobre, 0);
    if (!(p.vencimento < hoje) || aberto === 0) continue;

    let multa = 0;
    if (temMulta) {
      multa = config.tipoMulta === MULTA_FIXA ? arredondar(config.multaValor) : percentual(aberto, config.multaValor);
    }
    let juros = 0;
    if (temJuros) {
      const dias = diaAbsoluto(hoje) - diaAbsoluto(p.vencimento);
      const meses = dias <= 0 ? 0 : dias / 30;
      juros = arredondar(((aberto * config.jurosAoMesPct) / 100) * meses);
    }
    porParcela.push({ numeroParcela: p.numero, multa, juros, total: multa + juros });
    total += multa + juros;
  }
  return { porParcela, total };
}

export function calcularSaldo(
  parcelas: ParcelaPrevista[],
  pagamentos: PagamentoBase[],
  hoje: DataISO,
  encargos = 0,
): Saldo {
  const ordenadas = ordenar(parcelas);
  const totalPrincipal = ordenadas.reduce((s, p) => s + p.valor, 0);
  const totalPago = somaPagamentos(pagamentos);
  const totalDevido = totalPrincipal + encargos;

  let restantePago = totalPago;
  const estados: ParcelaEstado[] = ordenadas.map((p) => {
    const pago = Math.max(restantePago >= p.valor ? p.valor : restantePago, 0);
    const restante = Math.max(p.valor - pago, 0);
    restantePago -= pago;
    const vencida = p.vencimento < hoje;
    const status: StatusParcela =
      restante === 0 ? 'paga' : vencida ? 'atrasada' : pago > 0 ? 'parcial' : 'emAberto';
    return { ...p, pago, restante, status };
  });

  const saldo = Math.max(totalDevido - totalPago, 0);
  return {
    totalPrincipal,
    encargos,
    totalDevido,
    totalPago,
    saldo,
    credito: Math.max(totalPago - totalDevido, 0),
    quitado: saldo === 0,
    parcelas: estados,
  };
}

export function consolidar(e: EmprestimoBase, pagamentos: PagamentoBase[], hoje: DataISO): Consolidado {
  const parcelas = gerarParcelas(e.valorTotalCentavos, e.numParcelas, e.primeiroVencimento);
  const encargos = calcularEncargos(parcelas, pagamentos, e, hoje);
  const saldo = calcularSaldo(parcelas, pagamentos, hoje, encargos.total);
  const temAtraso = saldo.parcelas.some((p) => p.status === 'atrasada' && p.restante > 0);
  return { encargos, saldo, temAtraso };
}

export interface Resumo {
  totalEmprestado: number;
  totalPago: number;
  totalAReceber: number;
  emprestimosAtivos: number;
  emprestimosAtrasados: number;
}

export function resumir(itens: Array<{ valorTotalCentavos: number; consolidado: Consolidado }>): Resumo {
  const r: Resumo = { totalEmprestado: 0, totalPago: 0, totalAReceber: 0, emprestimosAtivos: 0, emprestimosAtrasados: 0 };
  for (const { valorTotalCentavos, consolidado: c } of itens) {
    r.totalEmprestado += valorTotalCentavos;
    r.totalPago += c.saldo.totalPago;
    r.totalAReceber += c.saldo.saldo;
    if (!c.saldo.quitado) r.emprestimosAtivos++;
    if (c.temAtraso) r.emprestimosAtrasados++;
  }
  return r;
}

/**
 * Quanto cobrar agora: tudo o que está vencido com encargos ou, sem atraso, a
 * próxima parcela em aberto. Nunca passa do saldo devedor.
 */
export function valorParaPagarAgora(c: Consolidado): number {
  if (c.saldo.quitado) return 0;
  const atrasadas = c.saldo.parcelas.filter((p) => p.status === 'atrasada');
  if (atrasadas.length > 0) {
    const principal = atrasadas.reduce((s, p) => s + p.restante, 0);
    return Math.min(principal + c.encargos.total, c.saldo.saldo);
  }
  const proxima = c.saldo.parcelas.find((p) => p.restante > 0);
  return Math.min(proxima ? proxima.restante : c.saldo.saldo, c.saldo.saldo);
}

/** Data de hoje no Brasil, para o vencimento não virar à meia-noite de outro fuso. */
export function hojeBrasil(agora: Date = new Date()): DataISO {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/** Converte "1.234,56", "1234,56" ou "1234.56" em centavos; null se inválido. */
export function parseMoeda(texto: string): number | null {
  let t = texto.replace('R$', '').trim();
  if (!t) return null;
  if (t.includes(',')) t = t.replaceAll('.', '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, '0') || 0);
  return Number.isSafeInteger(centavos) ? centavos : null;
}
