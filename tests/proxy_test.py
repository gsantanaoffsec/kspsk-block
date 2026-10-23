import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("rede_limpa_proxy", Path(__file__).parents[1] / "terminal/proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


def request(**overrides):
    values = dict(host=proxy.ORIGINAL_HOST, method="GET", scheme="https", port=443,
                  path="/init?test=1", headers={"sec-fetch-dest": "empty"})
    values.update(overrides)
    return SimpleNamespace(**values)


class RulesTest(unittest.TestCase):
    def test_original_cannot_be_disabled_by_custom_method_selection(self):
        self.assertIsNotNone(proxy.blocked_reason(request(), {"block_methods": ["POST"]}))
        self.assertIsNotNone(proxy.blocked_reason(request(scheme="http", port=80, headers={"origin": "http://app.example"}), {}))

    def test_original_scope_keeps_other_hosts_ports_methods_and_resource_types(self):
        for change in [dict(method="POST"), dict(port=8443), dict(headers={"sec-fetch-dest": "document"}),
                       dict(host="sub." + proxy.ORIGINAL_HOST), dict(host=proxy.ORIGINAL_HOST + ".example"),
                       dict(headers={})]:
            self.assertIsNone(proxy.blocked_reason(request(**change), {}), change)

    def test_custom_host_path_and_methods(self):
        config = {"block_urls": ["api.example.com/private"], "block_methods": ["DELETE"]}
        self.assertIsNotNone(proxy.blocked_reason(request(host="api.example.com", path="/private/1", method="DELETE"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="api.example.com", path="/public", method="DELETE"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="api.example.com", path="/private/1"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="sub.api.example.com", path="/private/1", method="DELETE"), config))

    def test_explicit_scheme_port_and_query(self):
        config = {"block_urls": ["https://api.example.com:8443/users?id=1"]}
        self.assertIsNotNone(proxy.blocked_reason(request(host="api.example.com", port=8443, path="/users?id=1"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="api.example.com", port=8443, path="/users?id=2"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="api.example.com", port=443, path="/users?id=1"), config))
        self.assertIsNone(proxy.blocked_reason(request(host="api.example.com", scheme="http", port=8443, path="/users?id=1"), config))

    def test_block_returns_local_response_without_upstream(self):
        monitor = proxy.Monitor.__new__(proxy.Monitor)
        monitor.config = {"block_urls": ["api.example.com"]}
        flow = SimpleNamespace(request=request(host="api.example.com"), metadata={}, response=None)
        monitor.request(flow)
        self.assertEqual(flow.response.status_code, 403)
        self.assertIn("rede_limpa_block", flow.metadata)
        self.assertEqual(flow.response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
