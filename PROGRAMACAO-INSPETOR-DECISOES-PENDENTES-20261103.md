Programação do inspetor — decisões pendentes em 03/11/2026

Requisito confirmado: inspetor vê sua programação e atividades/sistemas/TAGs
atribuídos, por tenant e contrato, em visão do dia ou do período de trabalho.
Isso precisa valer no servidor para consultas, mutações, relatórios e anexos,
com revalidação de identidade, atribuição, escopo e revogação.

Proposta nova recebida, aguardando confirmação: offshore por embarque;
onshore por campanha do contrato, com período/equipe definidos pela gestão
e atribuições individuais. Não foi transformada em regra de calendário,
expiração ou autorização temporal neste recorte local.

| Organização proposta | Aderência atual | Decisão necessária |
|---|---|---|
| Onshore por campanha do contrato | Atividade já referencia contrato/campanha e TAG; a checagem atual recusa atividade retirada desse escopo. | Confirmar que essa campanha é o programa operacional, quem define equipe/período e como reprogramar. |
| Offshore por embarque | Não há entidade de embarque operacional integrada ao controle de acesso. | Definir identidade do embarque, vínculos ao contrato/campanha, equipe, datas efetivas/planejadas e alterações. Não inventar tabela ou usar texto do cliente como regra. |
| Visão do dia/15dias | Pode ser recorte de navegação da programação aprovada. | Confirmar se é só visualização ou fronteira de autorização, início/fim inclusivos, fuso, alterações e rascunhos fora do período. |

Um profissional na equipe do embarque/campanha não deve ganhar todas as
atividades do grupo. O conjunto permitido continua a interseção de tenant,
contrato, programa atual, vínculo vigente e atribuição individual. Mesma TAG
em contratos distintos não mistura programação, evidência ou execução.
Gestor mantém suas capacidades próprias; consulta de planner/assistant já
autorizada permanece somente leitura, sem receber gravação administrativa.

Preservar IDs e histórico quando período, equipe ou programação mudarem.
Não apagar inspeções, RTIs, fotos ou desenhos ao encerrar embarque/campanha.
Retomada de rascunho fora do período exige regra explícita ou reprogramação
auditada; não conceder exceção escondida para fazer a interface funcionar.

Antes de ativar política temporal, implementar/testar datas faltantes,
inválidas, início/fim, mudança de fuso, atividade sem programa, programas
simultâneos, reatribuição/revogação durante save/upload/download e tentativa
de ampliar datas por URL/RPC. A resposta deve seguir o período autorizado
no servidor, sem confiar no filtro do navegador.

O trabalho local atual implementa a restrição por atribuição e fecha rotas
genéricas para o inspetor. Não afirma que período/embarque esteja implementado.
Nenhuma permissão, política temporal, banco ou projeto remoto foi alterado.
