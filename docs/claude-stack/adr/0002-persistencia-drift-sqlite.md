# 0002. Persistência: SQLite via Drift

Status: aceita | Data: 2026-11-20

## Contexto
Dados relacionais: Pessoa 1—N Empréstimo 1—N Parcela, e Empréstimo 1—N Pagamento.
Precisa de consultas (saldo por empréstimo, parcelas vencidas), migrations e
confiabilidade offline.

## Opções consideradas
- **Drift (SQLite)**: SQL type-safe, migrations versionadas, reativo (streams),
  testável. drift ~2.30.
- sqflite puro: mais manual, sem type-safety, SQL em string.
- Isar/Hive (NoSQL): rápido, mas relacionamentos e queries agregadas ficam piores
  para este modelo.

## Decisão
Drift sobre SQLite. Banco único no diretório do app.

## Consequências
- Mais fácil: queries de saldo/vencidos, migrations, testes com banco em memória.
- Mais difícil: gera código (build_runner); curva inicial um pouco maior.

## Fontes
- pub.dev/packages/drift, acesso 2026-11-20.
