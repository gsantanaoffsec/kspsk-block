'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { X509Certificate } = require('node:crypto');
const { row } = require('../terminal/core.cjs');
const { parseRules, parseMethods, firefoxPrefs } = require('../terminal/rede-limpa.cjs');
const { browserCandidates, runtimePaths, powershell, psString, trustPlan } = require('../terminal/platform.cjs');

test('menu valida bloqueios por host/URL sem aceitar credenciais, curingas ou protocolos inválidos', () => {
  assert.deepEqual(parseRules(' api.example.com/users, https://other.example/ '), ['api.example.com/users', 'https://other.example/']);
  assert.deepEqual(parseRules(''), []);
  for (const rule of ['https://user:pass@example.com', '*.example.com', 'ftp://example.com', 'http://[', 'example.com/#fragment', 'example.com/a b']) {
    assert.throws(() => parseRules(rule), rule);
  }
});

test('menu normaliza métodos e aceita todos sem alterar a regra fixa', () => {
  assert.deepEqual(parseMethods('get, POST,get'), ['GET', 'POST']);
  assert.deepEqual(parseMethods(''), []);
  assert.deepEqual(parseMethods('todos'), []);
  assert.throws(() => parseMethods('GTE'));
});

test('perfil Firefox usa proxy também para HTTPS e localhost sem fallback direto', () => {
  const prefs = firefoxPrefs(12345);
  for (const expected of [
    'user_pref("network.proxy.type", 1)', 'user_pref("network.proxy.ssl_port", 12345)',
    'user_pref("network.proxy.allow_hijacking_localhost", true)',
    'user_pref("network.proxy.failover_direct", false)',
    'user_pref("network.http.http3.enable", false)',
  ]) assert.ok(prefs.includes(expected), expected);
  assert.doesNotMatch(prefs, /security\.cert_pinning\.enforcement_level|ignore.*cert/);
});

test('cores dos quatro métodos e sanitização de controles recebidos pela rede', () => {
  const entry = method => ({ request: { method, url: 'https://example.com/\x1b]52;c;attack\x07\n' }, response: { status: 500 }, time: 12, startedDateTime: '2026-10-23T12:00:00Z' });
  for (const [method, color] of [['GET', 32], ['POST', 33], ['PUT', 34], ['DELETE', 31]]) {
    assert.ok(row(entry(method), { color: true }).includes(`\x1b[${color}m${method}`));
  }
  const text = row(entry('GET'));
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(text), false);
  assert.ok(text.includes('500'));
});

test('ajuda explica menu e execução sem extensão; modo não interativo falha claramente', () => {
  const cli = path.join(__dirname, '../terminal/rede-limpa.cjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Sem extensão/);
  const piped = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /terminal interativo/);
});

test('caminhos de navegador e runtime atendem Windows e macOS, incluindo espaços', () => {
  assert.deepEqual(runtimePaths('C:\\Users\\Ana Silva\\RedeLimpa', 'win32'), {
    python: 'C:\\Users\\Ana Silva\\RedeLimpa\\venv\\Scripts\\python.exe',
    proxy: 'C:\\Users\\Ana Silva\\RedeLimpa\\venv\\Scripts\\mitmdump.exe',
  });
  assert.ok(browserCandidates('chrome', 'win32', { PROGRAMFILES: 'C:\\Program Files' }).includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(browserCandidates('firefox', 'win32', { PROGRAMFILES: 'C:\\Program Files' }).includes('C:\\Program Files\\Mozilla Firefox\\firefox.exe'));
  assert.ok(browserCandidates('chrome', 'darwin').includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(browserCandidates('firefox', 'darwin').includes('/Applications/Firefox.app/Contents/MacOS/firefox'));
});

test('PowerShell codifica Unicode e protege caminhos com aspas sem usar shell', () => {
  assert.equal(psString("C:\\Ana's files\\ca.cer"), "'C:\\Ana''s files\\ca.cer'");
  const source = "Write-Output 'ação'";
  const script = powershell(source, () => 'powershell.exe');
  assert.equal(script.file, 'powershell.exe');
  assert.ok(Buffer.from(script.args.at(-1), 'base64').toString('utf16le').endsWith(source));
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform}: instala e remove somente a CA da sessão e mantém registro até a remoção`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-limpa-native-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const certificate = path.join(__dirname, 'fixtures/test-ca.pem');
    const fingerprint = new X509Certificate(fs.readFileSync(certificate)).fingerprint.replaceAll(':', '');
    const calls = [];
    let imported = false;
    const fake = async (file, args) => {
      const decoded = file === 'powershell.exe' ? Buffer.from(args.at(-1), 'base64').toString('utf16le') : args.join(' ');
      calls.push(decoded);
      if (args[0] === 'default-keychain') return '"/Users/Ana Silva/Library/Keychains/login.keychain-db"';
      if (args[0] === 'find-certificate') return imported ? `SHA-1 hash: ${fingerprint}` : '';
      if (decoded.includes('Import-Certificate') || args[0] === 'add-trusted-cert') imported = true;
      return '';
    };
    const plan = trustPlan(certificate, directory, platform, fake, () => 'powershell.exe');
    await plan.install();
    assert.equal(fs.existsSync(path.join(directory, 'trust-state.json')), true);
    await plan.remove();
    assert.equal(fs.existsSync(path.join(directory, 'trust-state.json')), false);
    if (platform === 'win32') {
      assert.ok(calls.some(s => s.includes('Import-Certificate') && s.includes('Cert:\\CurrentUser\\Root')));
      assert.ok(calls.some(s => s.includes('Remove-Item') && s.includes(fingerprint)));
      assert.equal(calls.some(s => s.includes('LocalMachine')), false);
    } else {
      assert.ok(calls.some(s => s.startsWith('add-trusted-cert -r trustRoot -p ssl -k /Users/Ana Silva/')));
      assert.ok(calls.some(s => s.startsWith('remove-trusted-cert')));
      assert.ok(calls.some(s => s.includes(`delete-certificate -Z ${fingerprint}`)));
      assert.equal(calls.some(s => s.includes('-d trust')), false);
    }
  });
}

test('falha na remoção mantém o registro de recuperação; certificado preexistente não é removido', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-limpa-trust-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const certificate = path.join(__dirname, 'fixtures/test-ca.pem');
  const fake = async (_file, args) => {
    if (Buffer.from(args.at(-1), 'base64').toString('utf16le').includes('Remove-Item')) throw new Error('removal denied');
    return '';
  };
  const plan = trustPlan(certificate, directory, 'win32', fake, () => 'powershell.exe');
  await plan.install();
  await assert.rejects(plan.remove(), /removal denied/);
  assert.equal(fs.existsSync(path.join(directory, 'trust-state.json')), true);
  let calls = 0;
  const preexisting = trustPlan(certificate, directory, 'win32', async () => { calls++; throw new Error('exists'); }, () => 'powershell.exe');
  await assert.rejects(preexisting.install(), /exists/);
  await preexisting.remove();
  assert.equal(calls, 1, 'não tenta remover certificado que já existia');
});
