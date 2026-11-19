# CI/CD da Pires, por etapas

Este pacote reúne os arquivos da proposta do PR #2 e um roteiro para você aplicá-los no seu computador. O CI já teve uma execução aprovada no GitHub, incluindo build Docker, testes no PostgreSQL 16 e resposta HTTP. A publicação no GHCR ocorrerá após um push aprovado na main. A conexão com a VPS ainda precisa ser configurada.

## 1. Conferir o ponto de partida

No terminal do PyCharm, na pasta do projeto, execute os comandos abaixo.

```powershell
git branch --show-current
git status --short --branch
```

A base prevista é a sua branch `develop`. Confira alterações locais antes de trocar de branch. Quando estiver nela, crie a branch de trabalho.

```powershell
git switch -c ci/configurar-pipeline
```

`git switch -c` cria a branch a partir da branch atual e muda para ela. O prefixo `ci/` também está entre os gatilhos de teste do workflow.

## 2. Padronizar o nome Dockerfile

O arquivo atualmente está versionado como `dockerfile`, em minúsculas. O CI em Linux distingue esse nome de `Dockerfile`. Antes de copiar os arquivos, se o nome versionado ainda for `dockerfile`, faça a mudança por um nome intermediário no Windows.

```powershell
git mv dockerfile dockerfile.tmp
git mv dockerfile.tmp Dockerfile
```

Se o arquivo já estiver versionado como `Dockerfile`, siga para a próxima etapa. Verifique o nome rastreado com `git ls-files '*ockerfile*'`.

## 3. Entender e incorporar os arquivos

As pastas de `arquivos/` correspondem aos caminhos dentro da raiz do seu projeto. Copie o conteúdo desses caminhos para os destinos correspondentes. Para os arquivos que já existem, compare as diferenças no PyCharm antes de incorporar a versão do pacote, especialmente `settings.py` e `.dockerignore`.

| Arquivo | Responsabilidade |
|---|---|
| `.github/workflows/ci.yml` | Define quando o GitHub executa a automação e os comandos de cada job. |
| `docker-compose.ci.yml` | Cria a aplicação e um PostgreSQL temporário, com variáveis específicas para os testes. |
| `Dockerfile` | Constrói a imagem com Python, dependências e código. O conteúdo segue o Dockerfile enviado, com o nome padronizado. |
| `entrypoint.sh` | Executa collectstatic, migrate e depois o comando recebido por `exec "$@"`. |
| `.dockerignore` | Evita incluir .env, chaves, Git, mídia e outros arquivos locais na imagem. |
| `.gitattributes` | Define terminações de linha LF para entrypoint.sh. |
| `pires_integrity/settings.py` | Versão de referência com o app PostgreSQL registrado uma vez e integração básica do Axes. |
| `sistema_pires/test_ci.py` | Cinco testes de inicialização e healthcheck. |
| `docs_IA/CI-CD.md` | Explica a execução local, a publicação da imagem e o que falta para o deploy. |

O Compose de CI é independente do seu Compose local. Utilize `-f docker-compose.ci.yml` nos comandos de teste para selecionar o ambiente correto.

## 4. Aplicar os três ajustes nos seus settings

No seu arquivo local, confira os pontos abaixo. As demais configurações locais precisam refletir seu projeto atual.

- `django.contrib.postgres` aparece uma única vez em INSTALLED_APPS.
- `axes` aparece em INSTALLED_APPS e `axes.middleware.AxesMiddleware` é o último middleware.
- AUTHENTICATION_BACKENDS contém o backend do Axes seguido do ModelBackend do Django.

```python
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]
```

A versão completa incluída em `arquivos/pires_integrity/settings.py` permite comparar essas mudanças com o arquivo lido na develop. Preserve ajustes locais posteriores, inclusive suas configurações de Fernet e DRF.

## 5. Verificar o Compose e construir

```powershell
docker compose -f docker-compose.ci.yml config --quiet
docker compose -f docker-compose.ci.yml build web
```

O primeiro comando valida o YAML e a configuração do Compose. O segundo constrói a imagem usando as versões do seu requirements.txt.

## 6. Testar com PostgreSQL temporário

```powershell
docker compose -f docker-compose.ci.yml up -d --wait db
docker compose -f docker-compose.ci.yml run --rm web python -m pip check
docker compose -f docker-compose.ci.yml run --rm web python manage.py check
docker compose -f docker-compose.ci.yml run --rm web python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.ci.yml run --rm web python manage.py test --noinput
```

`up -d --wait db` inicia o PostgreSQL e aguarda o healthcheck. `run --rm` cria um container para executar o comando e o remove ao terminar. O entrypoint aplica as migrations no banco temporário antes do comando.

`makemigrations --check --dry-run` falha se existirem mudanças nos models sem migration correspondente. Caso você já tenha incorporado os models, gere e versione as migrations no seu ambiente de desenvolvimento antes de enviar o commit. O CI verifica as migrations que vieram do Git.

Os cinco testes do pacote verificam resposta saudável, falha de banco, rejeição de POST no healthcheck, carregamento do login administrativo e consulta SQL. Outros testes do projeto também serão descobertos pelo test runner Django.

Ao finalizar, limpe os recursos do Compose de CI.

```powershell
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans
```

`--volumes` remove os volumes do projeto de testes selecionado. Confira o arquivo passado em `-f` antes de executar.

## 7. Versionar e enviar

Confira o diff, as migrations e os arquivos alterados. Inclua explicitamente os arquivos da configuração e as migrations necessárias.

```powershell
git status --short
git diff
git add .github/workflows/ci.yml docker-compose.ci.yml Dockerfile entrypoint.sh .dockerignore .gitattributes pires_integrity/settings.py sistema_pires/test_ci.py docs_IA/CI-CD.md
git add --renormalize entrypoint.sh
git commit -m "ci: configurar pipeline Django PostgreSQL e Docker"
git push -u origin ci/configurar-pipeline
```

A renomeação feita por git mv já fica no staging. As migrations, caso tenham sido geradas, também devem entrar no commit após revisão. O GitHub executa o workflow quando recebe o push da branch `ci/**`. Abra a aba Actions para acompanhar cada etapa.

## 8. Ler o workflow

- `on` define os gatilhos de push, pull request e execução manual.
- `permissions` limita as permissões do token do job.
- `concurrency` cancela uma execução anterior da mesma referência quando chega outra mais recente.
- `jobs.ci` constrói, verifica e testa a aplicação.
- `if: failure()` mostra logs quando uma etapa falha.
- `if: always()` garante a tentativa de limpeza no final.
- `jobs.publish` depende de `ci` por `needs` e só publica em push da main.
- `${{ ... }}` representa expressões avaliadas pelo GitHub Actions.

A publicação usa o GITHUB_TOKEN fornecido pelo Actions e requer permissão de GitHub Packages. O nome da imagem inclui o SHA do commit para identificar a versão entregue. O job de publicação ainda precisa ser exercitado na main.

## 9. Completar o deploy

O PR #2 existente contém a mesma proposta de pipeline. Escolha aplicar por ele ou pelo seu novo PR para que o histórico seja integrado de forma coerente.

Para conectar a implantação à VPS, ainda precisamos definir host, usuário SSH, pasta, domínio/porta e banco de destino. O comando de produção deve usar Gunicorn, conforme o exemplo em docs_IA/CI-CD.md.

Referências para leitura adicional

- https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers
- https://docs.docker.com/reference/compose-file/services/
