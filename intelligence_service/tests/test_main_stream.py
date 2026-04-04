from fastapi.testclient import TestClient

from intelligence_service.app import main as main_module
from intelligence_service.app.schemas import AssistantReply, Verification


class _StubOrchestrator:
    async def invoke(self, payload, event_callback=None):
        return AssistantReply(
            answer="stub answer",
            citations=[],
            toolRuns=[],
            verification=Verification(
                label="model_knowledge",
                confidence=0.6,
                summary="stub",
                evidenceCount=0,
            ),
            grounding={
                "mode": "model_knowledge",
                "status": "verified",
                "traceId": "trace_stub",
                "bundleVersion": "bundle_stub",
                "sources": [],
            },
            followUps=[],
            assistantTurn={
                "response": "stub answer",
                "citations": [],
                "toolRuns": [],
                "verification": {
                    "label": "model_knowledge",
                    "confidence": 0.6,
                    "summary": "stub",
                    "evidenceCount": 0,
                },
                "answerMode": "model_knowledge",
            },
            provider={"name": "stub", "model": "stub-model"},
            latencyMs=1,
        )


def _build_payload():
    return {
        "traceId": "trace_test",
        "bundleVersion": "bundle_stub",
        "expectedBundleVersion": "bundle_stub",
        "request": {
            "message": "hello",
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
            "route": "",
            "routeLabel": "",
            "cartSummary": None,
            "currentProductId": "",
            "sessionId": "",
            "contextVersion": 0,
            "sessionMemory": {},
        },
        "providerConfig": {},
    }


def test_stream_emits_final_turn_without_tokens():
    original = main_module.orchestrator
    main_module.orchestrator = _StubOrchestrator()
    headers = {}
    if main_module.settings.service_token:
        headers["Authorization"] = f"Bearer {main_module.settings.service_token}"

    try:
        client = TestClient(main_module.app)
        response = client.post("/v1/assistant/reply/stream", headers=headers, json=_build_payload())
    finally:
        main_module.orchestrator = original

    assert response.status_code == 200
    assert "event: final_turn" in response.text
    assert "event: error" not in response.text
