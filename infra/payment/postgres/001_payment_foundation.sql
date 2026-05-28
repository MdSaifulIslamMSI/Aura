-- Payment architecture foundation schema contract.
-- This file is not applied by the current Mongo/Mongoose runtime.
-- It documents the PostgreSQL-backed target state for a later persistence adapter.

CREATE TABLE IF NOT EXISTS payment_customers (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_customer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_customer_id)
);

CREATE TABLE IF NOT EXISTS payment_intents (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES payment_customers(id),
    order_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT UNIQUE,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'created',
        'requires_payment_method',
        'requires_confirmation',
        'processing',
        'succeeded',
        'failed',
        'canceled',
        'refunded',
        'partially_refunded',
        'disputed'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY,
    payment_intent_id UUID NOT NULL REFERENCES payment_intents(id),
    provider TEXT NOT NULL,
    provider_reference TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES payment_customers(id),
    provider TEXT NOT NULL,
    provider_method_reference TEXT NOT NULL,
    method_type TEXT NOT NULL,
    display_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_method_reference)
);

CREATE TABLE IF NOT EXISTS payment_refunds (
    id UUID PRIMARY KEY,
    payment_intent_id UUID NOT NULL REFERENCES payment_intents(id),
    provider TEXT NOT NULL,
    provider_reference TEXT,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'processing', 'succeeded', 'failed', 'canceled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id UUID PRIMARY KEY,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
    id UUID PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    response_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_audit_logs (
    id UUID PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_invoices (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES payment_customers(id),
    provider TEXT NOT NULL,
    provider_invoice_id TEXT,
    payment_intent_id UUID REFERENCES payment_intents(id),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES payment_customers(id),
    provider TEXT NOT NULL,
    provider_subscription_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_usage_events (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES payment_customers(id),
    subscription_id UUID REFERENCES billing_subscriptions(id),
    metric_code TEXT NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity >= 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
    id UUID PRIMARY KEY,
    account_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
    id UUID PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'dead_lettered')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Ledger rows are immutable; create reversing entries instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_immutable_update ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable_update
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_transactions_immutable_update ON ledger_transactions;
CREATE TRIGGER ledger_transactions_immutable_update
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
