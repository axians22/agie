# Progresso — App de Controle de Empréstimos

Projeto: `/home/vieiralucas/projects/git-repo/eder/agi`
Stack: Flutter (Android) + SQLite local + Google Sheets (espelho)

## Etapa atual
Fase 2 — Implementação. Concluídos P0, P1, P2. Próximo: P3 (juros/multa).

## LOCAL REAL DO PROJETO (importante) — MIGRADO PARA O WSL em 2026-11-20
Projeto agora em: /home/vieiralucas/projects/emprestimos-app (WSL/Linux).
Flutter nativo do WSL instalado em: ~/flutter (stable 3.35.5). Usar:
  export PATH="$HOME/flutter/bin:$PATH"; cd ~/projects/emprestimos-app; flutter test
Motivo da migração: rodar via Flutter do Windows (cmd.exe) travava a sqlite3.dll entre
execuções de teste (FileSystemException errno=5) e deixava timer pendente do Drift em
widget test. No Linux isso não ocorre.
Cópia antiga (Windows): C:\Users\lucas\emprestimos-app — manter só como referência/backup.
Para gerar APK Android a partir do WSL ainda falta Android SDK no Linux (ou apontar p/ o do Windows).
Android SDK/emulador JÁ existem no Windows (C:\Users\lucas\AppData\Local\Android\sdk).

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

## Atualização 2026-11-21: versão web (PWA)
O app passou a ser web e instalável, neste repositório. O Flutter segue intacto em `~/projects/emprestimos-app`.
- Stack: React + TypeScript, API Node (Hono), SQLite (`node:sqlite`), Docker. Ver ADR 0008.
- Perfis: admin e devedor, com login Google e isolamento por pessoa na API.
- Regras de cálculo portadas e comparadas com 2.000 casos gerados pelo código Dart.
- Pendente: credencial Google, chave Pix real, servidor com HTTPS, cópia de backup para fora do servidor e validação jurídica de juros e LGPD.
