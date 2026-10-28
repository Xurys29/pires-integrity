# Correspondência com a publicação de 28/10/2026

- Versão funcional: **Equipe v1** sobre Gestão v2.4.2; versão deste pacote de desenvolvimento: `0.8.0-equipe.20261028`.
- Domínio: https://app.piresintegridade.com.br.
- Projeto Cloudflare Pages: `pires-integrity-app`.
- Pacote efetivamente publicado: `pires-equipe-v1-publicacao.zip`, 61 arquivos.
- SHA-256 do ZIP: `bf80d0909c351d556a99085cfa4f1f1e493e15680234aaeb4f7632b4a9756980`.
- Última publicação desta sessão: 28/10/2026, aproximadamente 17:49 UTC (14:49 Brasília).
- Conferência pública em 28/10/2026 às 19:43:24 UTC: **60/60 arquivos servidos idênticos**. `_headers` não é servido; foi comparado com o pacote.
- ID completo do último deployment Cloudflare: **não recuperado**. A correspondência foi estabelecida pelos hashes dos arquivos atuais. O ID `1ec80d75-e6b1-43de-92d9-2e754f47e8fc` corresponde à publicação anterior do mesmo dia e não deve ser usado para identificar esta última.

## Diferenças deliberadas e material excluído

1. `app/runtime-config.js` está sem chaves, em modo demo. O preview conectado injeta configuração pelas variáveis privadas do ambiente. Todos os outros 60 arquivos do pacote mantêm os bytes originais.
2. Dois JSONs privados com documentos/listas de cliente não foram publicados. Foram incluídos exemplos vazios e preparação local idempotente. Não foram exportados registros, usuários Auth, senhas, anexos, salário configurado, auditorias pessoais nem licenças.
3. O cofre Windows, o utilitário de cópia de senhas, scripts de provisionamento/teste em produção, logs locais e arquivos de ambiente ficaram no computador.
4. O snapshot do banco contém a estrutura atual e permissões, sem dados. A migração histórica de licenciamento omite verificações/mapeamento específicos dos usuários de produção.
5. Fonte das seis Edge Functions incluída. Cinco foram baixadas diretamente; para `gestao-api`, versão 6 confirmada, foi usada a fonte local da publicação porque o download do bundle pelo conector falhou. Essa comparação integral permanece uma limitação.
6. Layouts de PDF existentes na branch anterior, mas ausentes da publicação, foram conservados em `legacy-cloud/app/`. A branch anterior e seu histórico não foram alterados.
7. `site/` e ferramentas anteriores foram preservados; este envio certifica a versão do aplicativo, não a publicação mais recente do site institucional.

## Verificação desta entrega

- Instalação limpa: `npm ci --ignore-scripts`, 40 pacotes.
- Sintaxe e varredura de padrões de credenciais.
- Comparação SHA-256 da aplicação com o pacote publicado.
- 161 testes: **158 passaram, 0 falharam, 3 ignorados** por dependerem de documentos privados.
- Bootstrap SQL em PGlite: 40 tabelas restauradas, nenhum usuário/profissional criado, chamada anônima à equipe negada. Auth/Storage simulados; não foi levantada uma instalação nova completa de Supabase.
- Prévia HTTP: início, equipe, entrada de gestão e runtime-config respondem 200; `.env` e SQL interno respondem 404.
- Nenhum deploy e nenhuma alteração do banco de produção nesta transferência.

Os testes, scripts portáteis, documentação e snapshot são adições de suporte ao desenvolvimento; não foram publicados na aplicação.

