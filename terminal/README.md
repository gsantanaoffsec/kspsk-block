# Rede limpa: um comando, menu e logs ao vivo

Na raiz do projeto, execute:

```bash
node terminal/rede-limpa.cjs
```

O script pergunta:

1. **Chrome/Chromium ou Firefox?**
2. **Quais requisições bloquear?** Informe hosts ou URLs separados por vírgula. Enter mantém apenas a regra fixa original.
3. **Quais métodos bloquear nessas regras extras?** Enter bloqueia todos; também aceita `GET,POST`, por exemplo.
4. **Mostrar tudo ou somente erros e bloqueios?**

Depois ele abre o navegador escolhido, configura o proxy e o HTTPS e permanece mostrando logs. Não precisa de extensão, HAR, porta de depuração ou configuração manual do navegador. No macOS, autorize a inclusão do certificado local no diálogo do sistema quando solicitado.

```text
  Navegador [1] Chrome/Chromium  [2] Firefox: 1
  Quais requisições bloquear? [Enter = só regra original]: api.exemplo.com/telemetria
  Métodos dos bloqueios extras [Enter = todos]: POST
  Mostrar [1] tudo  [2] só erros e bloqueios [Enter = 1]: 1

  EVENTO    HORA      MÉTODO   HTTP     TEMPO  URL
  OK        14:30:01  GET      200      24 ms  https://api.exemplo.com/usuarios
  BLOQUEADA 14:30:02  POST     403       1 ms  https://api.exemplo.com/telemetria
  ERRO      14:30:03  PUT      500      51 ms  https://api.exemplo.com/usuarios/1
```

GET é **verde**, POST **amarelo**, PUT **azul** e DELETE **vermelho**. PATCH usa roxo. Falhas de conexão aparecem como `ERR`; status HTTP 400+ e bloqueios aparecem como erros. Ctrl+C encerra o navegador de testes e o proxy, mostra os contadores e remove o perfil e o certificado daquela sessão. Fechar a janela do navegador também encerra a sessão.

## Requisitos e alcance

O script tem integração para **Windows, macOS e Linux com sessão gráfica**. Instale Node.js 18+, Python 3.12+ com `venv`/`pip` e o navegador escolhido. No Windows, o Python pode ser encontrado pelo launcher `py` ou pelo PATH; mantenha o PowerShell padrão disponível. No macOS, o script usa o comando nativo `security`. Somente Linux requer também o **certutil NSS** (`libnss3-tools` em Debian/Ubuntu).

O mitmproxy 12.3.0 é instalado automaticamente em um ambiente Python separado na primeira execução, usando a verificação TLS normal do pip. As execuções seguintes reutilizam essa instalação. Os arquivos ficam em `%LOCALAPPDATA%\RedeLimpa` no Windows, `~/Library/Caches/RedeLimpa` no macOS e `~/.cache/rede-limpa` no Linux. `REDE_LIMPA_HOME` permite outro local gravável. Não execute o monitor com sudo ou como administrador.

O navegador abre com um **perfil temporário separado**: seus logins, extensões e abas habituais não são herdados. A verificação TLS permanece ativa; o proxy verifica os certificados dos servidores de destino. Aplicações com autenticação por certificado cliente, pinning ou políticas corporativas podem precisar de configuração adicional.

Para inspecionar HTTPS, o script cria uma CA local por sessão. No **Windows**, importa somente o certificado público em `Cert:\CurrentUser\Root`. No **macOS**, adiciona confiança ao certificado no chaveiro padrão do usuário; essa etapa pode exigir autorização do sistema. Firefox usa a confiança do sistema por meio da preferência `security.enterprise_roots.enabled` no perfil temporário. Essa confiança vale para outros aplicativos do usuário enquanto o certificado estiver instalado. No **Linux**, a confiança fica no NSS do perfil Firefox ou no HOME isolado do Chrome. A chave privada fica apenas na pasta local da sessão.

Ao encerrar normalmente ou com Ctrl+C, o script fecha seus processos e remove a CA que adicionou. Certificados preexistentes não são substituídos ou removidos. Se a remoção falhar, os dados e o registro de recuperação são preservados, e o erro é informado. Após queda de energia, SIGKILL ou fechamento forçado do terminal, execute o comando novamente com o mesmo usuário e diretório de cache: o script tenta remover certificados registrados por sessões interrompidas antes de iniciar outra. Não apague a pasta `session-*` no Windows/macOS antes dessa recuperação, pois ela identifica o certificado que deve ser removido.

O monitor cobre HTTP/HTTPS do navegador aberto pelo script, incluindo localhost. Pode também mostrar chamadas de fundo do próprio navegador. Não captura outros programas ou o navegador que já estava aberto. Não grava arquivos de tráfego, headers ou corpos; exibe URLs, que podem conter dados sensíveis. As regras escolhidas são apenas daquela execução.

## Regras de bloqueio

As regras extras combinam **host exato**, prefixo do caminho e os métodos escolhidos. `api.exemplo.com` cobre esse host; `api.exemplo.com/eventos` cobre os caminhos iniciados por `/eventos`. Um esquema, uma porta ou uma query explícitos restringem a regra. Não são aceitos curingas, credenciais na URL ou fragmentos. O proxy responde localmente com **403**, sem encaminhar a requisição bloqueada ao servidor.

A regra fixa conserva o host `ff.kes.v2.scr.kaspersky-labs.com`, método GET, HTTP/HTTPS e portas padrão. Os arquivos originais da extensão não são alterados, mas a extensão não é necessária para este modo.

Um proxy HTTP não recebe a classificação interna `xmlhttprequest` do navegador. Para identificar XHR/fetch, a regra fixa usa `Sec-Fetch-Dest: empty` ou, quando esse cabeçalho não está disponível em HTTP, a presença de `Origin`. Navegações e outros tipos identificáveis não entram na regra. Chamadas antigas sem esses dois indicadores não podem ser classificadas com certeza e não são bloqueadas pela regra fixa; se necessário, inclua o host nas regras extras para bloquear explicitamente os métodos escolhidos independentemente do tipo.

## Verificações

```bash
node --test tests/panel.test.cjs tests/terminal.test.cjs
~/.cache/rede-limpa/venv/bin/python -m unittest discover -s tests -p 'proxy_test.py'
```

No macOS, use `~/Library/Caches/RedeLimpa/venv/bin/python` no segundo comando. No PowerShell/Windows, use `& "$env:LOCALAPPDATA\RedeLimpa\venv\Scripts\python.exe" -m unittest discover -s tests -p 'proxy_test.py'`.

Os testes cobrem menu, métodos, cores, sanitização, configuração Firefox e regras de bloqueio. As rotinas nativas de instalação e remoção de certificados de Windows/macOS são testadas com comandos simulados; a execução real nesses dois sistemas ainda precisa ser validada. Chromium e Firefox foram exercitados no Linux com requisições HTTP/HTTPS, os quatro métodos, bloqueios e erros HTTP. O Firefox exigiu um ajuste de sandbox apenas no comando de teste do contêiner; o script distribuído mantém o sandbox normal dos navegadores.
