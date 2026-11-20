# Progresso — App de Controle de Empréstimos

Projeto: `/home/vieiralucas/projects/git-repo/eder/agi`
Stack: Flutter (Android) + SQLite local + Google Sheets (espelho)

## Etapa atual
Fase 1 — aguardando aprovação final do plano para iniciar Fase 2 (Implementação)

## Etapas
- [x] 0. Setup mínimo (git init, docs/) — concluído 2026-11-20
- [x] 1. Design doc — concluído 2026-11-20 (abordagem A - Essencial)
- [x] 2. ADRs (0001-0007) + arquitetura.md — concluído 2026-11-20
- [x] 3. Plano — concluído 2026-11-20
- [ ] 4. Implementação
- [ ] 5. QA
- [ ] 6. Segurança
- [ ] 7. Revisão
- [ ] 8. Entrega

## Decisões já tomadas com o usuário (pré-design)
- Plataforma: mobile Android, Flutter/Dart.
- Fonte de dados primária: celular (SQLite local) + Google Sheets como espelho sincronizado.
- Conexão Sheets: login Google do usuário dentro do app (planilha no Drive do próprio usuário).
- Perfil da pessoa: nome, sobrenome, telefone, email (opcional).
- Empréstimo: valor, data do empréstimo, data prevista de pagamento.
- Parcelas: geração de N parcelas mensais com vencimento.
- Saldo devedor é a fonte da verdade: pagamento parcial acumula (fica devendo a diferença); pagamento a mais adianta/abate próximas parcelas. Parcelas são previsão recalculada.
- Juros/multa por atraso: CONFIGURÁVEL (taxa ao mês e/ou multa).
- Notificações locais no vencimento de cada parcela, perguntando se foi pago; status salvo na planilha.

## Premissas (confirmadas no design doc)
- App de uso pessoal/single-user (o próprio credor), sem backend próprio.
- Offline-first: funciona sem internet.
- Backup no Google Drive é TÉCNICO (JSON), só para restaurar; NÃO precisa ser legível.
- Sync ONE-WAY (celular → Drive), automático a cada mudança quando há internet; fila offline.
- Celular (SQLite) é a fonte da verdade; Drive é backup de restauração.
- Moeda: Reais (R$).
- Escopo v1: abordagem A (Essencial).

## Pendências / observações
- A skill /criar não tem perfil de "modo construção" para Flutter (só python/node/go/rust).
  A Fase 1 roda normal; a Fase 2 será adaptada para o fluxo Flutter (build/test/run no emulador),
  não em localhost HTTP.

## Decisões tomadas sozinho na Fase 2
(nenhuma ainda)
