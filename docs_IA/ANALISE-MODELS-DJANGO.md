# Análise de entidades para migração para Django

Data da análise: 15/11/2026  
Fontes consultadas: `../INSPECAO-REVISAO.txt`, `../supabase/bootstrap/current-schema.sql`, `../supabase/inspection-execution.sql`, migrations de Gestão, `../lib/asset-store.cjs`, testes e código da aplicação.

## Conclusão rápida

O projeto já possui um domínio persistente bem definido. A migração pode começar pelos modelos abaixo:

1. organização/tenant e usuários/memberships;
2. profissionais, qualificações e arquivos;
3. hierarquia operacional: unidade, sistema e ativo;
4. contrato/projeto, campanha e inspeção;
5. execução da inspeção, itens, fotos, achados e RTIs;
6. catálogo de inspeção versionado;
7. trilha de auditoria e controle de versão.

O ponto importante é que o Supabase atual armazena a maior parte da Gestão em `pi_gestao_private.records`, com `kind` identificando o tipo e `body JSONB` contendo os atributos. Em Django, o caminho mais seguro é não reproduzir tudo como um único modelo genérico. Normalize as entidades centrais e mantenha `JSONField` somente para dados técnicos variáveis, evidências, snapshots e payloads de origem.

## O que pode ser passado imediatamente

### 1. Organização e acesso

Já existe base relacional suficiente no snapshot:

- `Company` / `Tenant`
  - `id` UUID
  - `name`
  - `created_at`
- `CompanyMembership`
  - `company`
  - `user` (FK para o usuário do Django)
  - `role_name`
  - `access_state`
  - `approved_by`, `approved_at`, `revoked_at`
  - convite associado, se necessário
- `PilotAccess`
  - `tenant`, `user`
  - `granted_at`, `expires_at`, `revoked_at`
  - `reason`

Esses modelos devem ser separados de autorização técnica. O recorte registra explicitamente que login, membership e cadastro não significam habilitação para executar inspeção.

### 2. Profissionais e equipe

O modelo `Professional` pode ser criado praticamente com os campos já existentes em `pi_team_private.professionals`:

- `tenant`, `user`, `exercise_key`
- `name`, `job_title`, `relationship`
- `professional_email`, `professional_phone`
- `integrity_level`, `integrity_basis`
- `registration_state`, `availability`, `availability_note`
- `technical_state`, `technical_basis`
- `exercise`, `functional_role`
- `test_identity`, `test_registration`
- `access_revoked_at`, `login_validated_at`
- `version`, `created_by`, `created_at`, `updated_by`, `updated_at`

Modelos relacionados que também podem ser migrados:

- `QualificationCatalog`: `code`, `meaning`, `active`, `version`.
- `Qualification`: profissional, catálogo, método, nível, escopo, certificador, número do certificado, validade, verificação, observação e arquivo comprobatório.
- `ProfessionalDocument`: profissional, título, tipo, atividade, cliente, unidade, emissor, validade, verificação e arquivo.
- `ProfessionalFile`: nome, chave do objeto, MIME, tamanho, finalidade, estado, autor e data.
- `TeamAssignment`: profissional, cliente, projeto, atividade, datas e ativo.
- `TeamRequirement`: título, atividade, cliente, unidade, base e ativo.

### 3. Hierarquia operacional

Criar modelos relacionais:

- `Owner` ou `Client`
  - organização/tenant, nome, `name_key`, origem, datas e autor.
- `Unit`
  - owner, nome e auditoria.
- `System`
  - unit, nome e auditoria.
- `Asset`
  - owner, unit, system, TAG, tipo, identificação, segmento;
  - `operation`, `technical_condition`;
  - `technical` como `JSONField` para fluido, material, diâmetro, circuito e demais propriedades;
  - `source` como `JSONField` para origem/rastreabilidade.

O vínculo `Asset -> Unit -> System -> Owner` aparece repetidamente nas migrations e é uma boa primeira normalização. A TAG deve ter índice por tenant/owner e, se a regra permitir, unicidade no escopo do owner.

### 4. Contrato, projeto e campanha

O código atual usa `contract` para mais de um conceito, inclusive `operational_project`. No Django, recomenda-se começar com um único modelo `Project` ou `ContractProject`, deixando explícito o `record_class` durante a compatibilidade.

Campos observados:

- `name`, `source`, `status`, `record_class`
- `contract_reference`, `responsible`, `unit`
- `modules` (lista curta; pode ser `ArrayField` em PostgreSQL ou tabela de módulos)
- escopo de ativos por módulo
- `scope_version`, `plan_version`
- datas, autor e versão

Modelo `Campaign`:

- projeto/contrato
- sistema
- módulo
- ativos incluídos
- `planned_start`, `planned_end`
- `source`, `status`

Para os ativos incluídos, prefira tabela intermediária `ProjectAsset`/`CampaignAsset` em vez de manter apenas arrays de UUID. Isso facilita consultas, integridade referencial e filtros.

### 5. Inspeção

`Inspection` é uma das entidades mais prontas para migração. Campos identificados:

- `owner`/tenant
- `project` ou `contract`
- `campaign`
- `asset`
- `system`
- `module`
- `type` (`visual`, `espessura` e outros tipos históricos)
- `planned_at` / `planned_source`
- `observed_at` / `execution_source`
- `status`
- profissional responsável e nome preservado da atribuição
- `execution_id`
- `version`
- `record_source`
- timestamps e autor

Restrições que devem estar no serviço ou em `clean()`/transação:

- a inspeção não pode mudar de ativo ou contrato depois de criada;
- execução comprovada deve ser preservada;
- atividade deve respeitar módulo e escopo do contrato/campanha;
- inspeção planejada precisa de fonte de planejamento;
- inspeção executada precisa de evidência.

Uma tarefa de planejamento isolada ainda não cria automaticamente uma inspeção canônica. Esse vínculo deve ser decidido antes de transformar `projectPlan.tasks` em FK direta.

### 6. Catálogo de inspeção

O SQL de execução introduz `InspectionCatalog`, que pode ser convertido agora:

- tenant/owner
- `id`, nome ou título
- `status` (`draft`, `verified` etc.)
- `source_id`
- hash/origem do documento
- versão e datas
- `items` em `JSONField` inicialmente, ou tabelas normalizadas abaixo

Para uma segunda etapa:

- `InspectionCatalogItem`: catálogo, `item_key`, componente, descrição, ordem.
- `InspectionCondition`: item, texto, origem.
- `InspectionRecommendation`: item, texto, origem, condições aplicáveis.

Como o catálogo real ainda está pendente e `inspection_catalogs` começa vazio, não criar fixtures históricas como dados reais. O catálogo deve ser imutável depois de verificado; uma nova versão deve gerar novo registro.

### 7. Execução de inspeção

Criar `InspectionExecution` com:

- `inspection` (relação um-para-um)
- tipo da execução (`lvt` ou `document`)
- catálogo congelado usado na execução
- `record_class` (`field_lvt` ou `measurement_draft`)
- status (`rascunho`, `em_revisao` etc.)
- versão otimista (`version`)
- profissional/inspetor
- `observed_on`, instrumento
- `answers` e `readings` como `JSONField` inicialmente
- progresso, origem, revisão técnica, envio e autorias

Para execução visual, criar `InspectionItem`:

- execução, item do catálogo, chave do item, componente
- condição selecionada, recomendação selecionada
- status (`pendente`, `respondido`, `gestao_tecnica_pendente`)
- fotos associadas
- origem e necessidade de revisão técnica

Para execução de espessura, criar `ThicknessReading`:

- execução
- ponto documentado
- valor decimal positivo
- unidade (`mm` ou `in`)
- ordem e observação técnica, se necessária

Não colocar respostas visuais e leituras de espessura no mesmo conjunto de colunas obrigatórias: são modalidades diferentes.

### 8. Fotos, achados e RTIs

Modelos recomendados:

- `InspectionPhoto`
  - execução, item, ativo, arquivo, nome, MIME, hash, chave de armazenamento, data e autor.
- `Finding`
  - execução, item, ativo, condição, recomendação, fonte, fotos, status e revisão técnica.
- `RTI`
  - ativo, execução, item, finding, contrato/projeto;
  - status, currentness, fonte, evidência de atualidade;
  - `recommendation_withdrawn`, `technical_review_required`;
  - `actions` e `history` como `JSONField` no primeiro passo.

Regras importantes já implementadas no SQL:

- foto só pode pertencer ao mesmo item e TAG;
- recomendação precisa corresponder à condição do catálogo;
- recomendação exige data observada e foto;
- retirada de recomendação não apaga a RTI, apenas a encaminha para revisão;
- RTI encerrada não pode ser alterada silenciosamente.

### 9. Documentos, revisões e entrega

O fluxo legado também descreve entidades que podem ser modeladas:

- `TechnicalDocument`: ativo, módulo, tipo, base e aplicabilidade.
- `DocumentRevision`: documento, revisão, status, responsável, decisão e datas.
- `DocumentAttachment`: revisão, nome, hash, MIME e arquivo.
- `ReportDelivery`: inspeção, ativo, contrato, módulo, revisão e data de entrega.

Estados de revisão observados: `pendente`, `em_elaboracao`, `em_revisao`, `aprovado`, `devolvido`, `substituido`. A aprovação exige aplicabilidade validada e anexo; uma revisão aprovada anterior deve ser marcada como substituída quando outra for aprovada.

## O que deve continuar como JSONField por enquanto

- propriedades técnicas heterogêneas dos ativos;
- origem/proveniência de importação e localização em planilha;
- payloads de snapshot e relatório;
- respostas do catálogo enquanto o catálogo real não foi fechado;
- ações e histórico interno de RTI;
- `projectPlan.tasks`, até definir a relação oficial com inspeções;
- dados brutos de fontes importadas, previews e documentos originais.

Esses campos devem ter validação por serializer/form/service e, quando necessário, um `schema_version` explícito. JSONField não deve ser usado para esconder relações essenciais como ativo, inspeção, profissional, campanha ou catálogo.

## Persistência transversal

### Auditoria e histórico

O projeto já possui `audit`, `record_origins`, `record_relations` e `operation_receipts`. Em Django, criar:

- `AuditEvent`: tenant, owner, registro, tipo, ação, ator, data e `body` JSON.
- `RecordRelation`: origem, destino, tipos, relação, autor e data.
- `RecordOrigin`: registro, origem, chave e digest.
- `OperationReceipt`: request id, ação, digest, resultado, ator e data.

Não substituir auditoria por simples `updated_at`. A execução usa histórico e controle concorrente por versão.

### Versionamento concorrente

Adicionar `version` aos modelos mutáveis e salvar usando transação com condição `WHERE version = versão_esperada`, incrementando a versão. O comportamento atual rejeita rascunho alterado por outro usuário.

### Arquivos

Não salvar bytes de fotos e documentos técnicos diretamente em colunas normais. Usar `FileField`/storage S3 compatível, mantendo no banco nome, MIME, tamanho, hash, object key, finalidade e estado de validação.

## Ordem sugerida de migração

1. `Company`, memberships, pilot access e `Professional`.
2. `Owner`, `Unit`, `System` e `Asset`.
3. `Project/Contract`, `Campaign` e tabelas de escopo de ativos.
4. `Inspection` e atribuição do profissional.
5. `InspectionCatalog` versionado.
6. `InspectionExecution`, itens e leituras.
7. fotos, findings e RTIs.
8. documentos, revisões, relatórios e entrega.
9. auditoria, relações, receipts e importação.

## Itens ainda não prontos para uma migração definitiva

- catálogo real: originais e hashes ainda não foram materializados/conferidos;
- autorização operacional dos inspetores: os profissionais existentes não têm liberação do piloto;
- vínculo entre tarefas de planejamento e inspeções canônicas;
- isométrico, folha, pontos angulares, croqui e fotos numeradas;
- revisão/PLH, assinatura, emissão e entrega final de relatórios;
- rollout do SQL: `../supabase/inspection-execution.sql` foi testado em bancos isolados e não foi aplicado remotamente.

## Mapeamento resumido

| Registro atual | Modelo Django sugerido | Situação |
|---|---|---|
| `owner` | `Owner`/`Client` | pronto para normalizar |
| `unit` | `Unit` | pronto |
| `system` | `System` | pronto |
| `asset` | `Asset` | pronto, com JSON técnico |
| `contract` | `Project`/`ContractProject` | pronto, revisar semântica |
| `campaign` | `Campaign` | pronto |
| `inspection` | `Inspection` | pronto |
| `lvt` | `InspectionExecution` | pronto |
| `lvt_item` | `InspectionItem` | pronto |
| `photo` | `InspectionPhoto` | pronto |
| `finding` | `Finding` | pronto |
| `rti` | `RTI` | pronto, ações em JSON inicialmente |
| `document` | `TechnicalDocument` ou documento de projeto | separar por `record_class` |
| `revision` | `DocumentRevision` | pronto no fluxo legado |
| `delivery` | `ReportDelivery` | pronto no fluxo legado |
| `projectPlan` | `ProjectPlan` | modelar depois de definir tasks |
| `record_relations` | `RecordRelation` | transversal |
| `audit` | `AuditEvent` | transversal |

## Recomendação final

É seguro começar a passagem para Django pelo núcleo de identidade, equipe, hierarquia, ativos, projetos, campanhas e inspeções. Em seguida, migrar a execução de campo com catálogo versionado. Durante a transição, manter um adaptador compatível com o `kind/body` atual ou uma tabela de legado, para que os registros existentes possam ser lidos sem conversão destrutiva.

Não é recomendável começar criando um `GenericRecord` como arquitetura final: ele reproduziria a flexibilidade do JSONB, mas manteria no Django os mesmos problemas de integridade referencial, consultas e validação que a migração pretende resolver.
