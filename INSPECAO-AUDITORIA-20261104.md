# Auditoria do fluxo de inspeção — 04/11/2026

Esta revisão continua o PR #1 a partir de c133680b70aa6f0415eca2acdeaf41f0fad8d71c. Não houve merge, publicação, alteração remota de banco/ACL/Storage, login, mudança de identidade ou gravação em dados reais.

## Base e relação com a publicação

A branch padrão main está em 61444f51160c908b17de4a6eb9e271d728a5461a: cópia portátil antiga,68 arquivos, sem Gestão/Equipe.
Isso não descreve o PR: sua base codex/equipe-acessos-20261028 está em 6093ff37b10dd2246501ed790c8b0ab498508457,194 arquivos, com Gestão/Equipe.
O head anterior c133 tem 248 arquivos e inclui o novo fluxo. A revisão foi feita em worktree isolada derivada desse head; main,base,PR original e pastas anteriores foram preservados.

A base6093 tem recibo de 60/60 arquivos frontend coincidentes em 28/10. Os bytes públicos atuais não foram revalidados.
A leitura oficial de04/11 encontrou gestao-api produtiva v6, atualizada em 27/10; o download integral do bundle falhou. Não é prova de equivalência integral com o repositório.
A produção não contém as três tabelas/funções centrais do novo fluxo; a homologação tem o SQL c133, mas não a Edge Gestão. Esta revisão não foi instalada nesses ambientes.

## Falhas reproduzidas e corrigidas

| Falha | Antes | Depois / regressão |
|---|---|---|
| P1: rascunho altera RTI encerrada | Mantendo recommendationId/photoIds, execution.save podia mudar data, condição e ponto, mantendo encerramento e evidência anteriores. | Conferência semântica antes de alterar item/ponto/achado. Mudança exige revisão técnica e provoca rollback integral; saves iguais/replay não reescrevem RTI/achado/item/ponto/prazo/histórico. Sete regressões novas, incluindo outro item e legado. |
| P2: cobertura multiline bloqueia relatório | Textarea/SQL aceitavam LF/CR/TAB, mas freeze do relatório rejeitava e impedia PDF individual do registro salvo. | Helper aceita esses separadores legítimos, preservando texto/cobertura/fotos e rejeitando os demais controles. Regressão Edge→SQL→recarga→freeze→PDF; desktop/mobile. |
| P2: JPEG sem dados satisfaz foto obrigatória | Arquivo com SOF/SOS/EOI, mas scan vazio, era aceito; upload e boas condições retornavam200. | Scan exige dados de imagem, sem contar restart/fill como pixels. Rejeição ocorre antes do Storage/registro; boas condições sem foto segue bloqueada. Baseline/progressivo/bytes escapados/restart preservados com imagens sintéticas válidas. |

A validação JPEG continua estrutural; não é decodificação integral nem prova de que a fotografia mostra a linha inspecionada.
Nenhum fluxo fictício de reabertura/PLH/aprovação/assinatura foi acrescentado. Relatórios continuam rascunhos, canIssue=false.

## Validação consolidada da revisão

- npm test:386 testes, **383 pass / 0 fail / 3 skip**,0 cancelled. Os três skips dependem de originais privados ausentes.
- npm run check: **146 arquivos JavaScript**, sintaxe e verificação de padrões de credenciais aprovadas.
- Navegador: **72 pass / 0 fail**, desktop/mobile. Sete casos com UI→Edge→SQL(PGlite) reais locais; 63 regressões anteriores com HTTP/Auth simulados; dois casos novos de cobertura multiline com HTTP/Auth simulados.
- Testes direcionados dos três achados também passaram; fazem parte do consolidado e não devem ser somados como provas independentes.
- Baseline c133 preservado:374 testes, 371 pass / 0 fail / 3 skip. Evidências antes/depois e hashes dos arquivos sob teste mantidos localmente.
- Nenhuma instalação de programa/navegador: utilizados Node/dependências e Chromium/Playwright já existentes.

Auth/JWT/licenciamento/Storage/transporte são fixtures locais; PGlite serializado não prova concorrência entre sessões Postgres independentes.
Capturas/PDFs são sintéticos e de rascunho. Não houve uploadLibrary, emissão técnica, assinatura ou envio a cliente.
A revisão técnica examinou os caminhos de planejamento/atribuição,execução/fotos/RTI,escopo/relatórios e seus testes; não equivale a certificação de segurança ou homologação de produção.

## Matriz de evidência e pendências

| Etapa | Demonstrado localmente | Limite para operação real |
|---|---|---|
| Atribuição e navegação | Gestor/inspector distintos, Minhas inspeções, rota da atividade, escopo removido e contrato/TAG | Piloto produtivo de inspetor e login real não testados; política temporal ainda pendente. |
| Catálogo/checklist | Pin explícito/versionado, escolhas por item sem conformidade padrão, ausência encaminhada à gestão | Catálogo real aplicável precisa de materialização/curadoria aprovadas. |
| Rascunho/fotos | Mesmo registro após retomada/retry, versão/conflito, imagem inválida negada, foto de outro escopo negada | Storage/Auth reais e duas sessões independentes não homologados; órfãos privados precisam de reconciliação. |
| Boas condições | Foto/cobertura obrigatórias, trecho parcial preservado, zero RTI | Cobertura física real depende do inspetor; fotografia não prova linha integral automaticamente. |
| Tratativa/RTI | MesmaRTI, origem/vínculos, histórico/retirada, encerrados protegidos | Painel hierárquico completo e gestão técnica continuam requisitos separados. |
| Relatório | Rascunho individual por TAG, visual/espessura separados, isolamento de contrato e fontes | Revisão/devolução/aprovaçãoPLH,assinatura e emissão continuam não implementadas. |
| Desenho | Protótipo local e referências de campo declaradas preservados | Geometria/isométrico operacional, carimbo final/asbuilt aprovado e coordenadas físicas não integrados. |
| Prazo/risco | Data da inspeção é marco; preservação do prazo manual/revisão | Matriz minuta não ativa vencimento automático. |

Auditoria paralela da fonte confirmou diferenças entre grupos deTAG: não mesclar nem sobrescrever localizações/isométricos/extremidades ou divergências textuais da fonte.
Alertas Advisor de índices/Auth/policies exigem candidatos separados e aprovação específica; não relaxar RLS privada ou alterar produção para eliminar alertas.
