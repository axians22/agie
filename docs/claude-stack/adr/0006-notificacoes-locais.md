# 0006. Notificações locais de vencimento

Status: aceita | Data: 2026-11-20

## Contexto
Em cada vencimento de parcela, o app deve notificar e permitir marcar pago/não pago.
Precisa funcionar offline e disparar em data/hora exatas.

## Opções consideradas
- **flutter_local_notifications (~22.x) + agendamento exato (zonedSchedule)**:
  padrão da comunidade, suporta ações na notificação e timezone.
- awesome_notifications: rico, porém mais pesado e menos "oficial".
- Push (FCM): exige backend e internet — contra o offline-first; rejeitado.

## Decisão
flutter_local_notifications com zonedSchedule (timezone local) e ação na
notificação ("Pago" / "Não pago"). Reagendamento ao criar/editar/quitar parcelas.
No Android 13+ pede permissão de notificação; para horário exato usa
`exactAllowWhileIdle` (pode exigir permissão SCHEDULE_EXACT_ALARM em Android 12+).

## Consequências
- Mais fácil: lembrete confiável sem backend, offline.
- Mais difícil: lidar com permissões de notificação e alarme exato, e com
  restrições de bateria (Doze). Documentar para o usuário.

## Fontes
- pub.dev/packages/flutter_local_notifications (22.x), acesso 2026-11-20.
