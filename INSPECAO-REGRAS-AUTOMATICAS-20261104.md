# Recomendações e regras vinculadas automaticamente

O inspetor seleciona a condição e a recomendação pré-definida do item da LVT. Ao salvar uma tratativa, o servidor resolve o vínculo curado por **item + condição + recomendação**, preservando o texto original e registrando a mesma orientação no item, achado e RTI. Não há um segundo seletor manual de regra nem entrada do inspetor na Gestão de RTI.

O vínculo faz parte do catálogo explicitamente selecionado e fixado para a inspeção. Cada referência tem identidade, versão e SHA-256; a evidência de aplicabilidade precisa corresponder às fontes exatas das duas escolhas. O registro não busca a tabela mais recente por cliente e não usa palavras, semelhança de TAG, correção automática de grafia ou classificação por fotografia.

As orientações explícitas de corrosão permanecem separadas das faixas por pontuação: leve, tratar/pintar 6–12 meses; média, tratar/pintar 3–6 meses; severa, substituir 1 dia; urgente, substituir imediatamente, com disposição operacional sujeita à avaliação e autoridade competentes. A recomendação específica da LVT não é substituída pela orientação genérica. Nenhum nível é convertido em PoF, CoF ou pontuação.

## Pendências e histórico

Sem vínculo único e conferido, a orientação fica pendente ou em conflito. A tratativa continua abrindo a mesma RTI para acompanhamento do gestor, com origem e recomendação preservadas. N/A, Sem Visual, ausência, intensidades mistas e erros da fonte não recebem uma regra por aproximação. Um conflito não vira ausência de recomendação.

Condições e recomendações são transmitidas por seus IDs; o servidor rejeita orientação, referência ou prazo fabricado no payload do inspetor. Replay, falha de persistência, revogação e isolamento por contrato/tenant continuam protegidos. Retirada de recomendação e RTI encerrada preservam a orientação histórica; a seleção atual vazia não apaga sua origem. Catálogos e conferências antigas não recebem backfill silencioso.

Uma nova tabela ou versão não deve reinterpretar a inspeção já fixada. Referências conhecidas são mantidas por versão; suporte a uma versão nova exige implementação explícita, sem substituir a anterior.

## Relatório e prazo

O rascunho individual valida as projeções salvas e mostra separadamente a recomendação LVT, a orientação vinculada, sua referência/versão/hash e a faixa. Os mesmos IDs de item, ponto, foto e RTI são preservados. Conferências antigas continuam com o conteúdo congelado original.

Vínculo automático da orientação não equivale a vencimento calculado ou aprovação técnica. A data final declarada da inspeção é o marco. Intervalos não recebem uma duração escolhida automaticamente; meses não viram 30 dias; 1 dia não vira 24h; imediato não vira 0h. Calendário, horário real de fim, contagem em horas, duração única e critérios de risco ainda precisam das decisões aplicáveis. A regra e a faixa são registradas automaticamente; a data limite permanece ausente quando não há regra determinística suficiente.

## Curadoria e entrega

`lib/rti-guidance-registry.cjs` fornece o registro conhecido e o compilador de vínculos explícitos. O manifesto usa os IDs e as fontes esperadas das escolhas; a compilação preserva textos, é imutável e idempotente. Vínculos conflitantes continuam visíveis. Isso permite preparar os dados uma vez na curadoria e resolver automaticamente cada seleção em campo.

O código não instala os 509 registros reais por conveniência. As linhas e os conflitos da fonte precisam ser materializados, conferidos e vinculados ao procedimento/equipamento correto. Os testes usam fixtures isoladas; não demonstram catálogo real instalado, Auth/Storage reais, revisão/assinatura PLH ou emissão técnica. Esta continuação não aplica migração nem publica o aplicativo.

## Validação

Suíte consolidada: **478 testes, 475 pass, 0 fail, 3 skip**, nenhum cancelado; check em **155 arquivos JS**. Navegador UI→Edge→SQL→PDF: **11/11**, incluindo seleção exata sem outro seletor manual, recarga/replay, conflito preservado e inspector sem Gestão RTI. PostgreSQL 17.11 com sessões independentes: **4/4**, cobrindo concorrência/idempotência, rollback sem orientação órfã, revogação e retomada de v1 aberta após avanço do ponteiro atual. Os níveis se sobrepõem e Auth/JWT/licenciamento/Storage permanecem fixtures.
