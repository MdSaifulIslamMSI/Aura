# Chatbot File Map

This repo currently contains two chatbot generations plus a central intelligence service.

Current default runtime:

- Legacy floating chatbot is still the default because `VITE_ASSISTANT_V2_ENABLED=false` in [app/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/.env.example) and `ASSISTANT_V2_ENABLED=false` in [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/.env.example).
- The newer full-page assistant workspace exists and can be enabled without deleting the legacy flow.

## Frontend entry points

- [app/src/App.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/App.jsx)
- [app/src/components/shared/AssistantLauncher.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/shared/AssistantLauncher.jsx)
- [app/src/context/MultimodalAssistantContext.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/context/MultimodalAssistantContext.jsx)
- [app/src/store/chatStore.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/store/chatStore.js)

## Frontend legacy floating chatbot

- [app/src/components/features/chat/ActionBar.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ActionBar.jsx)
- [app/src/components/features/chat/ActionBar.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ActionBar.test.jsx)
- [app/src/components/features/chat/assistantActionRegistry.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/assistantActionRegistry.js)
- [app/src/components/features/chat/assistantActionRegistry.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/assistantActionRegistry.test.jsx)
- [app/src/components/features/chat/ChatBot.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ChatBot.jsx)
- [app/src/components/features/chat/ChatContainer.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ChatContainer.jsx)
- [app/src/components/features/chat/ChatContainer.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ChatContainer.test.jsx)
- [app/src/components/features/chat/ConfirmationCard.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ConfirmationCard.jsx)
- [app/src/components/features/chat/MessageItem.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/MessageItem.jsx)
- [app/src/components/features/chat/MessageItem.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/MessageItem.test.jsx)
- [app/src/components/features/chat/MessageList.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/MessageList.jsx)
- [app/src/components/features/chat/MessageList.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/MessageList.test.jsx)
- [app/src/components/features/chat/MultimodalDock.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/MultimodalDock.jsx)
- [app/src/components/features/chat/ProductCardInline.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ProductCardInline.jsx)
- [app/src/components/features/chat/ProductCardInline.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/ProductCardInline.test.jsx)
- [app/src/components/features/chat/SupportHandoffCard.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/SupportHandoffCard.jsx)
- [app/src/components/features/chat/useAssistantController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/components/features/chat/useAssistantController.js)
- [app/src/services/chatApi.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/chatApi.js)
- [app/src/services/aiApi.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/aiApi.js)
- [app/src/utils/assistantCommands.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/utils/assistantCommands.js)
- [app/src/utils/assistantCommands.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/utils/assistantCommands.test.js)
- [app/src/utils/assistantIntent.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/utils/assistantIntent.js)

## Frontend assistant workspace v2

- [app/src/pages/Assistant/index.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/index.jsx)
- [app/src/pages/Assistant/useAssistantWorkspace.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/useAssistantWorkspace.js)
- [app/src/pages/Assistant/workspaceModels.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/workspaceModels.js)
- [app/src/pages/Assistant/workspaceModels.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/workspaceModels.test.js)
- [app/src/pages/Assistant/components/AssistantActionRail.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantActionRail.jsx)
- [app/src/pages/Assistant/components/AssistantCardRenderer.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantCardRenderer.jsx)
- [app/src/pages/Assistant/components/AssistantContextRail.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantContextRail.jsx)
- [app/src/pages/Assistant/components/AssistantDisabledState.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantDisabledState.jsx)
- [app/src/pages/Assistant/components/AssistantHero.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantHero.jsx)
- [app/src/pages/Assistant/components/AssistantThreadPanel.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/pages/Assistant/components/AssistantThreadPanel.jsx)
- [app/src/services/assistantApi.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantApi.js)
- [app/src/services/assistantActionAdapter.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantActionAdapter.js)
- [app/src/services/assistantActionAdapter.test.jsx](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantActionAdapter.test.jsx)
- [app/src/services/assistantSessionStorage.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantSessionStorage.js)
- [app/src/services/assistantSessionStorage.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantSessionStorage.test.js)
- [app/src/services/assistantUiConfig.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantUiConfig.js)
- [app/src/services/assistantUiConfig.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantUiConfig.test.js)
- [app/src/services/assistantFeatureFlags.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantFeatureFlags.js)
- [app/src/services/assistantFeatureFlags.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/app/src/services/assistantFeatureFlags.test.js)

## Node backend routes and controllers

- [server/index.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/index.js)
- [server/routes/chatRoutes.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/routes/chatRoutes.js)
- [server/routes/aiRoutes.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/routes/aiRoutes.js)
- [server/routes/assistantRoutes.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/routes/assistantRoutes.js)
- [server/routes/internalAiToolRoutes.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/routes/internalAiToolRoutes.js)
- [server/controllers/chatController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/controllers/chatController.js)
- [server/controllers/aiController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/controllers/aiController.js)
- [server/controllers/assistantController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/controllers/assistantController.js)
- [server/controllers/internalAiToolsController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/controllers/internalAiToolsController.js)
- [server/middleware/internalAiAuth.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/middleware/internalAiAuth.js)
- [server/validators/aiValidators.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/validators/aiValidators.js)
- [server/validators/assistantValidators.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/validators/assistantValidators.js)
- [server/config/assistantFlags.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/config/assistantFlags.js)

## Node backend legacy AI orchestration

- [server/services/ai/assistantContract.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantContract.js)
- [server/services/ai/assistantDecisionEngine.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantDecisionEngine.js)
- [server/services/ai/assistantExecutionPolicy.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantExecutionPolicy.js)
- [server/services/ai/assistantIntentCompiler.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantIntentCompiler.js)
- [server/services/ai/assistantOrchestratorService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantOrchestratorService.js)
- [server/services/ai/assistantRecoveryService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantRecoveryService.js)
- [server/services/ai/assistantSearchService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantSearchService.js)
- [server/services/ai/assistantSessionService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/assistantSessionService.js)
- [server/services/ai/multimodalVisualSearchService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/multimodalVisualSearchService.js)
- [server/services/ai/providerRegistry.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/providerRegistry.js)
- [server/services/ai/voiceCommandService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/ai/voiceCommandService.js)
- [server/models/Conversation.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/models/Conversation.js)
- [server/models/Message.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/models/Message.js)

## Node backend assistant workspace v2

- [server/services/assistantV2/assistantCatalogAdapter.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantCatalogAdapter.js)
- [server/services/assistantV2/assistantCommerceRouter.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantCommerceRouter.js)
- [server/services/assistantV2/assistantContract.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantContract.js)
- [server/services/assistantV2/assistantResponseComposer.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantResponseComposer.js)
- [server/services/assistantV2/assistantRouteContextService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantRouteContextService.js)
- [server/services/assistantV2/assistantService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantService.js)
- [server/services/assistantV2/assistantSessionService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantSessionService.js)
- [server/services/assistantV2/assistantSupportAdapter.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantSupportAdapter.js)
- [server/services/assistantV2/assistantTelemetryService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/assistantV2/assistantTelemetryService.js)

## Central intelligence bridge

- [server/services/intelligence/codeIntelligenceBuilder.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/intelligence/codeIntelligenceBuilder.js)
- [server/services/intelligence/intelligenceGatewayService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/intelligence/intelligenceGatewayService.js)
- [server/services/intelligence/intelligenceToolService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/intelligence/intelligenceToolService.js)
- [server/services/intelligence/knowledgeBundleService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/services/intelligence/knowledgeBundleService.js)
- [intelligence_service/README.md](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/README.md)
- [intelligence_service/app/config.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/config.py)
- [intelligence_service/app/embeddings.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/embeddings.py)
- [intelligence_service/app/index_state.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/index_state.py)
- [intelligence_service/app/main.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/main.py)
- [intelligence_service/app/neo4j_store.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/neo4j_store.py)
- [intelligence_service/app/orchestrator.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/orchestrator.py)
- [intelligence_service/app/providers.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/providers.py)
- [intelligence_service/app/qdrant_store.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/qdrant_store.py)
- [intelligence_service/app/schemas.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/schemas.py)
- [intelligence_service/app/tool_gateway.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/tool_gateway.py)
- [intelligence_service/app/worker.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/app/worker.py)
- [intelligence_service/runtime/active_index.json](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/runtime/active_index.json)

## Tests tied to chatbot behavior

- [server/tests/aiRoutes.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/aiRoutes.test.js)
- [server/tests/assistantCommerceService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantCommerceService.test.js)
- [server/tests/assistantDecisionEngine.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantDecisionEngine.test.js)
- [server/tests/assistantIntentCompiler.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantIntentCompiler.test.js)
- [server/tests/assistantOrchestratorService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantOrchestratorService.test.js)
- [server/tests/assistantRecoveryService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantRecoveryService.test.js)
- [server/tests/assistantRoutesV2.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantRoutesV2.test.js)
- [server/tests/assistantSearchService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantSearchService.test.js)
- [server/tests/assistantV2SessionService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/assistantV2SessionService.test.js)
- [server/tests/chatQuotaService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/chatQuotaService.test.js)
- [server/tests/chatRoutes.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/chatRoutes.test.js)
- [server/tests/intelligenceGatewayService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/intelligenceGatewayService.test.js)
- [server/tests/intelligenceToolService.test.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/server/tests/intelligenceToolService.test.js)
- [intelligence_service/tests/test_main_stream.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/tests/test_main_stream.py)
- [intelligence_service/tests/test_orchestrator.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/tests/test_orchestrator.py)
- [intelligence_service/tests/test_providers.py](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/intelligence_service/tests/test_providers.py)

## Architecture docs

- [docs/chat-video-architecture.md](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/docs/chat-video-architecture.md)
- [docs/system-aware-intelligence-layer.md](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style Frontend/docs/system-aware-intelligence-layer.md)

## Purged stale files

- Removed root-level `old_api.js.tmp`. It was an orphaned old API snapshot and not part of the current app import graph.
- Removed empty `app/temp.html`.
- Removed generated frontend build output from `app/dist`.
- Removed Playwright HTML output from `app/playwright-report`.
- Removed Playwright last-run state from `app/test-results`.
- Removed Jest/Istanbul coverage output from `server/coverage`.
- Removed Python bytecode caches from `intelligence_service/app/__pycache__` and `intelligence_service/tests/__pycache__`.

## Kept on purpose

- The legacy floating chatbot files were not deleted because the repo is still configured to use them by default.
- Runtime data and source-backed chatbot code were kept so cleanup does not change application behavior.
