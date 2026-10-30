# Pires Integrity — código publicado em 28/10/2026

Esta branch reúne a versão **Equipe v1**, incluindo Gestão de Ativos, Corpo técnico, fichas, anexos privados, níveis, permissões, histórico e integração dos acessos individuais. O pacote de referência é `pires-equipe-v1-publicacao.zip`, publicado no projeto Cloudflare Pages `pires-integrity-app`, domínio https://app.piresintegridade.com.br.

A verificação de 28/10/2026 comparou os 60 arquivos servidos publicamente e todos coincidiram por SHA-256. Os 60 arquivos de código/configuração não credencial desta cópia coincidem com o pacote, incluindo `_headers`. A única substituição no conjunto de 61 arquivos é `app/runtime-config.js`: a chave de publicação foi retirada. Veja [RELEASE.md](RELEASE.md) e [release/](release/).

Esta branch de inspeção contém alterações ainda não publicadas sobre o commit `6093ff37b10dd2246501ed790c8b0ab498508457`. O manifesto e o recibo em `release/` continuam como evidência daquela base, sem serem reescritos para as alterações. O recorte, os testes e as dependências de catálogo/autorização estão em [INSPECAO-REVISAO.txt](INSPECAO-REVISAO.txt). O SQL de inspeção é um candidato de revisão, sem aplicação em produção.

As correções de 30/10 para isolamento dos relatórios por contrato, distinção entre progresso administrativo e emissão técnica e coerência da fila com o escopo vigente estão em [INSPECAO-CORRECOES-20261030.md](INSPECAO-CORRECOES-20261030.md). Continuam somente na versão em revisão.

## Executar e testar na nuvem

Node.js 24 ou superior. Para os importadores Python e seu teste, Python 3.12 com as versões de `requirements-cloud.txt`.

```sh
npm ci --ignore-scripts
python -m pip install -r requirements-cloud.txt
npm run prepare
npm run check
# verify:release confere a base publicada; nesta branch são esperadas diferenças.
npm test
HOST=0.0.0.0 PORT=3000 npm start
```

O servidor começa sem credenciais no modo de demonstração. Ele serve os arquivos atuais da aplicação; não simula autenticação da equipe. As telas protegidas precisam da configuração conectada e de permissões reais.

Para conectar, forneça **privadamente nas variáveis do ambiente** os campos vazios de `.env.example`, use `PIRES_MODE=connected` e `PIRES_GESTAO_BACKEND=supabase` e execute o mesmo servidor. A segunda variável seleciona explicitamente o adaptador operacional da Gestão; não concede acesso a pessoas. O servidor gera a resposta de `runtime-config.js` em memória. Não grava nem imprime chaves. O frontend valida URL Supabase e URL da aplicação HTTPS; uma prévia conectada precisa de domínio HTTPS autorizado. Configure também os URLs de redirecionamento do Auth no ambiente de desenvolvimento. As Edge Functions preservam as restrições de origem/projeto publicadas: revisá-las para um novo ambiente é trabalho posterior, não realizado neste envio.

Para testar somente equipe: `npm run test:team`. Os testes normais utilizam fixtures sintéticas e bancos locais PGlite; não utilizam as 22 contas de produção. Três testes de importações históricas dependem de documentos privados de cliente e ficam explicitamente ignorados sem `PIRES_PRIVATE_FIXTURES=1` e sem os originais autorizados.

## Backend e banco

- `supabase/functions/`: seis funções, incluindo autenticação administrativa, gestão, cobrança em observação e provisionador já encerrado (HTTP 410).
- `supabase/migrations/`: migrações de gestão/equipe, preservadas com os nomes usados no desenvolvimento.
- `supabase/history/`: demais migrações efetivamente aplicadas. A migração de licenciamento está sem as verificações e o mapeamento específicos dos usuários de produção.
- `supabase/bootstrap/current-schema.sql`: estrutura atual de 40 tabelas, 147 funções, políticas, triggers, permissões e configuração dos buckets; **sem usuários, salários, licenças ou registros comerciais**.
- [supabase/README.md](supabase/README.md): preparação de banco novo e limites de reprodução.

As 22 contas, as senhas e as vagas de licença permanecem no banco e no cofre privados existentes. Clonar o código não cria nem recria essas identidades. Os valores salariais configurados em produção são dados da organização e também não são publicados no GitHub.

## Trabalho preservado

A branch parte de `21c4bf9b484100528c30da69aa79cdbdc7b905bd`, da branch `codex/gestao-ativos-cloud`. A branch anterior e a `main` permanecem intactas. As alterações de layout de PDF ainda não publicadas foram preservadas em `legacy-cloud/app/`, com testes correspondentes. O servidor legado continua disponível em `npm run start:assets`; o padrão `npm start` serve a versão publicada.

O site institucional em `site/` foi preservado como estava no GitHub e não foi certificado como sua publicação mais recente. As pastas originais do computador não foram sobrescritas.

Nenhum deploy, alteração de banco de produção, criação de acesso ou cobrança faz parte desta entrega.

