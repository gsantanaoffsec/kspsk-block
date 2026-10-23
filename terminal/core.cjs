'use strict';

const COLORS = { GET: 32, POST: 33, PUT: 34, DELETE: 31, PATCH: 35 };

// Dados de rede nunca devem emitir sequências de controle no terminal.
function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}

function row(entry, { color = false, width = 120 } = {}) {
  const paint = (text, code) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const method = clean(entry.request.method).toUpperCase().slice(0, 8).padEnd(8);
  const status = Number(entry.response?.status) || 0;
  const elapsed = Number(entry.time);
  const time = (Number.isFinite(elapsed) && elapsed >= 0 ? `${Math.round(elapsed)} ms` : '—').padStart(9);
  const date = new Date(entry.startedDateTime);
  const clock = Number.isNaN(date.valueOf()) ? '--:--:--' : date.toLocaleTimeString('pt-BR', { hour12: false });
  const limit = Math.max(16, width - 39);
  let url = clean(entry.request.url);
  if (url.length > limit) url = url.slice(0, limit - 1) + '…';
  return `${paint(clock, 90)}  ${paint(method, COLORS[method.trim()] || 37)} ${paint(String(status || 'ERR').padEnd(4), status === 0 || status >= 400 ? 31 : 90)} ${time}  ${url}`;
}

module.exports = { row, clean };
