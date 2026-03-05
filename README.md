# Aura Marketplace Engineering Guide

## Overview
This repository contains:
- `app/`: React + Vite frontend
- `server/`: Express + MongoDB backend

Core capabilities:
- Firebase-authenticated user flows
- Checkout, orders, payment intents, capture/refunds
- OTP verification with fail-closed email delivery
- Durable order email queue with retry and admin APIs

## Run Locally
1. Backend:
   - `cd server`
   - Copy `.env.example` to `.env` and fill secrets
   - `npm install`
   - `npm start`
2. Frontend:
   - `cd app`
   - Copy `.env.example` to `.env`
   - `npm install`
   - `npm run dev`

## Security Model (High Level)
- All private/admin APIs require Firebase bearer token (`Authorization: Bearer ...`)
- Admin routes require backend `admin` middleware check
- Checkout totals are server-authoritative
- OTP routes are fail-closed when email delivery fails
- Login OTP requires fresh password credential proof token (`OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF=true`)
- Login identity snapshots are mirrored to local auth vault for wipe-recovery (`AUTH_VAULT_ENABLED=true`)
- Chat is split into:
  - `POST /api/chat/public` (no paid LLM providers)
  - `POST /api/chat` (authenticated, quota-limited)

## Critical Invariants
- Client cannot elevate privilege through profile update payload
- OTP expiry must never delete user documents
- Digital order placement requires valid authorized/captured payment intent
- Authorized payment capture task is transaction-coupled with order commit
- Webhook and idempotent mutation paths are replay-safe

## Operational Endpoints
- `GET /health`: app/db/queue status snapshot
- `GET /health/ready`: readiness gate for orchestrators

## Maintenance Notes
- Run `npm test` in `server/` and `app/` before merging
- Keep `.env` secrets out of source control
- For legacy OTP TTL cleanup, run:
  - `npm run migrate:drop-user-otp-ttl` (in `server/`)
