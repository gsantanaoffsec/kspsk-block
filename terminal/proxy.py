"""Proxy local: bloqueio antes do envio e eventos JSON para o menu Node."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from mitmproxy import http

ORIGINAL_HOST = "ff.kes.v2.scr.kaspersky-labs.com"


def blocked_reason(request, config):
    if (request.host.lower() == ORIGINAL_HOST and request.method == "GET"
            and request.scheme in ("http", "https")
            and request.port == (443 if request.scheme == "https" else 80)
            and (request.headers.get("sec-fetch-dest") == "empty"
                 or ("sec-fetch-dest" not in request.headers
                     and "origin" in request.headers))):
        return "regra original: GET XHR/fetch do host Kaspersky"
    methods = config.get("block_methods", [])
    if methods and request.method not in methods:
        return None
    for rule in config.get("block_urls", []):
        target = urlsplit(rule if "://" in rule else "//" + rule)
        # Host exato; caminho funciona como prefixo. Query opcional é literal.
        if target.hostname and request.host.lower() == target.hostname.lower():
            if target.scheme and request.scheme != target.scheme:
                continue
            if target.port and request.port != target.port:
                continue
            path = request.path.split("?", 1)[0]
            if target.path and not path.startswith(target.path):
                continue
            if target.query and request.path.partition("?")[2] != target.query:
                continue
            return "regra personalizada: " + rule
    return None


class Monitor:
    def __init__(self):
        self.config = json.loads(Path(os.environ["REDE_LIMPA_CONFIG"]).read_text())

    def request(self, flow):
        reason = blocked_reason(flow.request, self.config)
        if reason:
            flow.metadata["rede_limpa_block"] = reason
            flow.response = http.Response.make(
                403, b"Bloqueado pelo monitor Rede limpa.\n",
                {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"},
            )

    def emit(self, flow, error=None):
        start = flow.request.timestamp_start
        end = (flow.response.timestamp_end if flow.response else None) or datetime.now().timestamp()
        print(json.dumps({
            "request": {"method": flow.request.method, "url": flow.request.pretty_url},
            "response": {"status": flow.response.status_code if flow.response else 0},
            "time": max(0, (end - start) * 1000),
            "startedDateTime": datetime.fromtimestamp(start, timezone.utc).isoformat(),
            "blocked": flow.metadata.get("rede_limpa_block"),
            "error": error,
        }), flush=True)

    def response(self, flow):
        self.emit(flow)

    def error(self, flow):
        self.emit(flow, str(flow.error))

    def tls_failed_client(self, data):
        client = data.context.client
        print(json.dumps({
            "request": {"method": "TLS", "url": "https://" + (client.sni or "desconhecido") + "/"},
            "response": {"status": 0}, "startedDateTime": datetime.now(timezone.utc).isoformat(),
            "time": 0, "error": str(client.error or "O navegador recusou a conexão TLS com o proxy."),
        }), flush=True)


if os.environ.get("REDE_LIMPA_CONFIG"):
    addons = [Monitor()]
