# Design doc — App de Controle de Empréstimos

Data: 2026-11-20
Projeto: `/home/vieiralucas/projects/git-repo/eder/agi`

## Problema

Quem empresta dinheiro para conhecidos perde o controle de quem deve, quanto,
desde quando e se a parcela do mês foi paga. O acompanhamento costuma ser de
cabeça ou em anotações soltas; dívidas antigas "somem", pagamentos parciais
confundem o saldo, e não há lembrete de vencimento.

## Usuário

Uma única pessoa: **o credor** (quem empresta). Uso pessoal, no próprio celular
Android. As pessoas que pegaram emprestado são apenas fichas no app — não têm
login nem acesso.

Exemplo concreto: emprestei R$ 5.000 ao João em 5 parcelas mensais de R$ 1.000.
No mês 1 ele pagou só R$ 600; no mês 2 pagou R$ 1.400. Quero ver na hora quanto
ele ainda deve, receber um lembrete em cada vencimento, e marcar se pagou — sem
fazer conta na mão.

## Como resolve hoje e o que é ruim

De cabeça, no WhatsApp ou num caderno/planilha manual. Ruim porque: não lembra
vencimento, não recalcula saldo quando o pagamento é parcial, não acumula o que
ficou faltando, e some se perder o papel/celular.

## O que acontece se não fizer nada

Continua perdendo dinheiro por esquecimento, cobra na hora errada, e discute
valor porque não há registro confiável.

## Solução escolhida (abordagem A — Essencial)

App Android (Flutter) offline-first com:

1. **Pessoas**: nome, sobrenome, telefone, email (opcional).
2. **Empréstimos** vinculados a uma pessoa: valor total, data do empréstimo,
   data prevista de pagamento, nº de parcelas, config de juros/multa.
3. **Parcelas mensais** geradas automaticamente (previsão), cada uma com
   vencimento.
4. **Pagamentos**: registra data e valor. Saldo devedor é a fonte da verdade:
   - pagou menos que o previsto no mês → diferença continua devendo (acumula);
   - pagou mais → excedente abate as próximas parcelas (adianta);
   - pagou igual → quita a parcela.
5. **Juros/multa por atraso configurável**: taxa ao mês e/ou multa fixa/percentual
   que aumenta o saldo quando há atraso (configurável por empréstimo; pode ser zero).
6. **Notificações locais** no vencimento de cada parcela, com ação para marcar
   pago / não pago.
7. **Backup no Google Drive** (login Google do usuário): a cada mudança, quando
   há internet, envia um backup técnico (JSON) para o Drive do usuário. One-way
   (celular → Drive). Serve para **restaurar** os dados ao reinstalar o app ou
   trocar de celular. Offline, acumula e envia ao reconectar.

### Moeda
Reais (R$), uma moeda só.

### Modelo de sincronização
- **Celular (SQLite) é a fonte da verdade.** A planilha/arquivo no Drive é só
  backup para restauração.
- Sync **one-way**, automático a cada mudança quando há internet; fila offline.
- O usuário não edita o backup na mão esperando que volte pro app.

## Fora do escopo (v1)
- Login/multiusuário, acesso dos devedores.
- Dashboard, gráficos, relatórios, exportar PDF/extrato.
- Backup legível/editável de duas vias (two-way sync).
- Múltiplas moedas.
- iOS (foco Android; Flutter deixa a porta aberta no futuro).

## Critérios de sucesso
- Cadastrar pessoa + empréstimo de 5 parcelas em menos de 1 minuto.
- Registrar um pagamento parcial e ver o saldo devedor correto (acumulando a
  diferença) imediatamente.
- Receber a notificação no dia do vencimento e marcar pago pela notificação.
- Desinstalar o app, reinstalar, logar no Google e **restaurar todos os dados**
  a partir do backup.
- Tudo funciona sem internet; o backup aparece no Drive assim que reconecta.

## Riscos
- **OAuth Google no Android** (login + escopo do Drive): configuração de
  credenciais no Google Cloud Console e assinatura do app é a parte mais chata.
  Mitigação: isolar numa camada; app funciona sem backup se o login não estiver
  configurado.
- **Cálculo de saldo com juros/multa**: regra de negócio sensível; precisa de
  testes fortes (é o núcleo). Mitigação: lógica pura, isolada, com suíte de testes.
- **Fila de sync offline**: garantir que não perde mudança nem duplica backup.
  Mitigação: backup é idempotente (snapshot completo, não incremental).
- **Notificações confiáveis no Android** (restrições de bateria/Doze): usar
  agendamento exato e orientar permissões.
