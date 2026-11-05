# Cliente de autenticação compartilhado — revisão de 05/11/2026

## Problema e impacto

A página inicial carrega `account-ui.js`, que chama `PiresCloud.create`, e depois `gestao-entry.js`, que inicializa o adaptador de Gestão. Quando precisa consultar o acesso à equipe, o cartão inicializa também `PiresTeamAPI`. Cada chamada fabricava outro SDK Supabase com o mesmo armazenamento de sessão `pires-auth-v1`. A tela isolada `gestao.html` tem apenas o adaptador de Gestão; não se deve atribuir o aviso automaticamente a essa tela.

O aviso é emitido pelo próprio SDK distribuído em `app/vendor/supabase.js`. A duplicação permite clientes concorrentes lendo e renovando a mesma sessão. O aviso, sozinho, não comprova perda de sessão ou acesso indevido em produção. A orientação oficial também usa um cliente compartilhado: [Inicialização do Supabase JavaScript](https://supabase.com/docs/reference/javascript/initializing).

## Correção candidata

`PiresCloud.getClient` valida a configuração e reutiliza o SDK por factory original, endpoint normalizado e chave pública. `PiresCloud.create` mantém um facade novo com sua própria empresa selecionada, configuração e cursor de usuário. Os adaptadores Gestão e Equipe usam a factory original, sem wrappers que fabricavam outro cliente.

O cache dura apenas na página atual. Não guarda cópia de token, não altera o `storageKey`, não é apagado ao sair e não muda as opções de persistência/renovação/PKCE. Erro de construção não fica no cache. Configuração demo/inválida não inicializa cliente. Projetos, chaves e factories diferentes não são confundidos. A configuração do projeto permanece fixa durante a página; alternar projetos no mesmo armazenamento não faz parte deste fluxo.

As seleções de organização de conta/Gestão/Equipe continuam separadas. Cada operação segue enviando sua organização e a sessão atual; compartilhar autenticação não substitui a autorização do servidor.

## Evidência e limites

Os 11 testes novos de unidade passaram. No Chromium154 com o SDK vendorizado, os 12 cenários de cada versão passaram. No caminho normal da página inicial, com operations=true, a base `5642786` criou dois clientes/um aviso e a candidata usou um cliente/zero avisos. O caminho alternativo Equipe, forçado na fixture, passou de três clientes/dois avisos para um/zero. A Gestão isolada permaneceu com um cliente. Os caminhos foram conferidos em desktop e mobile, incluindo renovação e headers atuais, saída/nova entrada, renovação rejeitada com token ainda válido, sessão expirada e acesso revogado. Gestão direta não chamou a API de equipe. Nenhuma chamada externa inesperada ou erro de página foi observado.

A suíte final completa teve **526 testes:520 aprovados,3 falhas e3 ignorados**. As três falhas são do recorte UTC/São Paulo de planejamento descrito abaixo, comprovadamente presente na base; não são uma aprovação geral. Os três ignorados dependem de originais privados. A verificação de sintaxe/padrões de credenciais passou em **161 arquivos JavaScript**, sem instalar programas. O diff foi conferido preservando os finais CRLF dos arquivos existentes.

Os testes de unidade usam SDK sintético explicitamente. O harness de navegador usa o SDK real distribuído, Chromium local e scripts reais da aplicação, com configuração, sessões e respostas HTTP sintéticas interceptadas. Nenhuma dessas evidências equivale a inspeção, login ou integração autenticada real em produção.

O comparador público mantém 62 estáticos e 63 URLs incluindo o runtime. Agora 13 estáticos diferem do manifesto histórico e 46 são iguais, com três novos; os dois arquivos adicionais alterados são `cloud.js` e `equipe-api.js`. A versão publicada anterior `5642786` tinha 11 alterados, 48 iguais e três novos.

Uma falha independente de planejamento foi identificada durante a suíte: o recorte de eventos compara o dia UTC de `createdAt` com o dia atual de São Paulo. Nas primeiras três horas UTC do dia, escopo e planejamento recém-criados podem ficar fora do resumo. A reprodução determinística dá o mesmo resultado no modelo publicado `5642786` e nesta candidata, sem diferença no arquivo. O indicador técnico de emissão continua ausente, como exigido. Essa falha foi preservada e registrada separadamente; o patch de autenticação não muda datas, planejamento ou suas asserções.

Os resultados completos e recibos locais ficam em `output/auth-client-20261105/`, sem tokens, cookies ou dados de clientes. A primeira execução sem dependências ESM resolvidas foi mantida no log; a execução final usa as dependências já instaladas, sem instalação de programas.

## Publicação e retorno

Esta tarefa não publica a correção. O delta de produto contém somente três arquivos públicos: `cloud.js`, `gestao-connected.js` e `equipe-api.js`. Um eventual pacote completo continua com 64 arquivos, incluindo `_headers` e o runtime conectado original; não publicar o runtime demo do Git. Publicar os três em conjunto evita misturar um adaptador novo com `cloud.js` antigo.

Não há migração, mudança Edge, permissão, credencial, origem CORS ou política de rede neste patch. Não houve escrita em dados de produção nem criação/exportação/restauração de backup. Antes de uma publicação posterior, conferir a revisão efetivamente instalada e preservar qualquer alteração inesperada. O retorno de código deve restaurar esses três arquivos juntos pelo mecanismo oficial, mantendo dados e configuração existentes.

Depois de disponibilizar uma revisão autorizada, conferir pelo navegador normal a ausência do aviso na página inicial e no módulo, login/sessão existente, renovação e saída/entrada. Catálogo real, piloto nominal, fotos persistidas e ciclo técnico de inspeção continuam com as validações próprias pendentes; esta correção não aprova o fluxo completo.
