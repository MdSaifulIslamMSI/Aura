from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ConversationEntry(BaseModel):
    role: str = "user"
    content: str = ""


class AssistantRequestBody(BaseModel):
    message: str = ""
    assistantMode: str = "chat"
    conversationHistory: List[ConversationEntry] = Field(default_factory=list)
    images: List[Dict[str, Any]] = Field(default_factory=list)


class UserContext(BaseModel):
    id: str = ""
    isAdmin: bool = False
    isAuthenticated: bool = False


class RuntimeContext(BaseModel):
    route: str = ""
    routeLabel: str = ""
    cartSummary: Optional[Dict[str, Any]] = None
    currentProductId: str = ""
    sessionId: str = ""
    contextVersion: int = 0
    sessionMemory: Dict[str, Any] = Field(default_factory=dict)


class AssistantRequest(BaseModel):
    traceId: str
    bundleVersion: str = ""
    expectedBundleVersion: str = ""
    request: AssistantRequestBody
    userContext: UserContext = Field(default_factory=UserContext)
    runtimeContext: RuntimeContext = Field(default_factory=RuntimeContext)
    providerConfig: Dict[str, Any] = Field(default_factory=dict)


class ToolRun(BaseModel):
    id: str = ""
    toolName: str
    status: str = "completed"
    startedAt: str = ""
    endedAt: str = ""
    latencyMs: int = 0
    summary: str = ""
    inputPreview: Dict[str, Any] = Field(default_factory=dict)
    outputPreview: Dict[str, Any] = Field(default_factory=dict)


class Citation(BaseModel):
    id: str = ""
    label: str = ""
    type: str = "code"
    path: str = ""
    excerpt: str = ""
    startLine: int = 0
    endLine: int = 0
    score: float = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Verification(BaseModel):
    label: str = "cannot_verify"
    confidence: float = 0
    summary: str = ""
    evidenceCount: int = 0


class AssistantReply(BaseModel):
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    toolRuns: List[ToolRun] = Field(default_factory=list)
    verification: Verification = Field(default_factory=Verification)
    grounding: Dict[str, Any] = Field(default_factory=dict)
    followUps: List[str] = Field(default_factory=list)
    assistantTurn: Dict[str, Any] = Field(default_factory=dict)
    provider: Dict[str, str] = Field(default_factory=dict)
    latencyMs: int = 0
