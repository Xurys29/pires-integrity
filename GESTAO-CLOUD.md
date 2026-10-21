# Gestão de Ativos — ambiente privado de teste

Este desenvolvimento não é implantação em produção. Reutiliza as calculadoras e mantém os motores `calculations.js`, `construction-code.js` e `nr13.js` intactos.

## Executar no Codex Cloud

Use o checkout existente `/workspace/pires-integrity`, sem criar worktree. Requisitos testados: Node.js 24.19.0, npm 11.9.0, Python com openpyxl 3.1.5 e PyMuPDF 1.26.6. O SQLite é fornecido pelo Node 24.

```sh
cd /workspace/pires-integrity
npm ci --ignore-scripts --cache /workspace/.npm-cache
npm run check
npm test
HOST=0.0.0.0 PORT=3000 npm start
```

O início padrão mantém as calculadoras na raiz e disponibiliza a gestão em `/gestao.html`, no mesmo serviço. `npm run start:assets` é uma alternativa que abre a gestão na raiz, na porta 3002; não é preciso executar os dois. O site institucional continua independente (`PORT=3001 npm run start:site`).

A gestão exige nome do operador e uma chave aleatória do ambiente, lida **no terminal privado** de `/workspace/.pires-private/access-key`. Não copie a chave para o chat, para o Git, para URLs ou para os scripts. O servidor cria a chave com permissão 0600 e o diretório com 0700. As sessões expiram em oito horas e são invalidadas ao reiniciar. Não há integração de autenticação multiusuário/SSO, habilitação profissional ou assinatura digital; trata-se de acesso único de teste, com operador identificado por declaração. Não compartilhar como portal de clientes.

Dados, fontes XLSX e anexos persistem no SQLite `/workspace/.pires-private/assets.sqlite`, fora do checkout e da pasta pública. A persistência foi testada após reiniciar o serviço. Não é apenas memória de navegador. Isso **não** comprova restauração em outro ambiente, backup remoto ou sincronização com produção. O snapshot já publicado antes deste desenvolvimento não contém automaticamente estas mudanças. Não publicar o ambiente ou produção sem instrução específica. Para uma cópia consistente do banco em execução, usar a API de backup do SQLite; não copiar apenas o arquivo principal enquanto houver WAL.

Se Python/openpyxl não estiver disponível em outra instância, preparar um ambiente virtual fora do checkout e instalar a versão fixada em `requirements-cloud.txt`, mantendo verificações TLS. O ambiente atual já fornece essa dependência.

## Importação e situação dos dados reais

Uma fonte PDF enviada posteriormente pelo usuário foi conferida por extração independente de texto e coordenadas, inspeção visual e comparação dos itens. Foram persistidos 43 ativos de um sistema, com nome histórico da fonte preservado e nome de apresentação atual explicitamente confirmado pelo usuário. Itens vazios foram excluídos. A fonte original, página/item, datas brutas e marcações do controle ficam apenas no banco privado, fora do Git. Os registros históricos de inspeção indicam expressamente que foram informados no controle; não são relatórios, entrega documental ou aprovação. A reimportação real resultou em 0 novos e 43 inalterados. A planilha abaixo continua inacessível e não foi importada. O proxy recusou tanto `docs.google.com` quanto `drive.google.com` com CONNECT 403, antes do Google; não houve leitura nem validação dos arquivos reais. A sessão não disponibilizou ferramentas de Drive.

Arquivo necessário: XLSX completo da planilha `14MfLPO8oP98pkCPbQsqopKBagoeUUn2W`, incluindo todas as abas. Pasta adicional indicada: `1wqtBCZ5uU6uUULiiKJG_9bdfw09V6lcv`; seu conteúdo não pôde ser enumerado. Não há como nomear outros arquivos sem listar essa pasta.

Alvo informado pelo usuário, **ainda não conferido na fonte**: unidade 3R11, Ubarana; aba `3R11 - PE-341806-002 ` (preservar espaço final); sistema PE-341806-002; possível faixa 16–59, 44 linhas. Não usar esse relato como prova de importação. Preservar o nome efetivamente encontrado da empresa; não presumir equivalência entre 3R e Brava.

O leitor PDF aceita a grade Execution Control de uma página, confere os cabeçalhos e registra itens por coordenadas. Outros layouts não são interpretados silenciosamente. Datas da coluna de inspeção somente são normalizadas quando a convenção é desambiguada dentro da própria coluna. O cabeçalho de data, o resumo global e o número de OS não viram planejamento, progresso do sistema ou contrato. O PDF original pode ser baixado pela rota autenticada da empresa.

Fluxo XLSX implementado:

1. Anexar XLSX privado, visualizar abas e linhas (nomes exatos, incluindo espaços).
2. Informar identidade estável do arquivo, empresa comprovada por célula, unidade, sistema e evidência de confirmação. A aba não é automaticamente um sistema.
3. Mapear colunas e unidades originais e selecionar faixa. Fórmulas não são executadas; linhas sem TAG são bloqueadas para conferência, em vez de preencher valores presumidos. Células mescladas/continuações exigem análise antes da importação.
4. Conferir todas as linhas da prévia e avisos de repetição. Cada linha de origem recebe identidade própria; não há deduplicação apenas pelo TAG. Selecionar se o registro representa linha ou segmento.
5. Confirmar gravação. Reimportar o mesmo arquivo/aba/linha no mesmo destino mantém IDs e não multiplica ativos. Mudanças nos registros já importados bloqueiam a gravação para revisão; não há atualização destrutiva automática. Uma nova versão da fonte deve manter a mesma identidade documental.

Arquivos originais e seus hashes SHA-256, aba, linha, colunas mapeadas, valores e unidades são preservados. Nenhum contrato é criado pela importação. Valores ausentes são apresentados como Não informado; relatórios ausentes, como Sem relatório no sistema. Nomes empresariais iguais exigem escolher o cadastro existente; empresas de nomes distintos não são unidas.

## Cadastro, cards, books e indicadores

- Empresa → unidade → sistema → ativo; contratos referenciam os IDs dos ativos e selecionam Integridade, NR-13, Certificação de Válvulas e RTIs. RTIs são submódulo da Gestão de Ativos. Novo contrato reutiliza o cadastro e o histórico.
- Cards de linhas, segmentos, vasos, caldeiras, tanques, válvulas e outros; busca, filtros e paginação de 12 cards, com contagem por sistema. Paginação/filtragem atuais são no cliente; não se afirma capacidade para carga ilimitada.
- Operação e avaliação técnica separadas. Verde significa somente Em operação. RTI aberta tem indicador vermelho independente, texto e prazo se documentado. Sem RTI não significa aprovado. Cadastros permanecem Não avaliados; não foi criado parecer técnico fictício. Preferência sem movimento e `prefers-reduced-motion` suportados.
- Books individuais com item, aplicabilidade fundamentada, revisão, responsável, anexos, histórico e decisões. Aplicabilidade inicia pendente. Itens do submódulo NR-13 exigem enquadramento revisado do próprio ativo para validar aplicabilidade. Aprovado não é inferido do upload. Uma nova revisão substitui a anterior somente após aprovação explícita; há devolução para correção. Não há comprovação automática de assinatura ou habilitação.
- NR-13 usa o mesmo motor das calculadoras. É possível calcular a partir dos dados documentados ou vincular JSON salvo da calculadora, conferindo versão e resultados antes de guardar cópia e hash. Enquadramento, justificativa, classe do fluido e categoria ficam separados. Caldeiras não estão cobertas pelo motor atual e permanecem Não avaliadas; não foi inventada nova regra de enquadramento.
- Nenhuma tabela de intervalos é aplicada automaticamente. Prazo interno/externo exige enquadramento revisado, versão normativa, item, dados, condições especiais, marco inicial e fundamentação do responsável. Na falta disso: Prazo pendente de definição. Registrar um prazo não certifica a interpretação normativa; a revisão técnica continua necessária.
- Planejamento e execução comprovada são eventos diferentes. Entrega exige revisão de relatório com anexo, mas não exige nem significa aprovação. Indicadores segregam inspeções, entregas, backlog e RTIs; a curva S usa quantidades documentadas. Metas/percentuais sem planejamento não são preenchidos. Backlog de relatórios é quantidade não entregue, sem prazo contratual de entrega inventado.

## Relatórios e evidências

A PMTA tem apresentação compacta de duas páginas, padrão da interface, e memorial integral preservado como alternativa. O compacto preserva resultados e premissas e recusa excesso de texto em vez de cortar informações. Imagens de assinatura exigem o memorial integral nesta versão; a UI informa a limitação. A primeira folha da vida individual fica com identificação, e o histórico começa na seguinte. O resumo ME mostra até seis pontos na primeira folha, mantendo os demais nas folhas seguintes, com todas as geratrizes, fontes e hash do snapshot.

Não foi fornecido nesta sessão um arquivo de referência do layout anteriormente aprovado. Os layouts foram inspecionados visualmente, mas a aprovação visual pelo usuário permanece pendente. Não foram produzidos relatórios reais de cliente sem medições e documentos. A logo oficial solicitada não pôde ser obtida porque o domínio externo também foi bloqueado. A logo do prestador presente na fonte não é usada como logo do cliente; aguarda-se imagem oficial. Os PDFs em `output/relatorios/` são amostras sintéticas, claramente identificadas e separadas do banco. O conteúdo de `output/` é ignorado pelo Git.

```sh
node scripts/report-previews.cjs
node scripts/test-assets-browser.cjs
```

O teste de navegador requer Playwright disponível no ambiente e Chromium em `/usr/bin/chromium` (ou `PIRES_CHROMIUM`). Usa diretório temporário e XLSX sintético; nunca insere fixtures no banco privado real. Os testes automatizados não substituem a conferência da planilha real ou a revisão normativa.

Não há ferramenta de publicação ou encaminhamento de porta privada nesta sessão. O serviço foi validado por HTTP e navegador dentro da nuvem; a existência de uma URL privada acessível pelo celular precisa ser conferida na interface do Codex Cloud. Não tratar endereço de loopback como link utilizável no celular.
