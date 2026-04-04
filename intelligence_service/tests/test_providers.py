import sys
import types
import unittest

fake_huggingface_hub = types.ModuleType("huggingface_hub")
fake_huggingface_hub.InferenceClient = object
sys.modules.setdefault("huggingface_hub", fake_huggingface_hub)

from intelligence_service.app.providers import _normalize_tool_calls
from intelligence_service.app.providers import (
    _extract_gemini_text,
    _normalize_google_gemma_model_name,
    _normalize_prompt_tool_calls,
    _supports_hosted_gemma_thinking,
)


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

    def test_normalizes_google_hosted_model_names_for_native_gemma_api(self):
        self.assertEqual(
            _normalize_google_gemma_model_name("google/gemma-4-31B-it:novita"),
            "gemma-4-31b-it",
        )
        self.assertEqual(
            _normalize_google_gemma_model_name("gemma-4-27b-it"),
            "gemma-4-27b-it",
        )

    def test_normalizes_prompt_style_tool_calls(self):
        tool_calls = _normalize_prompt_tool_calls(
            [
                {
                    "name": "search_code_chunks",
                    "parameters": {
                        "query": "checkout flow",
                        "limit": 4,
                    },
                },
                {
                    "name": "trace_system_path",
                    "parameters": {
                        "query": "cart to checkout",
                    },
                },
            ]
        )

        self.assertEqual(len(tool_calls), 2)
        self.assertEqual(tool_calls[0]["function"]["name"], "search_code_chunks")
        self.assertEqual(tool_calls[1]["function"]["arguments"]["query"], "cart to checkout")

    def test_extracts_visible_text_without_thought_parts(self):
        text = _extract_gemini_text(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": "internal reasoning",
                                    "thought": True,
                                },
                                {
                                    "text": "Visible answer.",
                                },
                            ]
                        }
                    }
                ]
            }
        )

        self.assertEqual(text, "Visible answer.")

    def test_hosted_gemma_models_do_not_claim_thinking_config_support(self):
        self.assertFalse(_supports_hosted_gemma_thinking("gemma-3-27b-it"))
        self.assertTrue(_supports_hosted_gemma_thinking("gemma-4-31b-it"))
        self.assertTrue(_supports_hosted_gemma_thinking("gemini-2.5-pro"))


if __name__ == "__main__":
    unittest.main()
