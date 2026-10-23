'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { X509Certificate } = require('node:crypto');
const { spawn } = require('node:child_process');

function executable(names, platform = process.platform, environment = process.env) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  for (const name of names.filter(Boolean)) {
    const candidates = paths.isAbsolute(name) ? [name] : (environment.PATH || environment.Path || '').split(platform === 'win32' ? ';' : ':').flatMap(dir =>
      platform === 'win32' ? [paths.join(dir, name), paths.join(dir, name + '.exe')] : [paths.join(dir, name)]);
    for (const file of candidates) {
      try { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return file; } catch {}
    }
  }
  return null;
}

function browserCandidates(browser, platform = process.platform, environment = process.env, home = os.homedir()) {
  if (platform === 'darwin') {
    const app = browser === 'firefox' ? 'Firefox.app/Contents/MacOS/firefox' : 'Google Chrome.app/Contents/MacOS/Google Chrome';
    return [path.join('/Applications', app), path.join(home, 'Applications', app), ...(browser === 'chrome' ? ['/Applications/Chromium.app/Contents/MacOS/Chromium'] : [])];
  }
  if (platform === 'win32') {
    const suffix = browser === 'firefox' ? ['Mozilla Firefox', 'firefox.exe'] : ['Google', 'Chrome', 'Application', 'chrome.exe'];
    return [...[environment.PROGRAMFILES, environment['PROGRAMFILES(X86)'], environment.ProgramFiles, environment['ProgramFiles(x86)'], environment.LOCALAPPDATA].filter(Boolean).map(root => path.win32.join(root, ...suffix)), browser === 'firefox' ? 'firefox.exe' : 'chrome.exe'];
  }
  return browser === 'firefox' ? ['firefox', 'firefox-esr'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

function runtimePaths(root, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const directory = paths.join(root, 'venv', platform === 'win32' ? 'Scripts' : 'bin');
  return { python: paths.join(directory, platform === 'win32' ? 'python.exe' : 'python'), proxy: paths.join(directory, platform === 'win32' ? 'mitmdump.exe' : 'mitmdump') };
}

function execute(file, args, { quiet = false, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data; });
    child.stderr?.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${path.basename(file)} terminou com código ${code}: ${stderr.slice(-2000)}`)));
  });
}

function psString(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function powershell(script, find = executable) {
  return { file: find(['powershell.exe', 'pwsh.exe']), args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; " + script, 'utf16le').toString('base64')] };
}

function trustPlan(certificate, session, platform = process.platform, run = execute, find = executable) {
  const cert = new X509Certificate(fs.readFileSync(certificate));
  const fingerprint = cert.fingerprint.replaceAll(':', '').toUpperCase();
  const der = path.join(session, 'proxy-ca.cer');
  fs.writeFileSync(der, cert.raw, { mode: 0o600 });
  const marker = path.join(session, 'trust-state.json');
  const state = { platform, fingerprint, certificate, pid: process.pid };
  let installed = false;
  return {
    async install() {
      if (platform === 'win32') {
        const check = powershell(`if(Test-Path -LiteralPath 'Cert:\\CurrentUser\\Root\\${fingerprint}') { throw 'Certificado da sessão já existe; operação interrompida.' }`, find);
        const script = powershell(`Import-Certificate -FilePath ${psString(der)} -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null`, find);
        if (!script.file) throw new Error('PowerShell não encontrado para configurar o certificado HTTPS.');
        await run(check.file, check.args, { quiet: true });
        fs.writeFileSync(marker, JSON.stringify(state), { mode: 0o600 });
        installed = true;
        await run(script.file, script.args, { quiet: true });
      } else if (platform === 'darwin') {
        const security = '/usr/bin/security';
        const keychain = (await run(security, ['default-keychain', '-d', 'user'], { quiet: true })).replace(/^"|"$/g, '');
        const listing = await run(security, ['find-certificate', '-a', '-Z', keychain], { quiet: true });
        if (listing.includes(fingerprint)) throw new Error('Certificado da sessão já existe; operação interrompida.');
        state.keychain = keychain;
        fs.writeFileSync(marker, JSON.stringify(state), { mode: 0o600 });
        installed = true;
        await run(security, ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', keychain, certificate], { quiet: true });
      }
    },
    async remove() {
      if (!installed) return;
      await removeTrust(state, run, find);
      fs.rmSync(marker, { force: true });
    },
  };
}

async function removeTrust(state, run = execute, find = executable) {
  if (!/^[A-F0-9]{40}$/.test(state.fingerprint)) throw new Error('Identificador inválido no registro de certificado.');
  if (state.platform === 'win32') {
    const script = powershell(`$p='Cert:\\CurrentUser\\Root\\${state.fingerprint}'; if(Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }`, find);
    if (!script.file) throw new Error('PowerShell não encontrado para remover certificado da sessão.');
    await run(script.file, script.args, { quiet: true });
  } else if (state.platform === 'darwin') {
    const listing = await run('/usr/bin/security', ['find-certificate', '-a', '-Z', state.keychain], { quiet: true });
    if (listing.includes(state.fingerprint)) {
      await run('/usr/bin/security', ['remove-trusted-cert', state.certificate], { quiet: true });
      await run('/usr/bin/security', ['delete-certificate', '-Z', state.fingerprint, state.keychain], { quiet: true });
    }
  }
}

async function recoverTrust(root) {
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory() || !item.name.startsWith('session-')) continue;
    const directory = path.join(root, item.name);
    const marker = path.join(directory, 'trust-state.json');
    if (!fs.existsSync(marker)) continue;
    const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (state.platform !== process.platform) continue;
    if (Number.isInteger(state.pid) && state.pid > 0) {
      try { process.kill(state.pid, 0); continue; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (path.resolve(state.certificate) !== path.join(path.resolve(directory), 'proxy', 'mitmproxy-ca-cert.pem')) throw new Error('Registro de recuperação de certificado inválido.');
    const fingerprint = new X509Certificate(fs.readFileSync(state.certificate)).fingerprint.replaceAll(':', '').toUpperCase();
    if (state.fingerprint !== fingerprint) throw new Error('Certificado de recuperação não corresponde ao registro.');
    await removeTrust(state);
    fs.rmSync(marker);
    console.log('  Certificado de uma sessão interrompida removido da confiança do usuário.');
  }
}

module.exports = { executable, browserCandidates, runtimePaths, execute, trustPlan, recoverTrust, psString, powershell };
