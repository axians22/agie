import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adicionaMeses, horaBrasil, hojeBrasil } from '@emprestimos/dominio';
import type { Repo } from './repo.ts';

export const MAX_COMPROVANTE_BYTES = 8 * 1024 * 1024;
export const MESES_GUARDAR_COMPROVANTE = 3;
const HORA_LIMPEZA = 3;
const TOLERANCIA_ORFAOS_MS = 24 * 60 * 60 * 1000;
const NOME_ARQUIVO = /^[a-f0-9]{48}\.(?:jpg|png|webp|pdf)(?:\.tmp)?$/;

export interface TipoComprovante {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  extensao: 'jpg' | 'png' | 'webp' | 'pdf';
}

/** Decide pelo conteúdo do arquivo: nome e tipo enviados pelo navegador podem ser falsos. */
export function detectarTipoComprovante(b: Uint8Array): TipoComprovante | null {
  const comeca = (assinatura: number[], desde = 0) => assinatura.every((v, i) => b[desde + i] === v);
  if (b.length >= 3 && comeca([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extensao: 'jpg' };
  if (b.length >= 8 && comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', extensao: 'png' };
  if (b.length >= 12 && comeca([0x52, 0x49, 0x46, 0x46]) && comeca([0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', extensao: 'webp' };
  if (b.length >= 5 && comeca([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', extensao: 'pdf' };
  return null;
}

export const dataExpiracaoComprovante = (hoje: string) => adicionaMeses(hoje, MESES_GUARDAR_COMPROVANTE);

export class ArquivosComprovante {
  private readonly pasta: string;

  constructor(pasta: string) {
    this.pasta = pasta;
  }

  private caminho(nome: string): string {
    if (!NOME_ARQUIVO.test(nome)) throw new Error('nome de comprovante inválido');
    return join(this.pasta, nome);
  }

  async salvar(bytes: Uint8Array, tipo: TipoComprovante): Promise<string> {
    await mkdir(this.pasta, { recursive: true, mode: 0o700 });
    const nome = `${randomBytes(24).toString('hex')}.${tipo.extensao}`;
    const temporario = this.caminho(`${nome}.tmp`);
    try {
      await writeFile(temporario, bytes, { mode: 0o600, flag: 'wx' });
      await rename(temporario, this.caminho(nome));
    } catch (e) {
      await rm(temporario, { force: true }).catch(() => {});
      throw e;
    }
    return nome;
  }

  async ler(nome: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      const b = await readFile(this.caminho(nome));
      return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as Uint8Array<ArrayBuffer>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async remover(nome: string): Promise<void> {
    await rm(this.caminho(nome), { force: true });
  }

  /** Remove sem interromper a ação principal. O que falhar é recolhido pela limpeza diária. */
  async removerVarios(nomes: string[]): Promise<void> {
    await Promise.all(nomes.map((n) => this.remover(n).catch(() => console.error('falha ao remover comprovante'))));
  }

  /** Apaga arquivos sem registro, como os de um envio interrompido. */
  async removerOrfaos(referenciados: Set<string>, agora: Date): Promise<number> {
    let nomes: string[];
    try {
      nomes = await readdir(this.pasta);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw e;
    }
    let removidos = 0;
    for (const nome of nomes) {
      if (!NOME_ARQUIVO.test(nome) || referenciados.has(nome)) continue;
      const { mtimeMs } = await stat(this.caminho(nome));
      if (agora.getTime() - mtimeMs < TOLERANCIA_ORFAOS_MS) continue;
      await this.remover(nome);
      removidos += 1;
    }
    return removidos;
  }
}

export interface ResultadoLimpeza {
  removidos: number;
  orfaos: number;
  falhas: number;
}

/** Cron diário: apaga só o arquivo, mantendo o histórico do pagamento. Comprovante aguardando conferência fica. */
export class LimpezaComprovantes {
  private readonly repo: Repo;
  private readonly arquivos: ArquivosComprovante;
  private ultimaData: string | null = null;
  private rodando = false;

  constructor(repo: Repo, arquivos: ArquivosComprovante) {
    this.repo = repo;
    this.arquivos = arquivos;
  }

  async executar(agora: Date = new Date()): Promise<ResultadoLimpeza> {
    let removidos = 0;
    let falhas = 0;
    for (const c of this.repo.comprovantesVencidos(hojeBrasil(agora))) {
      try {
        await this.arquivos.remover(c.arquivo);
        this.repo.marcarComprovanteRemovido(c.id, agora);
        removidos += 1;
      } catch {
        falhas += 1;
      }
    }
    const orfaos = await this.arquivos.removerOrfaos(this.repo.arquivosComprovante(), agora);
    return { removidos, orfaos, falhas };
  }

  /** Roda uma vez por dia a partir das 3h de Brasília. Se o servidor estava fora, roda quando voltar. */
  async executarSeDevido(agora: Date = new Date()): Promise<ResultadoLimpeza | null> {
    const hoje = hojeBrasil(agora);
    if (this.rodando || this.ultimaData === hoje || horaBrasil(agora) < HORA_LIMPEZA) return null;
    this.rodando = true;
    try {
      const r = await this.executar(agora);
      if (r.falhas === 0) this.ultimaData = hoje;
      else console.error(`limpeza de comprovantes: ${r.falhas} falha(s)`);
      return r;
    } finally {
      this.rodando = false;
    }
  }
}
