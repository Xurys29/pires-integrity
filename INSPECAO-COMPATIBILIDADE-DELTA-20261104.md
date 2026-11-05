# Compatibilidade Edge e delta de inspeção — 04/11/2026

Esta revisão continua o PR #1 sobre 3a070575c1f2089bd1ec2c585620114994bdc36d.
Não houve publicação, aplicação de SQL em produção/homologação, alteração de acesso nominal ou gravação em dados reais.

## Correção de negociação com o banco

A Edge anunciava execução v1 sem confirmar que o SQL instalado possuía as guardas correspondentes.
Na combinação Edge nova + SQL antigo, uma rota de relatório por contrato recebia HTTP 200, mas o SQL ignorava contractId e incluía um ativo de outro contrato na fixture.

Agora a Edge exige **inspectionScopeVersion===1 e inspectorWorkspaceVersion===1**, ambos numéricos, antes de anunciar execução/área do inspetor ou encaminhar novas rotas de execução e relatório contratual.
Sem esse contrato, retorna 503 inspection_backend_unavailable antes do RPC de negócio, processamento de foto ou gravação.
Status sem empresa selecionada não anuncia uma capacidade de execução presumida.
Consultas legadas de gestão/planner/assistant permanecem disponíveis; a checagem não amplia permissões nem filtra relatório incorreto no cliente.

## Matriz local

| Edge | Banco | Resultado |
|---|---|---|
| Antiga | Antigo | Fluxo legado de gestão/consulta funciona; execução nova indisponível. |
| Antiga | Novo | Consultas legadas de gestão preservadas; não serve para ativar inspetor: o código antigo ainda inclui nomes de fontes preparadas no status da fixture. |
| Nova | Antigo ou parcial | Gestão legada preservada; capacidades novas desativadas e rotas novas negadas antes do RPC. |
| Nova | Novo | Execução por atribuição, foto, salvamento/retry e RTI única demonstrados localmente. |

A ordem necessária é **DB → Edge → frontend → piloto de inspetor**. Não conceder o piloto durante a fase de Edge antiga.
Retornar Edge antiga com inspetor ativo também exige contenção nominal previamente definida; não restaurar grants privados genéricos.
O banco atualizado mantém a autoridade de escopo/contrato; o anúncio da Edge não substitui essa autorização.

## Testes

- Suíte consolidada: 390 testes, **387 pass / 0 fail / 3 skip**, 0 cancelled. Os skips dependem de originais privados ausentes.
- Sintaxe/verificação de padrões de credenciais: 147 arquivos JavaScript, aprovada.
- Matriz Edge/SQL: 20 verificações aprovadas; inclui verificações de combinações que devem ser negadas, não declara todas as combinações compatíveis.
- Navegador UI→Edge→SQL local: 7 pass / 0 fail, com desktop/mobile.
- PostgreSQL 17.11 nativo isolado: 7 cenários de concorrência/ACL mais 4 cenários do candidato SQL exato, 11 pass / 0 fail / 0 skip.
- Testes direcionados de handshake e Edge→SQL também passaram e fazem parte das provas acima; não somar como cenários independentes.

Nos testes nativos, IDs de processos PostgreSQL diferentes e espera real por Lock demonstraram:
dois starts→mesma execução; dois saves na mesma versão→um commit e 40001; retry concorrente→mesma RTI; atribuição revogada durante a espera→42501 sem execução; falha de RTI→rollback integral; ACL dos dispatchers privados e RPC geral bloqueia anon/serviço indevido, inclusive service role com BYPASSRLS.

## Candidato de banco

O SQL de execução do repositório não mudou neste commit.
O pacote privado de revisão acrescenta pré-condições de metadata, timeouts, transação e pós-validação de ACL/preservação ao recorte aditivo.
A base sintética teve fingerprint correspondente ao escopo do preflight observado: quatro tabelas relevantes, 19 definições de funções, schemas/default ACL e Equipe completa. Isso não equivale a comparar todos os schemas gerenciados do provedor.
O artefato exato foi aplicado em PostgreSQL 17.11 local: 43 tabelas anteriores e seus dados sintéticos preservados, 3 tabelas novas vazias, 18 funções novas, apenas o wrapper existente e quatro ACL previstos alterados. Reaplicação foi negada sem mudança.
O preflight do alvo real executou somente SELECT e conferiu metadata/ausência de objetos/owner; o candidato de alteração NÃO foi aplicado lá.
Fingerprints, alvos, SQL operacional e evidência de produção ficam privados, fora do GitHub.

## Limites e impacto

Auth/JWT/licenciamento e Storage são simulados, mesmo quando o motor PostgreSQL é nativo. Não há homologação de sessão real Supabase ou de arquivos privados.
A Edge antiga corresponde à fonte fornecida da publicação; seu bundle integral remoto não foi comparado.
DDL/ACL/wrapper/Edge têm efeito compartilhado; um piloto nominal não restringe todo o impacto. Locks de DDL/FKs podem bloquear gravações temporariamente.
Após novas gravações, reverter código não desfaz registros, fotos, RTIs ou histórico. O retorno deve manter dados/estruturas e controles restritos.
Os contêineres próprios de teste foram removidos. Nenhuma credencial, dado operacional de cliente, exportação ou artefato de recuperação foi criado.
