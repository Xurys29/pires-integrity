Correções de escopo e indicadores — 30/10/2026

Esta atualização corrige três falhas reproduzidas na validação local de 29/10.
O ponto de partida remoto foi conferido antes das edições:
`codex/inspecao-lvt-20261028` em
`38fe04faf986d1038c86ec1d672085b5ee5515ea`, sobre
`6093ff37b10dd2246501ed790c8b0ab498508457`.
O destino continua sendo o [PR #1 em rascunho](https://github.com/Xurys29/pires-integrity/pull/1).

| Falha reproduzida | Antes | Depois |
|---|---|---|
| Relatório por sistema ignorava o contrato | Selecionar C1 e gerar o rascunho incluía TAGs de C2 no mesmo sistema. | O contrato segue no caminho canônico da requisição até a consulta SQL. Ativos, inspeções, LVTs, itens, fotos, achados, RTIs, documentos, versões e proveniência recebem o mesmo filtro. O caminho geral anterior permanece identificado como acervo geral. |
| Evento administrativo virava relatório emitido | Uma tarefa `issuance` concluída com documento tipo `outro` gerava indicador 1 mesmo sem inspeção, LVT ou revisão. | O histórico e o progresso administrativo permanecem. A emissão técnica fica explicitamente indisponível (`value=null`, não um zero presumido). Painel e resumo executivo distinguem tarefas concluídas administrativamente de relatórios tecnicamente emitidos. Não foi criado um fluxo fictício de aprovação. |
| Fila ignorava retirada da campanha | A inspeção permanecia na fila mesmo quando a consulta direta era negada. | Listagem e consulta direta usam o mesmo predicado de contrato/campanha. Fora do escopo, a atividade fica oculta e a gravação segue negada. Seu rascunho não é apagado; restaurar o escopo permite continuar o mesmo registro. |

O filtro usa identidades, não nomes de sistemas ou textos de TAG. As regressões
cobrem contratos do mesmo cliente, ativo compartilhado, sistemas com nomes
iguais, vínculos contraditórios, escopo retirado/restaurado, recarga e rascunhos
existentes. Os testes anteriores de RTI única, fotos por item, atribuição,
persistência, erro de salvamento e modalidade de espessura foram mantidos.

Os novos GETs são `companies/{owner}/reports/contracts/{contract}/system/{system}`
e `companies/{owner}/reports/contracts/{contract}/campaign/{campaign}`.
O backend determina proprietário, contrato e alvo pelo caminho e valida os
vínculos canônicos. O frontend também confere o contrato do snapshot antes de
gerar o PDF. Não há fallback silencioso para um relatório sem contrato.

`supabase/inspection-execution.sql` permanece um candidato de revisão local,
não aplicado remotamente. As migrações históricas foram preservadas. As novas
funções auxiliares são privadas; a política existente de piloto, licença,
papéis e atribuição foi mantida. O delta de ACL dos dispatchers que já constava
no PR anterior continua candidato, sem aplicação em permissões persistentes.

Validação e alcance

| Ensaio | Resultado final |
|---|---|
| `npm test` com a suíte ampliada | 191 testes: **188 aprovados, zero falhas, 3 ignorados** por originais privados ausentes |
| `npm run check` | Sintaxe e padrões de credenciais aprovados em **111 arquivos JavaScript** |
| Navegador | **32 aprovações, zero falhas**: 10 cenários anteriores, 15 ampliados e 7 regressões das correções, em desktop/mobile |
| Focal SQL/Edge | **14/14 aprovados**, incluídos na suíte unitária: 11 grupos SQL e 3 core Edge→SQL local |
| Negativos adicionais da Edge | **7/7 aprovados** com Auth/RPC/Storage simulados; não somados ao npm test |
| Revisão independente | Nenhum bloqueador remanescente nas três correções; 57 testes de unidade/API/indicador e 14 SQL/Edge passados, sobrepostos aos testes anteriores, não somados |

Antes das correções, a suíte ampliada de 29/10 tinha 180 testes: 174 aprovados,
3 falhas de requisito e 3 ignorados. Os mesmos três cenários agora passam e
foram acrescidos casos de isolamento, compatibilidade e retomada.

PGlite executa o SQL real do candidato em banco descartável. Os ensaios que
ligam o core real da Edge ao SQL também usam Auth e transporte sintéticos em
Node; não exercitam Deno, PostgREST ou os serviços Supabase reais. O navegador
testa a interface e as requisições com APIs simuladas. Nenhum desses níveis
prova o comportamento publicado ou a autorização operacional das contas reais.

Reprodução:

```sh
npm run check
npm test
node tests/gestao-inspection-browser.cjs
node tests/gestao-inspection-validation-browser.cjs
node tests/gestao-inspection-contract-browser.cjs
```

Os testes de regressão novos são versionados junto ao PR; evidências de execução
e capturas ficam no diretório local `output/inspection-fixes-20261030/`.
O material de validação de 29/10 foi preservado em sua worktree original e
copiado para `output/inspection-fixes-20261030/before/` como evidência anterior.

Permanecem pendentes acesso operacional por inspetor, catálogo real completo
conferido, relatório individual integrado por TAG, revisão PLH e assinatura
verificável, segundo relatório integrado de espessura e isométrico com pontos.
O ciclo completo não está aprovado. A versão publicada atual e o bundle remoto
integral da Edge não foram revalidados nesta atualização; não houve nova
tentativa de acesso ao app ou de transferência de anexos.

Não houve merge, deploy, migração remota, alteração persistente de permissões,
credenciais ou dados reais, assinatura técnica, emissão técnica ou envio a cliente.
