# Pires Integrity — continuidade em ambiente de código na nuvem

Esta pasta é uma cópia portátil preparada em 20/10/2026. O aplicativo vem exclusivamente da release `release-pmta-pdf-20261020/dist`, baseada no pacote de produção corrigido de 16/10. O site vem de `site-institucional/release-rodape-20261020/dist`, a versão com rodapé publicada em 20/10.

## Executar em Linux

Use Node.js 24 ou superior, com npm:

```sh
npm ci --ignore-scripts
npm run check
npm test
HOST=0.0.0.0 PORT=3000 npm start
```

Abra a prévia da porta 3000 e selecione **Explorar demonstração → Calculadoras de integridade**. Para o site institucional, abra outro terminal:

```sh
HOST=0.0.0.0 PORT=3001 npm run start:site
```

A demonstração funciona sem Supabase, credenciais ou computador local do usuário. `app/runtime-config.js` contém apenas `mode:'demo'`. Os scripts conectados foram preservados como código público, mas não têm configuração de produção nesta pasta. A demonstração não salva avaliações em conta. O site conserva os links públicos originalmente publicados.

Os pilotos locais de gestão, Divisão 3 e memorial completo não integram esta cópia. Seus atalhos permanecem desabilitados na demonstração portátil, inclusive ao selecionar Divisão 3 na calculadora. Os PDFs de PMTA parcial e de enquadramento NR-13 estão incluídos.

O exemplo de vida remanescente desta cópia usa somente identificação, medidas, datas e referências sintéticas `DEMO`; a referência ao relatório fornecido anteriormente foi removida apenas daqui. O motor de cálculo não foi alterado.

## Estrutura

- `app/`: HTML, CSS, JavaScript e bibliotecas públicas da release do aplicativo; o novo gerador é `nr13-pdf.js`.
- `site/`: os 25 arquivos estáticos da publicação institucional atual, incluindo imagens já públicas.
- `tests/`: testes de PDF e cenários inteiramente fictícios. Os testes usam o motor corrigido de `app/calculations.js` e a dependência `jspdf` fixada em `4.2.1`.
- `scripts/`: servidor de demonstração e conferência de sintaxe, portáteis para Linux.
- `MANIFEST.json`: origens, adaptações e SHA-256 dos arquivos desta cópia.
- `VALIDATION.json`: verificações efetivamente realizadas nesta preparação.

Não foram incluídos `node_modules`, PDFs gerados, resultados de avaliações, sessões, arquivos de ambiente, chaves de publicação, credenciais, anexos privados de clientes ou módulos locais de gestão.

## Estado e continuidade autorizada

O fluxo de PDF de PMTA parcial e o relatório próprio de enquadramento NR-13 estão implementados. Logo e foto do equipamento são opcionais e aparecem no início do PDF; identificação e responsáveis são opcionais. Não há marca, CNPJ ou responsável técnico preenchido automaticamente no modelo. A exportação JSON também inclui os metadados do relatório NR-13.

A foto é preparada pelo navegador como JPEG com o maior lado limitado a 1600 px. Ela e sua legenda acompanham o PDF e o JSON. **Persistência de anexos na nuvem não foi solicitada após o esclarecimento final e não foi implementada.** `cloud.js`, autenticação, políticas e armazenamento remoto permanecem como na base de produção.

O motor `calculations.js` desta cópia é o corrigido da produção. Não substitua esse arquivo pela versão anterior existente na raiz de outro workspace. Preserve as validações numéricas e a relação `L = 0,90D` do tampo elipsoidal já implementadas.

A release de PDF foi publicada pelo executor principal em 20/10/2026 no projeto Cloudflare `pires-integrity-app`, implantação `da2fcbe4-ac9c-416e-b45b-c4181e6364c8`: https://da2fcbe4.pires-integrity-app.pages.dev/. O domínio oficial abriu o índice com `nr13-pdf.js`. Os 12 testes finais passaram; o percurso em prévia no Edge anexou foto/logo e baixou os PDFs NR-13 e PMTA, com os arquivos conferidos em Downloads. **O percurso autenticado em produção ainda não foi ensaiado.** Uma consulta pública automatizada com HTTP 403 não determina falha do aplicativo.

Esta cópia portátil usa modo demonstrativo e contém as adaptações de portabilidade descritas acima; ela não é uma configuração de implantação conectada. **Não publique nem altere o servidor automaticamente.** Antes de uma publicação futura, confira a release exata, os testes e o PDF baixado em desktop e celular; mantenha os dados do usuário e o isolamento já existentes.

Esta preparação não criou repositório GitHub, chat ou tarefa em nuvem. Para continuar com o computador desligado, ainda é necessário conectar um repositório e iniciar um ambiente de execução em nuvem a partir desta pasta. Essa conexão não foi concluída aqui.
