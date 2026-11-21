import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const PADRAO = /^emprestimos-\d{4}-\d{2}-\d{2}\.db$/;

/** Cópia íntegra do banco por dia, mantendo as mais recentes. */
export function fazerBackup(db: DatabaseSync, pasta: string, dia: string, manter = 30): string {
  mkdirSync(pasta, { recursive: true });
  const destino = join(pasta, `emprestimos-${dia}.db`);
  rmSync(destino, { force: true });
  db.prepare('VACUUM INTO ?').run(destino);
  const antigos = readdirSync(pasta).filter((f) => PADRAO.test(f)).sort().reverse().slice(manter);
  for (const f of antigos) rmSync(join(pasta, f));
  return destino;
}
