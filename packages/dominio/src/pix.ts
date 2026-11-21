/** Geração do BR Code estático do Pix (o texto do QR Code e do Copia e Cola). */

export interface DadosPix {
  chave: string;
  nome: string;
  cidade: string;
  /** Em centavos. Sem valor, o pagador digita no app do banco. */
  valorCentavos?: number;
  /** Até 25 letras e números. Sem ele, usa '***'. */
  txid?: string;
}

function campo(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`;
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim();
}

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = [...base].reduce((t, c, i) => t + (c.charCodeAt(0) - 48) * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cpfValido(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  const d1 = digitoVerificador(v.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(v.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return v.endsWith(`${d1}${d2}`);
}

/** Aceita o CNPJ numérico e o alfanumérico. */
function cnpjValido(v: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(v) || /^(\d)\1{13}$/.test(v)) return false;
  const pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = digitoVerificador(v.slice(0, 12), pesos);
  const d2 = digitoVerificador(v.slice(0, 13), [6, ...pesos]);
  return v.endsWith(`${d1}${d2}`);
}

/** Devolve a chave no formato usado pelo Pix, ou null se ela não for CPF, CNPJ, e-mail, telefone ou aleatória. */
export function normalizarChavePix(valor: string): string | null {
  const v = valor.trim();
  if (v.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v.toLowerCase();
  const telefone = v.replace(/[\s().-]/g, '');
  if (/^\+55[1-9]\d\d{8,9}$/.test(telefone)) return telefone;
  const documento = v.replace(/[.\-/\s]/g, '').toUpperCase();
  return cpfValido(documento) || cnpjValido(documento) ? documento : null;
}

export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function gerarBrCode(d: DadosPix): string {
  const chave = d.chave.trim();
  if (!chave || chave.length > 77) throw new RangeError('chave Pix inválida');
  const nome = semAcento(d.nome).slice(0, 25).trim();
  const cidade = semAcento(d.cidade).slice(0, 15).trim();
  if (!nome || !cidade) throw new RangeError('nome e cidade do recebedor são obrigatórios');
  const txid = d.txid ?? '***';
  if (txid !== '***' && !/^[A-Za-z0-9]{1,25}$/.test(txid)) throw new RangeError('txid inválido');
  if (d.valorCentavos !== undefined && (!Number.isInteger(d.valorCentavos) || d.valorCentavos <= 0)) {
    throw new RangeError('valor inválido');
  }

  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const valor =
    d.valorCentavos === undefined
      ? ''
      : campo('54', `${Math.trunc(d.valorCentavos / 100)}.${String(d.valorCentavos % 100).padStart(2, '0')}`);
  const corpo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    valor +
    campo('58', 'BR') +
    campo('59', nome) +
    campo('60', cidade) +
    campo('62', campo('05', txid)) +
    '6304';
  return corpo + crc16(corpo);
}
