# 0001. Flutter + Dart como framework mobile

Status: aceita | Data: 2026-11-20

## Contexto
App mobile Android, offline-first, single-user. Precisa de UI nativa, banco local,
notificações locais e integração com Google Drive.

## Opções consideradas
- **Flutter/Dart**: um código, UI nativa, ecossistema maduro (Drift, Riverpod,
  google APIs, notificações). Fixado pelo usuário.
- Kotlin/Android nativo: ótimo no Android, mas mais verboso e sem portabilidade.
- React Native: JS, mas ecossistema de banco local e notificações menos coeso.

## Decisão
Flutter + Dart. Alvo principal: Android. (iOS fica possível no futuro sem reescrever.)

## Consequências
- Mais fácil: UI, estado, pacotes oficiais do Google, testes de domínio em Dart puro.
- Mais difícil: o "modo construção" automático da skill /criar não cobre Flutter;
  build/test rodam via SDK Flutter e emulador, não em localhost HTTP.

## Fontes
- pub.dev (versões de pacotes), acesso 2026-11-20.
