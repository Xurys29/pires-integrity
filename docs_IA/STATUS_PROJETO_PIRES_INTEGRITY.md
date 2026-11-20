# Pires Integrity — andamento e próximos passos

Atualizado em 20/11/2026. Revisão 3. Responsável pelo desenvolvimento Albert Pimentel França.

## 1. Ponto atual

O projeto possui ambiente Django em Docker, PostgreSQL configurado, estrutura inicial com 53 models, migration inicial versionada e CI executando no GitHub Actions. A última execução consultada da `develop` concluiu build, configuração, aplicação da migration e verificação HTTP com sucesso.

**A execução mais recente confirmou 31 testes aprovados no PostgreSQL**, sendo 26 dos models e 5 de inicialização/healthcheck. A suíte está organizada em `tests/__init__.py`, `tests/tests_models.py` e `tests/test_ci.py`. O Admin inicial de Company, Client, Unit, System e Asset também está registrado no commit remoto verificado. O cadastro manual dos primeiros dados e a criação do superusuário local ainda precisam de confirmação.

Este registro reúne entregas da conversa, confirmações do usuário e uma verificação do repositório remoto. O código no computador do desenvolvedor pode conter mudanças ainda pendentes de push.

## 2. Última evidência verificada no GitHub

| Item | Resultado |
|---|---|
| Repositório de trabalho | `Xurys29/pires-integrity` |
| Branch utilizada pelo usuário | `develop` |
| Commit da execução consultada | `9e023c2d3008742516578d9b8787ad2098d7da03` |
| Execução | `44820689709`, concluída com sucesso |
| Migration | `sistema_pires.0001_initial` aplicada com resultado `OK` |
| Configuração Django | `System check identified no issues` |
| Mudanças de models sem migration | `No changes detected` |
| Testes executados | `Ran 31 tests in 0.336s` e `OK` |
| Inicialização HTTP | Verificação de `/healthz/` aprovada |
| Publicação de imagem | Job ignorado nessa execução da `develop`, conforme o gatilho definido para `main` |

[Consultar execução verificada](https://github.com/Xurys29/pires-integrity/actions/runs/44820689709).

A execução confirma que a suíte foi enviada à `develop`, descoberta e executada no PostgreSQL temporário. A pendência de descoberta está concluída.

## 3. Trabalho realizado

### 3.1 Planejamento e entendimento do domínio

- [x] Análise do README, RELEASE e revisão de inspeção do sistema anterior.
- [x] Análise do panorama de módulos, matriz de risco e referências técnicas.
- [x] Elaboração do plano diretor de desenvolvimento em PDF para avaliação da Pires.
- [x] Definição da reconstrução em Django e Django REST Framework.
- [x] Definição da intenção de criar aplicativos mobile e desktop com operação offline e sincronização.
- [x] Análise inicial das entidades e separação entre persistência, integridade e regras de negócio.
- [x] Preparação de perguntas e recebimento das respostas do engenheiro mecânico.
- [x] Análise dos extratos de relatório visual e de medição de espessura Rev. 06.

O plano elaborado contém estimativas e propostas de arquitetura. Sua aprovação formal e o início de um cronograma contratado ainda precisam de confirmação. Flutter/SQLite foi proposto para os aplicativos e continua sujeito à escolha final de implementação.

### 3.2 Definições recebidas do engenheiro

- Hierarquia operacional cliente → unidade → sistema → ativo/TAG.
- Histórico da TAG preservado entre campanhas, contratos e inspeções.
- Contrato e projeto como entidades distintas, com vários projetos por contrato.
- Campanhas vinculadas ao projeto e ao contrato correspondente, com escopo, modalidades, cobertura, inspetor e cronograma.
- Inspeção planejada separada de execução realizada.
- Retornos e complementações representados como execuções da mesma inspeção.
- Nova inspeção periódica representada por novo registro para o mesmo ativo.
- Pontos de medição reutilizáveis, com localização, posição, isométrico e revisão rastreáveis.
- Evidências de leitura e localização do ponto.
- Possibilidade de descrever e fotografar uma condição ausente no catálogo para revisão técnica.
- Toda recomendação aberta deve gerar uma RTI automaticamente.
- Uso da matriz oficial da Pires integrada à LVT.
- Quatro perfis previstos, gerente, engenheiro responsável, assistente e inspetor.
- Fluxo de programação, campo, conferência, revisão/correções, assinaturas, emissão e entrega.

### 3.3 Ambiente e dependências

- [x] Projeto Django e app `sistema_pires` criados.
- [x] Container local estabilizado após correção do comando de inicialização.
- [x] Mapeamento local previsto em `127.0.0.1:8001`, com servidor na porta interna 8000.
- [x] Configuração por variáveis de ambiente e `python-dotenv`.
- [x] PostgreSQL definido como banco padrão.
- [x] DRF registrado em `INSTALLED_APPS`.
- [x] Remoção da duplicação de `django.contrib.postgres`.
- [x] Configuração do middleware e backend do Axes adicionada ao settings informado pelo usuário.
- [x] `cryptography` instalada e `FERNET_KEY` carregada pelo settings.
- [x] Requirements versionado, incluindo Django 6.1.3, DRF 3.18.3, Axes 9.0.0 e psycopg 3.3.9.

A instalação e a configuração das bibliotecas permitem implementar seus recursos. A criptografia de campos, as políticas da API e as permissões do domínio ainda têm tarefas próprias.

### 3.4 Models

- [x] Entrega de models, testes e instruções.
- [x] Estrutura de 53 models concretos, com UUID, timestamps, campos de autoria e versão.
- [x] Relações principais normalizadas e tabelas intermediárias de escopo.
- [x] Validações de coerência de organização, projeto, campanha, ativo, execução e ponto.
- [x] Constraints de unicidade, intervalos e espessura positiva.
- [x] Validações de congelamento de determinados registros aprovados ou emitidos.
- [x] Validação do pacote com Django 6.1.3 e psycopg 3.3.9.
- [x] 26 testes aprovados no ambiente temporário SQLite durante a construção do pacote.
- [x] Os mesmos 26 testes dos models aprovados no PostgreSQL do CI, junto dos 5 testes de inicialização/healthcheck.
- [x] Models presentes no commit remoto inspecionado.
- [x] Migration inicial gerada pelo usuário, versionada e aplicada no PostgreSQL do CI.

| Domínio | Models principais |
|---|---|
| Organização e acesso | Company, CompanyMembership, PilotAccess |
| Equipe e arquivos | Professional, QualificationCatalog, Qualification, ProfessionalDocument, StoredFile, TeamAssignment, TeamRequirement |
| Hierarquia de ativos | Client, Unit, System, Asset |
| Contratos e planejamento | Contract, Project, ProjectAsset, Campaign, CampaignAsset, Inspection |
| Catálogo LVT | InspectionCatalog, InspectionCatalogItem, InspectionCondition, InspectionRecommendation |
| Execução | InspectionExecution, InspectionItem, Finding, Recommendation, InspectionPhoto |
| Desenhos e pontos | Isometric, IsometricRevision, MeasurementPoint, MeasurementPointRevision, MeasurementPosition |
| Medição | Instrument, CalibrationRecord, ExecutionInstrument, ThicknessRequirement, ThicknessReading |
| Risco e tratativas | RiskMatrixVersion, RiskBand, RiskAssessment, RTI, RTIAction |
| Documentação | TechnicalDocument, DocumentRevision, DocumentAttachment, DocumentSignature, ReportDelivery |
| Rastreabilidade | AuditEvent, RecordOrigin, RecordRelation, OperationReceipt |

### 3.5 CI e entrega de imagem

- [x] Arquivos de CI/CD e roteiro de aplicação entregues ao usuário.
- [x] Workflow em `.github/workflows/ci.yml`.
- [x] Compose de CI com PostgreSQL 16 temporário.
- [x] Padronização proposta do nome `Dockerfile` para execução em Linux.
- [x] Regra de terminação de linha LF para `entrypoint.sh`.
- [x] Build Docker e verificação de dependências com `pip check`.
- [x] Verificação de configuração e migrations pendentes.
- [x] Comando de execução de testes no PostgreSQL.
- [x] Inicialização da imagem e verificação HTTP de `/healthz/`.
- [x] Publicação de imagem no GHCR configurada para push aprovado na `main`.
- [ ] Confirmar a publicação real da imagem na `main`.
- [ ] Conectar o deploy à VPS.

A estratégia escolhida pelo usuário é aplicar as mudanças diretamente na `develop`. O PR de preparação permanece como referência da proposta e deve ter sua situação conciliada com o trabalho já integrado.

[PR de preparação do CI/CD](https://github.com/Xurys29/pires-integrity/pull/2).

## 4. Pendências imediatas

### 4.1 Testes organizados e aprovados

A suíte definida pelo usuário está presente no commit verificado da `develop`.

```text
tests/
    __init__.py
    tests_models.py
    test_ci.py
```

| Arquivo | Responsabilidade | Resultado |
|---|---|---|
| `tests/__init__.py` | Pacote para descoberta e importação | Presente |
| `tests/tests_models.py` | Integridade dos models | 26 testes aprovados |
| `tests/test_ci.py` | Inicialização, healthcheck e consulta SQL | 5 testes aprovados |
| Total | Suíte completa entregue | 31 testes aprovados no PostgreSQL |

O import dos models utiliza `from sistema_pires.models import (...)`. O arquivo `test_ci.py` mantém os imports absolutos. A execução dos dois módulos foi confirmada pelos logs.

- [x] Organização na pasta `tests/` com `__init__.py`.
- [x] Import dos models corrigido e módulo executado com sucesso.
- [x] `test_ci.py` incluído na suíte.
- [x] Arquivos enviados à `develop` e incorporados à imagem construída.
- [x] Os 31 testes executados no PostgreSQL temporário.
- [x] Resultado `Ran 31 tests in 0.336s` seguido de `OK`.

#### Repetir a validação após alterações

Os comandos ficam registrados para novas execuções locais, na raiz do projeto.

```powershell
docker compose -f docker-compose.ci.yml build web
docker compose -f docker-compose.ci.yml run --rm web python manage.py test tests --noinput --verbosity 2
```

Para executar um módulo específico, usar o caminho correspondente.

```powershell
docker compose -f docker-compose.ci.yml run --rm web python manage.py test tests.tests_models --noinput --verbosity 2
docker compose -f docker-compose.ci.yml run --rm web python manage.py test tests.test_ci --noinput --verbosity 2
```

O workflow usa o test runner do Django por `python manage.py test`. O Compose de CI inicia sua dependência PostgreSQL e o entrypoint aplica as migrations antes do comando. A reconstrução incorpora o código atualizado à imagem. O contador esperado para a suíte atual é 31 testes.

A configuração de `pytest.ini` pertence ao runner pytest e precisa de revisão própria caso esse runner seja adotado.

### 4.2 Confirmar o banco de desenvolvimento

O comando local `makemigrations` apresentou recusa de conexão com `pires_dev` pelo `pg_hba.conf`. A migration foi criada e o CI usa seu próprio PostgreSQL, cujo funcionamento foi confirmado.

- [ ] Confirmar conexão ao PostgreSQL a partir do container de desenvolvimento.
- [ ] Aplicar a migration no banco exclusivo de desenvolvimento.
- [ ] Confirmar a conexão pelo Python executado diretamente no Windows, se esse modo fizer parte do fluxo de trabalho.
- [ ] Conferir que as credenciais e o banco usados localmente correspondem ao ambiente de desenvolvimento.

### 4.3 Aplicar o Django Admin inicial

O registro de Company, Client, Unit, System e Asset está implementado em `sistema_pires/admin.py`, com colunas, buscas, filtros e autocomplete. A configuração passou no check do CI e o teste de carregamento do login administrativo foi aprovado. O uso manual com superusuário e o cadastro completo da hierarquia ainda precisam de confirmação.

- [x] Código do Admin incorporado e versionado na `develop`.
- [ ] Atualizar a imagem ou confirmar o volume de código usado no desenvolvimento.
- [x] `manage.py check` e `migrate` aprovados no CI.
- [ ] Criar o superusuário de desenvolvimento.
- [ ] Validar cadastro de organização, cliente, unidade, sistema e TAG.
- [ ] Acrescentar preenchimento controlado da autoria.
- [ ] Expandir o Admin progressivamente para os demais cadastros.

## 5. Funcionalidades a implementar

### 5.1 Acesso e perfis

- [ ] Detalhar a matriz de permissões por perfil e por contrato/projeto.
- [ ] Implementar convites, liberação, suspensão e revogação.
- [ ] Validar vínculo, atribuição e qualificação técnica em cada operação protegida.
- [ ] Implementar filtragem por organização e cliente nas consultas, APIs, Admin e arquivos.
- [ ] Definir como ficará a consulta do cliente no produto final, considerando que os quatro perfis recebidos descrevem a equipe interna.

### 5.2 APIs e interface web

- [ ] Criar serializers, rotas e endpoints DRF.
- [ ] Definir autenticação e política padrão de permissões da API.
- [ ] Criar o primeiro fluxo completo de cadastro de cliente, unidade, sistema e ativo.
- [ ] Criar as telas de projetos, campanhas e programação.
- [ ] Implementar busca, paginação, filtros e tratamento dos erros de validação.

### 5.3 Planejamento e inspeção

- [ ] Importar TAGs para escopo de projeto/campanha com validação e relatório de inconsistências.
- [ ] Implementar regras de amostragem e cobertura de 100%.
- [ ] Gerar inspeções planejadas a partir da programação.
- [ ] Validar modalidade, escopo, inspetor e cronograma.
- [ ] Implementar execução inicial, retorno, complementação e nova inspeção periódica.
- [ ] Controlar envio, conferência, revisão, devolução e bloqueios de edição.

### 5.4 LVT e evidências

- [ ] Obter os originais e versões aprovadas da LVT.
- [ ] Importar condições e recomendações com origem rastreável.
- [ ] Homologar e congelar versões do catálogo.
- [ ] Implementar descrição e foto para condições ainda não catalogadas.
- [ ] Definir a obrigatoriedade de fotos por fluxo e modalidade.
- [ ] Validar que referências ilustrativas sejam identificadas como tal.

### 5.5 Recomendações e RTIs

- [ ] Implementar serviço que abre recomendação e cria RTI na mesma transação.
- [ ] Validar evidências e dados necessários para a abertura.
- [ ] Tratar reenvios sem duplicar recomendações ou RTIs.
- [ ] Definir tratamento de ocorrências repetidas entre execuções e campanhas.
- [ ] Implementar retirada de recomendação com revisão e preservação da RTI.
- [ ] Implementar mural de acompanhamento, responsáveis e alertas.
- [ ] Confirmar autoridade e critérios de encerramento da RTI.
- [ ] Implementar verificação da eficácia e histórico das tratativas.

### 5.6 Matriz de risco e prazos

- [ ] Receber e conferir a versão oficial da matriz Pires.
- [ ] Parametrizar as faixas confirmadas pelo engenheiro.
- [ ] Aplicar consequências de segurança, ambiente e negócio conforme a matriz oficial.
- [ ] Classificar consequência 5 como muito alta e sinalizar mitigação imediata.
- [ ] Definir o prazo numérico de consequência catastrófica com a engenharia.
- [ ] Definir a data exata dentro das faixas e quem pode estabelecê-la.
- [ ] Definir a data-base de uma recomendação identificada em retorno/complementação.
- [ ] Aplicar prazo técnico/normativo menor quando houver, com referência e justificativa.
- [ ] Registrar versão, autoria e fundamentos das avaliações.

As faixas informadas pelo engenheiro estão registradas abaixo como referência para a futura parametrização.

| Score | Faixa informada |
|---|---|
| 25 | Mitigação imediata em menos de 24 horas |
| 20 | Mitigação imediata em menos de 72 horas |
| 15 e 16 | Menos de 14 dias |
| 10 e 12 | Menos de 4 semanas |
| 8 e 9 | De 1 a 3 meses |
| 5 e 6 | De 3 a 6 meses |
| 3 e 4 | De 6 a 24 meses |
| 1 e 2 | Monitoramento acima de 24 meses |

O engenheiro definiu a data da inspeção realizada como marco inicial. A exceção de consequência 5 prevalece sobre a faixa do score. O valor numérico ainda pendente precisa de definição técnica para automatização.

### 5.7 Espessura, cálculos e instrumentos

- [ ] Implementar cadastro e revisão de isométricos, pontos e posições.
- [ ] Implementar registro de leituras com fotos do ponto e da leitura.
- [ ] Selecionar instrumentos e registros metrológicos aplicáveis à execução.
- [ ] Definir comparabilidade entre medições e escolha de leituras repetidas.
- [ ] Homologar requisitos mínimos por ativo, ponto ou posição.
- [ ] Homologar fórmulas, unidades, intervalos, arredondamento e tratamentos de casos especiais.
- [ ] Implementar taxa de corrosão, saldo, perda percentual e vida residual.
- [ ] Preservar a memória de cálculo e sua versão em cada emissão.

Os requisitos de espessura, cores e fórmulas dos extratos Rev. 06 incluem exemplos demonstrativos. A implementação operacional depende da aprovação técnica aplicável.

### 5.8 Relatórios e documentação técnica

- [ ] Confirmar modelos oficiais e versões da LVT, relatórios, certificados e BOOK.
- [ ] Gerar PDFs com identificação, evidências, medições, recomendações e rastreabilidade.
- [ ] Implementar numeração, revisão, anexos e snapshot de emissão.
- [ ] Implementar conferência, revisão técnica e correções.
- [ ] Integrar assinaturas efetivas e sua verificação.
- [ ] Liberar e registrar entrega ao cliente.
- [ ] Detalhar cadastros e fluxos especializados de NR-13 e certificação de válvulas.

### 5.9 Fernet e arquivos privados

- [x] Dependência `cryptography` instalada.
- [x] Leitura de `FERNET_KEY` adicionada aos settings informados.
- [x] Orientação para fornecer chave exclusiva de testes ao CI.
- [ ] Escolher quais campos serão criptografados.
- [ ] Implementar a criptografia e a descriptografia nos caminhos de leitura e escrita.
- [ ] Definir impacto nas buscas, validações, exportações e logs.
- [ ] Planejar migração dos valores já existentes, caso haja dados nesses campos.
- [ ] Definir cópia segura, recuperação e rotação das chaves.
- [ ] Configurar storage privado e autorização para fotos/documentos.
- [ ] Validar integridade, MIME e tamanho dos uploads.

Os models consultados ainda usam campos legíveis. A chave nos settings é uma dependência da futura integração de criptografia.

### 5.10 Auditoria, concorrência e sincronização

- [ ] Preencher atores e registrar AuditEvent na transação de cada alteração relevante.
- [ ] Implementar comparação e incremento de `version` para impedir sobrescrita concorrente.
- [ ] Implementar idempotência com OperationReceipt e validação do payload recebido.
- [ ] Definir as operações disponíveis offline.
- [ ] Escolher e preparar a tecnologia dos aplicativos mobile/desktop.
- [ ] Implementar banco local, pacotes de trabalho, fila de envio e estado de sincronização.
- [ ] Implementar conflitos, revalidação de permissões e retomada de anexos.
- [ ] Definir tratamento de exclusões e retenção local.

### 5.11 Dados e IA

- [ ] Definir indicadores, fontes, períodos e fórmulas de avanço, backlog e curva S.
- [ ] Implementar consultas, processamento pandas e exportações.
- [ ] Selecionar usos assistivos de IA e amostras para avaliação.
- [ ] Definir provedor, custos, privacidade e revisão humana.
- [ ] Integrar IA aos fluxos aprovados e manter rastreabilidade das sugestões.

### 5.12 Implantação e operação

- [ ] Definir ambiente de homologação, VPS/provedor, domínio, porta e diretório.
- [ ] Exercitar a publicação no GHCR pela main.
- [ ] Implementar deploy com imagem identificada por versão/commit.
- [ ] Configurar Gunicorn, proxy HTTPS, estáticos e mídia privada.
- [ ] Definir execução de migrations, backup e recuperação durante deploy.
- [ ] Configurar monitoramento e alertas.
- [ ] Testar restauração do banco e dos arquivos.
- [ ] Inventariar e ensaiar migração do acervo legado.
- [ ] Homologar com a engenharia e usuários do piloto.
- [ ] Planejar corte, treinamento e acompanhamento inicial.

## 6. Premissas de modelagem a confirmar

| Premissa adotada no código entregue | Confirmação necessária |
|---|---|
| TAG única por organização, ignorando maiúsculas/minúsculas | Confirmar repetição entre unidades/clientes e necessidade de retagging |
| Identidade do ativo preservada nos contratos | Definir movimentações de unidade/sistema e seu histórico, caso necessárias |
| Uma RTI por Recommendation concreta | Definir como agrupar ou distinguir recomendações repetidas |
| Inspection com várias InspectionExecution | Confirmar marco de prazo e processo de correção em retornos |
| MeasurementPosition reutilizável | Confirmar identificação e orientação oficiais dos pontos |
| Usuário Django já configurado | Confirmar forma de login e regras de convite/perfil |
| Documentos especializados representados inicialmente por tipos | Detalhar os dados de NR-13, válvulas e BOOK com a engenharia |

## 7. Ordem proposta para continuar

1. Manter os 31 testes aprovados como verificação a cada alteração na `develop`. A organização e a execução no PostgreSQL estão concluídas.
2. Confirmar o banco local e aplicar a migration no ambiente de desenvolvimento.
3. Validar manualmente os cadastros da hierarquia operacional no Admin inicial já registrado.
4. Implementar autorização, autoria e auditoria para o primeiro fluxo.
5. Criar as primeiras APIs e telas de cadastro.
6. Evoluir para contratos, projetos, campanhas e inspeções planejadas.
7. Implementar catálogo, execução, evidências e abertura automática de RTI.
8. Integrar risco, prazos e cálculos após as decisões técnicas pendentes.
9. Implementar revisão, assinatura, emissão e entrega.
10. Evoluir offline, análises, IA e implantação por entregas aprovadas.

Essa sequência é uma proposta de prioridade para o próximo ciclo. O cronograma final deve considerar a disponibilidade real do desenvolvedor e o retorno da engenharia.

## 8. Arquivos e entregas de referência

| Entrega | Finalidade |
|---|---|
| `Pires_Integrity_Plano_Diretor_Desenvolvimento_v1.pdf` | Planejamento inicial para aprovação |
| `ANALISE-MODELS-DJANGO.md` | Análise das entidades e do legado |
| `Pires_Modelo_ME_Extrato_Rev06.pdf` | Referência demonstrativa de medição e memória de cálculo |
| `Pires_Modelo_Visual_Extrato_Rev06.pdf` | Referência demonstrativa de achados, fotos, recomendações e RTIs |
| `Pires_Models_Django.zip` | Models, 26 testes e instruções de integração |
| `Pires_CI_CD_Passo_a_Passo.zip` | Workflow, arquivos de apoio e roteiro de aprendizado |
| `tests/tests_models.py` | Localização acordada para os 26 testes dos models |
| `tests/test_ci.py` | Localização acordada para os 5 testes de inicialização e healthcheck |
| `tests/__init__.py` | Pacote Python para descoberta e importação dos testes |
| `sistema_pires/migrations/0001_initial.py` | Estrutura inicial versionada do banco Django |

## 9. Critério para atualizar este registro

Marcar uma tarefa como concluída quando houver código ou entrega correspondente e evidência de validação. Registrar o commit e o resultado de teste/homologação quando aplicável. Para atividades feitas somente no computador local, indicar a confirmação recebida até que o push permita verificá-las no repositório.
