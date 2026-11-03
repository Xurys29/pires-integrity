Catálogo, marco da inspeção e conferência individual — 03/11/2026

Esta revisão parte do commit remoto confirmado
`8851aca713b9c5d48f3d405107227c8e97abe58b`, no mesmo PR em rascunho.
O fluxo técnico completo continua pendente. Nenhuma matriz ou catálogo real
foi ativado e nenhum relatório real foi emitido.

Fontes conferidas e limites de acesso

| Fonte | O que foi lido | Limite |
|---|---|---|
| Catálogo sanitizado de danos e recomendações | Texto integral do JSON na Library, 14.276 linhas e 509 registros. As 15 partes lidas tinham a mesma identidade de arquivo, tamanho e data de modificação. | O original não foi materializado. O hash do XLSX informado no JSON é relatado, sem comparação local com seus bytes ou com as células da planilha original. |
| Modelo visual DOCX | Texto integral, 1.109 linhas. | Modelo de vaso de pressão; não é modelo final de tubulação. Imagens/layout não foram conferidos em pixels. |
| Relatório de espessura PDF | Texto das duas páginas, incluindo referências do ensaio e croqui. | Relatório histórico específico. Suas faixas, posições, valores e critérios não foram convertidos em regras universais. |
| Procedimento Pires de anomalias/RTI | Texto das oito páginas. | REV00, minuta não vigente. A aceitação de faixas como base não aprova a matriz completa ou sua ativação. |

Foi realizada uma tentativa oficial de materialização para cada um dos três
primeiros arquivos; todas retornaram `download failed`, sem arquivo instalado.
Não houve repetição, alteração de rede, uso direto de URL ou busca de credenciais.
A leitura textual autorizada permitiu analisar o conteúdo, mas não verificar os
hashes dos originais nem reproduzir seus layouts. Os identificadores completos
e o diagnóstico estão no artefato privado local `output/inspection-catalog-tag-20261103/SOURCE-EVIDENCE.json`.

A conferência do texto do catálogo encontrou:

- 509 origens distintas, em 12 grupos; células A:H do JSON coerentes com as linhas declaradas.
- Todos os campos de prazo em português/inglês contêm `-`.
- Uma chave Item/Condição/Dano/Recomendação repetida nas linhas 2312 e 2313; ambas preservadas.
- Duas lacunas em recomendações em inglês, nas linhas 2802 e 2902, representadas por `-`.
- Coluna I sem cabeçalho, com valores em 447 registros; nenhum significado de disciplina atribuído.

Não se transformaram 509 frases em 509 itens obrigatórios de inspeção. A
composição do checklist, sua aplicabilidade por equipamento/modalidade e a
aprovação técnica são decisões separadas. A fonte de vaso não foi aplicada às
linhas de tubulação.

Alterações implementadas

1. Revisão offline do catálogo: `lib/lvt-catalog-review.cjs` valida o JSON
   recebido e suas coordenadas, preserva textos e duplicatas, identifica lacunas
   e mantém revisão técnica, composição e aplicabilidade pendentes. O digest dos
   bytes recebidos é separado do hash relatado da planilha. O módulo não instala
   catálogo, não cria RTI e não infere prazo, classificação, disciplina ou aprovação.
   Foi testado somente com pequenas fixtures sintéticas; os 509 registros reais
   não foram instalados ou incluídos como fixture no repositório.
2. Marco do prazo: `deadlineAnchor` usa a data declarada da inspeção realizada
   (`observedOn`) e guarda inspeção, execução e versão do conteúdo salvo. Não usa
   data planejada, data atual ou emissão do relatório. Data ausente permanece
   pendente; o requisito anterior de data para salvar recomendação foi mantido.
   Achado e RTI preservam IDs/histórico. Alteração relevante conserva o prazo
   manual e sinaliza `deadlineReviewRequired`; replay e mudanças sem efeito não
   geram revisão falsa. O envio mantém o marco do último SAVE.
3. Prazo manual, prazo histórico e marco aparecem separados na Gestão RTI e no
   rascunho por sistema. A justificativa continua obrigatória no acompanhamento.
   Um prazo histórico não preenche prazo manual ou data de inspeção ausentes.
4. Conferência individual por TAG: botão secundário na execução visual salva,
   com seleção explícita de cliente/contrato/sistema/TAG/inspeção/execução. O
   código recusa contrato divergente, versões ou conteúdo alterados, foto de
   outro item e uso de uma atividade de espessura no visual. Não seleciona a
   última LVT automaticamente. A API é relida antes do download para conferir
   contexto e conteúdo; o recorte mantém fontes e versões dos registros.
5. O novo PDF é um layout genérico identificado como **RASCUNHO DE CONFERÊNCIA**.
   Número técnico, revisão técnica, aprovação PLH e assinaturas permanecem
   pendentes. UUID, versão de registro e digest não substituem essas identidades
   ou atos. O digest do conteúdo não muda apenas pela data de geração; mudanças
   de conteúdo criam outro snapshot, sem simular uma revisão assinada.

O catálogo operacional existente ainda não impede alteração privilegiada de
seu conteúdo na tabela. A nova conferência recusa divergência entre catálogo
consultado e frases/fontes efetivamente salvas e renderiza o conteúdo persistido.
Isso não constitui arquivamento imutável de um relatório emitido. Aplicabilidade,
controle de versões do catálogo e múltiplas fontes precisam ser resolvidos antes
da instalação real.

Matriz e prazo

A diretriz recebida define o marco como a inspeção realizada. Permanecem
pendentes categoria da pontuação 5, regra CoF 5, calendário, escolha dentro das
faixas, autoridade de alteração e aprovação integral da política. Não foi
ativado cálculo de classificação ou vencimento. A matriz PI legada das
calculadoras não foi usada como substituta da matriz Pires confirmada.

Validação

| Ensaio final | Resultado |
|---|---|
| `npm test` | 232 testes: **229 aprovados, zero falhas, 3 ignorados** por originais privados ausentes |
| `npm run check` | Sintaxe e padrões de credenciais aprovados em **119 arquivos JavaScript** |
| Navegador desktop/mobile | **47 aprovações, zero falhas**: 32 regressões anteriores e 15 casos de conferência individual/RTI |
| Marco e regressões SQL/Edge focais | 28/28 aprovados, incluídos na suíte agregada |
| Revisão offline do catálogo | 16/16 aprovados com pequenas fixtures sintéticas, incluídos na suíte agregada |
| Helper individual e integração SQL → PDF | 13 + 2 aprovados, incluídos na suíte agregada |

Os três testes ignorados dependem dos originais privados históricos de clientes.
Os testes usam fixtures sintéticas, PGlite com SQL real e, separadamente, APIs de navegador
simuladas. O novo ensaio SQL → recorte individual → PDF em memória confere os
dados canônicos sem equivaler a Supabase/Auth/Storage/Deno reais. PDFs de teste
são exclusivamente sintéticos; salvamento no navegador é capturado.

Um caso de escala recebeu snapshot sintético de 9,78 MB, com mais de 2.000 itens
e fotos alheios à execução selecionada. A conferência gerou somente seu item/foto
e consultou apenas a fonte selecionada. Os limites se aplicam ao recorte, sem
clonar ou validar todo o histórico do sistema como se fosse uma única TAG.

```sh
npm run check
npm test
node tests/gestao-inspection-tag-draft-browser.cjs
```

Evidências privadas locais: `output/inspection-catalog-tag-20261103/`,
`output/inspection-anchor-20261103/` e `output/tag-conference-20261103/`.
As evidências de 28–30/10 e as migrações históricas foram preservadas.

Permanecem pendentes os bytes originais/hashes, o modelo final de tubulação,
composição/aplicabilidade e ativação do catálogo, acesso operacional de inspetor,
matriz vigente, revisão/assinatura PLH, relatório técnico individual emitível,
relatório integrado de espessura e isométrico/pontos/croqui. O SQL continua um
candidato não aplicado remotamente. Não houve deploy, merge, migração de
produção, alteração persistente de permissões ou credenciais, envio a cliente ou
transferência de anexos de saída.
