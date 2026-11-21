import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRACOES = [
  `
  CREATE TABLE pessoas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 100),
    sobrenome TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT,
    criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE UNIQUE INDEX pessoas_email ON pessoas (lower(email)) WHERE email IS NOT NULL;

  CREATE TABLE emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
    nome TEXT,
    valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
    data_emprestimo TEXT NOT NULL,
    data_prevista_pagamento TEXT NOT NULL,
    primeiro_vencimento TEXT NOT NULL,
    num_parcelas INTEGER NOT NULL CHECK (num_parcelas >= 1),
    juros_ao_mes_pct REAL NOT NULL DEFAULT 0,
    tipo_multa INTEGER NOT NULL DEFAULT 0 CHECK (tipo_multa IN (0,1,2)),
    multa_valor REAL NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX emprestimos_pessoa ON emprestimos (pessoa_id);

  CREATE TABLE pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emprestimo_id INTEGER NOT NULL REFERENCES emprestimos(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    observacao TEXT,
    parcela_marcada INTEGER,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX pagamentos_emprestimo ON pagamentos (emprestimo_id, data);

  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    nome TEXT,
    avatar_url TEXT,
    ultimo_login TEXT
  );

  CREATE TABLE sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em INTEGER NOT NULL
  );
  CREATE INDEX sessoes_usuario ON sessoes (usuario_id);
  `,
  `
  CREATE TABLE config_pix (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    chave TEXT NOT NULL,
    nome TEXT NOT NULL,
    cidade TEXT NOT NULL,
    atualizado_por TEXT NOT NULL,
    atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE admins (
    email TEXT PRIMARY KEY,
    criado_por TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  `
  ALTER TABLE pessoas ADD COLUMN avatar_url TEXT;
  ALTER TABLE pessoas ADD COLUMN via_google INTEGER NOT NULL DEFAULT 0 CHECK (via_google IN (0,1));
  `,
  `
  CREATE TABLE pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    num_parcelas INTEGER NOT NULL CHECK (num_parcelas BETWEEN 1 AND 360),
    primeiro_vencimento TEXT NOT NULL,
    finalidade TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado','cancelado')),
    motivo_recusa TEXT,
    emprestimo_id INTEGER REFERENCES emprestimos(id) ON DELETE SET NULL,
    decidido_por TEXT,
    decidido_em TEXT,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX pedidos_pessoa ON pedidos (pessoa_id, id);
  CREATE INDEX pedidos_status ON pedidos (status, id);
  CREATE UNIQUE INDEX pedidos_um_pendente ON pedidos (pessoa_id) WHERE status = 'pendente';
  `,
  `
  CREATE TABLE config_push (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    chave_publica TEXT NOT NULL,
    chave_privada TEXT NOT NULL
  );

  CREATE TABLE push_inscricoes (
    endpoint TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX push_inscricoes_usuario ON push_inscricoes (usuario_id);

  CREATE TABLE push_lembretes (
    chave TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE INDEX push_lembretes_data ON push_lembretes (data);
  `,
];

export function abrirBanco(caminho: string): DatabaseSync {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: versao } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = versao; i < MIGRACOES.length; i++) {
    transacao(db, () => {
      db.exec(MIGRACOES[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

export function transacao<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
