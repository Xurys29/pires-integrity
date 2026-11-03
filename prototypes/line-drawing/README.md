Protótipo local de desenho de linha

Este recorte prepara um levantamento esquemático sobre malha, com figuras e
marcações vinculadas a uma TAG declarada. Não é cadastro operacional, desenho
isométrico real, documento certificado ou as-built aprovado. Não há escala ou
unidade física, cálculo geométrico de tubulação, medição, verificação normativa,
aprovação, assinatura ou emissão técnica.

Executar separadamente da Gestão:

```sh
npm run start:drawing
```

Abrir `http://127.0.0.1:3011`. O servidor escuta somente loopback, aceita GET e
HEAD para quatro arquivos explícitos e bloqueia conexões de API pela CSP. O
servidor normal da aplicação não serve este protótipo. Nenhuma credencial,
configuração conectada, conta, banco, Storage ou permissão é utilizado.

Para experimentar:

1. Declare a TAG em **Escopo declarado**, gere os IDs locais e confirme o
   escopo; ou escolha o exemplo identificado como inteiramente sintético.
2. Em **Linha**, toque em duas posições da malha. Em **Selecionar**, arraste
   nós ou trechos. Zoom e rolagem são apenas recursos de visualização.
3. Escolha uma das quatro figuras disponíveis na interface: válvula, flange,
   redução e derivação T. Insira na malha ou ancore em um trecho.
4. Em **Ponto**, escolha a posição e confirme o rótulo; o vínculo à TAG é
   declarado explicitamente. Não há numeração ou condição técnica presumida.
5. Salve, recarregue e use **Retomar** no mesmo navegador/endereço. Consulte um
   estado antigo em somente leitura; retome-o explicitamente como outro
   rascunho para continuar. Exporte JSON para transportar o histórico ou SVG
   para visualizar o rascunho com seus avisos e identificação.

A referência fornecida foi identificada pela Library como
`libfile_866c137db5c8819190006a5e34e72588`, arquivo JPEG de 222.935 bytes. A
leitura retornou metadados, descrição automática e ponteiro de imagem; os
pixels não foram inspecionados. O recorte usa a descrição autorizada de traçado
azul sobre malha. Não copia traçado real, anotações, dimensões ou figuras da
fotografia, nem afirma reproduzir seu programa ou procedimento.

O modelo `model.js` é compartilhado pelo navegador e pelos testes Node. Exige
escopo de cliente/contrato/sistema/TAG/linha por IDs declarados, rótulo de TAG,
versão da biblioteca, nós, segmentos e ancoragens explícitas. Os passos da
malha são coordenadas do desenho, sem conversão para metros, milímetros ou
leituras de espessura. Os símbolos são construções esquemáticas internas,
identificadas por versão, sem origem normativa validada.

Vínculos opcionais de item/foto/RTI são somente declarações no escopo da TAG.
Não há consulta ao cadastro, carregamento de fotos ou prova de relação entre
esses registros. A integração futura precisará obter relações canônicas no
servidor e respeitar autorização e atribuição; digitar um ID aqui não concede
acesso nem registra uma inspeção.

Cada salvamento alterado acrescenta uma revisão interna com conteúdo e digest;
salvar conteúdo igual mantém a revisão. Importação verifica a cadeia inteira,
o escopo esperado e o prefixo do histórico local informado, recusando rollback
ou ramificação que o apagaria. Retomar conteúdo antigo deve acrescentar outro
rascunho, preservando a cadeia atual. Revisão interna e digest não são revisão técnica, identidade
documental, assinatura ou origem verificada. A biblioteca V1 precisa conservar
seu renderer quando outras versões forem adicionadas, para não redesenhar
histórico silenciosamente.

O armazenamento do navegador é local e pode ser apagado. Exportação JSON
preserva o conteúdo e a cadeia para retomada; exportação SVG é uma representação
do rascunho. Esses arquivos não constituem arquivo documental imutável ou
relatório técnico. Dados reais e originais privados não foram incluídos no
exemplo ou nos testes.

Salvar com proteção entre abas requer Web Locks; sem essa capacidade, a
gravação é recusada e o editor orienta a exportar JSON. WebCrypto também é
necessário para conferir os digests. Não foi homologado em Safari/iPad real.
O modelo limita cada JSON a 8 MiB e 200.000 elementos, e a cadeia a 100 estados.
No limite de 100 estados, novas edições são bloqueadas; os estados existentes
continuam exportáveis. Limites de bytes/elementos podem ser atingidos antes
disso: salvar e exportar um novo candidato podem falhar, mantendo o último
estado persistido e o rascunho em memória. Recuperação de conteúdo que exceda
esses limites ainda não está implementada. Portanto, não usar o protótipo como
único registro de levantamento real. Os limites nunca truncam a cadeia.

Para operar como levantamento de campo integrado ainda faltam cadastro de
desenho/linha, número/revisão/folha e originais preservados, catálogo de figuras
tecnicamente definido, conferência de geometria e dados de campo, autorização
do inspetor e persistência no backend. As-built exige revisão técnica e ato
formal próprios. Documento emitido anterior e marcações de sua revisão precisam
permanecer preservados. A matriz RTI continua minuta e não participa deste editor.

Validação local deste recorte, iniciado em
`ee2181633fc09a85f5a512a29c8dbe41c7086083`:

| Ensaio | Resultado e alcance |
|---|---|
| `npm test` | 292 testes: 289 aprovados, zero falhas, 3 ignorados por originais privados históricos ausentes. |
| Modelo de desenho | 14 testes novos aprovados, incluídos no agregado: escopo, vínculos declarados, ancoragens, biblioteca, cadeia, replay, importação antiga/adulterada e limites. |
| Servidor HTTP | 2 testes novos aprovados, incluídos no agregado: arquivos explícitos/sem POST/API e ausência do protótipo no servidor da aplicação. |
| `npm run check` | Sintaxe e padrões de credenciais aprovados em 131 arquivos JavaScript. |
| Navegador | 12 cenários funcionais aprovados em Chromium local, desktop 1440, tablet 820 e celular 390 emulados. |
| Capturas de revisão | 2 verificações auxiliares aprovadas do exemplo sintético em desktop/celular, com histórico anteriormente salvo preservado, zero erros de página e zero requisições externas. |

O navegador exercitou entradas físicas de mouse/toque, desenho, símbolos,
ancoragens, rótulos, seleção, zoom/rolagem, retomada após
recarregar, revisão anterior somente leitura, importação e downloads JSON/SVG
reais. Falha de Storage foi injetada somente no ensaio isolado; o conflito
entre duas abas utilizou Web Locks e armazenamento reais do navegador de teste.
Rótulos com markup permaneceram texto inerte. Um corte de texto de 160
caracteres na malha mínima foi reproduzido, corrigido e retestado com bounding
boxes no SVG, sem alterar coordenadas do desenho.

A revisão também corrigiu indicação de importação ainda não salva, seleção
histórica durante exportação assíncrona e substituição de histórico por arquivo
antigo. Limites de armazenamento continuam explícitos, conforme descritos
acima. São ensaios locais com dados sintéticos; não demonstram sessão de
inspetor, cadastro real, API Supabase, revisão PLH ou as-built aprovado.

Logs, capturas, hashes e evidência anterior à correção estão em
`output/line-drawing-20261103/`, na cópia privada de revisão. Não houve
transferência para Library, alteração de rede, produção ou permissões.
As capturas representativas são `browser/review-desktop.png` e
`browser/review-mobile.png`; permanecem somente no executor, sem upload.
