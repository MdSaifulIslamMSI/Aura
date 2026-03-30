# Trusted Device Architecture

## What was wrong with the old LWE path

The old `latticeChallenge` flow was not a defensible authentication control.

The concrete failures were:

- The server sent `simulatedSk` to the browser, which means the client received the exact secret it was supposed to prove possession of.
- The frontend challenge component was not mounted into the application shell, so the backend could return a required challenge without a real enforcement surface.
- The legacy proof was not converted into a session-bound server token required by privileged requests, so there was no durable authorization boundary after the proof step.
- The naming implied post-quantum or FIDO-grade guarantees that the implementation did not actually provide.

## Replacement design

The repo now uses a real trusted-device checkpoint for privileged access.

### Browser side

- Each browser gets a stable device identifier via `localStorage`.
- The browser stores a non-extractable `RSA-PSS` private key in IndexedDB.
- When the server issues a challenge, the browser signs a short-lived challenge payload locally.
- On first use for a device, the browser also sends its exported public key so the server can register the device.

### Server side

- `server/services/trustedDeviceChallengeService.js` issues sealed challenge tokens bound to:
  - user id
  - device id
  - current Firebase session binding (`authUid` + token `iat`)
- Verification requires a valid browser signature over the challenge payload.
- Successful verification returns a sealed trusted-device session token, also bound to the current Firebase session and device id.
- Privileged middleware requires that trusted-device session token on protected privileged requests.

## Enforcement model

- Session establishment routes (`/api/auth/session`, `/api/auth/sync`) can return `device_challenge_required`.
- The frontend mounts a real checkpoint overlay through `AuraTrustedDeviceChallenge`.
- Seller and admin access paths enforce the trusted-device session token on the server.
- `AUTH_DEVICE_CHALLENGE_MODE` is the primary environment flag.
- `AUTH_LATTICE_CHALLENGE_MODE` is still read as a legacy alias so existing deployments do not silently break.

## Capability boundaries

This is a trusted-browser proof, not a hardware attestation system.

- It is materially stronger than the removed fake LWE flow because the private signing key never leaves the browser.
- It is still browser-resident, so it should not be described as hardware-backed or passkey-backed.
- If hardware-bound proof is needed later, the next step is WebAuthn or platform passkeys, not reintroducing synthetic cryptography claims.
