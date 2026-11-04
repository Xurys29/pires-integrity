# Vínculo da matriz de risco e feedback técnico — revisão

Esta revisão mapeia requisitos e corrige mensagens da ficha, Gestão RTI e PDF de rascunho. Não ativa critérios, prazos, diagnósticos, assinatura ou decisão operacional.

## Lacuna de integração comprovada

O solicitante informou que a matriz Pires já foi fechada. A versão e os valores dessa decisão ainda precisam ser recuperados com evidência. O documento anteriormente examinado é uma minuta; sua existência não demonstra que seja a versão aprovada, nem invalida a aprovação informada.

No código atual, achado, RTI e rascunho não carregam identidade/revisão/hash de política, regra aplicada, avaliação aprovada ou calendário da matriz Pires. O vínculo com a matriz **não está implementado**. Instalar estruturas SQL de execução não instala essa política.

`observedOn` alimenta `deadlineAnchor` com evento inspection_performed, data declarada, inspeção, execução e versão; o SQL o preserva no achado/RTI e histórico. A data do salvamento e a data planejada não substituem essa data. Alteração relevante preserva o prazo manual anterior e marca revisão; não recalcula vencimento.

`rtis.update` aceita data manual com evidência/justificativa e registra ator/histórico, mas ainda não exige decisão estruturada vinculada ao marco/versão da inspeção. Não valida coerência do prazo com o marco e não oferece resolução explícita de deadlineReviewRequired. Isso requer alteração própria de servidor, revisão e testes; não foi alterado neste recorte.

A calculadora antiga usa perfil pi-risk-matrix-v1 indicativo e não está ligada ao fluxo Gestão. Seu cálculo não equivale à matriz Pires informada. Textos de recomendação e requiresTreatment também não determinam classe de risco ou prazo.

## Correção segura realizada

As telas e o rascunho passam a informar **versão e regra não vinculadas ao registro**. A mensagem anterior afirmava aprovação pendente da matriz em geral, sem distinguir a decisão empresarial da lacuna no software. Prazo manual, histórico e data da inspeção continuam separados; nenhum valor ou regra de cálculo foi acrescentado.

## Próximo recorte da matriz, após identificar a decisão efetiva

1. Registrar documento/revisão/hash, escopo, vigência e evidência da aprovação informada; preservar versões anteriores. Não exigir repetir a decisão já tomada: recuperar sua referência e conteúdo exato.
2. Mapear as regras efetivamente aprovadas, incluindo critérios de entrada, unidade, classificação, prevalência, faixas, duração determinística, calendário, marco e autoridades. Não completar ambiguidades por inferência.
3. Vincular cada avaliação a essa versão e à evidência/medição aplicável; distinguir rascunho, avaliação técnica e aprovação competente. Preservar avaliação anterior quando a política mudar.
4. Projetar na RTI e relatório a regra, versão, fundamento, marco e prazo aprovado, separando-os do texto de recomendação e de datas históricas/manuais. Alterações relevantes exigem revisão explícita, sem fechar RTI ou emitir relatório automaticamente.
5. Testar fronteiras, lacunas, política errada por contrato/equipamento/procedimento, falta de evidência, alteração/revogação e recálculo controlado. Cálculo não deve transformar ausência de dado em risco baixo.

Sem a referência, não há valores seguros para instalar. Esta revisão não usa exemplos do feedback, prazos históricos ou a minuta como substitutos da decisão informada.

## Feedback PLH — mapeamento para proposta técnica

| Requisito | Situação atual | Alteração proposta e confirmação necessária |
|---|---|---|
| F.02: intensidade de corrosão | Seleções textuais do catálogo; não há medida/classe estruturada própria. | Metadados versionados por item/procedimento e definição técnica das classes. Não inferir intensidade de foto ou converter classe em prazo sem regra confirmada. |
| F.03: corrosão alveolar e profundidade com profundímetro | Não há campo próprio. As leituras existentes pertencem à atividade separada de medição de espessura. | Capturar tipo/local da medição, instrumento, unidade, valor e evidência conforme procedimento validado. Confirmar significado/aplicabilidade de F.03 e não reutilizar leitura de espessura como profundidade de cavidade. |
| Fotos numeradas e nota rastreável de RTI | Item/ponto/inspeção/TAG/foto/RTI possuem IDs; a legenda atual usa ID da foto. | Numeração editorial estável por revisão, ligada aos mesmos IDs e sem inventar localização; nota técnica separada da frase original e do prazo, com autoria/histórico. |
| Urgência, substituição imediata, interdição ou remoção por risco iminente | Não existem decisões técnicas estruturadas no checklist. Texto de catálogo ou ação manual não representa ordem operacional. | Registrar alerta, fundamento, evidência, encaminhamento e decisão da autoridade competente. Não emitir diagnóstico, interdição ou liberação automática. Confirmar critérios e quem pode decidir. |
| Recomendar END pelo avaliador | Não há fluxo específico de avaliação/solicitação. | Registrar recomendação/necessidade de avaliação complementar; modalidade, procedimento e critério dependem do responsável técnico. Não selecionar por palavra-chave. |
| Prazos sugeridos no feedback | Leve 6–12 meses; média 3–6 meses; severa 1 dia; urgente imediato foram relatados como proposta. | Confrontar com a decisão efetiva da matriz Pires; não instalar esses valores por conveniência. “Imediato” precisa de semântica operacional e autoridade confirmadas, sem conversão inventada em horas. |

## Arquivos afetados em futura implementação estruturada

- Ficha visual: app/gestao-inspection.js, controles de itens e escolhas.
- API/SQL: normalização estrita das respostas em supabase/inspection-execution.sql. Campos adicionais somente no frontend seriam rejeitados; qualquer persistência nova precisa de revisão do contrato e delta próprio.
- RTI: acompanhamento em app/gestao-workflow.js e projeção em app/gestao-flow.js; servidor deve registrar decisão/marco/versões com concorrência e autorização.
- Rascunho individual: projeção/validação/digest e renderização em app/gestao-tag-report.js. Numeração de fotos, notas e avaliação técnica devem ser preservadas por revisão.

Nenhuma dessas propostas constitui procedimento validado, assinatura PLH, relatório emitido ou regra de vencimento ativa. O ciclo técnico completo e os testes autenticados permanecem pendentes.
