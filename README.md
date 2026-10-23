# Rede limpa — versão 1.1.0

A extensão acrescenta a aba **Rede limpa** ao DevTools do Firefox, Chrome e Edge. Nessa aba, as chamadas para `ff.kes.v2.scr.kaspersky-labs.com` ficam ocultas automaticamente, tanto as bem-sucedidas quanto as bloqueadas. O critério é o host exato, para qualquer caminho, método, status e porta, sem depender de IDs ou query parameters.

As linhas usam as cores do método: **GET verde, POST amarelo, PUT azul e DELETE vermelho**. PATCH é roxo; demais métodos são cinza. Os nomes dos métodos continuam escritos para que a identificação não dependa somente da cor. Erros da aplicação continuam visíveis, com o status destacado.

**Essas mudanças visuais valem na nova aba Rede limpa. A aba Rede nativa não é alterada.** A extensão não oferece todos os recursos do monitor nativo.

## Obter o código e atualizar pelo Git

Na primeira vez, clone este repositório com `git clone https://github.com/gsantanaoffsec/kspsk-block.git` e entre na pasta `kspsk-block`. Use a pasta `chrome` ou `firefox` para instalar a extensão, conforme as instruções abaixo.

Nas próximas atualizações, execute `git pull --ff-only` dentro dessa mesma pasta e recarregue a extensão no navegador. Os comandos são iguais no Windows e no macOS. Não é necessário baixar outro ZIP nem executar `npm install` para usar a extensão.

O GitHub centraliza os arquivos, mas não configura atualização automática no navegador.

## Atualização da extensão

1. Execute `git pull --ff-only` na pasta do repositório usada na instalação.
2. No Chrome/Edge, clique em Recarregar no cartão da extensão em `chrome://extensions` ou `edge://extensions`. Se o navegador pedir aceite do novo acesso ao DevTools, revise a permissão e habilite a extensão.
3. No Firefox temporário, use Recarregar em `about:debugging#/runtime/this-firefox`. Se mudou a pasta, remova a temporária antiga e carregue o novo `firefox/manifest.json`.
4. **Feche e reabra o DevTools**, para o navegador criar a nova aba.
5. Abra **Rede limpa**, que também pode estar no menu de abas excedentes `»`.
6. Recarregue a aplicação e gere as requisições.

No Firefox, a API de captura precisa que a aba **Rede nativa seja ativada pelo menos uma vez na sessão do DevTools**. Se não aparecerem requisições, abra Rede, volte a Rede limpa e recarregue a aplicação. Não é necessário digitar filtros.

Uma instalação permanente do Firefox continua dependendo de assinatura. Para atualizar uma instalação assinada, distribua a nova versão assinada pelo mesmo canal usado anteriormente.

## Uso

- A ocultação do host e as cores vêm prontas, sem configuração recorrente.
- Clique no nome de uma requisição para ver URL, status, duração, query parameters, Request headers, payload, Response headers e Response body, quando o navegador disponibilizar esses dados.
- O corpo da Response é consultado somente ao selecionar a requisição; JSON é formatado como texto. HTML recebido não é executado. Binários em base64 são indicados como tal.
- Há busca por URL/método/status, seletor de método, Limpar, Pausar/Retomar e Preservar ao navegar.
- Pausar descarta novas entradas enquanto estiver ativo. Preservar mantém as entradas ao navegar nesta sessão. Os controles voltam ao padrão quando o painel é recriado.
- São mantidas as últimas 500 entradas visíveis em memória. Requisições ocultas não ocupam esse limite. O contador de ocultas depende dos eventos disponibilizados pelo navegador e não é uma auditoria completa de bloqueios.
- A captura começa quando o painel é carregado. Recarregue a aplicação para capturar uma página completa.
- O painel mostra requisições concluídas, sem waterfall, acompanhamento de requisições pendentes, WebSocket frames ou replay. Responses descartadas pelo navegador podem não estar disponíveis.
- A exibição do corpo é limitada a 200.000 caracteres. Nenhum arquivo é gravado com os dados capturados.

## Primeira instalação: Chrome e Edge

1. Clone o repositório em uma pasta definitiva, que deve permanecer no computador.
2. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
3. Ative o modo de desenvolvedor e clique em Carregar sem compactação/Carregar descompactado.
4. Selecione a pasta `chrome`, que contém `manifest.json`.
5. Abra/reabra o DevTools e siga as instruções de uso acima.

A instalação local pode permanecer após reiniciar o navegador, desde que a extensão continue habilitada e as políticas da empresa permitam. Para distribuição administrada, a TI deve escolher um canal de distribuição adequado. Este repositório contém o código fonte, não um instalador publicado em loja.

## Primeira instalação: Firefox

Requer Firefox 140 ou superior neste pacote.

Para avaliar: clone o repositório, abra `about:debugging#/runtime/this-firefox`, clique em Carregar extensão temporária e selecione `firefox/manifest.json`.

**A instalação temporária é removida ao reiniciar o Firefox.** Para instalação permanente no Firefox padrão, o responsável pela distribuição precisa compactar o conteúdo da pasta `firefox` em ZIP, com `manifest.json` na raiz do arquivo, e submetê-lo à Mozilla, por exemplo pelo fluxo unlisted/self-distributed, para obter um `.xpi` assinado. A empresa pode avaliar a distribuição desse pacote assinado por política corporativa. A extensão deste repositório ainda não foi submetida nem assinada.

## Bloqueio de rede mantido da versão anterior

Além do novo painel visual, foi mantida a regra estática já existente: bloqueia GETs XHR/fetch para o host exato `ff.kes.v2.scr.kaspersky-labs.com`, via HTTP ou HTTPS na porta padrão, em qualquer caminho. Essa regra continua ativa quando a extensão está habilitada, mesmo com o DevTools fechado.

O filtro visual é mais amplo que a regra de bloqueio: oculta todos os registros desse host na nova aba, independentemente do método, tipo ou status. Por isso, também cobre o `/init` com status 200 mostrado na imagem, se esse registro for entregue à API.

O bloqueio pode afetar funcionalidades da proteção web do Kaspersky que dependam dessa comunicação. O impacto no produto de segurança não foi medido. O pacote continua sendo um protótipo para avaliação técnica da empresa, sem homologação corporativa.

## Privacidade e permissões

- `declarativeNetRequest` permite a regra estática de bloqueio.
- `devtools_page` habilita o painel e o acesso às requisições da aba inspecionada; o navegador pode pedir uma nova permissão na atualização.
- Enquanto o painel está carregado, a extensão acessa URLs, headers, payloads e Responses da aba inspecionada, que podem conter informações sensíveis. Esses dados são mostrados somente no painel, em memória; não são enviados a um servidor, persistidos ou usados para telemetria.
- Não há scripts injetados na aplicação, eval da página, background worker, dependências remotas ou coleta/transmissão externa de dados pela extensão. A declaração Firefox permanece `required: ["none"]` para transmissão/coleta externa.

## Desativação

Desative ou remova a extensão no gerenciador de extensões do navegador e recarregue as páginas. Isso remove o painel e interrompe a aplicação da regra. Nenhuma configuração de Kaspersky, proxy, DNS, hosts ou firewall é alterada pelo pacote.

## Verificação antes da apresentação

1. Confirme a versão 1.1.0 e abra a aba Rede limpa.
2. No Firefox, ative Rede nativa uma vez antes de testar a captura.
3. Gere GET, POST, PUT e DELETE com sua própria aplicação. Confira as cores e os detalhes.
4. Confirme que chamadas para o host do Kaspersky não são listadas na aba Rede limpa, mesmo que ainda apareçam na Rede nativa.
5. Confira que um erro da própria API permanece visível.
6. Teste busca, filtro por método, Limpar, Pausar e navegação com/sem preservar.
7. Avalie cada navegador separadamente, a persistência da instalação e o impacto no Kaspersky com a equipe responsável.

As verificações automatizadas locais estão descritas em `VALIDACAO.txt`. Elas não substituem a instalação real nos navegadores.

Para executar os 15 testes locais com Node.js 18 ou superior, use `node --test tests/panel.test.cjs` na raiz do repositório. Nenhuma dependência externa é necessária.

## Arquivos de cada navegador

- `manifest.json`: registra a extensão, o painel e a regra.
- `rules.json`: bloqueio automático mantido da versão 1.0.1.
- `devtools.html` e `devtools.js`: criação da aba Rede limpa.
- `panel.html` e `panel.css`: interface e cores por método.
- `network-core.js`: filtro por host, busca e limite das entradas.
- `panel.js`: captura de eventos, tabela e inspeção dos detalhes.

## Referências oficiais

- Painéis DevTools: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools/panels/create
- Eventos de rede e requisito Firefox: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools/network/onRequestFinished
- Rede no Chrome: https://developer.chrome.com/docs/extensions/reference/api/devtools/network
- Regras declarativas: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest
- Instalação Chrome: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
- Assinatura Firefox: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
