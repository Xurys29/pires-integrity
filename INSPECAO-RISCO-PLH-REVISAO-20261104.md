# Vínculo da matriz de risco e feedback técnico — revisão

Esta revisão implementa controles locais de datas, decisão manual de prazo e fotografias numeradas, além de referências rastreáveis das orientações recebidas. Não ativa cálculo de risco/vencimento, diagnóstico, assinatura ou decisão operacional. As mudanças posteriores ao delta já aplicado permanecem candidatas, sem nova aplicação remota.

## Lacuna de integração comprovada

Foi recuperada a aceitação explícita das faixas em 21/10: 25 <24h; 20 <72h; 15–16 <14 dias; 10–12 <4 semanas; 8–9 =1–3 meses; 5–6 =3–6 meses; 3–4 =6–24 meses; 1–2 monitoramento >24 meses. Não é necessário aprovar essas faixas novamente. Elas não resolvem os critérios de PoF/CoF, prevalência CoF 5, calendário ou duração única dentro de intervalos. A minuta encontrada não é presumida como versão vigente da política completa.

No código atual, achado, RTI e rascunho não carregam identidade/revisão/hash de política, regra aplicada, avaliação aprovada ou calendário da matriz Pires. O vínculo com a matriz **não está implementado**. Instalar estruturas SQL de execução não instala essa política.

O marco definido foi especificado pelo solicitante como **data final da inspeção**, inclusive quando durar vários dias. O novo contrato guarda inspectionStartedOn/inspectionEndedOn e usa deadlineAnchor com evento inspection_completed. observedOn e o marco inspection_performed continuam históricos, sem serem reinterpretados como fim. O achado guarda separadamente findingObservedAt com fuso explícito. Horário real de fim e contagem de prazos em horas não são presumidos. A RTI continua sendo criada ao salvar a tratativa mesmo sem fim/horário, com dados pendentes; enviar a ficha exige conferi-los. Não atrasar o encaminhamento de uma condição de risco esperando o fim da TAG.

Para RTI de execução, o novo recorte rtis.update registra decisão manual com justificativa, ator, requestId, data, marco e versão. O servidor exige gestor autorizado, base exibida exata, versão atual e data não anterior ao fim declarado. Essa verificação é de datas, não prova temporal para prazos em horas. Só uma nova decisão explícita pode resolver deadlineReviewRequired; acompanhamento comum omite due e preserva decisão/revisão. Replay, revogação, conflito, RTI encerrada e falha intermediária são tratados sem reescrever o histórico. RTI legada sem execução mantém o fluxo anterior, sem marco inventado.

A calculadora antiga usa perfil pi-risk-matrix-v1 indicativo e não está ligada ao fluxo Gestão. Seu cálculo não equivale à matriz Pires informada. Textos de recomendação e requiresTreatment também não determinam classe de risco ou prazo.

## Correção segura realizada

As telas e o rascunho informam **versão e regra não vinculadas ao registro**. A mensagem anterior afirmava aprovação pendente da matriz em geral, sem distinguir a decisão empresarial da lacuna no software. lib/rti-treatment-policy.cjs registra as faixas aceitas e a orientação de corrosão em referências separadas e imutáveis, sem ativá-las como política, calcular data ou classificar risco. Não converte mês em 30 dias, troca < por ≤ ou transforma monitoramento em autorização para postergar reparo.

## Próximo recorte da matriz, após identificar a decisão efetiva

1. Registrar documento/revisão/hash, escopo, vigência e evidência da aprovação informada; preservar versões anteriores. Não exigir repetir a decisão já tomada: recuperar sua referência e conteúdo exato.
2. Mapear as regras efetivamente aprovadas, incluindo critérios de entrada, unidade, classificação, prevalência, faixas, duração determinística, calendário, marco e autoridades. Não completar ambiguidades por inferência.
3. Vincular cada avaliação a essa versão e à evidência/medição aplicável; distinguir rascunho, avaliação técnica e aprovação competente. Preservar avaliação anterior quando a política mudar.
4. Projetar na RTI e relatório a regra, versão, fundamento, marco e prazo aprovado, separando-os do texto de recomendação e de datas históricas/manuais. Alterações relevantes exigem revisão explícita, sem fechar RTI ou emitir relatório automaticamente.
5. Testar fronteiras, lacunas, política errada por contrato/equipamento/procedimento, falta de evidência, alteração/revogação e recálculo controlado. Cálculo não deve transformar ausência de dado em risco baixo.

As faixas aceitas e o marco estão registrados; faltam as decisões técnicas acima para ativação determinística. Datas históricas e recomendações específicas de uma LVT não são substituídas pela orientação genérica.

## Feedback PLH — mapeamento para proposta técnica

| Requisito | Situação atual | Alteração proposta e confirmação necessária |
|---|---|---|
| F.02: intensidade de corrosão | Seleções textuais do catálogo; não há medida/classe estruturada própria. | Metadados versionados por item/procedimento e definição técnica das classes. Não inferir intensidade de foto ou converter classe em prazo sem regra confirmada. |
| F.03: corrosão alveolar e profundidade com profundímetro | Não há campo próprio. As leituras existentes pertencem à atividade separada de medição de espessura. | Capturar tipo/local da medição, instrumento, unidade, valor e evidência conforme procedimento validado. Confirmar significado/aplicabilidade de F.03 e não reutilizar leitura de espessura como profundidade de cavidade. |
| Fotos numeradas e nota rastreável de RTI | Numeração Foto 01/02 estável no rascunho congelado, ligada a ID/versão/item; cobertura e RTI usam o mesmo mapa. | Ponto/RTI só aparecem como vínculos fotográficos quando contêm o photoId explicitamente. Nota técnica estruturada ainda pendente; não inventar localização nem alterar documentos anteriores. |
| Urgência, substituição imediata, interdição ou remoção por risco iminente | Não existem decisões técnicas estruturadas no checklist. Texto de catálogo ou ação manual não representa ordem operacional. | Registrar alerta, fundamento, evidência, encaminhamento e decisão da autoridade competente. Não emitir diagnóstico, interdição ou liberação automática. Confirmar critérios e quem pode decidir. |
| Recomendar END pelo avaliador | Não há fluxo específico de avaliação/solicitação. | Registrar recomendação/necessidade de avaliação complementar; modalidade, procedimento e critério dependem do responsável técnico. Não selecionar por palavra-chave. |
| Orientação explícita para corrosão | Leve: tratar/pintar 6–12 meses; média: tratar/pintar 3–6 meses; severa: substituir 1 dia; urgente: substituir imediatamente, com interdição conforme risco. Referência separada no módulo local. | Não mapear intensidade a score/PoF/CoF ou sobrescrever recomendações específicas por palavra-chave. Intensidades mistas, N/A e Sem Visual não viram “leve”. “1 dia” não vira automaticamente 24h; “imediato” não vira 0h nem ordem de interdição automática. |

## Arquivos afetados em futura implementação estruturada

- Ficha visual: app/gestao-inspection.js, controles de itens e escolhas.
- API/SQL: normalização estrita das respostas em supabase/inspection-execution.sql. Campos adicionais somente no frontend seriam rejeitados; qualquer persistência nova precisa de revisão do contrato e delta próprio.
- RTI: acompanhamento em app/gestao-workflow.js e projeção em app/gestao-flow.js; servidor deve registrar decisão/marco/versões com concorrência e autorização.
- Rascunho individual: projeção/validação/digest e renderização em app/gestao-tag-report.js. Numeração de fotos, notas e avaliação técnica devem ser preservadas por revisão.

O inspetor permanece na programação e no checklist digital. A tratativa abre RTI para a Gestão do gestor, com origem rastreável; a área Gestão de RTI não é liberada ao inspetor. Não há etapa obrigatória de preenchimento impresso.

Nenhuma dessas referências constitui procedimento completo validado, assinatura PLH, relatório emitido ou regra de vencimento ativa. O ciclo técnico completo, o desenho operacional integrado e os testes autenticados permanecem pendentes.

## Validação desta continuação

Suíte consolidada: **439 testes, 436 pass, 0 fail, 3 skip**, nenhum cancelado. Os skips dependem de originais privados ausentes. Check de sintaxe/padrões em **151 arquivos JavaScript** aprovado.

Navegador UI→Edge→SQL local: **9/9**, desktop/mobile, incluindo decisão manual, recarga, acompanhamento sem redefinir prazo e outro contrato da mesma TAG. PostgreSQL 17.11 com sessões independentes: **3/3**, cobrindo decisões concorrentes, data final alterada enquanto aguarda lock e revogação do gestor durante a espera. Os níveis se sobrepõem; Auth/JWT/licenciamento/Storage são fixtures, sem homologação real do aplicativo.
