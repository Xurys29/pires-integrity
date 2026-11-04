# Conferência da interface publicada
Use um checkout completo da revisão candidata do PR. Não use o pacote local de desenho nem o runtime demo como base de publicação.

```text
node scripts/compare-public-frontend.cjs --plan
node scripts/compare-public-frontend.cjs --live
```

--plan é o padrão e não faz rede. --live deve rodar apenas onde o acesso ao domínio https://app.piresintegridade.com.br já seja permitido, como a sessão autorizada do notebook. Não alterar políticas ou usar outra rota para contornar uma negativa.

O comparador faz somente GET público:59 arquivos estáticos históricos,3 novos da candidata e runtime-config.js separado (63URLs). _headers entra no pacote de64 arquivos, mas não é buscado como recurso público. Não executa JavaScript remoto, não envia credenciais e não guarda corpos dos arquivos ou cópia de backup. Registra somente status, tamanhos e hashes. Interrompe em negação, rate limit, desafio ou falha de transporte; não tenta autenticar ou contornar.

## Interpretar o resultado
- matches_candidate_static: os62 arquivos estáticos correspondem aos bytes locais da candidata. Conferir configuração, cabeçalhos efetivos e deploymentID antes de afirmar publicação completa. Não redeployar por suposição.
- matches_baseline_static_new_assets_absent: os59 estáticos correspondem ao manifesto histórico e os3 novos estão ausentes. A interface ainda não contém a candidata completa.
- mixed_or_inconclusive: não sobrescrever automaticamente. Identificar erro de leitura, transformação do provedor ou alterações de outro executor e reconciliar.

Exit0 significa comparação concluída, inclusive quando a interface é a histórica; não significa aprovação para emissão ou teste de inspeção. Exit2 significa resultado inconclusivo e exit1 erro de preparação. sourceHead é referência local; os hashes não identificam um commit único quando vários commits contêm os mesmos arquivos. sourceHead pode ser null num arquivo baixado sem .git.

runtime-config.js recebe somente comparação de hash. Seus valores não são inspecionados nem aprovados pelo script. Conferir a configuração pública real: mode connected, gestao.backend supabase, projeto e domínio corretos, chave pública existente e flags preservadas. Nunca publicar o runtime demo do Git nem colocar segredos de servidor na interface.

Depois de identificar a versão atual, preparar a candidata com os63 arquivos da allowlist conferida mais a configuração pública real, total64 incluindo _headers; verificar manifesto/ZIP e publicar pelo mecanismo oficial do Pages pires-integrity-app existente. O bundle Edge e os JSONs privados ficam fora desse staging público. Registrar o deploymentID atual e o novo pelo painel oficial; a comparação não acessa o Cloudflare administrativo.

Após publicação, repetir a comparação e fazer os testes autenticados normais com gestor e, após planejamento/atribuição/piloto, inspetor. O script não testa login, banco, anexos, permissões ou persistência e não concede acesso.

## Testes locais
```text
node --test tests/compare-public-frontend.test.cjs
```

Esses testes usam fetch simulado, identificado no relatório. Eles não demonstram a versão atualmente publicada.

