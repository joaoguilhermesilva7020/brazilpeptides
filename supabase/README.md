# Supabase — Brazil Peptides

Esta pasta contém a estrutura do banco e a primeira carga do catálogo. **Nenhuma migration foi executada em um projeto Supabase por este commit.** A aplicação do banco deve ocorrer depois de revisar os arquivos e configurar as credenciais.

## Escopo desta etapa
- Somente backend e dados; não altera HTML, CSS, JavaScript ou a UI.
- 20261105000100_initial_schema.sql: tabelas, índices, triggers, RLS e permissões.
- 20261105000200_import_catalog.sql: carga inicial baseada no data/catalog.json existente no momento da preparação.
- config.toml: configuração do Supabase CLI.
- .github/workflows/supabase-migrations.yml: implantação manual das migrations, depois que os secrets forem configurados.

## Snapshot importado
- Marca registrada no catálogo: **Aset Life** (mantida sem alteração).
- WhatsApp: número configurado no JSON (mantido como configuração pública do site).
- 21 produtos ativos.
- 37 variantes.
- 8 categorias.
- 2 afiliados de exemplo: BP1001 e BP1002, importados **inativos** até serem cadastrados afiliados reais.

A importação preserva os IDs antigos em legacy_id, nomes, descrições, evidências, disclaimers, tamanhos e preços. A categoria atual de cada produto é relacionada pela tabela product_categories; o modelo permite múltiplas categorias no futuro.

### Estoque e comissões
O JSON não contém saldo de estoque. Por isso, a carga **não inventa quantidades nem cria saldos de estoque**. Os saldos deverão ser informados após contagem real.
Os afiliados BP1001 e BP1002 são exemplos e são importados inativos. A taxa/valor de comissão fica em zero até que a regra comercial seja confirmada.

## Como aplicar no Supabase
### Opção recomendada: Supabase CLI
1. Instale o Supabase CLI.
2. No diretório do repositório, autentique-se: supabase login.
3. Vincule o projeto: supabase link --project-ref SEU_PROJECT_REF.
4. Revise os arquivos em supabase/migrations/.
5. Execute supabase db push para aplicar as migrations pendentes.
6. No SQL Editor, confira as contagens:

```sql
select count(*) as products from public.products;
select count(*) as variants from public.product_variants;
select count(*) as categories from public.categories;
select count(*) as affiliates from public.affiliates;
select key, value from public.site_settings order by key;
```

Resultado esperado para o snapshot inicial: 21 produtos, 37 variantes, 8 categorias e 2 afiliados.

### Alternativa: SQL Editor
Se preferir usar o painel, abra SQL Editor e execute primeiro o conteúdo de 20261105000100_initial_schema.sql, depois o conteúdo de 20261105000200_import_catalog.sql. Não execute os dois ao mesmo tempo. Se usar SQL Editor, lembre-se de que o histórico de migrations do CLI não será atualizado automaticamente; para continuar usando CLI depois, será necessário reconciliar o histórico de migrations antes de um db push.

## Automação GitHub Actions
O workflow Supabase migrations (manual) é deliberadamente manual (workflow_dispatch). Ele não publica alterações automaticamente a cada push. Antes de executá-lo, configure estes GitHub Actions Secrets no repositório:
- SUPABASE_ACCESS_TOKEN: token pessoal criado no painel Supabase.
- SUPABASE_PROJECT_REF: xuutmhgjrrsmtropldwh (extraído da URL do projeto informada).
- SUPABASE_DB_PASSWORD: senha do banco criada ao criar o projeto.

Depois de revisar e mesclar as migrations na branch principal, abra Actions → Supabase migrations (manual) → Run workflow. Nunca grave esses valores no código ou em arquivos do repositório. A senha do banco e o access token não devem ser enviados em mensagens.

## Segurança e pendências
- RLS está habilitado nas tabelas.
- Visitantes anônimos podem apenas ler catálogo ativo e configurações marcadas como públicas.
- Tabelas operacionais não concedem acesso anônimo.
- A chave service_role/secret nunca deve ser usada no navegador.
- Ainda é necessário criar a conta Auth do administrador e cadastrar seu UUID em public.admin_users.
- Ainda não foram criadas Edge Functions de criação de pedido e confirmação transacional de pagamento/estoque/comissão.
- Antes de produção, testar policies, permissões, importação, pedidos duplicados, concorrência de estoque e confirmação repetida de pagamento.

## Próxima sequência
1. Revisar esta branch e abrir/mesclar o Pull Request.
2. Criar o projeto Supabase e confirmar o Project Ref.
3. Aplicar as migrations.
4. Conferir contagens e dados importados.
5. Criar o usuário administrador e cadastrar os saldos reais.
6. Implementar Edge Functions e regras transacionais.
7. Só depois conectar o frontend ao banco.

**Não há alteração de UI nesta etapa.**