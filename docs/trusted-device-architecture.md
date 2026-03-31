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
- The trusted-device flow now prefers WebAuthn or platform passkeys when the browser exposes them.
- Passkey-capable browsers complete a real WebAuthn challenge locally and send the resulting credential payload to the server.
- Browsers that cannot use WebAuthn can still fall back to a non-extractable `RSA-PSS` private key stored in IndexedDB when the server allows the fallback path.
- On first use for a device, the browser either registers a WebAuthn credential or sends an exported browser-key public key so the server can bind the device.

### Server side

- `server/services/trustedDeviceChallengeService.js` issues sealed challenge tokens bound to:
  - user id
  - device id
  - current Firebase session binding (`authUid` + token `iat`)
- WebAuthn challenges also carry relying-party context (`origin`, `rpId`, user-verification policy, timeout) so the browser and server verify the same passkey ceremony.
- Trusted-device tokens now use their own rotation-aware secret contract:
  - primary secret: `AUTH_DEVICE_CHALLENGE_SECRET`
  - primary version: `AUTH_DEVICE_CHALLENGE_SECRET_VERSION`
  - previous secrets: `AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS`
- Verification requires either a valid WebAuthn assertion or a valid browser-key signature over the challenge payload.
- Successful verification returns a sealed trusted-device session token, also bound to the current Firebase session and device id.
- Privileged middleware requires that trusted-device session token on protected privileged requests.

## Enforcement model

- Session establishment routes (`/api/auth/session`, `/api/auth/sync`) can return `device_challenge_required`.
- The frontend mounts a real checkpoint overlay through `AuraTrustedDeviceChallenge`.
- Seller and admin access paths enforce the trusted-device session token on the server.
- `AUTH_DEVICE_CHALLENGE_MODE` is the primary environment flag.
- `AUTH_LATTICE_CHALLENGE_MODE` is still read as a legacy alias so existing deployments do not silently break.
- When trusted-device challenge mode is enabled, startup now fails closed unless the deployment provides a dedicated device secret or explicitly opts into vault-secret fallback.

## Capability boundaries

This is now a passkey-first trusted-device proof with a browser-key fallback, not a full hardware-attestation platform.

- It is materially stronger than the removed fake LWE flow because the private signing material never leaves the authenticator or browser.
- The WebAuthn branch is genuinely passkey-backed, but the fallback branch is still browser-resident and should be described honestly.
- If hardware-bound attestation policy is needed later, the next step is stronger WebAuthn attestation and device-management policy, not synthetic cryptography claims.
