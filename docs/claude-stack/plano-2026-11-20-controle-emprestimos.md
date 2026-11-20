# Plano de implementação — App de Controle de Empréstimos

Data: 2026-11-20

## Regras de negócio (núcleo, domínio puro)

Dinheiro em **centavos (int)**. Datas sem hora para vencimento.

### Geração de parcelas
- Entrada: valorTotal, numParcelas, data da 1ª parcela (ou dataEmprestimo + 1 mês).
- Gera N parcelas mensais. Valor por parcela = valorTotal / N, com o resto
  (centavos) somado à última parcela (soma fecha exata).

### Saldo devedor (fonte da verdade)
- `totalDevido = valorTotal + jurosAcumulados + multasAcumuladas`
- `totalPago = soma(pagamentos)`
- `saldo = totalDevido - totalPago` (nunca negativo; excedente = crédito/quitado)
- Alocação de pagamentos nas parcelas (para status/previsão), em ordem de vencimento:
  - paga a parcela mais antiga em aberto; sobra vai para a próxima (adianta);
  - se o pago no total < previsto até hoje → parcelas ficam parciais/atrasadas
    (a diferença acumula no saldo).

### Juros/multa por atraso (configurável por empréstimo; pode ser 0)
- Config: `jurosAoMesPct` (juros sobre saldo em atraso por mês) e/ou
  `multaAtraso` (fixa em centavos OU percentual) aplicada quando a parcela vence
  sem quitação.
- Juros incidem sobre o saldo vencido não pago, proporcional aos dias/mês de atraso.
- Cálculo é **determinístico e puro**: recebe "data de referência" (hoje) e
  retorna juros/multa até ali. Sem juros compostos surpresa: documentar a fórmula.
- Se config zerada → comporta como empréstimo sem juros.

## Matriz de testes (domínio — prioridade máxima)
1. Gera N parcelas; soma das parcelas == valorTotal (inclui resto na última).
2. Pagamento igual à parcela → parcela paga, saldo cai certo.
3. Pagamento parcial → parcela parcial, diferença acumula no saldo.
4. Pagamento a mais → excedente adianta próxima(s) parcela(s).
5. Quitação total antecipada → todas parcelas pagas, saldo 0.
6. Atraso com juros ao mês → saldo cresce conforme fórmula.
7. Atraso com multa fixa/percentual → aplicada uma vez no vencimento.
8. Juros/multa zerados → igual ao caso sem juros.
9. Arredondamento em centavos nunca "perde" dinheiro.
10. Status da parcela (emAberto/parcial/paga/atrasada) conforme hoje e pagamentos.

## Passos de implementação (cada um com teste e commit)

**P0 — Esqueleto do projeto**
- `flutter create` (org, nome), limpar boilerplate, configurar análise (lints).
- Pronto: `flutter analyze` limpo, app abre tela vazia.

**P1 — Domínio: dinheiro e parcelas** (Dart puro)
- Tipo Money (centavos), geração de parcelas. Testes 1 e 9.
- Pronto: testes passam, sem dependência de Flutter.

**P2 — Domínio: saldo e alocação de pagamentos**
- Cálculo de saldo, alocação, status das parcelas. Testes 2–5 e 10.
- Pronto: testes passam.

**P3 — Domínio: juros e multa**
- Config e cálculo determinístico. Testes 6–8.
- Pronto: testes passam.

**P4 — Data: Drift (SQLite)**
- Tabelas Pessoa/Empréstimo/Parcela/Pagamento, DAOs, migrations. Repositórios.
- Testes de repositório com banco em memória (CRUD + queries de saldo).
- Pronto: testes passam.

**P5 — Estado + navegação (Riverpod + go_router)**
- Providers dos repositórios; rotas. Tela inicial lista pessoas/empréstimos.
- Pronto: app navega; lista vazia e com dado de exemplo.

**P6 — Telas: Pessoas**
- Cadastro/edição/lista (nome, sobrenome, telefone, email opcional) com validação.
- Teste de widget do formulário. Pronto: cria e lista pessoa.

**P7 — Telas: Empréstimos + parcelas**
- Criar empréstimo (valor, datas, nº parcelas, config juros/multa) → gera parcelas.
- Detalhe do empréstimo: parcelas, saldo devedor, status.
- Pronto: cria empréstimo e vê parcelas/saldo.

**P8 — Telas: Pagamentos**
- Registrar pagamento (data, valor) → recalcula saldo/parcelas na hora.
- Pronto: pagamento parcial/total/a mais refletem corretamente.

**P9 — Notificações locais**
- Agenda no vencimento de cada parcela; ação Pago/Não pago. Reagenda ao mudar.
- Permissões Android 13+ e alarme exato. Pronto: notifica em data de teste.

**P10 — Login Google + backup Drive**
- google_sign_in + Drive (escopo drive.file). Serializa snapshot JSON e envia.
- Fila offline: tenta a cada mudança; reenvia ao reconectar. Restauração a partir
  do arquivo. Login opcional (app funciona sem).
- Pronto: faz backup visível no Drive e restaura em app novo.
- OBS: exige OAuth client ID (Google Cloud Console) + SHA-1 — documentado no SETUP.

**P11 — Polimento + README/SETUP**
- Formatação de moeda/data pt-BR, estados de erro/vazio, tema.
- README (rodar/testar) e SETUP (OAuth, permissões, build APK).

## Dependências a instalar (versões conferidas em 2026-11-20; travar no pubspec)
- flutter_riverpod (~2.6)
- drift (~2.30) + sqlite3_flutter_libs + path_provider + path
- go_router (última estável)
- flutter_local_notifications (~22.x) + timezone
- google_sign_in (~7.2) + googleapis + googleapis_auth + extension_google_sign_in_as_googleapis_auth
- intl (formatação pt-BR)
- connectivity_plus (detectar internet para a fila de sync)
Dev: build_runner, drift_dev, flutter_lints, mocktail (testes)

## Riscos e mitigação
- OAuth/SHA-1: documentar passo a passo; app degrada sem login.
- Notificações/bateria: usar alarme exato; orientar permissões.
- Cálculo de dinheiro: centavos + testes fortes no domínio (feitos antes da UI).
- Fila offline: snapshot idempotente (sobrescreve, não acumula).

## Observação sobre o "modo construção" do claude-stack
A automação da Fase 2 cobre python/node/go/rust, não Flutter. A Fase 2 roda com o
SDK do Flutter: `flutter pub get`, `flutter analyze`, `flutter test`, e build/execução
em emulador/dispositivo. Testes de domínio e data rodam headless (`flutter test`).
