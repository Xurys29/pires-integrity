Controles locais de composição, desenho e conferência — 03/11/2026

Esta etapa parte de `506e78ea5642d0f3a790046e55319ee1fc2ec24a`,
confirmado no início como HEAD local e remoto do PR draft #1. Os novos módulos
são helpers offline, sem importação no aplicativo ou na Edge Function. Não
instalam catálogo, não concedem acesso e não realizam atos técnicos. O código
servido, o SQL candidato e o banco de produção não foram alterados nesta etapa.

Fontes e evidência

Foi reconfirmada pela Library a identidade das fontes já analisadas em
[INSPECAO-CATALOGO-TAG-20261103.md](INSPECAO-CATALOGO-TAG-20261103.md).
O texto do catálogo contém 509 registros, incluindo duplicatas e lacunas, mas
os bytes originais continuam ausentes. O hash relatado da planilha não é um
hash do JSON nem uma verificação local das células originais. O modelo visual
é de vaso de pressão; o modelo final de tubulação ainda precisa ser definido.
O relatório histórico de espessura não estabelece regras universais.

A materialização oficial anterior terminou com `library file transfer failed:
download failed`, sem arquivo instalado. Esse erro genérico não demonstra um
status HTTP específico nem a quantidade de bytes recebidos. A configuração
atual observada do ambiente está em modo `restricted/enforced`, sem destinos
personalizados. Os destinos oficiais retornados para as fontes,
`sdmntprcentralus.oaiusercontent.com` e
`sdmntprbrazilsouth.oaiusercontent.com`, não constam dos destinos efetivos.
Não houve nova tentativa de transferência ou modificação de rede.

O runtime não apresenta segredos ou variáveis configurados. A primeira chamada
de descoberta do conector exigiu `link_id`. Os metadados oficiais forneceram os
vínculos e permitiram completar a leitura, sem credencial em chat. Os dois
vínculos retornaram os mesmos projetos: `pires-integrity-app` ativo e
`pires-integrity-homolog-rc1` inativo; a homologação não foi retomada.

Consultas agregadas somente de leitura no projeto `pires-integrity-app`
confirmaram 22 profissionais, todos de exercício, ativos, com vínculo Auth,
e-mail confirmado e marcador de login validado. Vinte têm membership ativo de
inspetor; nenhum dos 22 tem liberação vigente no piloto da Gestão. A definição
atual de `ga_access_for_actor` exige esse par usuário/tenant no piloto antes de
prosseguir e mantém gravação restrita a admin/master. As tabelas candidatas
`inspection_executions` e `inspection_catalogs` estão ausentes nesse banco.
Isso demonstra a primeira barreira de acesso e a ausência dessas tabelas,
sem testar sessão de inspetor, demais gates de licença ou bundle remoto.
Não se consultaram nomes, e-mails, salários, senhas ou tokens, nem se executou
gravação. Evidência privada: `output/inspection-review-controls-20261103/READONLY-ACCESS-EVIDENCE.json`.

O que está preparado e o que permanece pendente

| Parte | Evidência local | Limite operacional |
|---|---|---|
| Composição de checklist | `lib/lvt-checklist-composition.cjs` relê o payload pelo revisor do catálogo; exige origem/digest, procedimento, modalidade, equipamento e itens declarados. Conserva linhas duplicadas, lacunas e ocorrências separadas. | A composição permanece rascunho, com origem e adequação técnica não verificadas. Nenhuma das 509 frases vira item obrigatório por padrão; não há instalação/ativação. |
| Isométrico/pontos/croqui | `lib/inspection-drawing-model.cjs` valida referências explícitas por cliente/contrato/sistema/TAG/linha/item/foto/RTI. Exige documento, número, revisão, folha, hash relatado, frame e posições explícitas. Nova revisão preserva integralmente a anterior. | É um modelo de referências JSON. Não lê/renderiza desenho, não comprova localização física, não cria pontos/ângulos e não integra zoom ou tela. Croquis continuam levantamento pendente, nunca as-built aprovado. |
| Pacote individual para conferência | `lib/inspection-review-packet.cjs` utiliza o congelamento existente da TAG e o verificador de desenhos; mantém digest, linhagem interna e conteúdo anterior. | Continua offline, sem persistência, envio, decisão, número/revisão técnica, aprovação ou assinatura. Digest é controle de conteúdo, não identidade ou ato técnico. |
| Inspetor e gestão | Leitura agregada confirmou os 22 cadastros de exercício e zero liberações vigentes no piloto. O gate publicado exige piloto e restringe gravação a admin/master. | Atribuição/login não concedem execução. Acesso operacional por sessão de inspetor e homologação autenticada continuam não demonstrados. |
| Revisão e assinatura | O envio existente conserva `em_revisao` e assinatura pendente. Os novos helpers recusam alegações de emissão/assinatura. | Não há devolução técnica, aprovação PLH, assinatura ou emissão técnica implementadas no fluxo de execução deste recorte. |

Plano específico para integração posterior

1. **Originais e composição técnica.** No ambiente salvo `pires-integrity`,
   solicitar pelo fluxo oficial de configuração a inclusão somente dos dois
   hosts de materialização acima, preservando as demais restrições. A
   [skill de runtime](skill://plugin_connector_1p_c5b7d5df5d7081918f2c4be5a633ed5d/cloud-environment-runtime/SKILL.md)
   estabelece: “Configuration changes require the environment
   configuration workflow and its user review.” Não há ferramenta de edição
   disponível nesta sessão; não se inventou caminho de interface. Após ajuste
   efetivamente observado e autorização específica desses destinos, realizar
   uma tentativa oficial, conferir bytes/hashes e reconciliar as células.
   A gestão técnica precisa declarar os itens aplicáveis, equipamento,
   modalidade, procedimento/revisão, tratamento de lacunas e duplicatas e
   modelo final de tubulação. A instalação deve fixar conteúdo e versão;
   catálogo ativo mais recente por cliente não demonstra aplicabilidade.
2. **Acesso de inspetor.** A conexão de leitura já confirmou o vínculo dos 22
   profissionais e a barreira do piloto. A homologação existente está inativa;
   retomá-la exige aprovação específica de configuração, e eventual custo
   precisa ser confirmado; não houve reativação nesta etapa. Antes de testar
   sessões, definir conta/tenant de homologação e conferir
   licença e capacidades. A mudança futura proposta é uma
   capacidade restrita às operações de iniciar/salvar/enviar a própria
   inspeção atribuída e às fotos dos seus itens. Exige revisão específica
   antes de alterar os gates da Edge/SQL, piloto ou Storage; não promover inspetores
   a admin/master nem liberar os demais POSTs. Revalidar vínculo/atribuição
   antes de gravar e após operações demoradas. Testar revogação, mudança de
   responsável, outro contrato/tenant, sessão expirada, escopo removido e
   requisições concorrentes em homologação isolada.
3. **Desenho e persistência.** Definir cadastro documental por linha com
   número/revisão/folha e bytes preservados; API autenticada deve obter os
   vínculos canônicos, em vez de confiar nas declarações do cliente. Preparar
   candidato de schema/API sob revisão antes de aplicar qualquer banco.
   O zoom precisa registrar frame e coordenadas no documento exato; recorte,
   rotação e nova revisão exigem tratamento explícito e novas marcações.
   Conferir PDFs/imagens reais em pixels. Não substituir o original por croqui.
4. **Revisão e atos técnicos.** Definir com a gestão quem pode solicitar,
   conferir, devolver e aprovar cada modalidade/TAG, como se comprova a
   habilitação PLH e se existe separação obrigatória entre executante e
   revisor. Papel funcional cadastrado não comprova habilitação ou autoria.
   Persistência/autorização, numeração e revisão técnica são propostas
   separadas, ainda sem implementação. A conferência futura deve obter seus
   dados canônicos por IDs no servidor, conferir versões/digest sob lock e
   receipt e persistir documento próprio com histórico. Snapshot/eventos de
   projeto são administrativos; não representam aprovação da TAG/PLH. Leitura
   e escrita precisam revalidar tenant, contrato, execução e ator em cada
   endpoint, sem aceitar aprovação ou identidade declarada pelo cliente.
   Devolução deve preservar versões e
   RTIs; alteração de conteúdo invalida aprovações do conteúdo anterior.
   Assinatura precisa de ato interativo do usuário autorizado sobre conteúdo,
   revisão e fontes exatos, com evidência verificável e trilha de auditoria;
   imagem de assinatura e digest local não atendem esse requisito. O mecanismo
   e as autoridades precisam ser aprovados antes de qualquer integração real.
5. **Emissão e homologação.** Só preparar emissão depois de conferir completude,
   identidade, revisão, assinaturas e originais preservados. Visual é individual
   por TAG; resumo por sistema conserva a identidade dos individuais.
   Espessura planejada exige seu relatório separado, instrumento e leituras
   válidos conforme procedimento confirmado, sem posições angulares inventadas.
   Emissão não encerra RTI. Homologar em conta/ambiente autorizados com dados
   sintéticos e ações identificadas; envio a cliente, assinatura real, merge,
   deploy e migração de produção continuam fora desta autorização.

Os alvos atuais que motivam esse plano são
`supabase/functions/_shared/gestao-api-core.mjs:274` (POST exige admin/master),
`:316` (revalidação genérica do upload antes do Storage),
`supabase/inspection-execution.sql:233` (execução exige write e responsável),
`:309` (gate de gravação), `:360` (completude no envio) e `:364`
(estado de revisão com assinatura pendente). Não foram alterados.

A matriz permanece REV00 minuta não vigente. O único marco definido é a data
de inspeção realizada, preservada no achado/histórico. Prazo manual justificado
continua separado do texto da recomendação e da classificação. Categoria de
pontuação 5, CoF 5, calendário, escolha dentro das faixas, autoridade e aprovação
integral continuam pendentes; não há cálculo automático novo.

Validação final

| Ensaio | Resultado | O que comprova |
|---|---|---|
| `npm test` | 276 testes: **273 aprovados, zero falhas, 3 ignorados** | Regressões locais, PGlite/SQL candidato e testes de helpers; os três ignorados dependem de originais privados históricos ausentes. |
| Composição nova | **20/20 aprovados**, incluídos no agregado | Seleção explícita, origem/digest, duplicatas/lacunas, ausência de padrões técnicos e rejeição de getters/estado não JSON/limites sem truncamento. |
| Desenho novo | **14/14 aprovados**, incluídos no agregado | Escopo, item/foto/RTI, uma inspeção por LVT, coordenadas explícitas e preservação de revisões; hash de origem continua relatado. |
| Pacote novo | **10/10 aprovados**, incluídos no agregado | Integração entre helpers reais da TAG e desenho, rejeição de mistura de execução, adulteração, aprovação/assinatura declaradas e recarga idempotente do pacote anterior. |
| `npm run check` | **125 arquivos JavaScript aprovados** | Sintaxe e padrões de credenciais; não equivale a auditoria de segurança ou integração Supabase real. |
| Leitura no banco publicado | **22 cadastros, 0 liberações vigentes no piloto**; tabelas candidatas ausentes | Estado agregado e definição atual do gate; nenhuma gravação, sessão de inspetor ou ação técnica executada. |
| Navegador | Não reexecutado nesta etapa | Os novos helpers não estão importados nas telas. As 47 aprovações anteriores permanecem evidência histórica local com APIs simuladas, não de produção. |

As revisões cruzadas encontraram e corrigiram, antes do agregado final, um
getter que mudava a obrigatoriedade declarada entre leituras, uma mesma LVT
apontando para duas inspeções e campos extras de escopo alterando a série do
pacote. Os casos foram incorporados aos testes. Não há achado pendente dessas
revisões nos novos helpers; isso não fecha as integrações técnicas listadas.

Evidências privadas locais: `output/inspection-review-controls-20261103/`,
incluindo logs agregados, leitura de acesso e manifesto de hashes.
Nenhum dado real foi usado nos testes. Os novos ensaios usam pequenas fixtures
sintéticas, sem fotos, desenhos, assinaturas ou relatórios técnicos reais.
O SQL candidato não foi aplicado remotamente. Não houve deploy, merge,
mudança de permissão, credencial, conta, matriz ou envio a cliente.
