import sys
import types
import unittest

fake_huggingface_hub = types.ModuleType("huggingface_hub")
fake_huggingface_hub.InferenceClient = object
sys.modules.setdefault("huggingface_hub", fake_huggingface_hub)

from intelligence_service.app.providers import _normalize_tool_calls


class GemmaToolCallParsingTests(unittest.TestCase):
    def test_parses_valid_tool_arguments(self):
        tool_calls = _normalize_tool_calls(
            [
                {
                    "id": "call-1",
                    "function": {
                        "name": "search_code_chunks",
                        "arguments": "{\"query\":\"checkout flow\",\"limit\":4}",
                    },
                }
            ]
        )

        self.assertEqual(len(tool_calls), 1)
        self.assertEqual(tool_calls[0]["function"]["name"], "search_code_chunks")
        self.assertEqual(
            tool_calls[0]["function"]["arguments"],
            {
                "query": "checkout flow",
                "limit": 4,
            },
        )

    def test_rejects_malformed_tool_arguments(self):
        tool_calls = _normalize_tool_calls(
            [
                {
                    "id": "call-1",
                    "function": {
                        "name": "search_code_chunks",
                        "arguments": "{\"query\":\"checkout flow\"",
                    },
                }
            ]
        )

        self.assertEqual(tool_calls, [])


if __name__ == "__main__":
    unittest.main()
