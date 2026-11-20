# 0003. Gerenciamento de estado: Riverpod

Status: aceita | Data: 2026-11-20

## Contexto
UI precisa reagir a mudanças do banco (saldo recalculado após pagamento) e
gerenciar estados de carregamento/erro (ex.: sync com Drive).

## Opções consideradas
- **Riverpod** (~2.6): testável, sem dependência de BuildContext, combina bem
  com streams do Drift.
- Bloc: robusto, porém mais verboso para um app deste tamanho.
- Provider: simples, mas menos seguro em testes e composição.

## Decisão
Riverpod como camada de estado/injeção de dependência.

## Consequências
- Mais fácil: providers testáveis, override em testes, reatividade.
- Mais difícil: conceitos iniciais (provider/notifier) para quem não conhece.

## Fontes
- riverpod.dev / pub.dev, acesso 2026-11-20.
