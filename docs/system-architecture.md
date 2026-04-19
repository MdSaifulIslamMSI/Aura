# System Architecture

This repo currently runs as three coordinated surfaces:
- a dedicated gateway frontend at `aura-gateway.vercel.app`
- the shared storefront frontend on both Vercel and Netlify
- a shared split-runtime backend that serves both storefront hosts

The diagrams below separate frontend and backend architecture, then connect them into one end-to-end view.

## Frontend Architecture

```mermaid
flowchart TD
    User["User Browser"]
    Gateway["Gateway Frontend<br/>`aura-gateway.vercel.app`"]
    VercelRuntime["Storefront Runtime<br/>`aurapilot.vercel.app`"]
    NetlifyRuntime["Storefront Runtime<br/>`aurapilot.netlify.app`"]

    User --> Gateway
    User --> VercelRuntime
    User --> NetlifyRuntime
    Gateway --> VercelRuntime
    Gateway --> NetlifyRuntime

    subgraph Storefront["Shared React Storefront (`app/`)"]
        AppShell["App Shell<br/>`app/src/App.jsx`"]
        Providers["Runtime Providers<br/>Auth, Commerce, Socket, Market,<br/>Motion, Color Mode, Notifications,<br/>Video Call, Assistant"]
        Routes["Route Layer<br/>Home, Login, Catalog, Product,<br/>Marketplace, Cart, Wishlist,<br/>Checkout, Orders, Admin"]
        ClientServices["Client Services<br/>`apiBase`, API modules, socket client,<br/>client observability, CSRF, device trust"]
        BrowserState["Browser State<br/>cookies, local/session storage,<br/>IndexedDB trusted-device material"]
        FirebaseClient["Firebase Web Auth"]

        AppShell --> Providers
        Providers --> Routes
        Providers --> ClientServices
        ClientServices --> FirebaseClient
        ClientServices --> BrowserState
    end

    VercelRuntime --> AppShell
    NetlifyRuntime --> AppShell
```

## Backend Architecture

```mermaid
flowchart TD
    subgraph Backend["Shared Backend (`server/`)"]
        Secrets["Runtime Secret Bootstrap<br/>local env + AWS Parameter Store"]

        API["API Runtime<br/>`start_api_runtime.js` -> `index.js`"]
        Worker["Worker Runtime<br/>`start_worker_runtime.js` -> `workerProcess.js`"]

        Middleware["Security + Platform Middleware<br/>Helmet, CORS, request IDs, metrics,<br/>timeouts, sanitizers, rate limiting,<br/>market-context resolution"]
        Routes["Route Layer<br/>Auth, Users, Products, Cart, Orders,<br/>Checkout, Payments, Listings, AI,<br/>Support, Uploads, Admin, Observability"]
        SocketLayer["Realtime Layer<br/>Socket.IO + Redis adapter"]

        Domain["Domain Services<br/>browser sessions, trusted-device checks,<br/>commerce logic, payment service,<br/>email queue, catalog, support,<br/>AI/intelligence, FX rates"]
        Jobs["Background Jobs<br/>payment outbox, order email,<br/>commerce reconciliation, catalog sync,<br/>analytics/email monitors, OTP maintenance"]

        Mongo["MongoDB Replica Set"]
        Redis["Redis"]
        S3["AWS S3 Upload Storage"]
        External["External Providers<br/>Firebase Admin, Stripe, Resend/Nodemailer,<br/>LiveKit, OpenAI, VoyageAI"]

        Secrets --> API
        Secrets --> Worker

        API --> Middleware --> Routes --> Domain
        API --> SocketLayer
        Worker --> Jobs --> Domain

        Domain <--> Mongo
        Domain <--> Redis
        SocketLayer <--> Redis
        Jobs <--> Redis

        Domain --> S3
        Domain --> External
        Jobs --> External
    end
```

## Connected System Flow

```mermaid
flowchart LR
    User["User Browser"]
    Gateway["Gateway Frontend<br/>`aura-gateway.vercel.app`"]
    Vercel["Vercel Storefront<br/>shared `app/` build"]
    Netlify["Netlify Storefront<br/>shared `app/` build"]
    Proxy["Same-Origin Runtime Paths<br/>`/api`, `/health`, `/socket.io`, `/uploads`"]
    Backend["Shared Backend API<br/>AWS EC2 split runtime"]
    Worker["Shared Worker Runtime<br/>background jobs + reconciliation"]
    Mongo["MongoDB"]
    Redis["Redis"]
    Services["External Services<br/>Firebase, Stripe, LiveKit,<br/>AI providers, email, S3"]

    User --> Gateway
    Gateway --> Vercel
    Gateway --> Netlify

    User --> Vercel
    User --> Netlify

    Vercel --> Proxy --> Backend
    Netlify --> Proxy

    Vercel -. realtime socket events .-> Backend
    Netlify -. realtime socket events .-> Backend

    Backend <--> Mongo
    Backend <--> Redis
    Worker <--> Mongo
    Worker <--> Redis

    Backend --> Services
    Worker --> Services
```

## Notes

- The gateway is a separate static Vercel project. It is not the storefront app itself.
- The Vercel and Netlify storefronts are two hosts for the same React/Vite frontend and are expected to behave identically.
- Both storefront hosts connect to the same backend runtime through proxied same-origin routes instead of talking to different backends.
- The backend is intentionally split into API and worker processes so traffic spikes on HTTP do not take down payment, email, reconciliation, or catalog jobs.
- Redis is part of both realtime coordination and distributed security/rate-limit behavior, not just caching.
