# Banco e funções

`bootstrap/current-schema.sql` é um snapshot **somente da estrutura** obtido por consultas de leitura ao catálogo PostgreSQL em 28/10/2026. Restaura o contrato atual do aplicativo em um Supabase novo, com Auth/Storage gerenciados já disponíveis. Não é um dump de dados nem contém identidades, anexos, senhas ou configuração salarial.

Use uma instância Supabase isolada e vazia, com `auth`, `storage`, roles padrão e extensão pgcrypto disponíveis. Com psql autenticado de forma privada ao banco novo:

```sh
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/bootstrap/current-schema.sql
```

Não execute esse arquivo em produção ou em banco contendo tabelas Pires. Não execute também as migrações históricas depois do snapshot: elas já estão incorporadas. O diretório `migrations/` conserva nomes locais; [migration-map.json](../release/migration-map.json) relaciona esses nomes com o histórico remoto. Esta organização é uma exportação para continuidade, não uma autorização para `db push` ou `db reset`.

As roles e políticas são preservadas. Uma base vazia não tem master, organização, licença, salário, usuário, profissional nem acesso piloto; nenhum é aprovado automaticamente. O teste de bootstrap restaura as 40 tabelas e confirma que acesso anônimo à equipe continua negado. Auth/Storage são simulados nesse teste PGlite; a execução em uma instância Supabase nova com todos os serviços não foi realizada nesta entrega.

`npm run prepare` cria dois catálogos privados vazios, ignorados pelo Git, a partir de `private-examples/`. Eles permitem carregar o código sem publicar documentos de clientes. As importações preparadas específicas desses documentos ficam indisponíveis até que os originais autorizados sejam fornecidos em ambiente privado; gestão e equipe mantêm suas implementações.

`release/backend-versions.json` registra versões e hashes dos bundles remotos. Cinco funções foram obtidas diretamente do serviço. O download de `gestao-api` retornou erro interno do conector em duas tentativas; foi incluída a fonte local usada na publicação, com seu deno.lock, e a versão remota 6 foi confirmada por metadados. Não foi possível comparar integralmente esse bundle remoto nesta sessão.

Segredos ficam exclusivamente nas configurações gerenciadas do ambiente. Não colocar service_role em variáveis do frontend. O provedor financeiro permanece sem ativação; seu código preserva o modo de observação. O endpoint temporário de criação das contas foi incluído somente na versão encerrada, sem código administrativo de provisionamento.

