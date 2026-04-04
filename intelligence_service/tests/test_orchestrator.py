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

    async def test_allows_stale_bundle_when_workspace_evidence_exists(self):
        orchestrator = AssistantOrchestrator()
        state = {
            "request": build_request(expectedBundleVersion="bundle-2"),
            "answer_mode": "app_grounded",
            "citations": [
                {
                    "id": "workspace:server/services/intelligence/intelligenceGatewayService.js:1",
                    "label": "server/services/intelligence/intelligenceGatewayService.js:1",
                    "type": "code",
                    "path": "server/services/intelligence/intelligenceGatewayService.js",
                    "excerpt": "const hasRepoHint = ...",
                    "startLine": 1,
                    "endLine": 12,
                    "score": 0.91,
                    "metadata": {},
                }
            ],
            "tool_results": [
                {
                    "toolRun": {
                        "toolName": "search_code_chunks",
                        "outputPreview": {
                            "store": "workspace",
                        },
                    },
                    "result": {
                        "store": "workspace",
                        "results": [],
                    },
                }
            ],
            "verification": {},
            "answer": "",
        }

        updated = await orchestrator.evidence_validator(state)

        self.assertEqual(updated["guard_reason"], "stale_bundle_live_repo_fallback")
        self.assertTrue(updated["stale_bundle"])
        self.assertFalse(updated["missing_evidence"])
        self.assertEqual(updated["verification"]["label"], "app_grounded")
        self.assertIn("live repo source files", updated["verification"]["summary"])


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


class StoreBackedToolRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_prefers_qdrant_for_search_code_chunks(self):
        orchestrator = AssistantOrchestrator()

        class StubQdrantStore:
            async def search_chunks(self, **kwargs):
                return [
                    {
                        "id": "chunk-1",
                        "label": "server/routes/aiRoutes.js:12",
                        "type": "code",
                        "path": "server/routes/aiRoutes.js",
                        "excerpt": "router.post('/chat', ...)",
                        "startLine": 12,
                        "endLine": 28,
                        "score": 0.91,
                        "metadata": {
                            "subsystem": "backend",
                        },
                    }
                ]

            async def close(self):
                return None

        class StubBundleStore:
            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/routes/aiRoutes.js",
                    "subsystem": "backend",
                    "startLine": 12,
                    "endLine": 28,
                    "content": "router.post('/chat', ...)",
                }

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when qdrant returns results")

            async def close(self):
                return None

        orchestrator.qdrant_store = StubQdrantStore()
        orchestrator.bundle_store = StubBundleStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "search_code_chunks",
                    "input": {
                        "query": "checkout flow",
                        "limit": 4,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "qdrant")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "qdrant")
        self.assertIn("search_code_chunks", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertIn("get_file_section", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertTrue(any(citation["path"] == "server/routes/aiRoutes.js" for citation in updated["citations"]))

    async def test_prefers_workspace_search_when_bundle_is_stale(self):
        orchestrator = AssistantOrchestrator()

        class ExplodingQdrantStore:
            async def search_chunks(self, **kwargs):
                raise AssertionError("qdrant should be skipped when the bundle is stale")

            async def close(self):
                return None

        class StubWorkspaceStore:
            async def search_code_chunks(self, **kwargs):
                return [
                    {
                        "id": "workspace:server/services/intelligence/intelligenceGatewayService.js:1",
                        "label": "server/services/intelligence/intelligenceGatewayService.js:1",
                        "type": "code",
                        "path": "server/services/intelligence/intelligenceGatewayService.js",
                        "excerpt": "const hasRepoHint = ...",
                        "startLine": 1,
                        "endLine": 20,
                        "score": 0.93,
                        "metadata": {
                            "subsystem": "backend",
                            "source": "workspace",
                        },
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/services/intelligence/intelligenceGatewayService.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 20,
                    "content": "const hasRepoHint = ...",
                }

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when workspace resolves stale repo search")

            async def close(self):
                return None

        orchestrator.qdrant_store = ExplodingQdrantStore()
        orchestrator.workspace_store = StubWorkspaceStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(
                expectedBundleVersion="bundle-2",
                request={
                    "message": "Explain intelligenceGatewayService.js",
                    "assistantMode": "chat",
                    "conversationHistory": [],
                    "images": [],
                },
            ),
            "tool_plan": [
                {
                    "toolName": "search_code_chunks",
                    "input": {
                        "query": "intelligenceGatewayService.js",
                        "limit": 4,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "workspace")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "workspace")

    async def test_prefers_workspace_trace_when_bundle_is_stale(self):
        orchestrator = AssistantOrchestrator()

        class ExplodingNeo4jStore:
            async def trace_paths(self, **kwargs):
                raise AssertionError("neo4j should be skipped when the bundle is stale")

            async def close(self):
                return None

        class StubWorkspaceStore:
            async def trace_system_path(self, **kwargs):
                return [
                    {
                        "focus": {
                            "id": "route:POST:/api/ai/chat",
                            "type": "route",
                            "label": "POST /api/ai/chat",
                            "path": "/api/ai/chat",
                            "subsystem": "backend",
                        },
                        "summary": "Matched live workspace graph entity POST /api/ai/chat",
                        "steps": [
                            {
                                "type": "handled_by",
                                "from": {
                                    "id": "route:POST:/api/ai/chat",
                                    "type": "route",
                                    "label": "POST /api/ai/chat",
                                    "path": "/api/ai/chat",
                                    "subsystem": "backend",
                                },
                                "to": {
                                    "id": "file:server/controllers/aiController.js",
                                    "type": "file",
                                    "label": "aiController.js",
                                    "path": "server/controllers/aiController.js",
                                    "subsystem": "backend",
                                },
                            }
                        ],
                        "score": 3,
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/controllers/aiController.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 24,
                    "content": "exports.chat = async (req, res) => { ... }",
                }

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when workspace resolves stale traces")

            async def close(self):
                return None

        orchestrator.neo4j_store = ExplodingNeo4jStore()
        orchestrator.workspace_store = StubWorkspaceStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(expectedBundleVersion="bundle-2"),
            "tool_plan": [
                {
                    "toolName": "trace_system_path",
                    "input": {
                        "query": "ai chat route",
                        "limit": 4,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "workspace")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "workspace")
        self.assertIn("get_file_section", [tool_run["toolName"] for tool_run in updated["tool_runs"]])

    async def test_prefers_neo4j_for_trace_system_path(self):
        orchestrator = AssistantOrchestrator()

        class StubNeo4jStore:
            async def trace_paths(self, **kwargs):
                return [
                    {
                        "focus": {
                            "id": "route:POST:/api/ai/chat",
                            "type": "route",
                            "label": "POST /api/ai/chat",
                            "path": "/api/ai/chat",
                            "subsystem": "backend",
                        },
                        "summary": "Matched graph entity POST /api/ai/chat",
                        "steps": [
                            {
                                "type": "handled_by",
                                "from": {
                                    "id": "route:POST:/api/ai/chat",
                                    "type": "route",
                                    "label": "POST /api/ai/chat",
                                    "path": "/api/ai/chat",
                                    "subsystem": "backend",
                                },
                                "to": {
                                    "id": "file:server/controllers/aiController.js",
                                    "type": "file",
                                    "label": "aiController.js",
                                    "path": "server/controllers/aiController.js",
                                    "subsystem": "backend",
                                },
                            }
                        ],
                        "score": 2,
                    }
                ]

            async def close(self):
                return None

        class StubBundleStore:
            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/controllers/aiController.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 24,
                    "content": "exports.chat = async (req, res) => { ... }",
                }

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when neo4j returns traces")

            async def close(self):
                return None

        orchestrator.neo4j_store = StubNeo4jStore()
        orchestrator.bundle_store = StubBundleStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "trace_system_path",
                    "input": {
                        "query": "ai chat route",
                        "limit": 4,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "neo4j")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "neo4j")
        self.assertIn("trace_system_path", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertIn("get_file_section", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertEqual(updated["citations"][0]["type"], "graph")
        self.assertIn("/api/ai/chat", updated["citations"][0]["label"])

    async def test_falls_back_to_gateway_when_store_returns_no_results(self):
        orchestrator = AssistantOrchestrator()

        class EmptyQdrantStore:
            async def search_chunks(self, **kwargs):
                return []

            async def close(self):
                return None

        class EmptyBundleStore:
            async def search_code_chunks(self, **kwargs):
                return []

            async def get_file_section(self, **kwargs):
                return None

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class EmptyWorkspaceStore:
            async def search_code_chunks(self, **kwargs):
                return []

            async def get_file_section(self, **kwargs):
                return None

            async def close(self):
                return None

        class StubGateway:
            async def run_tool(self, tool_name, input_payload=None, auth_context=None):
                return {
                    "toolRun": {
                        "id": "search-code-fallback",
                        "toolName": tool_name,
                        "status": "completed",
                        "startedAt": "",
                        "endedAt": "",
                        "latencyMs": 1,
                        "summary": "Fallback bundle search.",
                        "inputPreview": input_payload or {},
                        "outputPreview": {
                            "resultCount": 1,
                        },
                    },
                    "result": {
                        "bundleVersion": "bundle-1",
                        "results": [
                            {
                                "id": "chunk-bundle",
                                "label": "server/services/intelligence/knowledgeBundleService.js:98",
                                "type": "code",
                                "path": "server/services/intelligence/knowledgeBundleService.js",
                                "excerpt": "const searchCodeChunks = async (...)",
                                "startLine": 98,
                                "endLine": 120,
                                "score": 0.88,
                                "metadata": {
                                    "subsystem": "backend",
                                },
                            }
                        ],
                    },
                }

            async def close(self):
                return None

        orchestrator.qdrant_store = EmptyQdrantStore()
        orchestrator.bundle_store = EmptyBundleStore()
        orchestrator.workspace_store = EmptyWorkspaceStore()
        orchestrator.gateway = StubGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "search_code_chunks",
                    "input": {
                        "query": "checkout flow",
                        "limit": 4,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["toolRun"]["id"], "search-code-fallback")
        self.assertEqual(updated["citations"][0]["path"], "server/services/intelligence/knowledgeBundleService.js")

    async def test_uses_bundle_store_for_file_section(self):
        orchestrator = AssistantOrchestrator()

        class StubBundleStore:
            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/services/intelligence/knowledgeBundleService.js",
                    "subsystem": "backend",
                    "startLine": 120,
                    "endLine": 132,
                    "content": "const getFileSection = async (...) => { ... }",
                }

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when bundle store resolves file sections")

            async def close(self):
                return None

        orchestrator.bundle_store = StubBundleStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "get_file_section",
                    "input": {
                        "path": "server/services/intelligence/knowledgeBundleService.js",
                        "aroundLine": 126,
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "bundle")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "bundle")
        self.assertEqual(updated["citations"][0]["path"], "server/services/intelligence/knowledgeBundleService.js")

    async def test_uses_bundle_store_for_route_contract(self):
        orchestrator = AssistantOrchestrator()

        class StubBundleStore:
            async def get_route_contract(self, **kwargs):
                return [
                    {
                        "method": "POST",
                        "path": "/chat",
                        "fullPath": "/api/ai/chat",
                        "file": "server/routes/aiRoutes.js",
                        "controllerRefs": ["server/controllers/aiController.js"],
                        "serviceRefs": ["server/services/ai/assistantOrchestratorService.js"],
                        "modelRefs": [],
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": kwargs.get("target_path") or "server/routes/aiRoutes.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 24,
                    "content": "router.post('/chat', ...)",
                }

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when bundle store resolves route contracts")

            async def close(self):
                return None

        orchestrator.bundle_store = StubBundleStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "get_route_contract",
                    "input": {
                        "endpoint": "/api/ai/chat",
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "bundle")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "bundle")
        self.assertIn("get_file_section", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertEqual(updated["citations"][0]["type"], "route")
        self.assertEqual(updated["citations"][0]["path"], "server/routes/aiRoutes.js")

    async def test_prefers_workspace_route_contract_when_bundle_is_stale(self):
        orchestrator = AssistantOrchestrator()

        class StubWorkspaceStore:
            async def get_route_contract(self, **kwargs):
                return [
                    {
                        "method": "POST",
                        "path": "/chat",
                        "fullPath": "/api/ai/chat",
                        "file": "server/routes/aiRoutes.js",
                        "controllerRefs": ["server/controllers/aiController.js"],
                        "serviceRefs": ["server/services/ai/assistantOrchestratorService.js"],
                        "modelRefs": [],
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/routes/aiRoutes.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 24,
                    "content": "router.post('/chat', ...)",
                }

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when workspace resolves stale route contracts")

            async def close(self):
                return None

        orchestrator.workspace_store = StubWorkspaceStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(expectedBundleVersion="bundle-2"),
            "tool_plan": [
                {
                    "toolName": "get_route_contract",
                    "input": {
                        "endpoint": "/api/ai/chat",
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "workspace")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "workspace")

    async def test_uses_bundle_store_for_model_schema(self):
        orchestrator = AssistantOrchestrator()

        class StubBundleStore:
            async def get_model_schema(self, **kwargs):
                return [
                    {
                        "name": "Order",
                        "file": "server/models/Order.js",
                        "fields": ["user", "orderItems", "orderStatus"],
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": kwargs.get("target_path") or "server/models/Order.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 40,
                    "content": "const OrderSchema = new mongoose.Schema({ ... })",
                }

            async def get_bundle_version(self):
                return "bundle-1"

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when bundle store resolves model schemas")

            async def close(self):
                return None

        orchestrator.bundle_store = StubBundleStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(),
            "tool_plan": [
                {
                    "toolName": "get_model_schema",
                    "input": {
                        "modelName": "Order",
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "bundle")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "bundle")
        self.assertIn("get_file_section", [tool_run["toolName"] for tool_run in updated["tool_runs"]])
        self.assertEqual(updated["citations"][0]["type"], "schema")
        self.assertEqual(updated["citations"][0]["path"], "server/models/Order.js")

    async def test_prefers_workspace_model_schema_when_bundle_is_stale(self):
        orchestrator = AssistantOrchestrator()

        class StubWorkspaceStore:
            async def get_model_schema(self, **kwargs):
                return [
                    {
                        "name": "Order",
                        "file": "server/models/Order.js",
                        "fields": ["user", "orderItems", "orderStatus"],
                    }
                ]

            async def get_file_section(self, **kwargs):
                return {
                    "path": "server/models/Order.js",
                    "subsystem": "backend",
                    "startLine": 1,
                    "endLine": 40,
                    "content": "const OrderSchema = new mongoose.Schema({ ... })",
                }

            async def close(self):
                return None

        class ExplodingGateway:
            async def run_tool(self, *args, **kwargs):
                raise AssertionError("gateway should not be called when workspace resolves stale model schemas")

            async def close(self):
                return None

        orchestrator.workspace_store = StubWorkspaceStore()
        orchestrator.gateway = ExplodingGateway()

        state = {
            "request": build_request(expectedBundleVersion="bundle-2"),
            "tool_plan": [
                {
                    "toolName": "get_model_schema",
                    "input": {
                        "modelName": "Order",
                    },
                }
            ],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "event_callback": None,
        }

        updated = await orchestrator.tool_runner(state)

        self.assertEqual(updated["tool_results"][0]["result"]["store"], "workspace")
        self.assertEqual(updated["tool_runs"][0]["outputPreview"]["store"], "workspace")


class PlanningHeuristicTests(unittest.IsolatedAsyncioTestCase):
    async def test_classifies_explicit_file_hint_as_app_grounded(self):
        orchestrator = AssistantOrchestrator()
        state = {
            "request": build_request(
                request={
                    "message": "Explain qdrant_store.py",
                    "assistantMode": "chat",
                    "conversationHistory": [],
                    "images": [],
                },
                runtimeContext={
                    "route": "",
                    "routeLabel": "",
                    "cartSummary": None,
                    "currentProductId": "",
                    "sessionId": "",
                    "contextVersion": 0,
                    "sessionMemory": {},
                },
            ),
            "message": "Explain qdrant_store.py",
            "answer_mode": "model_knowledge",
            "follow_ups": [],
        }

        updated = await orchestrator.intent_scope_classifier(state)

        self.assertEqual(updated["answer_mode"], "app_grounded")


if __name__ == "__main__":
    unittest.main()
