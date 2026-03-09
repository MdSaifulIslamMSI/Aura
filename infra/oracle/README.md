# Aura Oracle VM Backend + Vercel Frontend

This repo is now prepared for:

- `app/` on Vercel
- `server/` on an Oracle Cloud Always Free Ubuntu VM
- review-media uploads on a persistent local volume mounted on the VM

## Target shape

- `Vercel` serves the React frontend
- `Oracle VM` runs the Express backend as a long-lived `systemd` service
- `Nginx` on the VM reverse proxies public traffic to the Node process
- `MongoDB Atlas` stays external
- `Redis` stays external

## Backend persistence

Review uploads are stored on the VM filesystem through:

- `UPLOAD_STORAGE_DRIVER=local`
- `REVIEW_UPLOAD_DIR=/var/lib/aura/uploads/reviews`

Put that path on the Oracle boot disk or on an attached block volume mounted at `/var/lib/aura`.

## First-time VM setup

On the Ubuntu VM:

1. Clone this repo or copy the `server/` and `infra/oracle/` folders to the VM.
2. Run:
   - `cd /path/to/repo`
   - `sudo bash infra/oracle/bootstrap-backend.sh`
3. Edit:
   - `/etc/aura/server.env`
4. Start the backend:
   - `sudo systemctl restart aura-api`
5. Verify:
   - `sudo systemctl status aura-api --no-pager`
   - `curl http://127.0.0.1:5000/health`

The bootstrap script installs Node.js 22, Nginx, creates `/opt/aura`, `/var/lib/aura/uploads/reviews`, and registers the systemd/Nginx config files in this folder.

## Required runtime envs

At minimum set these in `/etc/aura/server.env`:

- `NODE_ENV=production`
- `PORT=5000`
- `CORS_ORIGIN=https://<your-vercel-domain>`
- `APP_PUBLIC_URL=https://<your-vercel-domain>`
- `SPLIT_RUNTIME_ENABLED=true`
- `REDIS_ENABLED=true`
- `REDIS_REQUIRED=true`
- `UPLOAD_STORAGE_DRIVER=local`
- `REVIEW_UPLOAD_DIR=/var/lib/aura/uploads/reviews`
- `MONGO_URI=...`
- `REDIS_URL=...`
- `BYTEZ_API_KEY=...`
- `UPLOAD_SIGNING_SECRET=...`

Add the rest of your production email, Firebase admin, OTP, and payment envs from:

- [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.example)

## GitHub deployment workflow

Use:

- [deploy-backend-oracle.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-oracle.yml)

Required GitHub secrets:

- `ORACLE_SSH_HOST`
- `ORACLE_SSH_PORT`
- `ORACLE_SSH_USER`
- `ORACLE_SSH_PRIVATE_KEY`
- `ORACLE_APP_ROOT`
- `ORACLE_SERVICE_NAME`

The workflow:

1. runs the targeted backend tests
2. uploads `server/` and `infra/oracle/` over SSH
3. installs production dependencies on the VM
4. restarts the backend service
5. reloads Nginx

## Frontend on Vercel

Set this Vercel environment variable:

- `VITE_API_URL=https://api.your-domain.example/api`

Then redeploy the frontend. The app no longer hardcodes a backend Vercel URL.

## DNS and TLS

Point a hostname such as `api.your-domain.example` to the Oracle VM public IP.

Then install TLS on the VM, for example with:

- `sudo apt-get install certbot python3-certbot-nginx`
- `sudo certbot --nginx -d api.your-domain.example`

## Operational notes

- Oracle Always Free gives you persistence through the VM disk, but not managed zero-downtime deploys.
- Keep backups for `/etc/aura/server.env` and your upload directory.
- If the VM is rebuilt, restore `/var/lib/aura/uploads/reviews` from backup before restarting the API.
