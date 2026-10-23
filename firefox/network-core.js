(() => {
  'use strict';
  const hiddenHost = 'ff.kes.v2.scr.kaspersky-labs.com';
  const methodClasses = { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' };

  function isHidden(url) {
    try { return new URL(url).hostname.toLowerCase() === hiddenHost; }
    catch { return false; }
  }

  function methodClass(method) {
    return methodClasses[String(method).toUpperCase()] || 'other';
  }

  function matches(entry, query, method) {
    if (method && entry.request.method.toUpperCase() !== method) return false;
    const search = `${entry.request.method} ${entry.request.url} ${entry.response?.status ?? ''}`;
    return search.toLowerCase().includes(query.trim().toLowerCase());
  }

  function pretty(value) {
    const text = String(value ?? '');
    if (text.length > 200000) return text.slice(0, 200000) + '\n[Exibição limitada a 200.000 caracteres]';
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
  }

  class RequestStore {
    constructor(limit = 500) {
      this.limit = limit;
      this.entries = [];
      this.hidden = 0;
      this.dropped = 0;
      this.nextId = 1;
      this.paused = false;
      this.preserve = false;
    }
    add(request) {
      if (this.paused || !request?.request?.url) return null;
      if (isHidden(request.request.url)) { this.hidden++; return null; }
      const record = { id: this.nextId++, entry: request };
      this.entries.push(record);
      if (this.entries.length > this.limit) { this.entries.shift(); this.dropped++; }
      return record;
    }
    clear() { this.entries = []; this.hidden = 0; this.dropped = 0; }
    navigate() { if (!this.preserve) this.clear(); }
  }

  globalThis.CleanNetwork = { hiddenHost, isHidden, methodClass, matches, pretty, RequestStore };
})();
