Resultados da inspeção, cobertura e tratativas — revisão de 03/11/2026

Este recorte parte de `82e6fae90c6a00c9fb8b3b2a0e45a09f3c7472c8`.
Ele prepara os dois caminhos confirmados pelo usuário. O SQL é candidato de
revisão, aplicado somente em bancos locais transitórios. A autorização para
preparar publicação não substitui a aprovação específica de migração, ACL ou
acesso de inspetor em produção. Nenhuma dessas mudanças foi executada.

Comportamento preparado

| Caminho | Exigência e resultado |
|---|---|
| Boas condições | Declaração explícita, condições compatíveis na curadoria, checklist completo, data da inspeção e cobertura declarada com foto(s) canônicas. Não cria RTI. O PDF precisa incorporar todas as fotos selecionadas para cobertura. |
| Tratativa | Recomendação classificada como tratativa no catálogo, foto e rótulo de ponto de campo fornecido pelo usuário. O servidor registra achado, referência de campo e a mesma RTI por execução/item, sem duplicar em repetição, retomada ou edição. |
| Sem ação | Escolha documental classificada explicitamente com `requiresTreatment=false` conserva texto e fonte no item; não gera achado/RTI artificial. |
| Não contemplado/legado | Continua pendente para revisão. Ausência de recomendação ou RTI não significa boas condições. RTI retirada do rascunho é preservada e não é encerrada automaticamente. |

`outcome` distingue `pending`, `good_condition`, `treatment_required` e
`technical_review`. A cobertura informa `declared_section` ou
`declared_entire_line`, descrição dos limites e fotos explicitamente selecionadas
nos itens da própria execução. O sistema não deduz linha integral de uma foto
parcial, de várias fotos, da quantidade de itens ou da ausência de achados.
O relatório identifica a cobertura como declaração do inspetor, sujeita a
conferência técnica. A próxima campanha e o planejamento não são criados,
concluídos ou remarcados pela geração do PDF.

O catálogo ainda é escolhido pelo mais recente verificado de tenant/cliente
antes do início; depois a execução guarda seu ID. Não existe vínculo explícito
por modalidade/equipamento/procedimento nem garantia de versão imutável do
conteúdo do catálogo. A conferência de escolhas alteradas reduz a inconsistência,
mas não resolve essa aplicabilidade. Instalar as 509 frases fica bloqueado até
definir e implementar seleção explícita e versão aprovada por inspeção.

A condição usa `supportsGoodCondition` e a recomendação usa `requiresTreatment`,
metadados que precisam de curadoria técnica, aplicabilidade e fonte verificadas.
Eles não são extraídos automaticamente de palavras como “Bom” ou de faixas de
risco. A decisão salva é comparada ao catálogo atual; uma alteração posterior
não reclassifica silenciosamente o conteúdo. O catálogo real não foi instalado
nem recebeu esses metadados inventados para fazer o teste passar. As fixtures
são pequenas e inteiramente sintéticas.

Recomendações positivas antigas conservam compatibilidade, com
`actionabilityStatus=legacy_unclassified` e revisão pendente. Frases vazias,
marcadores e textos exatos de ausência de ação não viram RTI. Para selecionar
uma frase documental sem ação, a curadoria precisa declarar isso explicitamente.
Os novos resultados de boas condições/tratativa exigem classificação explícita;
um registro legado não é promovido a resultado novo por ausência de informação.

O ponto é um registro canônico `document/field_point_reference`, criado pelo
servidor sob o escopo de contrato/TAG/inspeção/execução/item, com ID estável,
rótulo declarado e fotos do item. O cliente não fornece um UUID arbitrário como
prova de ponto. Localização, documento, revisão e posição do isométrico ainda
ficam pendentes. Isso não conecta automaticamente o editor local de desenho
ao backend nem comprova uma posição física. O modelo atual comporta uma escolha
de recomendação e uma referência de campo por item/execução; múltiplos pontos
ou tratativas independentes no mesmo item exigem composição e modelo adicionais.

Uma tratativa de campo registrada depois da data da inspeção entra em
acompanhamento aberto. Isso é separado da confirmação da condição física atual:
a data observada e a atualidade desconhecida permanecem visíveis. Importação
histórica com texto “aberta” não ganha essa condição de acompanhamento por
inferência. A Gestão de RTI mantém a mesma identidade e os vínculos de origem.
Gerar ou conferir um relatório não encerra a RTI.

O marco permanece a data em que a inspeção foi realizada (`observedOn`).
Um ano, seis meses, 48 horas e imediato foram exemplos, sem regras aprovadas.
A matriz Pires permanece minuta. Prazo manual justificado é preservado até
aprovação da matriz, calendário, classificação e autoridade de alteração. Não
há novo cálculo de vencimento ou classificação de risco.

O backend novo anuncia `outcomeWorkflowVersion=1` no detalhe da execução.
Sem esse contrato, a interface não mostra os dois caminhos novos nem envia
`outcome`, `coverage` ou `pointLabel` ao servidor antigo. Uma escolha com
semântica nova também não é enviada ao backend antigo para evitar RTI falsa.
Isso protege contra atualização parcial de frontend; não habilita permissão.

Relatório individual continua **rascunho de conferência**, com `canIssue=false`.
Foto e declaração de boas condições não substituem revisão PLH, habilitação,
assinatura, numeração ou emissão técnicas reais. O carimbo solicitado foi
registrado como requisito separado e ainda não está integrado neste recorte.
O envio muda para `em_revisao` e bloqueia edição; ainda não há ações de devolver,
revisar ou aprovar. Esse bloqueio não deve ser apresentado como ciclo PLH pronto.

Estado real e plano para ativação

O inventário oficial de leitura encontrou produção ativa, Postgres 17.11,
1.452 registros (1.382 ativos, 4 contratos e 2 inspeções) e nenhuma LVT, RTI,
foto ou referência de campo nesse banco. `inspection_catalogs`,
`inspection_executions` e `ga_api_execution` estão ausentes. Há 22 profissionais
de exercício ativos e vinculados ao Auth, sem liberação vigente no piloto da
Gestão; 20 têm membership de inspetor. Cadastro/login não são permissão de
execução. A homologação `pires-integrity-homolog-rc1` está inativa.

A Edge `gestao-api` está na versão 6 segundo metadados, compatíveis com o recibo
anterior. O bundle integral e os arquivos públicos atuais não foram comparados
nesta etapa. O ID atual do deployment Cloudflare e um artefato restaurável de
frontend/Edge não estão verificados. Backups/PITR, retenção, ponto recuperável
e teste de restauração também não estão verificados: não há ferramenta
administrativa correspondente exposta nesta sessão. Backup do banco não inclui
os bytes dos objetos de Storage; estes precisam de proteção própria.
[Documentação oficial de backups](https://supabase.com/docs/guides/platform/backups).

Antes de dados reais, a proposta é homologar em ambiente isolado, nesta ordem:

1. Inventariar e aprovar a retomada da homologação existente, seu eventual
   custo, origem HTTPS/redirects Auth/CORS e configuração privada. Não criar
   projeto pago, conta, credencial ou copiar dados de produção por padrão.
2. Gerar a migração pelo fluxo suportado a partir do candidato final, comparar
   schema/ACL existentes e revisar o arquivo/hash. Não restaurar bootstrap sobre
   banco com conteúdo nem repetir migrações históricas. Aplicar somente ao
   destino isolado aprovado, com tenant e identidades de teste autorizados.
3. Testar Auth, Edge, Storage e autorização reais: atribuído versus outro
   profissional, revogação durante upload, outro tenant/contrato/item/foto,
   escopo removido, gravação concorrente, falhas, repetição e retomada. Testar
   ambos os caminhos, PDF com fotos e fila de RTI. PGlite e HTTP simulado não
   comprovam essa integração real.
4. Conferir originais, composição, aplicabilidade, semântica e versão imutável
   do catálogo real. A planilha de frases não define por si só itens obrigatórios,
   condição compatível, prazo ou disciplina. A matriz continua sem ativação.
5. Antes de qualquer escrita em produção, obter evidência de backup/Storage e
   restauração em destino aprovado, preservar artefatos exatos de rollback e
   aprovar o delta de migração/ACL abaixo com seu hash final.
6. Somente depois, publicar Edge e frontend correspondentes com configuração
   conectada correta, verificar contrato de versão e executar leitura inicial.
   O ensaio real deve ter usuários, contrato/TAGs e ações definidos. Inspetores
   reais registram observações reais; agentes não preenchem nem assinam por eles.

O delta de ACL já existia no candidato anterior e requer aprovação específica:
revogar `authenticated EXECUTE` dos quatro dispatchers privados `ga_api`,
`ga_api_operational`, `ga_api_prepared`, `ga_api_projects`; conceder execução ao
novo `ga_api_execution`; criar as duas tabelas privadas com RLS e acesso direto
revogado; trocar o roteamento de `public.pi_gestao_api`. Hoje os quatro grants
legados estão ativos. As alterações deste recorte preservam esse delta, sem
executá-lo nem ampliar o gate atual de gravação admin/master.

Acesso de inspetor exige outro pacote específico: usuário/tenant/licença/piloto
conferidos e capacidade restrita a fila própria, iniciar/salvar/enviar e fotos
dos próprios itens sob atribuição atual. Não promover inspetores a admin/master,
liberar todos os POSTs ou um bucket inteiro. Revisão PLH, devolução técnica,
assinatura e emissão reais exigem autoridade e implementação próprias.

Matriz de evidência do recorte

| Etapa | Resultado demonstrado | Limite |
|---|---|---|
| Atribuição e Minhas inspeções | SQL local valida vínculo, responsável, tenant, licença, piloto, escopo e revogação. | Inspetor permanece somente leitura no Edge e SQL. Não há acesso operacional real homologado. |
| Iniciar/continuar | Mesma execução e respostas após repetição, recarga e reabertura do banco. | Auth e transporte remotos não foram exercitados. |
| Boas condições | SQL, tela e PDF exigem escolha explícita compatível, data, cobertura e fotos vinculadas. Sem RTI nova e sem alteração da próxima campanha. | Catálogo real e geometria do isométrico não integrados; não é emissão técnica. |
| Tratativa e Gestão RTI | SQL cria um conjunto ponto/achado/RTI por execução/item; edição, repetição, retirada e reabertura conservam identidade/histórico. Tela mostra acompanhamento mesmo com data de inspeção anterior. | Uma referência declarada por item, sem posição validada em desenho. |
| Falha transacional | Falha injetada na RTI reverte ponto/item/execução; retry cria um único conjunto. | Atomicidade entre Storage remoto e banco não comprovada. |
| Duplo clique/resposta perdida | Fila local, replay pós-commit, stale version e reabertura testados. | Não comprova corrida PostgreSQL entre sessões independentes nem timeout real Supabase. |
| Isolamento | Outro contrato, TAG/item/foto/execução e sistemas de mesmo nome são recusados ou excluídos do relatório/fila. | Não há ensaio autenticado de upload entre tenants no serviço remoto. |
| Marco e prazo | Data declarada da inspeção, auditoria de alterações e prazo manual preservados. | Matriz minuta sem cálculo automático. |
| Visual/espessura | Tipo da atividade preservado; rascunho visual não seleciona medição nem outra execução. | Segundo relatório operacional de espessura e consolidação emitida não integrados. |
| Revisão/assinatura/emissão | Envio bloqueia edição; PDF/pacote conservam `canIssue=false` e rejeitam atos técnicos falsos. | Devolução, revisão/aprovação PLH, assinatura e emissão reais não implementadas. |

As provas executáveis ficam em `tests/gestao-inspection-treatment.test.cjs`,
`tests/gestao-inspection-validation.test.cjs`,
`tests/gestao-inspection-edge-sql-validation.test.cjs`,
`tests/gestao-inspection-anchor.test.cjs`, `tests/gestao-tag-sql.test.cjs`,
`tests/gestao-tag-good-condition.test.cjs`,
`tests/gestao-rti-followup.test.cjs`,
`tests/gestao-inspection-outcomes-browser.cjs` e suítes anteriores.
O checklist curado usado nos testes é sintético e isolado; os dados de produção
foram consultados apenas por metadados e contagens autorizadas.

Resultados finais locais

| Verificação | Aprovados | Falhas | Ignorados |
|---|---:|---:|---:|
| `npm test` | 328 | 0 | 3 |
| Navegador: novos resultados | 16 | 0 | 0 |
| Navegador: regressões anteriores | 47 | 0 | 0 |
| `npm run check` | 135 arquivos JS | 0 | 0 |

Os três ignorados exigem originais privados de clientes, ausentes desta cópia.
Os 29 testes focais do backend e os 45 de helper/SQL/PDF/pacote fazem parte da
suíte agregada; não devem ser somados novamente. O navegador usa Chromium local,
UI/PDF reais e HTTP/Auth/catálogo sintéticos. A integração SQL usa PGlite com SQL
candidato real e identidades/Storage de fixture; não é Supabase operacional.

A primeira rodada agregada encontrou uma asserção anterior que comparava a
resposta canônica salva ao payload sem os novos metadados. O teste agora confirma
os campos enviados e compara a resposta canônica completa antes/depois de remover
o escopo, reintroduzi-lo e reabrir o banco. O produto não foi afrouxado.
A primeira regressão de navegador encontrou uma corrida de preparação: chegada
dos headers HTTP ainda não significava estado atualizado/renderizado. Os helpers
de teste agora aguardam a promise do handler real de atualização; fixtures,
rotas, autorização e asserções foram preservadas. Falhas iniciais e rodadas finais
permanecem separadas nos logs privados.

SHA-256 do candidato SQL: `ebc873f1e44aae1ea8d23f9b558a886564421782681fe94ea7aa23d2986f74db`.
Ele ainda não é uma migração gerada/aprovada para produção. O próximo pacote
de autorização deve identificar ambiente, atores, operações, schema/ACL exatos,
versão aplicável do catálogo e proteção/rollback. Uma autorização genérica de
deploy já foi recebida; não se pede sua repetição. As mudanças materiais de
segurança/migração descritas acima continuam sem aprovação específica ou execução.

Rollback deve preservar novos registros e histórico. Reverter frontend/Edge
requer versões compatíveis verificadas; não apagar tabelas/RTIs/pontos ou
restaurar banco automaticamente depois de novas gravações. Reverter ACL sem
revisão pode reabrir os caminhos legados que o candidato restringe. Sem evidência
de restauração/compatibilidade, a ativação permanece bloqueada.

Inventário e plano detalhado, somente de leitura, estão na cópia privada em
`output/activation-inventory-20261103/`. Resultados finais, hashes e capturas
deste recorte serão fechados em `output/inspection-outcomes-20261103/` após
congelar as fontes. Nenhuma migração, permissão, dado real, assinatura, emissão,
mudança de rede, merge ou deploy de produção foi executado.
