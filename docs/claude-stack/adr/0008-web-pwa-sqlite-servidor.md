# 0008. App web instalável com SQLite no servidor
Status: aceita | Data: 2026-11-21. Substitui, para a versão web, as ADRs 0001, 0002, 0003, 0005, 0006 e 0007.

## Contexto
O app Flutter guardava tudo no celular do credor. Agora cada devedor precisa ver as próprias dívidas no próprio
aparelho, e a maioria usará somente o celular.

## Decisão
- Um único PWA instalável, em React + TypeScript, com perfis de admin e devedor. O código de cada perfil é
  carregado separadamente.
- API Node (Hono) serve a interface e é a única que acessa o banco.
- SQLite em arquivo no servidor (`node:sqlite`, modo WAL), em disco persistente.
- Login Google, como no scalex: o servidor valida o ID token e cria uma sessão opaca em cookie `HttpOnly`,
  `SameSite=Strict`, guardando só o SHA-256 do token.
- Papel calculado a cada requisição: o admin principal vem de `ADMIN_EMAILS`, os demais da tabela `admins`. Qualquer
  outra conta Google entra como usuário e só vê a ficha que tem o próprio e-mail.
- Pix e administradores ficam na tela Config, no banco. Só o admin principal altera, porque trocar a chave desvia
  os pagamentos.
- Rotas fechadas por padrão. Rotas do devedor sempre filtram pela pessoa da sessão e usam uma lista explícita de
  campos, sem observações do credor.
- Regras de cálculo em `packages/dominio`, verificadas contra casos gerados pelo código Dart original.
- Pix por BR Code estático, com baixa confirmada pelo credor.

## Consequências
- O app depende de internet e de um servidor com HTTPS.
- SQLite limita a operação a uma instância, o que atende o porte atual.
- Backup diário fica no volume de dados; falta enviar a cópia para fora do servidor.
- Notificações locais e backup automático no Drive não existem na versão web.
