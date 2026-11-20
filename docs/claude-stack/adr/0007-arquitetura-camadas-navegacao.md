# 0007. Organização em camadas, navegação e erros/logs

Status: aceita | Data: 2026-11-20

## Contexto
Precisa de uma estrutura clara que mantenha o domínio puro isolado, e decisões
sobre navegação entre telas e tratamento de erros/log (decisões que faltavam na
lista inicial).

## Opções consideradas
Camadas:
- **feature-first com camadas** (`domain/`, `data/`, `features/`, `core/`):
  domínio puro no centro, repositórios no data, telas em features. Escolhida.

Navegação:
- **go_router**: declarativo, deep-link friendly, oficial do time Flutter. Escolhido.
- Navigator 1.0 puro: simples, mas cresce mal.

Erros/logs:
- Result/exceções tratadas na borda + logs locais simples (`log()` do dart:developer)
  e tela de erro amigável. Sem telemetria externa (privacidade/custo).

## Decisão
Estrutura:
```
lib/
  core/        # tema, formatação de moeda/data, constantes, utils
  domain/      # Dart puro: entidades, cálculo de saldo/juros, regras
  data/        # drift (schema, DAOs), repositórios, backup Drive, sync
  features/    # pessoas, emprestimos, parcelas/pagamentos, notificacoes, backup, settings
  app.dart / main.dart
```
Navegação com go_router. Erros tratados na camada data e exibidos pela UI; logs
locais apenas. Dinheiro sempre em centavos (int).

## Consequências
- Mais fácil: testar domínio, trocar implementações, telas desacopladas.
- Mais difícil: disciplina de camadas; mais arquivos.

## Fontes
- pub.dev/packages/go_router, acesso 2026-11-20.
