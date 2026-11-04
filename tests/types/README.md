# Regressão de tipos das referências preparadas
O teste gestao-prepared-sources.ts verifica o contrato real de createGestaoHandler sem casts ou supressões. O pacote composto e o checkout podem ter caminhos diferentes para o core; antes de atribuir causa a um erro, compare seus arquivos resolvidos, hashes, configuração e diagnóstico completo.

Os seis erros foram reproduzidos com o mesmo core em Deno 2.9.8 / TypeScript 6.0.3: Parameters<typeof createGestaoHandler> produzia never para o parâmetro inteiro. A extração direta do parâmetro único recupera o contrato exportado. Todas as asserções foram preservadas; os negativos usam a mesma extração e precisam continuar falhando por seus valores incompatíveis. O core de produção não mudou nesta correção.

O executor público cria uma árvore temporária própria, copia o core escolhido e o teste original **sem mudar seus bytes**, confere a identidade e executa um compilador Deno já existente. Não instala nada, não lê originais privados, não limpa cache global e não executa a aplicação.

Na raiz de um checkout completo desta revisão:

```text
node scripts/check-gestao-prepared-types.cjs --deno "CAMINHO_DO_DENO_EXISTENTE" --core "CAMINHO_DO_PACOTE/_shared/gestao-api-core.mjs"
```

--core é opcional para verificar o core do próprio checkout. O SHA esperado está fixado na fonte pública corrigida0173e3c: 6e1bcae933c1797bf8db44fc778e41e0e7e6cba04c9054737cc87d24a59b0ccb. Não copie apenas o script para outra pasta sem o restante do checkout. O argumento --baseline-core é opcional e aceita somente o core c650 pré-tipagem no Git (SHA16674a...), não o bundle remoto v6.

## Critério de aprovação
1. O teste original completo precisa compilar com saída zero e sem diagnóstico TypeScript.
2. Quatro casos independentes devem falhar nos próprios arquivos por tipos incompatíveis: ID numérico, nome numérico, nome ausente e entrada unknown.
3. Erro de importação, compilador ausente, sinal, timeout, código inesperado ou positivo com erro **não aprovam** o teste.
4. Os arquivos de entrada devem continuar idênticos e a pasta temporária própria deve ser removida com verificação de prefixo/nonce.

O JSON mostra o hash/caminho que o import original resolveria, além do core efetivamente testado. Uma diferença é informação para diagnóstico, não motivo para descartar falhas. O executor não reconstrói o deno info de uma execução antiga nem conclui a causa dos seis erros já relatados.

A checagem usa deno check --no-config --no-lock --cached-only em uma árvore que contém apenas fontes públicas locais, sem dependências. Essas opções isolam configuração/lock acidentais e não desligam a tipagem. Referência: [Deno check](https://docs.deno.com/runtime/reference/cli/check/).

Este ensaio é separado do deno check da entrada real e da validação dos JSONs/imports/bundle no pacote composto. Ambos precisam passar antes de publicar.

## Testes do executor
```text
node --test tests/gestao-prepared-types-runner.test.cjs
```

As respostas de compilador nesses testes Node são **fixtures**, marcadas compilerFixture=true. Elas testam contenção, propagação de falhas e limpeza; não são execução real do typecheck Deno.

