Gestão RTI — requisito confirmado em 03/11/2026

Status: requisito e avaliação de aderência. O painel descrito abaixo não foi
implementado por este documento e não está publicado. O trabalho corrente de
autorização por atribuição e catálogo deve continuar sem abrir outros acessos.

Navegação confirmada

Contrato e seus KPIs → sistema → TAGs com RTI → tratativas individualizadas.
Dentro de uma TAG podem coexistir tratativas da tubulação, flange, válvula e
outros componentes efetivamente registrados. Agrupar por TAG é apresentação;
não funde RTIs nem transforma várias recomendações em uma ocorrência única.

Cada tratativa deve preservar ID próprio, componente/item, achado, ponto,
foto(s), inspeção de origem, data em que a inspeção foi feita, classificação
de risco, prazo, status, responsável e histórico. Campo ainda não informado
permanece pendente, sem valor presumido ou conformidade automática.

Aderência ao modelo existente

- Os registros de RTI já têm identidade distinta por execução/item, vínculos
  à TAG, contrato, inspeção, achado, referência de campo e fotos; edição e
  repetição reutilizam a mesma identidade. O histórico de retirada é preservado.
- Itens diferentes de uma TAG podem produzir RTIs diferentes. O limite atual
  continua uma escolha de recomendação e uma referência de campo por
  execução/item. Várias tratativas independentes no mesmo item/ponto exigem
  evolução explícita de modelo e idempotência; este requisito não a implementa.
- A fila de RTI atual não é o painel hierárquico novo. Sua reorganização,
  responsável operacional por tratativa e KPIs precisam de implementação e
  validação próprias, preservando documentos e RTIs existentes.
- A classificação de risco e o prazo não vêm do texto da recomendação.
  A matriz Pires continua minuta; prazo manual justificado é preservado e
  a data da inspeção é o marco. Não criar categorias ou vencimentos automáticos.
- Referência de campo não representa posição isométrica validada. Desenho,
  revisão e posição permanecem pendentes quando não vinculados de fato.

Regras para a preparação do painel

Usar tenant, cliente, contrato, sistema e ativo por IDs canônicos. TAGs e
sistemas de mesmo nome em contratos distintos não podem ser misturados.
Cada nível deve contar/listar as mesmas RTIs distintas do recorte autorizado,
com retorno à inspeção/item/foto de origem, preservando múltiplas ocorrências.

KPIs precisam de definições revisáveis antes de serem apresentados: universo,
data de referência, status considerado, exclusões e base de prazo. Distinguir
tratativa aberta para acompanhamento de confirmação da condição física atual.
Prazo ausente ou pendente não entra como “em dia”; status histórico da fonte
não prova abertura ou encerramento atual. Gerar relatório não encerra RTI.

Gestor usa suas capacidades administrativas por escopo. O painel amplo não
será concedido ao inspetor: ele permanece limitado à programação própria e
às atividades, sistemas e TAGs atribuídos, com proteção de servidor também
em consultas, relatórios e anexos. Agrupar por cliente não amplia autorização.

Validação necessária na implementação futura

Uma TAG com três componentes deve mostrar três tratativas e seus históricos
separados; repetir salvar/editar/recarregar não duplica nenhuma. Contratos e
sistemas homônimos permanecem isolados. Soma dos KPIs deve reconciliar com
os IDs listados, sem duplicar por fotos, anexos ou versões. Prazo/risco
ausentes ficam explícitos. Revogação, acesso de outro inspetor e URLs/RPC
diretos devem continuar bloqueados. Nada deste documento autoriza migração,
alteração de permissões ou publicação em produção.
