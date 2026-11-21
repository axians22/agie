# Controle de Empréstimos

App web instalável (PWA) para controlar empréstimos. O administrador gerencia pessoas, empréstimos e pagamentos.
Qualquer pessoa entra com a conta Google e aparece em Pessoas, com nome, e-mail e foto. Quem não é administrador vê
somente as próprias dívidas.

## Desenvolvimento

Requer Node 24 e um `.env` com `GOOGLE_CLIENT_ID`, porque o único login é pelo Google.
Autorize `http://localhost:5173` como origem no cliente OAuth.

```bash
npm install
npm run dev        # interface em http://localhost:5173
npm test
npm run typecheck
```

## Estrutura

- `packages/dominio`: cálculo de parcelas, saldo, juros, multa e Pix.
- `apps/api`: API, login, permissões e SQLite.
- `apps/web`: interface React.

## Produção

1. Crie um ID do cliente OAuth no Google Cloud e autorize a origem `https://seu-dominio`.
2. Em "URIs de redirecionamento", inclua `https://seu-dominio/api/auth/google/redirect`.
3. Copie `.env.example` para `.env` e preencha `APP_ORIGINS`, `GOOGLE_CLIENT_ID` e `ADMIN_EMAILS`.
4. Suba o app e aponte o HTTPS do domínio para a porta local definida em `APP_PORT`:

```bash
docker compose up -d --build
```

O app não sobe se faltar configuração. Ele grava um backup diário em `/data/backups` e mantém 30 dias.
Copie essa pasta para fora do servidor, porque um backup no mesmo disco não protege contra falha do disco.

Depois do primeiro login, abra **Config** e salve a chave, o nome e a cidade do Pix. Os devedores só geram o QR Code
depois disso. O e-mail de `ADMIN_EMAILS` é o administrador principal: só ele altera o Pix e a lista de administradores.

Para trazer os dados do app Flutter, gere o JSON de backup nele e use **Config > Importar backup**, com o sistema vazio.
