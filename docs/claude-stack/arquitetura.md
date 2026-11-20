# Arquitetura — App de Controle de Empréstimos

Visão geral dos componentes e fluxo de dados. Detalhes nas decisões:
[0001](adr/0001-flutter-dart.md) ·
[0002](adr/0002-persistencia-drift-sqlite.md) ·
[0003](adr/0003-estado-riverpod.md) ·
[0004](adr/0004-dominio-puro.md) ·
[0005](adr/0005-login-google-drive-backup.md) ·
[0006](adr/0006-notificacoes-locais.md) ·
[0007](adr/0007-arquitetura-camadas-navegacao.md)

```
  CELULAR ANDROID (fonte da verdade)                    NUVEM (Google)
┌───────────────────────────────────────────┐        ┌────────────────────┐
│  UI (Flutter + go_router)                  │        │                    │
│  features/: pessoas, emprestimos,          │        │   Google Sign-In   │
│  parcelas+pagamentos, backup, settings     │        │   (OAuth, login)   │
│        │  usa providers (Riverpod)         │        │        ▲           │
│        ▼                                   │        │        │ token     │
│  DOMAIN (Dart puro) ◄─ testes unitários    │        │        │           │
│  - cálculo de saldo devedor (centavos)     │        │   Google Drive     │
│  - pagamento parcial acumula / a mais      │        │   arquivo visível  │
│    adianta                                 │        │   emprestimos-     │
│  - juros/multa por atraso (configurável)   │        │   backup.json      │
│  - geração de parcelas mensais             │        │        ▲           │
│        │                                   │        │        │           │
│        ▼                                   │        └────────┼───────────┘
│  DATA                                      │                 │
│  - Drift (SQLite)  ◄─ banco local          │   one-way sync  │
│    Pessoa→Empréstimo→Parcela, Pagamento    │   (snapshot     │
│  - Repositórios                            │    completo,    │
│  - BackupService ───────────────────────────────────────────┘
│    (fila offline; envia a cada mudança     │   só quando há internet
│     quando há internet)                    │
│  - NotificationService                     │
│    (flutter_local_notifications,           │
│     agenda no vencimento de cada parcela)  │
└───────────────────────────────────────────┘
        │ dispara no vencimento
        ▼
   Notificação local  ──►  ação "Pago / Não pago"  ──►  registra pagamento
                                                         (recalcula saldo + re-sync)

Fronteiras de confiança:
- Tudo dentro do celular é confiável e funciona offline.
- A borda com o Google (login/Drive) é a única saída de rede. Nenhum dado é
  enviado para terceiros além do backup no Drive DO PRÓPRIO usuário.
- Nenhum segredo embutido no app (client ID público; sem client secret).
```

## Modelo de dados (resumo)

- **Pessoa**: id, nome, sobrenome, telefone, email?(opcional), criadaEm.
- **Empréstimo**: id, pessoaId, valorTotalCentavos, dataEmprestimo,
  dataPrevistaPagamento, numParcelas, jurosAoMes?(%), multaAtraso?(config), criadoEm.
- **Parcela**: id, emprestimoId, numero, vencimento, valorPrevistoCentavos,
  status(derivado: emAberto/parcial/paga/atrasada).
- **Pagamento**: id, emprestimoId, data, valorCentavos, observacao?.

Saldo e status das parcelas são **recalculados** pelo domínio a partir de
(empréstimo + parcelas previstas + pagamentos + juros/multa), nunca gravados como
verdade fixa. Dinheiro em centavos (int).
