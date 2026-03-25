# Support Live Video Ops

Customer support video calls and marketplace live inspections now use LiveKit instead of direct browser-to-browser WebRTC.

## Why this path exists

- Support calls need higher connection success and easier operator recovery.
- Marketplace inspections benefit from the same NAT/firewall resilience.
- LiveKit gives SFU routing, reconnect behavior, and embedded TURN for self-hosted deployments.

## Required server env

Set these in the server environment:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_TTL_SECONDS`
- `LIVEKIT_SUPPORT_ROOM_PREFIX`
- `LIVEKIT_LISTING_ROOM_PREFIX`

## Recommended deployment

For self-hosted production:

1. Run LiveKit on a public VPS with TLS.
2. Point `LIVEKIT_URL` to the public `wss://` endpoint.
3. Keep ports and TLS configured exactly as LiveKit expects.
4. Let LiveKit handle TURN first before introducing a separate coturn service.

## Operational behavior

- Users can request a live call from the support ticket thread.
- Admins start the live session from the admin support view.
- If a browser refreshes or misses the popup, both sides can rejoin from the ticket while the call is still marked `ringing` or `connected`.
- Ending the call tears down the LiveKit room and updates the support ticket timeline.
- Marketplace live inspection now also uses LiveKit rooms between the seller and the active escrow buyer.
