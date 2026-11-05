Inspeção por atribuição e catálogo explícito — recorte local de 03/11/2026

Base de revisão: 63566cd037c7e3cb9d60306e63851a2a3bdfe8f5, na branch
codex/inspecao-lvt-20261028. SQL candidato e código preparados localmente;
nenhum projeto remoto recebeu schema, ACL, configuração, dado ou deploy.
O pacote anterior de ativação referente ao commit63566cd é histórico: seu
hash SQL e seu delta de duas tabelas não descrevem este candidato novo.

Comportamento implementado localmente

O inspetor ativo, com identidade, vínculo, licença e piloto válidos, consulta
e executa somente inspeções atribuídas a ele no tenant/cliente/contrato/campanha
atuais. Não recebe write administrativo global. Iniciar, salvar, enviar e
anexar foto são operações específicas; atribuir pessoas e selecionar catálogo
continuam capacidades do gestor. Planner/assistant conservam suas consultas
anteriores, sem nova gravação administrativa.

As rotas gerais de estado, book/histórico, relatório e fontes são recusadas ao
inspetor. Seu contexto é construído no servidor apenas das próprias atribuições;
contratos/campanhas projetam TAGs pelas atribuições de cada vínculo, sem misturar
um mesmo ativo entre contratos. A interface usa esse contexto e não tenta
consultas gerais quando o backend não anuncia o contrato de acesso restrito.

Upload e download de foto revalidam atribuição e escopo. Upload recebe execução,
item, versão e requestId antes dos bytes; conferências se repetem após validação
e Storage. Um RPC exclusivo de service_role revalida o ator e grava fonte/foto/
vínculo/recibo de maneira transacional. O ator vem da identidade conferida pelo
Edge, não do formulário. Chamadas diretas autenticadas a esse RPC são negadas.
Resposta perdida ou repetição conserva a mesma foto; mesmo requestId com outro
conteúdo/item conflita. Negativa401/403 limpa o contexto da tela.

Falha depois de armazenar bytes não é anunciada como confirmação da foto.
Os bytes privados são preservados com estado explícito e possibilidade de retry
autorizado; objetos existentes/compartilhados não são excluídos. Reconciliação
operacional/limpeza auditada e atomicidade real entre Storage e SQL permanecem
pendentes. Não se promete transação distribuída.

O gestor deve selecionar explicitamente uma versão aplicável de catálogo por
inspeção antes de iniciar visual. Confere hash esperado, modalidade, tipo de
ativo, contrato, TAG e procedimento. Não há seleção automática do catálogo mais
recente. Cada vínculo guarda snapshot integral, hash, versão, fonte, escopo e
seleção, com histórico imutável. Rebind só antes do início; não muda execução
existente. Legado sem vínculo continua legível e exige revisão/migração explícita
para voltar a editar. Espessura não é convertida em visual nem recebe esse LVT.

O relatório individual e pacote preservam o catálogo/vínculo e conferem
igualdade de metadados, corpo e ponteiros com o snapshot SQL. Hash PostgreSQL
é token de linhagem, não assinatura; não é recalculado por algoritmo JS diferente
nem usado como prova de ato técnico. Documentos continuam rascunho/canIssue=false.

Segurança e migração para revisão futura

SQL SHA256: f92c2df695f5e2c8218de6ab93030cdaff8c7ba36a5abf475ac587b0cad6d4a7.
Esse arquivo não é migração gerada/aprovada nem script repetível.
Em relação à produção inventariada, o candidato contém três tabelas privadas
(catalogs, catalog_bindings, executions), três ENABLE RLS, um trigger de
imutabilidade, dezessete funções privadas e duas públicas (um RPC novo de foto
e substituição do router). Definições e assinaturas estão no arquivo SQL.

O delta revoga execução direta autenticada dos quatro dispatchers legados,
revoga acesso direto às três tabelas/helpers, libera apenas ga_api_execution
para authenticated e o par de funções de registro de foto para service_role.
Não promove inspetor a admin, não concede piloto/licença, não cria conta/chave,
não abre bucket/fontes e não instala catálogo real. Qualquer aplicação remota
continua dependendo de aprovação específica do delta final, destino e atores.

Validação e alcance

- Suíte agregada:374 testes,371 aprovados,0 falhas,3 ignorados por originais
  privados ausentes. Fontes de produto permaneceram iguais na rodada final.
- Navegador ligado ao Edge e SQL candidatos reais:7/7 aprovados, desktop/mobile.
  Cobre área própria, seleção do catálogo, foto/boas condições sem RTI,
  tratativa/retomada com RTI única, revogação durante upload/download e backend
  sem contrato restrito. Auth/JWT/licença/Storage e transporte/CORS são fixtures.
- Regressão anterior de navegador:63/63 aprovados,0 falhas/ignorados, com
  contratos HTTP sintéticos atualizados para as rotas restritas. Uma fixture de
  PDF inicialmente sem a rota nova foi corrigida; o bloqueio do produto foi
  preservado. Verificação de sintaxe/padrões de credenciais:143 arquivos JS.
- Focais inclusos na suíte, sem somar novamente:7 SQL de atribuição,11 Edge→SQL,
  10 de catálogo e50 de helper/relatório/pacote, além das regressões existentes.
- Revisão independente reproduziu uma mistura de assetIds entre contratos no
  contexto; foi corrigida e ganhou regressão. Não houve outro bypass reproduzido
  nesse recorte. Isso não é auditoria completa nem homologação de produção.

Persistência, rollback e replay SQL são comprovados em PGlite isolado. Não foram
comprovados Auth/Storage remotos, corrida entre sessões PostgreSQL independentes,
integração operacional de isométrico, aprovação/assinatura/emissão PLH reais.
O catálogo real de509 frases não foi instalado nem teve aplicabilidade/semântica
inventadas. Matriz de risco continua minuta; marco é a inspeção feita, preservando
prazo manual justificado e sem vencimento automático novo.

Pendências que impedem ativação real

Programação temporal aguarda confirmação: proposta offshore por embarque e
onshore por campanha do contrato, com equipe/período definidos e atribuição
individual. Não foi inferida janela móvel, hoje+14, expiração, fuso ou exceção
de retomada. Ver PROGRAMACAO-INSPETOR-DECISOES-PENDENTES-20261103.md.

Consulta oficial identificou organização no Free, produção ativa e homologação
htblarwbdlbwlqiycwdb inativa. Uma listagem de schema da homologação retornou
“Database is possibly not accessible at the moment”; não houve retry/retomada.
Plano Free não inclui backups automáticos/PITR; backup externo continua
desconhecido. Recuperação oficial do bundle gestao-api falhou com UNAVAILABLE /
ProtocolError, sem contorno. Backup/Storage, artefatos restauráveis de Edge e
frontend, custo/elegibilidade e conteúdo da homologação precisam de evidência.

Próximo passo administrativo proposto: confirmar no Dashboard elegibilidade e
ausência de novo custo para retomar exclusivamente htblarwbdlbwlqiycwdb no plano
atual; pedir autorização específica apenas para retomada + inventário de leitura.
Isso não autoriza SQL, ACL, Auth/CORS, contas/credenciais, cópia de produção ou
dados reais. Depois, apresentar hashes do pacote final e escopo de atores para
homologar serviços reais antes de migração/permissões em produção. A autorização
geral de publicar já existe e não está sendo solicitada novamente.

O painel RTI por contrato→sistema→TAG→tratativas foi registrado separadamente
em RTI-PAINEL-REQUISITOS-20261103.md; não é declarado implementado neste recorte.
Capturas e logs locais estão em output/assignment-scope-20261103/. Nenhum arquivo
foi enviado à Library e nenhuma sessão do notebook Windows foi controlada.
