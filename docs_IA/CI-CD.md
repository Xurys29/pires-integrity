# CI e entrega de imagem

O workflow `.github/workflows/ci.yml` valida pushes em `develop`, `main` e branches `ci/**`, pull requests para `develop`/`main` e execuções manuais.

## Validações

1. Validar o Compose e construir a imagem com o `Dockerfile` da raiz.
2. Iniciar PostgreSQL 16 temporário, com credenciais de teste.
3. Conferir dependências com `pip check` e configuração com `manage.py check`.
4. Rejeitar alterações de models com migrations ausentes.
5. Aplicar migrations e executar `manage.py test` no PostgreSQL. O entrypoint aplica as migrations no banco temporário antes dos comandos.
6. Iniciar o servidor pela imagem e aguardar resposta HTTP de `/healthz/`, incluindo acesso ao banco.
7. Remover containers e volumes de teste mesmo após falha.

O Compose de CI é utilizado sozinho. O `.env` local fica fora da imagem e o carregamento por python-dotenv é desabilitado no CI. Os comandos usam `pires_integrity.settings` com as variáveis do Compose. `pytest.ini` usa settings com SQLite, então o workflow usa o test runner do Django para testar PostgreSQL.

Os cinco testes novos cobrem healthcheck, indisponibilidade do banco, método HTTP, carregamento do login administrativo e consulta SQL. Os testes de domínio passarão a rodar quando seus arquivos e models forem commitados. No `develop` inspecionado para esta alteração, os models ainda estão vazios.

## Publicação

Depois de um push aprovado na `main`, o job `publish` publica a imagem em `ghcr.io/xurys29/pires-integrity:<SHA_DO_COMMIT>`. A permissão `packages: write` pertence apenas a esse job. A política da conta/repositório precisa permitir publicação no GitHub Packages. O resumo do job registra a imagem publicada.

O Dockerfile foi renomeado de `dockerfile` para `Dockerfile` para funcionar no Linux com os Composes e com `docker build .`. O comando padrão segue adequado ao desenvolvimento. Para produção, o Compose do servidor deverá definir o comando abaixo.

```yaml
command: ["gunicorn", "pires_integrity.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "-"]
```

A imagem é reconstruída no job de publicação a partir do mesmo commit. Dependências do sistema/Chrome são obtidas durante o build, então os bytes podem variar entre os dois builds. Se for exigida promoção do mesmo artefato testado, transportar a imagem aprovada ou fixar as dependências e promover seu digest.

## Execução local equivalente

```powershell
docker compose -f docker-compose.ci.yml build web
docker compose -f docker-compose.ci.yml up -d --wait db
docker compose -f docker-compose.ci.yml run --rm web python manage.py check
docker compose -f docker-compose.ci.yml run --rm web python manage.py makemigrations --check --dry-run
docker compose -f docker-compose.ci.yml run --rm web python manage.py test --noinput
```

Ao finalizar os testes, remova exclusivamente os recursos deste Compose de CI.

```powershell
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans
```

## Deploy no servidor

A etapa de atualização da VPS depende da definição do host, usuário SSH, pasta do projeto, domínio/porta e banco de homologação/produção. A implantação deverá obter a imagem pelo SHA aprovado, aplicar migrations com estratégia de backup, iniciar Gunicorn e verificar `/healthz/`. Credenciais devem ser cadastradas em secrets ou no ambiente do servidor.

A implantação na VPS ainda precisa ser conectada. A entrega atualmente termina na publicação da imagem. Também é necessário configurar a regra de proteção das branches no GitHub caso se queira exigir o check aprovado para permitir merge.
