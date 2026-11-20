# 0005. Login Google e backup no Drive

Status: aceita | Data: 2026-11-20

## Contexto
Backup técnico (JSON), one-way (celular → Drive), automático a cada mudança quando
há internet. O usuário quer o arquivo VISÍVEL no seu próprio Drive, para poder
baixar/guardar e restaurar ao reinstalar.

## Opções consideradas
- **google_sign_in (~7.2) + googleapis (Drive API), escopo `drive.file`**: o app só
  acessa arquivos que ele mesmo criou; o arquivo fica VISÍVEL no Drive do usuário.
  Mais seguro que acesso total, e atende "quero ver o arquivo".
- Escopo `drive.appdata` (pasta oculta): mais restrito, mas arquivo invisível —
  rejeitado pelo usuário.
- Escopo `drive` completo: acesso a todo o Drive — desnecessário e arriscado.

## Decisão
`google_sign_in` + `googleapis` com escopo `drive.file`. Backup num arquivo JSON
fixo (ex.: `emprestimos-backup.json`), sobrescrito a cada sync (snapshot completo,
idempotente). Login é opcional: o app funciona 100% sem ele; sem login, sem backup.

## Consequências
- Mais fácil: backup/restauração simples, arquivo único, usuário vê o arquivo.
- Mais difícil: configurar OAuth no Google Cloud Console (client ID Android com
  SHA-1 da assinatura). Documentar no README/SETUP.
- Segurança: nenhum client secret embutido no app (fluxo Android usa client ID público).

## Fontes
- pub.dev/packages/google_sign_in (7.2.0), Drive API scopes, acesso 2026-11-20.
