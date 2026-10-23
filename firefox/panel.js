/* global CleanNetwork, browser, chrome */
(() => {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : globalThis.chrome;
  const isFirefox = typeof browser !== 'undefined';
  const store = new CleanNetwork.RequestStore();
  const byId = id => document.getElementById(id);
  let selectedId = null;
  let scheduled = false;
  let detailVersion = 0;
  let captureError = '';

  function cell(parent, text, className = '') {
    const node = document.createElement('td');
    node.textContent = text;
    node.className = className;
    parent.append(node);
    return node;
  }

  function section(title, text) {
    const heading = document.createElement('h2');
    heading.textContent = title;
    const content = document.createElement('pre');
    content.textContent = text || '(vazio ou não disponível)';
    byId('details').append(heading, content);
    return content;
  }

  function headers(items) {
    return (items || []).map(item => `${item.name}: ${item.value}`).join('\n');
  }

  function closeDetails() {
    selectedId = null;
    detailVersion++;
    byId('inspector').hidden = true;
    byId('details').replaceChildren();
  }

  async function select(record) {
    selectedId = record.id;
    const version = ++detailVersion;
    const entry = record.entry;
    byId('inspector').hidden = false;
    byId('details').replaceChildren();
    section('Resumo', `${entry.request.method} ${entry.request.url}\nStatus: ${entry.response?.status || 'Sem resposta HTTP'} ${entry.response?.statusText || ''}\nTempo: ${Math.round(entry.time || 0)} ms`);
    section('Query parameters', headers(entry.request.queryString));
    section('Request headers', headers(entry.request.headers));
    const postData = entry.request.postData;
    section('Request payload', CleanNetwork.pretty(postData?.text || headers(postData?.params)));
    section('Response headers', headers(entry.response?.headers));
    const responseBody = section('Response body', 'Carregando…');
    scheduleRender();
    try {
      let content;
      let encoding;
      if (typeof entry.getContent !== 'function') throw new Error('Corpo não disponibilizado pelo navegador.');
      if (isFirefox) {
        [content, encoding] = await entry.getContent();
      } else {
        [content, encoding] = await new Promise((resolve, reject) => {
          entry.getContent((text, format) => {
            const error = api.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve([text, format]);
          });
        });
      }
      if (version !== detailVersion) return;
      responseBody.textContent = encoding === 'base64'
        ? 'Conteúdo binário em base64. Consulte a aba Rede nativa para inspecionar esse recurso.'
        : CleanNetwork.pretty(content) || '(Response sem corpo ou corpo não disponível)';
    } catch (error) {
      if (version === detailVersion) responseBody.textContent = error.message || 'Response não disponível.';
    }
  }

  function render() {
    scheduled = false;
    const visible = store.entries.filter(record => CleanNetwork.matches(record.entry, byId('search').value, byId('method').value));
    const fragment = document.createDocumentFragment();
    for (const record of visible) {
      const entry = record.entry;
      const row = document.createElement('tr');
      const color = CleanNetwork.methodClass(entry.request.method);
      row.className = color;
      row.setAttribute('aria-selected', String(record.id === selectedId));
      const method = cell(row, '');
      const badge = document.createElement('span');
      badge.className = `badge ${color}`;
      badge.textContent = entry.request.method;
      method.append(badge);
      const status = Number(entry.response?.status) || 0;
      cell(row, status > 0 ? String(status) : 'Falhou', status === 0 || status >= 400 ? 'status-error' : '');
      const requestCell = cell(row, '');
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'request-name';
      name.title = entry.request.url;
      const domain = document.createElement('span');
      domain.className = 'domain';
      try {
        const url = new URL(entry.request.url);
        name.textContent = url.pathname.split('/').pop() + url.search || '/';
        domain.textContent = url.host;
      } catch { name.textContent = entry.request.url; }
      name.addEventListener('click', () => select(record));
      requestCell.append(name, domain);
      cell(row, (entry.response?.content?.mimeType || '—').split(';')[0]);
      cell(row, `${Math.round(entry.time || 0)} ms`);
      fragment.append(row);
    }
    byId('requests').replaceChildren(fragment);
    byId('empty').hidden = visible.length > 0;
    byId('counter').textContent = captureError || `${store.paused ? 'Pausado · ' : ''}${visible.length} visíveis · ${store.hidden} Kaspersky ocultas${store.dropped ? ` · ${store.dropped} antigas descartadas` : ''}`;
    if (selectedId !== null && !store.entries.some(record => record.id === selectedId)) closeDetails();
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  byId('clear').addEventListener('click', () => { store.clear(); closeDetails(); scheduleRender(); });
  byId('close').addEventListener('click', () => { closeDetails(); scheduleRender(); });
  byId('pause').addEventListener('click', () => {
    store.paused = !store.paused;
    byId('pause').textContent = store.paused ? 'Retomar' : 'Pausar';
    byId('pause').setAttribute('aria-pressed', String(store.paused));
    scheduleRender();
  });
  byId('search').addEventListener('input', scheduleRender);
  byId('method').addEventListener('change', scheduleRender);
  byId('preserve').addEventListener('change', event => { store.preserve = event.target.checked; });

  if (api?.devtools?.network) {
    const onFinished = entry => { store.add(entry); scheduleRender(); };
    const onNavigated = () => { store.navigate(); if (!store.preserve) closeDetails(); scheduleRender(); };
    api.devtools.network.onRequestFinished.addListener(onFinished);
    api.devtools.network.onNavigated.addListener(onNavigated);
    window.addEventListener('unload', () => {
      api.devtools.network.onRequestFinished.removeListener(onFinished);
      api.devtools.network.onNavigated.removeListener(onNavigated);
    });
  } else {
    captureError = 'Captura indisponível: abra esta página pela aba Rede limpa do DevTools.';
  }
  scheduleRender();
})();
