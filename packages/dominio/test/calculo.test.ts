import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  adicionaMeses,
  calcularEncargos,
  calcularSaldo,
  consolidar,
  crc16,
  gerarBrCode,
  gerarParcelas,
  hojeBrasil,
  normalizarChavePix,
  parseMoeda,
  percentual,
  valorParaPagarAgora,
  type TipoMulta,
} from '../src/index.ts';

const base = () => gerarParcelas(500000, 5, '2026-01-10');
const pg = (data: string, reais: number) => ({ data, valor: reais * 100 });

describe('parcelas', () => {
  test('gera mensais e fecha o total', () => {
    const p = base();
    assert.equal(p.length, 5);
    assert.equal(p[1]!.vencimento, '2026-02-10');
    assert.equal(p[4]!.vencimento, '2026-05-10');
    assert.ok(p.every((x) => x.valor === 100000));
  });
  test('resto vai para a última', () => {
    assert.deepEqual(gerarParcelas(10000, 3, '2026-01-01').map((p) => p.valor), [3333, 3333, 3334]);
  });
  test('fim de mês', () => {
    assert.deepEqual(gerarParcelas(30000, 3, '2026-01-31').map((p) => p.vencimento), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.equal(adicionaMeses('2027-11-30', 3), '2028-02-29');
  });
  test('rejeita entradas inválidas', () => {
    assert.throws(() => gerarParcelas(10000, 0, '2026-01-01'), RangeError);
    assert.throws(() => gerarParcelas(-100, 2, '2026-01-01'), RangeError);
  });
});

describe('saldo', () => {
  test('parcial acumula', () => {
    const s = calcularSaldo(base(), [pg('2026-01-05', 600)], '2026-01-05');
    assert.equal(s.saldo, 440000);
    assert.equal(s.parcelas[0]!.status, 'parcial');
    assert.equal(s.parcelas[0]!.restante, 40000);
  });
  test('a mais adianta a próxima', () => {
    const s = calcularSaldo(base(), [pg('2026-01-10', 1400)], '2026-01-10');
    assert.equal(s.parcelas[0]!.status, 'paga');
    assert.equal(s.parcelas[1]!.status, 'parcial');
    assert.equal(s.parcelas[1]!.pago, 40000);
  });
  test('excedente vira crédito', () => {
    const s = calcularSaldo(base(), [pg('2026-01-10', 5200)], '2026-01-10');
    assert.equal(s.saldo, 0);
    assert.equal(s.credito, 20000);
    assert.ok(s.quitado);
  });
  test('vence no dia seguinte ao vencimento', () => {
    assert.equal(calcularSaldo(base(), [], '2026-01-10').parcelas[0]!.status, 'emAberto');
    assert.equal(calcularSaldo(base(), [], '2026-01-11').parcelas[0]!.status, 'atrasada');
  });
});

describe('encargos', () => {
  test('juros simples por dias/30', () => {
    const e = calcularEncargos(base(), [], { jurosAoMesPct: 10, tipoMulta: 0, multaValor: 0 }, '2026-02-10');
    assert.equal(e.porParcela[0]!.juros, 10333);
  });
  test('multa percentual incide sobre o aberto', () => {
    const e = calcularEncargos(base(), [pg('2026-01-20', 600)], { jurosAoMesPct: 0, tipoMulta: 2, multaValor: 10 }, '2026-02-01');
    assert.equal(e.porParcela[0]!.multa, 4000);
  });
  test('parcela quitada não gera encargo', () => {
    const e = calcularEncargos(base(), [pg('2026-01-15', 1000)], { jurosAoMesPct: 10, tipoMulta: 1, multaValor: 5000 }, '2026-02-01');
    assert.equal(e.porParcela.length, 0);
  });
  test('percentual arredonda ao centavo', () => assert.equal(percentual(333, 10), 33));
});

describe('valor a pagar agora', () => {
  const emp = { valorTotalCentavos: 300000, numParcelas: 3, primeiroVencimento: '2026-01-10', jurosAoMesPct: 0, tipoMulta: 1 as TipoMulta, multaValor: 2000 };
  test('sem atraso cobra a próxima parcela', () => assert.equal(valorParaPagarAgora(consolidar(emp, [], '2026-01-05')), 100000));
  test('com atraso soma vencidas e encargos', () => assert.equal(valorParaPagarAgora(consolidar(emp, [], '2026-02-20')), 204000));
  test('quitado não cobra', () => assert.equal(valorParaPagarAgora(consolidar(emp, [pg('2026-01-05', 3000)], '2026-01-05')), 0));
});

describe('formatos', () => {
  test('parseMoeda', () => {
    assert.equal(parseMoeda('1.234,56'), 123456);
    assert.equal(parseMoeda('1234.5'), 123450);
    assert.equal(parseMoeda('R$ 10,05'), 1005);
    assert.equal(parseMoeda('abc'), null);
    assert.equal(parseMoeda('-5'), null);
    assert.equal(parseMoeda('1,234'), null);
  });
  test('dia no Brasil', () => assert.equal(hojeBrasil(new Date('2026-03-01T02:00:00Z')), '2026-02-28'));
});

describe('Pix', () => {
  test('normaliza os tipos de chave aceitos', () => {
    assert.equal(normalizarChavePix('529.982.247-25'), '52998224725');
    assert.equal(normalizarChavePix('11.222.333/0001-81'), '11222333000181');
    assert.equal(normalizarChavePix('12.ABC.345/01DE-35'), '12ABC34501DE35');
    assert.equal(normalizarChavePix(' Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
    assert.equal(normalizarChavePix('+55 (11) 91234-5678'), '+5511912345678');
    assert.equal(normalizarChavePix('123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
  });
  test('recusa chave inválida', () => {
    for (const v of ['', 'abc', '52998224724', '11111111111', '11222333000180', '11912345678', '+5511123']) {
      assert.equal(normalizarChavePix(v), null, v);
    }
  });
  test('reproduz o exemplo do manual do BR Code', () => {
    const c = gerarBrCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'BRASILIA' });
    assert.equal(c, '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  });
  test('inclui valor e txid, remove acentos e fecha o CRC', () => {
    const c = gerarBrCode({ chave: 'a@b.co', nome: 'João Conceição', cidade: 'São Paulo', valorCentavos: 15007, txid: 'E12P3' });
    assert.ok(c.includes('5406150.07'));
    assert.ok(c.includes('Joao Conceicao'));
    assert.ok(c.includes('0505E12P3'));
    assert.equal(c.slice(-4), crc16(c.slice(0, -4)));
  });
  test('rejeita txid inválido', () => {
    assert.throws(() => gerarBrCode({ chave: 'x', nome: 'A', cidade: 'B', txid: 'com-traco' }), RangeError);
  });
});

describe('paridade com a versão Flutter', () => {
  const url = new URL('./paridade-flutter.json', import.meta.url);
  const casos = JSON.parse(readFileSync(url, 'utf8')) as Array<{
    e: { valorTotalCentavos: number; numParcelas: number; primeiroVencimento: string; jurosAoMesPct: number; tipoMulta: TipoMulta; multaValor: number };
    pagamentos: Array<{ data: string; valor: number }>;
    hoje: string;
    esperado: Record<string, unknown>;
  }>;
  test(`${casos.length} casos gerados pelo código Dart`, () => {
    assert.ok(casos.length >= 1000);
    for (const [i, c] of casos.entries()) {
      const r = consolidar(c.e, c.pagamentos, c.hoje);
      const obtido = {
        encargos: r.encargos.total,
        porParcela: r.encargos.porParcela.map((p) => [p.numeroParcela, p.multa, p.juros]),
        totalDevido: r.saldo.totalDevido,
        totalPago: r.saldo.totalPago,
        saldo: r.saldo.saldo,
        credito: r.saldo.credito,
        parcelas: r.saldo.parcelas.map((p) => [p.numero, p.vencimento, p.valor, p.pago, p.restante, p.status]),
      };
      assert.deepEqual(obtido, c.esperado, `caso ${i}`);
    }
  });
});
