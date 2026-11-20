# 0004. Regra de negócio em camada de domínio pura

Status: aceita | Data: 2026-11-20

## Contexto
O cálculo de saldo devedor é o coração do app: pagamento parcial acumula,
pagamento a mais adianta, e há juros/multa por atraso configuráveis. Essa lógica
não pode depender de banco nem de UI, para ser testada com segurança.

## Opções consideradas
- **Domínio puro (Dart puro)**: funções/classes sem I/O que recebem dados e
  retornam saldo/estado das parcelas. Testável com tabelas de casos.
- Lógica espalhada em repositórios/widgets: rápido de escrever, difícil de testar
  e propenso a bugs de dinheiro.

## Decisão
Camada `domain/` em Dart puro, sem dependências de Flutter/Drift. O repositório
chama o domínio; a UI só exibe. Valores monetários em **inteiros de centavos**
(evita erro de ponto flutuante).

## Consequências
- Mais fácil: testes unitários fortes, confiança no cálculo de dinheiro.
- Mais difícil: disciplina de manter a fronteira (não vazar tipos do banco pro domínio).

## Fontes
- Boas práticas de representação monetária (inteiros de menor unidade).
