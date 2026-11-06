# Teste HTTP real — confirm-payment

O script `confirm_payment_live_smoke_test.ps1` valida a Edge Function publicada no projeto Supabase real, sem confirmar pedidos e sem alterar estoque.

## O que ele verifica

1. Requisição sem JWT: espera HTTP 401.
2. JWT inválido: espera HTTP 401.
3. JWT do administrador ativo: envia um UUID deliberadamente inexistente e espera que a chamada chegue à RPC e retorne "Pedido não encontrado" (HTTP 400).
4. Opcionalmente, JWT de um usuário autenticado que não seja administrador: espera HTTP 403.

O UUID usado é `00000000-0000-0000-0000-000000000000`. A função SQL valida o perfil de administrador antes de procurar o pedido; por isso, esse UUID permite testar a autorização sem tocar em pedidos existentes.

## Como executar no Windows

1. Baixe/atualize a branch `main` depois que esta PR for mesclada.
2. Abra PowerShell na pasta do repositório.
3. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\supabase\tests\confirm_payment_live_smoke_test.ps1
```

4. Informe a chave `anon/publicável` do projeto (Project Settings → API Keys). **Não use `service_role` nem uma secret key.**
5. Informe o e-mail e a senha do usuário administrador cadastrado em `public.admin_users`. A senha é solicitada como SecureString e não é gravada no arquivo.
6. Para testar também o bloqueio de não administradores, informe o e-mail de um usuário Supabase Auth que não esteja em `public.admin_users`; pressione Enter para pular esse cenário.

## Limites do teste

- O script não testa uma confirmação de pagamento bem-sucedida nem a baixa de estoque pela HTTP, pois isso exigiria um pedido de teste real com saldo de estoque.
- O retorno idempotente `already_confirmed=true` é uma garantia da RPC SQL e não é exercitado por este smoke test HTTP.
- Não cole tokens, senhas ou chaves em issues, PRs ou conversas. O script usa as credenciais localmente apenas para obter os JWTs e chamar o endpoint.
- O teste não cria, atualiza ou exclui dados de negócio.
