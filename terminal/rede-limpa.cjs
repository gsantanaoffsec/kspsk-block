#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');
const { row, clean } = require('./core.cjs');
const { executable, browserCandidates, runtimePaths, execute, trustPlan, recoverTrust } = require('./platform.cjs');

const VERSION = '12.3.0';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'];
const color = Boolean(process.stdout.isTTY && !('NO_COLOR' in process.env));
const paint = (text, code) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const command = execute;

function parseRules(value) {
  const rules = value.split(',').map(v => v.trim()).filter(Boolean);
  for (const rule of rules) {
    let url;
    try { url = new URL(rule.includes('://') ? rule : `http://${rule}`); } catch { throw new Error(`Host/URL inválido: ${rule}`); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || /[\s*]/.test(rule)) {
      throw new Error('Use host ou URL HTTP(S), sem curingas, credenciais ou fragmentos.');
    }
  }
  return rules;
}

function parseMethods(value) {
  if (!value.trim() || ['todos', '*'].includes(value.trim().toLowerCase())) return [];
  const methods = [...new Set(value.toUpperCase().split(',').map(v => v.trim()))];
  if (methods.some(v => !METHODS.includes(v))) throw new Error('Use métodos como GET,POST,PUT,DELETE, separados por vírgula.');
  return methods;
}

function browserExecutable(choice) {
  return executable(browserCandidates(choice));
}

async function runtime(root) {
  const venv = path.join(root, 'venv');
  const { python, proxy } = runtimePaths(root);
  const ready = fs.existsSync(python) && fs.existsSync(proxy) && spawnSync(python, ['-c', `import importlib.metadata; assert importlib.metadata.version('mitmproxy') == '${VERSION}'`], { stdio: 'ignore' }).status === 0;
  if (ready) return proxy;
  const systemPython = executable(process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']);
  const pythonArgs = process.platform === 'win32' && /[\\/]py(?:\.exe)?$/i.test(systemPython || '') ? ['-3'] : [];
  if (!systemPython) throw new Error('Instale Python 3.12+ e execute novamente.');
  console.log('  Preparando o proxy local na primeira execução…');
  await command(systemPython, [...pythonArgs, '-c', 'import sys; assert sys.version_info >= (3, 12), "Requer Python 3.12+"']);
  if (!fs.existsSync(python)) await command(systemPython, [...pythonArgs, '-m', 'venv', venv]);
  await command(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', `mitmproxy==${VERSION}`]);
  return proxy;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitProxy(port, certificate, child) {
  for (let i = 0; i < 150; i++) {
    if (!child.pid) throw new Error('Não foi possível executar o proxy local.');
    if (child.exitCode !== null) throw new Error(`O proxy não iniciou (código ${child.exitCode}).`);
    if (fs.existsSync(certificate)) {
      const open = await new Promise(resolve => {
        const socket = net.connect(port, '127.0.0.1');
        socket.setTimeout(300);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
      });
      if (open) return;
    }
    await delay(100);
  }
  throw new Error('Tempo esgotado ao iniciar o proxy.');
}

async function trust(certutil, directory, certificate) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await command(certutil, ['-N', '--empty-password', '-d', `sql:${directory}`], { quiet: true });
  await command(certutil, ['-A', '-d', `sql:${directory}`, '-n', 'Rede limpa — sessão local', '-t', 'C,,', '-i', certificate], { quiet: true });
}

function firefoxPrefs(port) {
  return Object.entries({
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': port,
    'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': port,
    'network.proxy.no_proxies_on': '', 'network.proxy.allow_hijacking_localhost': true,
    'network.proxy.failover_direct': false, 'network.http.http3.enable': false,
    'security.enterprise_roots.enabled': true,
    'network.trr.mode': 5, 'browser.shell.checkDefaultBrowser': false,
    'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0,
    'datareporting.policy.dataSubmissionEnabled': false,
  }).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n');
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { await command('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { quiet: true }); }
    catch (error) { if (child.exitCode === null && child.signalCode === null) throw error; }
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); }
}

async function runSession({ browser, binary, certutil, proxyBinary, root, config }) {
  const session = fs.mkdtempSync(path.join(root, 'session-'));
  fs.chmodSync(session, 0o700);
  const confdir = path.join(session, 'proxy');
  const certificate = path.join(confdir, 'mitmproxy-ca-cert.pem');
  const configFile = path.join(session, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  const home = path.join(session, 'home');
  const profile = path.join(session, 'browser');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(profile, { mode: 0o700 });
  const port = await freePort();
  let proxy, browserProcess, certificatePlan, total = 0, blocked = 0, errors = 0;
  let resolveEnd;
  const ending = new Promise(resolve => { resolveEnd = resolve; });
  const signal = () => resolveEnd();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    proxy = spawn(proxyBinary, ['--quiet', '--listen-host', '127.0.0.1', '--listen-port', String(port),
      '--set', `confdir=${confdir}`, '--set', 'connection_strategy=lazy', '--set', 'flow_detail=0',
      '--set', 'termlog_verbosity=error', '--set', 'ssl_insecure=false', '--set', 'upstream_cert=false',
      '-s', path.join(__dirname, 'proxy.py')], {
      env: { ...process.env, REDE_LIMPA_CONFIG: configFile }, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', windowsHide: true,
    });
    let startupError;
    proxy.once('error', error => { startupError = error; resolveEnd(error); });
    const lines = readline.createInterface({ input: proxy.stdout });
    lines.on('line', line => {
      let entry;
      try { entry = JSON.parse(line); } catch { if (line.trim()) console.error('  Proxy: ' + clean(line)); return; }
      if (!entry.request) return;
      total++;
      if (entry.blocked) blocked++;
      const failed = Boolean(entry.error || (entry.response?.status || 0) >= 400 || !entry.response?.status);
      if (failed) errors++;
      if (config.only_errors && !failed) return;
      const label = entry.blocked ? paint('BLOQUEADA', 31) : failed ? paint('ERRO     ', 31) : paint('OK       ', 90);
      console.log(`  ${label} ${row(entry, { color, width: (process.stdout.columns || 140) - 14 })}`);
      if (entry.blocked || entry.error) console.log('             ' + paint(clean(entry.blocked || entry.error), 90));
    });
    proxy.stderr.on('data', data => console.error('  Proxy: ' + clean(data.toString())));
    proxy.once('exit', code => resolveEnd(new Error(`O proxy encerrou inesperadamente (${code}).`)));
    await waitProxy(port, certificate, proxy);
    if (startupError) throw startupError;
    const browserEnv = process.platform === 'linux'
      ? { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share') }
      : { ...process.env };
    if (process.platform !== 'linux') {
      certificatePlan = trustPlan(certificate, session);
      await certificatePlan.install();
    }
    let args;
    if (browser === 'firefox') {
      if (process.platform === 'linux') await trust(certutil, profile, certificate);
      fs.writeFileSync(path.join(profile, 'user.js'), firefoxPrefs(port));
      args = ['--no-remote', '--profile', profile, 'about:blank'];
    } else {
      // Chromium usa NSS do HOME, sem alterar a confiança do perfil habitual.
      if (process.platform === 'linux') {
        await trust(certutil, path.join(home, '.pki/nssdb'), certificate);
        await trust(certutil, path.join(home, '.local/share/pki/nssdb'), certificate);
      }
      args = [`--user-data-dir=${profile}`, `--proxy-server=http://127.0.0.1:${port}`,
        '--proxy-bypass-list=<-loopback>', '--disable-quic', '--disable-background-networking', '--disable-background-mode',
        '--no-first-run', '--no-default-browser-check', 'about:blank'];
    }
    console.log('\n  ' + paint('● MONITOR ATIVO', 36) + ` • ${browser === 'firefox' ? 'Firefox' : 'Chrome/Chromium'}`);
    console.log('  Navegue na janela de testes que será aberta. O navegador habitual fica separado.');
    console.log(`  Regras extras: ${config.block_urls.join(', ') || 'nenhuma'} | Métodos bloqueados: ${config.block_methods.join(', ') || 'todos'}`);
    console.log(`  Exibição: ${config.only_errors ? 'erros e bloqueios' : 'todas as requisições'} • Ctrl+C encerra navegador e proxy.\n`);
    console.log('  EVENTO    HORA      MÉTODO   HTTP     TEMPO  URL');
    console.log('  ' + '─'.repeat(Math.min(process.stdout.columns || 120, 140) - 2));
    browserProcess = spawn(binary, args, { env: browserEnv, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let browserLog = '';
    browserProcess.stderr.on('data', data => { browserLog = (browserLog + data.toString()).slice(-4000); });
    browserProcess.once('error', resolveEnd);
    browserProcess.once('exit', code => resolveEnd(code ? new Error(`O navegador não iniciou ou encerrou com erro (${code}): ${clean(browserLog)}`) : undefined));
    const result = await ending;
    if (result instanceof Error) throw result;
  } finally {
    const stopped = await Promise.allSettled([stop(browserProcess), stop(proxy)]);
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    try { await certificatePlan?.remove(); }
    catch (error) {
      console.error(`  Certificado da sessão não pôde ser removido. Execute o script novamente para recuperar. Dados preservados em ${session}.`);
      throw error;
    }
    const failedStop = stopped.find(result => result.status === 'rejected');
    if (failedStop) throw failedStop.reason;
    fs.rmSync(session, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    console.log(`\n  Encerrado • ${total} requisições · ${blocked} bloqueadas · ${errors} erros/bloqueios\n`);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Execute: node terminal/rede-limpa.cjs\nO menu pergunta navegador, bloqueios e exibição. Sem extensão.\nWindows, macOS ou Linux com interface gráfica; Node.js 18+, Python 3.12+. Linux requer certutil NSS.');
    return;
  }
  if (process.argv.length > 2) throw new Error('Execute sem opções: node terminal/rede-limpa.cjs');
  if (!process.stdin.isTTY) throw new Error('Abra um terminal interativo para responder ao menu.');
  if (!['linux', 'win32', 'darwin'].includes(process.platform)) throw new Error('Sistema não suportado. Use Windows, macOS ou Linux.');
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('É necessário um terminal na sua sessão gráfica para abrir o navegador.');
  console.log('\n  ' + paint('╭─────────────────────────────────────────────╮\n  │  REDE LIMPA  •  Monitor e bloqueador local   │\n  ╰─────────────────────────────────────────────╯', 36));
  console.log('  ' + ['GET', 'POST', 'PUT', 'DELETE'].map((m, i) => paint(m, [32, 33, 34, 31][i])).join('   '));
  console.log('  Sem extensão • perfil de testes • certificado temporário\n');
  if (process.platform !== 'linux') console.log('  HTTPS: adiciona uma CA local à confiança do seu usuário durante a sessão.\n  Ela será removida ao encerrar. No macOS, autorize a operação no diálogo do sistema.\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));
  async function validated(prompt, parse) {
    while (true) { try { return parse(await ask(prompt)); } catch (error) { console.log('  ' + paint(clean(error.message), 31)); } }
  }
  let browser, config;
  try {
    browser = await validated('  Navegador [1] Chrome/Chromium  [2] Firefox: ', value => {
      const v = value.trim().toLowerCase();
      if (['1', 'chrome', 'chromium'].includes(v)) return 'chrome';
      if (['2', 'firefox'].includes(v)) return 'firefox';
      throw new Error('Escolha 1 ou 2.');
    });
    console.log('\n  A regra original GET XHR/fetch do host Kaspersky já fica bloqueada.');
    console.log('  Bloqueios extras: host ou host/caminho, separados por vírgula.');
    const block_urls = await validated('  Quais requisições bloquear? [Enter = só regra original]: ', parseRules);
    const block_methods = block_urls.length ? await validated('  Métodos dos bloqueios extras [Enter = todos]: ', parseMethods) : [];
    const only_errors = await validated('  Mostrar [1] tudo  [2] só erros e bloqueios [Enter = 1]: ', value => {
      if (['', '1'].includes(value.trim())) return false;
      if (value.trim() === '2') return true;
      throw new Error('Escolha 1 ou 2.');
    });
    config = { block_urls, block_methods, only_errors };
  } finally { rl.close(); }
  const binary = browserExecutable(browser);
  if (!binary) throw new Error(`Instale ${browser === 'firefox' ? 'Firefox' : 'Chrome ou Chromium'} e execute novamente.`);
  const certutil = process.platform === 'linux' ? executable(['certutil']) : null;
  if (process.platform === 'linux' && !certutil) throw new Error('Instale o utilitário NSS certutil (Debian/Ubuntu: sudo apt install libnss3-tools) e execute novamente.');
  const root = process.env.REDE_LIMPA_HOME || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'RedeLimpa')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'RedeLimpa') : path.join(os.homedir(), '.cache', 'rede-limpa'));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  await recoverTrust(root);
  const proxyBinary = await runtime(root);
  await runSession({ browser, binary, certutil, proxyBinary, root, config });
}

if (require.main === module) main().catch(error => { console.error('\n  ' + paint('ERRO: ', 31) + clean(error.message)); process.exitCode = 1; });
module.exports = { parseRules, parseMethods, firefoxPrefs, runSession, trust, runtime, browserExecutable };
