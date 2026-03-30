# Chat And Video Architecture

## Frontend chat path

The assistant UI lives in `app/src/components/features/chat/` and the orchestration point is `app/src/components/features/chat/useAssistantController.js`.

The controller does four jobs:

1. It pulls persisted conversational state from `app/src/store/chatStore.js`.
2. It converts UI state into assistant request payloads with `app/src/utils/assistantCommands.js`.
3. It sends requests through `app/src/services/chatApi.js`, which delegates to `app/src/services/aiApi.js`.
4. It maps structured assistant turns back into UI surfaces, actions, products, support handoff state, and pending confirmations.

This means the chat frontend is not a thin text box. It is a state machine with:

- persisted session memory in Zustand
- action execution in `assistantActionRegistry.js`
- route-aware context hydration
- confirmation loops handled through `/api/ai/chat`

## Backend chat path

The live assistant entrypoint is `server/routes/aiRoutes.js` and `server/controllers/aiController.js`.

That path accepts:

- plain chat messages
- confirmation payloads with no message body
- backend-owned `actionRequest` payloads with no message body

The actual decision engine sits behind `server/services/ai/assistantOrchestratorService.js` and related AI service files. The older `/api/chat` legacy route still exists for compatibility, but the app frontend is wired to `/api/ai/chat`.

## Marketplace chat path

Marketplace buyer and seller messaging is completely separate from the assistant.

Frontend:

- `app/src/pages/ListingDetail/index.jsx`
- `app/src/services/api/listingApi.js`

Backend:

- `server/controllers/listingController.js`
- `server/models/Conversation.js`
- `server/models/Message.js`
- `server/services/socketService.js`

Persistence is Mongo-backed. Realtime fanout is Socket.IO via the `new_message` event. The listing page still keeps a polling fallback for degraded socket conditions.

## Support chat path

Frontend:

- `app/src/pages/Profile/components/SupportSection.jsx`
- `app/src/pages/Admin/Support.jsx`
- `app/src/services/api/supportApi.js`

Backend:

- `server/routes/supportRoutes.js`
- `server/controllers/supportController.js`
- `server/models/SupportTicket.js`
- `server/models/SupportMessage.js`

Support chat is more structured than marketplace chat. It carries unread counters, admin/user projections, ticket status, and system-generated lifecycle messages.

## Video path

All live call state is centralized in `app/src/context/VideoCallContext.jsx`.

That provider is responsible for:

- socket signaling intake for `support:video:*` and `listing:video:*`
- LiveKit room connect and media publish
- local and remote stream assembly
- camera switching
- global overlay rendering through `app/src/components/features/video/VideoCallOverlay.jsx`

Backend session control is split by domain:

- support calls: `server/controllers/supportController.js`
- listing calls: `server/controllers/listingController.js`

Shared realtime session tracking sits in:

- `server/services/socketService.js`
- `server/services/livekitService.js`
- `server/services/supportVideoService.js`

The server is doing two different things at once:

1. authorizing and minting LiveKit access
2. holding an app-level session registry so the rest of the product can reason about who is ringing, connected, or terminated

## Fault lines that mattered

Before this branch, the weakest points were:

- incoming calls could overwrite an already active call in the global provider
- duplicate incoming socket events could re-arm the same call state
- an unexpected LiveKit disconnect could clear the UI without synchronizing the backend session, leaving ghost ringing or connected sessions behind

## Fixes in this branch

This branch adds an explicit session-decision utility in `app/src/context/videoCallSessionUtils.js` and hardens `VideoCallContext.jsx` so that:

- duplicate incoming call events are ignored
- new incoming calls are declined when another call is already active instead of stomping the current session
- unexpected LiveKit disconnects now synchronize an end-state back to the backend before local cleanup

The goal of the fix is simple: one active call, one authoritative session outcome, and no silent drift between LiveKit state and app state.
