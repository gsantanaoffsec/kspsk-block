const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const folder = join(__dirname, '../chrome');
const source = name => readFileSync(join(folder, name), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(source('network-core.js'), context);
const core = context.CleanNetwork;
const host = 'ff.kes.v2.scr.kaspersky-labs.com';
function request(url = 'http://localhost:4000/users', method = 'GET', status = 200) {
  return { request: { url, method, headers: [], queryString: [] }, response: { status, headers: [], content: { mimeType: 'application/json' } }, time: 12 };
}

test('oculta init e from do Kaspersky em qualquer status e método', () => {
  const store = new core.RequestStore();
  for (const path of ['/session/init?nocache=1', '/id/session/from?tm=now']) {
    for (const method of ['GET', 'POST']) {
      for (const status of [0, 200, 500]) store.add(request(`http://${host}${path}`, method, status));
    }
  }
  assert.equal(store.hidden, 12);
  assert.equal(store.entries.length, 0);
});

test('não esconde erros da API, domínios parecidos ou URL contendo o host na query', () => {
  const urls = ['http://localhost:4000/users', `https://${host}.example.com/from`, `https://sub.${host}/from`, `https://api.example.com/?url=${host}`];
  const store = new core.RequestStore();
  for (const url of urls) store.add(request(url, 'GET', 500));
  assert.equal(store.entries.length, 4);
  assert.equal(store.hidden, 0);
});

test('hostname normalizado e porta não contornam ocultação visual', () => {
  assert.equal(core.isHidden(`https://${host.toUpperCase()}:8443/init`), true);
  assert.equal(core.isHidden('URL inválida'), false);
});

test('quatro métodos pedidos recebem classes distintas', () => {
  assert.equal(core.methodClass('GET'), 'get');
  assert.equal(core.methodClass('POST'), 'post');
  assert.equal(core.methodClass('PUT'), 'put');
  assert.equal(core.methodClass('DELETE'), 'delete');
  assert.equal(core.methodClass('HEAD'), 'other');
});

test('busca combina URL ou status com filtro por método', () => {
  const entry = request('http://localhost:4000/users?page=1', 'POST', 422);
  assert.equal(core.matches(entry, ' USERS ', 'POST'), true);
  assert.equal(core.matches(entry, '422', 'POST'), true);
  assert.equal(core.matches(entry, 'users', 'GET'), false);
});

test('buffer limitado descarta antigas sem guardar chamadas ocultas', () => {
  const store = new core.RequestStore(2);
  store.add(request('http://localhost/a'));
  store.add(request(`http://${host}/init`));
  store.add(request('http://localhost/b'));
  store.add(request('http://localhost/c'));
  assert.equal(store.entries.length, 2);
  assert.equal(store.entries[0].entry.request.url, 'http://localhost/b');
  assert.equal(store.hidden, 1);
  assert.equal(store.dropped, 1);
});

test('pausa descarta entradas e navegação respeita preservar', () => {
  const store = new core.RequestStore();
  store.paused = true;
  store.add(request());
  assert.equal(store.entries.length, 0);
  store.paused = false;
  store.add(request());
  store.preserve = true;
  store.navigate();
  assert.equal(store.entries.length, 1);
  store.preserve = false;
  store.navigate();
  assert.equal(store.entries.length, 0);
});

test('limpar não reutiliza ID e formatação limita corpo grande', () => {
  const store = new core.RequestStore();
  const first = store.add(request()).id;
  store.clear();
  assert.ok(store.add(request()).id > first);
  assert.ok(core.pretty('a'.repeat(200001)).includes('Exibição limitada'));
  assert.equal(core.pretty('{"ok":true}'), '{\n  "ok": true\n}');
});

class Element {
  constructor(tag = '') { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.value = ''; this.hidden = false; this.ownText = ''; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  append(...items) {
    for (const item of items) {
      if (item.tag === 'fragment') this.children.push(...item.children);
      else this.children.push(item);
    }
  }
  replaceChildren(...items) { this.children = []; this.ownText = ''; this.append(...items); }
  addEventListener(type, listener) { this.events[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  fire(type) { return this.events[type]?.({ target: this }); }
}

function panel(firefox) {
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
  };
  function event() {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), fire: arg => listeners.forEach(fn => fn(arg)) };
  }
  const network = { onRequestFinished: event(), onNavigated: event() };
  const api = { devtools: { network }, runtime: { lastError: null } };
  const ctx = vm.createContext({ URL, document, window: new Element(), requestAnimationFrame: fn => fn(), [firefox ? 'browser' : 'chrome']: api });
  vm.runInContext(source('network-core.js'), ctx);
  vm.runInContext(source('panel.js'), ctx);
  return { el: id => document.getElementById(id), network };
}

for (const firefox of [true, false]) {
  const browserName = firefox ? 'Firefox' : 'Chrome/Edge';
  test(`${browserName}: integração da tabela, ocultação e cores`, () => {
    const ui = panel(firefox);
    ui.network.onRequestFinished.fire(request(`http://${host}/session/init`, 'GET', 200));
    ui.network.onRequestFinished.fire(request(`http://${host}/session/from`, 'GET', 0));
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) ui.network.onRequestFinished.fire(request('http://localhost:4000/users', method, method === 'GET' ? 500 : 200));
    const rows = ui.el('requests').children;
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => row.className), ['get', 'post', 'put', 'delete']);
    assert.equal(rows[0].children[1].textContent, '500');
    assert.ok(ui.el('counter').textContent.includes('2 Kaspersky ocultas'));
    ui.el('method').value = 'DELETE';
    ui.el('method').fire('change');
    assert.equal(ui.el('requests').children.length, 1);
    ui.el('clear').fire('click');
    assert.equal(ui.el('requests').children.length, 0);
  });

  test(`${browserName}: Response usa adapter correto e nunca vira HTML`, async () => {
    const ui = panel(firefox);
    const entry = request();
    const payload = '<img src=x onerror=alert(1)>';
    entry.getContent = firefox ? async () => [payload, 'text/html'] : callback => callback(payload, '');
    ui.network.onRequestFinished.fire(entry);
    const button = ui.el('requests').children[0].children[2].children[0];
    await button.fire('click');
    const sections = ui.el('details').children;
    assert.equal(sections.at(-1).tag, 'pre');
    assert.equal(sections.at(-1).textContent, payload);
  });

  test(`${browserName}: resposta lenta não substitui seleção mais recente`, async () => {
    const ui = panel(firefox);
    let finishFirst;
    const first = request('http://localhost/first');
    first.getContent = firefox ? () => new Promise(resolve => { finishFirst = () => resolve(['primeira', '']); }) : callback => { finishFirst = () => callback('primeira', ''); };
    const second = request('http://localhost/second');
    second.getContent = firefox ? async () => ['segunda', ''] : callback => callback('segunda', '');
    ui.network.onRequestFinished.fire(first);
    ui.network.onRequestFinished.fire(second);
    const firstSelection = ui.el('requests').children[0].children[2].children[0].fire('click');
    await ui.el('requests').children[1].children[2].children[0].fire('click');
    finishFirst();
    await firstSelection;
    assert.equal(ui.el('details').children.at(-1).textContent, 'segunda');
  });
}

test('criação da aba funciona com Promise Firefox e callback Chrome', async () => {
  for (const firefox of [true, false]) {
    let args;
    const api = { devtools: { panels: { create(...values) { args = values; return firefox ? Promise.resolve({}) : undefined; } } } };
    const ctx = vm.createContext({ console, [firefox ? 'browser' : 'chrome']: api });
    vm.runInContext(source('devtools.js'), ctx);
    await Promise.resolve();
    assert.equal(args[0], 'Rede limpa');
    assert.equal(args[2], 'panel.html');
  }
});
