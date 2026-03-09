/**
 * resendProvider.js — Resend email provider
 *
 * Resend (https://resend.com) is the recommended production email provider:
 *   - Free tier: 3,000 emails/month, 100/day
 *   - Deliverability: SPF/DKIM/DMARC auto-configured
 *   - No rate limits like Gmail's 500/day App Password cap
 *   - REST API — no SMTP pool management needed
 *
 * Set RESEND_API_KEY in environment to activate.
 * Set ORDER_EMAIL_PROVIDER=resend in environment.
 */

const AppError = require('../../../utils/AppError');
const BaseEmailProvider = require('./baseProvider');

class ResendProvider extends BaseEmailProvider {
    constructor({ apiKey, fromName, fromAddress, replyTo = '' }) {
        super({ name: 'resend' });
        this.apiKey = String(apiKey || '').trim();
        this.fromName = String(fromName || 'Aura Marketplace').trim();
        this.fromAddress = String(fromAddress || '').trim();
        this.replyTo = String(replyTo || '').trim();

        if (!this.apiKey) {
            throw new AppError('Resend provider requires RESEND_API_KEY', 500);
        }
        if (!this.fromAddress) {
            throw new AppError('Resend provider requires ORDER_EMAIL_FROM_ADDRESS', 500);
        }
    }

    normalizeError(error) {
        const status = Number(error?.statusCode || error?.status || 0);
        const name = String(error?.name || '').toLowerCase();

        if (status === 401 || status === 403) return { code: 'AUTH_FAILED', retryable: false };
        if (status === 422) return { code: 'INVALID_RECIPIENT', retryable: false };
        if (status === 429) return { code: 'RATE_LIMIT', retryable: true };
        if (status >= 500 || name.includes('network') || name.includes('timeout')) {
            return { code: 'PROVIDER_5XX', retryable: true };
        }
        return { code: 'UNKNOWN_EMAIL_ERROR', retryable: true };
    }

    async sendTransactionalEmail({ to, subject, html, text = '', headers = {}, meta = {} }) {
        if (!to || !subject || (!html && !text)) {
            throw new AppError('Invalid transactional email payload', 400);
        }

        const fromField = this.fromName
            ? `${this.fromName} <${this.fromAddress}>`
            : this.fromAddress;

        const body = {
            from: fromField,
            to: to.split(',').map((addr) => addr.trim()).filter(Boolean),
            subject,
            ...(html ? { html } : {}),
            ...(text ? { text } : {}),
            ...(this.replyTo ? { reply_to: this.replyTo } : {}),
            // Map custom headers
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            tags: meta?.securityTags
                ? meta.securityTags.slice(0, 10).map((tag) => ({ name: String(tag).slice(0, 64), value: '1' }))
                : undefined,
        };

        let response;
        try {
            response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            });
        } catch (error) {
            const normalized = this.normalizeError(error);
            const wrapped = new AppError(error.message || 'Resend network error', 503);
            wrapped.emailCode = normalized.code;
            wrapped.emailRetryable = normalized.retryable;
            throw wrapped;
        }

        if (!response.ok) {
            let errorBody = {};
            try { errorBody = await response.json(); } catch { /* ignore */ }

            const normalized = this.normalizeError({ statusCode: response.status });
            const wrapped = new AppError(
                errorBody?.message || errorBody?.name || `Resend API error ${response.status}`,
                normalized.retryable ? 503 : 400
            );
            wrapped.emailCode = normalized.code;
            wrapped.emailRetryable = normalized.retryable;
            wrapped.providerError = {
                code: normalized.code,
                responseCode: response.status,
                command: 'resend_api_send',
            };
            throw wrapped;
        }

        const result = await response.json();
        return {
            provider: this.name,
            providerMessageId: result?.id || '',
            response: {
                accepted: Array.isArray(body.to) ? body.to : [body.to],
                rejected: [],
                response: `resend:${result?.id || 'ok'}`,
                envelope: { from: this.fromAddress, to: body.to },
                meta,
            },
        };
    }
}

module.exports = ResendProvider;
