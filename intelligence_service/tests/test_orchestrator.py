import sys
import types
import unittest

fake_huggingface_hub = types.ModuleType("huggingface_hub")
fake_huggingface_hub.InferenceClient = object
sys.modules.setdefault("huggingface_hub", fake_huggingface_hub)

from intelligence_service.app.orchestrator import AssistantOrchestrator
from intelligence_service.app.schemas import AssistantRequest


def build_request(**overrides):
    payload = {
        "traceId": "trace-test",
        "bundleVersion": "bundle-1",
        "expectedBundleVersion": "bundle-1",
        "request": {
            "message": "Explain checkout flow",
            "assistantMode": "chat",
            "conversationHistory": [],
            "images": [],
        },
        "userContext": {
            "id": "",
            "isAdmin": False,
            "isAuthenticated": False,
        },
        "runtimeContext": {
            "route": "/checkout",
            "routeLabel": "Checkout",
            "cartSummary": None,
            "currentProductId": "",
            "sessionId": "",
            "contextVersion": 0,
            "sessionMemory": {},
        },
        "providerConfig": {},
    }
    payload.update(overrides)
    return AssistantRequest(**payload)


class EvidenceGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_marks_stale_bundle_guard(self):
        orchestrator = AssistantOrchestrator()
        state = {
            "request": build_request(expectedBundleVersion="bundle-2"),
            "answer_mode": "app_grounded",
            "citations": [],
            "tool_results": [],
            "verification": {},
            "answer": "",
        }

        updated = await orchestrator.evidence_validator(state)

        self.assertEqual(updated["guard_reason"], "stale_bundle")
        self.assertTrue(updated["stale_bundle"])
        self.assertFalse(updated["missing_evidence"])
        self.assertEqual(updated["verification"]["label"], "cannot_verify")
        self.assertIn("does not match", updated["answer"])

    async def test_marks_missing_evidence_guard(self):
        orchestrator = AssistantOrchestrator()
        state = {
            "request": build_request(),
            "answer_mode": "app_grounded",
            "citations": [],
            "tool_results": [],
            "verification": {},
            "answer": "",
        }

        updated = await orchestrator.evidence_validator(state)

        self.assertEqual(updated["guard_reason"], "missing_repo_evidence")
        self.assertFalse(updated["stale_bundle"])
        self.assertTrue(updated["missing_evidence"])
        self.assertEqual(updated["verification"]["label"], "cannot_verify")
        self.assertIn("cannot verify", updated["answer"].lower())


class CompositionFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_knowledge_hello_skips_provider(self):
        orchestrator = AssistantOrchestrator()

        class ExplodingProvider:
            async def generate_text(self, **kwargs):
                raise AssertionError("provider should not be called for hello")

        orchestrator.provider = ExplodingProvider()

        answer = await orchestrator._compose_model_knowledge(
            "hello",
            images=[],
            event_callback=None,
            reasoning_model="gemma-test",
        )

        self.assertIn("Hello!", answer)
        self.assertIn("not repo-grounded", answer)

    async def test_grounded_answer_falls_back_when_provider_returns_none(self):
        orchestrator = AssistantOrchestrator()

        class NoneProvider:
            async def generate_text(self, **kwargs):
                return None

        orchestrator.provider = NoneProvider()

        answer = await orchestrator._compose_grounded_answer(
            message="Where is support video handled?",
            answer_mode="app_grounded",
            citations=[
                {
                    "label": "server/controllers/supportController.js",
                    "path": "server/controllers/supportController.js",
                }
            ],
            tool_results=[],
            images=[],
            event_callback=None,
            reasoning_model="gemma-test",
        )

        self.assertIn("indexed app bundle", answer)
        self.assertIn("supportController", answer)


if __name__ == "__main__":
    unittest.main()
