# Ativação futura em produção — plano de revisão

Este documento acompanha o mesmo PR da execução de inspeções. **Não é migração executável, autorização de aplicação ou declaração de publicação.** A autorização geral de publicar já existe; mudanças específicas de banco/ACL/acesso ainda precisam de plano imutável e aprovação.

## Preservar e aproveitar a base existente

Reutilizar Gestão, Equipe completa, profissionais/usuários, owners, contratos/campanhas/TAGs, originais, versões, recibos e auditoria. Não aplicar bootstrap/seed/reset/restore integral ou converter cadastros de exercício em técnicos qualificados.
O administrador pretendido do piloto foi confirmado; faltam inspetor(es),atividades/contrato e janela técnica aprovados.
O bucket privado de fontes já possui configuração compatível. **Não é necessário alterar bucket/policies/grants de Storage** para este recorte; preservar também o bucketEquipe e seus objetos.

## Delta de banco e ACL a preparar

A produção não tem inspection_catalogs,inspection_catalog_bindings,inspection_executions nem as funções de execução por atribuição.
Preparar delta aditivo com três tabelas novas,17 funções privadas,endpoint estreito de foto (ausência/precondições a reconfirmar) e substituição do wrapper público preservando assinatura.
Reutilizar as 15 dependências runtime atuais; não copiar funções do composto mínimo homolog por diferença de hash nem reduzir a tabela completa de profissionais ao schema mínimo.

O candidato retira somente EXECUTE direto authenticated dos quatro dispatchers privados legados, conserva canal autenticado validado e restringe registro de fotos ao servidor.
Conferir herança/defaultACL e acesso efetivo antes/depois. Não conceder acesso direto a tabelas privadas ou abrir POSTs globalmente.
Esta auditoria acrescenta uma correção do corpo de ga_api_execution para preservar RTIs encerradas; não acrescenta tabelas,roles ou grants.

Confirmar constraints/índices/FKs/assinaturas/hashes/ACL e consumidores legados antes de gerar migração.
Rascunhos antigos sem binding ficam preservados em leitura; não selecionar catálogo automaticamente para fazer o fluxo passar.
Não aplicar o script completo inspection-execution.sql ou MINIMAL-INSPECTION-SLICE.review.sql sobre produção.

## Bloqueios antes da ativação

1. **Backup restaurável comprovado:** cobertura de banco/Auth/roles/configuração e bytes do Storage, destino privado autorizado, checksums e restauração ensaiada em destino isolado. Plano Free/saúde/migrações/hashes não provam esse backup.
2. **Artefatos anteriores recuperáveis:** frontend servido atualmente,headers/runtime e bundleEdge anteriores com composição privada preservada. O recibo de 28/10 e hash remoto não permitem republish por si mesmos. JSONs privados vazios locais não podem substituir os preparados produtivos.
3. **Ensaio conectado:** origemHTTPS isolada, Edge/JWT/CSP, identidades reais autorizadas, foto/catálogo/documento válidos, dataset mínimo, duas sessões e testes negativos/retomada/revogação/conflito.
4. **Compatibilidade:** versão antiga sobre banco aditivo,combinações transitórias,versão nova,retorno. SQL mínimo já instalado na homolog não substitui ensaio do delta sobre baseline produtiva equivalente.
5. **Fonte/catálogo:** materialização,curadoria,aplicabilidade e pin por atividade; matriz permanece minuta,prazo manual justificado. Dados reais não podem ser substituídos porfixtures apresentadas como operação.
6. **Candidato e aprovação:** commit/hashes/SQL/ACL/alvos/impacto/locks/abort/rollback definidos; aprovar especificamente migração e acessos nominais. Eventual exportação privada,clone/custo e mudançasAuth precisam de seus escopos próprios.

## Ordem e retorno

Após os gates e aprovações: deltaDB verificado → Edge verificada → frontend → smoke com titular/inspetor aprovados e observação.
Não há switch atômico comprovado; não inventar toggle ou desligar autenticação para contornar incompatibilidade.
Na falha, interromper somente o piloto pelo mecanismo previamente aprovado e reverter UI/Edge por artefatos ensaiados, preservando tabelas,registros,fotos,RTIs,catálogos/bindings e histórico.
Não restaurar snapshot antigo automaticamente, apagar dados ou reabrir ACL legada para fazer rollback funcionar.
Restore produtivo real exige decisão específica sobre indisponibilidade,ponto de recuperação e possíveis perdas.

## Dados e segurança recebidos da auditoria paralela

Grupos deTAG semelhantes têm diferenças na fonte de localização,isométrico/extremidades e inconsistências textuais: preservar registros e campos originais; não mesclar,excluir ou impor unicidade global por TAG.
ÍndicesFK,policies com avaliaçãoAuth e proteção de senha são revisões separadas,com evidência de equivalência/impacto/custo e aprovação específica.
RLS sem policy em schemas privados pode ser intencional e não deve ser relaxada.
Os detalhes operacionais/fingerprints e aprovações permanecem nos artefatos privados de planejamento,sem cópia de conteúdo/identidades de cliente no repositório.

Nenhum requisito pendente de relatório PLH/assinatura/emissão,isométrico integrado ou matriz aprovada passa a pronto por estas correções locais.
