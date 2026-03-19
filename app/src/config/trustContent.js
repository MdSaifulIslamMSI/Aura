const TRUST_LAST_UPDATED = 'March 1, 2026';

export const trustContent = {
  contact: {
    title: 'Contact Aura Security and Support',
    summary: 'Reach the right team quickly for account security, order help, and marketplace issues.',
    sections: [
      {
        heading: 'Security Operations Desk',
        points: [
          'Report account takeover, suspicious OTP, or payment concerns immediately.',
          'High-priority incidents are triaged continuously by the security support channel.',
          'Use only official Aura channels listed here. We never ask OTP in chat or calls.',
        ],
      },
      {
        heading: 'Support Channels',
        points: [
          'Email: support@aura.shop',
          'Helpline: 1-800-AURA-01',
          'HQ: Aura Global HQ, Tower 7, Innovation District, Bangalore, 560001, India',
        ],
      },
    ],
    cta: { label: 'Open Security Policy', to: '/security' },
  },
  about: {
    title: 'About Aura Trust Standards',
    summary: 'Aura combines marketplace speed with security-first controls across login, payments, and orders.',
    sections: [
      {
        heading: 'Security by Design',
        points: [
          'OTP login protections with lockout, purpose checks, and anti-replay controls.',
          'Server-authoritative checkout and pricing validation before order confirmation.',
          'Idempotent payment and order operations to protect from duplicate processing.',
        ],
      },
      {
        heading: 'Operational Reliability',
        points: [
          'Durable order email queue with retries and failure audit trails.',
          'Payment lifecycle tracking with reconciliation-ready event states.',
          'Continuous monitoring via service health checks and platform telemetry.',
        ],
      },
    ],
    cta: { label: 'Read Privacy Policy', to: '/privacy' },
  },
  careers: {
    title: 'Careers in Security and Platform Engineering',
    summary: 'Help build resilient commerce systems focused on trust, safety, and scale.',
    sections: [
      {
        heading: 'Core Focus Areas',
        points: [
          'Identity and account protection',
          'Payments integrity and fraud controls',
          'Marketplace policy enforcement and abuse detection',
        ],
      },
      {
        heading: 'Hiring Signals',
        points: [
          'Strong systems thinking and operational discipline',
          'Secure coding and incident response readiness',
          'Ownership mindset for reliability and customer trust',
        ],
      },
    ],
    cta: { label: 'Contact Us', to: '/contact' },
  },
  stories: {
    title: 'Aura Stories: Trust and Reliability',
    summary: 'Read how the platform ships security upgrades and customer safeguards.',
    sections: [
      {
        heading: 'Recent Focus',
        points: [
          'OTP email hardening and fail-closed delivery behavior.',
          'Payment security integration with risk controls and audit trails.',
          'Checkout reliability improvements with backend-authoritative quotes.',
        ],
      },
    ],
    cta: { label: 'Go to Security', to: '/security' },
  },
  press: {
    title: 'Press and Security Communications',
    summary: 'Official notices related to platform trust, compliance, and policy updates.',
    sections: [
      {
        heading: 'Media Guidance',
        points: [
          'Use only verified Aura channels for public statements.',
          'Security incident updates are communicated with validated timelines.',
          'Customer protection guidance is prioritized in all advisories.',
        ],
      },
    ],
    cta: { label: 'Read Terms', to: '/terms' },
  },
  corporate: {
    title: 'Corporate Information',
    summary: 'Organizational and compliance information supporting platform trust.',
    sections: [
      {
        heading: 'Governance Priorities',
        points: [
          'User safety and account integrity',
          'Payment and order reliability',
          'Transparent policy operations',
        ],
      },
    ],
    cta: { label: 'Read EPR Compliance', to: '/epr' },
  },
  payments: {
    title: 'Payments and Settlement Safeguards',
    summary: 'How Aura protects digital payment flows and fallback options.',
    sections: [
      {
        heading: 'Protection Layers',
        points: [
          'Server-side amount validation before order acceptance.',
          'Risk-aware payment controls and challenge support paths.',
          'Retry-safe idempotency protections on critical payment mutations.',
        ],
      },
      {
        heading: 'Fallback and Recovery',
        points: [
          'COD fallback where applicable.',
          'Operational handling for failures, pending states, and retries.',
          'Audit-linked events for support investigations.',
        ],
      },
    ],
    cta: { label: 'Open Security Hub', to: '/security' },
  },
  shipping: {
    title: 'Shipping and Delivery Assurance',
    summary: 'Delivery promises, slot behavior, and reliability expectations.',
    sections: [
      {
        heading: 'Delivery Commitments',
        points: [
          'Delivery options are validated during checkout quote.',
          'Address and slot selections are normalized server-side.',
          'Post-order tracking visibility is surfaced in order timelines.',
        ],
      },
    ],
    cta: { label: 'View Return Policy', to: '/return-policy' },
  },
  returns: {
    title: 'Cancellation and Returns',
    summary: 'Return windows, cancellation behavior, and refund processing posture.',
    sections: [
      {
        heading: 'Policy Summary',
        points: [
          'Return eligibility depends on category and order state.',
          'Cancellation windows are visible in order workflows.',
          'Refund operations follow controlled payment-state transitions.',
        ],
      },
    ],
    cta: { label: 'Read Return Policy', to: '/return-policy' },
  },
  faq: {
    title: 'Frequently Asked Questions',
    summary: 'Fast answers for account, checkout, payment, and security questions.',
    sections: [
      {
        heading: 'Top Questions',
        points: [
          'Why did I receive an OTP email?',
          'How do I secure my account if OTP was not requested by me?',
          'How do payment retries and fallback options work?',
        ],
      },
    ],
    cta: { label: 'Contact Support', to: '/contact' },
  },
  report: {
    title: 'Report Infringement and Abuse',
    summary: 'Report policy violations, abuse, or suspicious marketplace activity.',
    sections: [
      {
        heading: 'What to Include',
        points: [
          'Listing links, order references, and timestamps.',
          'Clear description of suspected violation.',
          'Contact details for follow-up if required.',
        ],
      },
    ],
    cta: { label: 'Go to Contact', to: '/contact' },
  },
  'return-policy': {
    title: 'Return Policy',
    summary: 'Customer-friendly return guidance with consistency and compliance controls.',
    sections: [
      {
        heading: 'Eligibility Principles',
        points: [
          'Item condition and category rules determine eligibility.',
          'Time-bound windows are enforced by order state.',
          'Certain categories may have non-returnable constraints.',
        ],
      },
    ],
    cta: { label: 'Cancellation & Returns', to: '/returns' },
  },
  terms: {
    title: 'Terms of Use',
    summary: 'Platform terms for account usage, transactions, and marketplace conduct.',
    sections: [
      {
        heading: 'Core Terms',
        points: [
          'Use the platform only through authorized and lawful behavior.',
          'Do not attempt fraud, account abuse, or data misuse.',
          'Transactions are governed by checkout, payment, and policy controls.',
        ],
      },
    ],
    cta: { label: 'Read Privacy Policy', to: '/privacy' },
  },
  security: {
    title: 'Security',
    summary: 'Aura security controls for account integrity, payments, and communications.',
    sections: [
      {
        heading: 'Account Protection',
        points: [
          'OTP checks include purpose validation, expiry windows, and anti-replay handling.',
          'Failed attempts trigger lockouts to reduce brute-force risk.',
          'Security notifications include request context and anti-phishing guidance.',
        ],
      },
      {
        heading: 'Transaction Protection',
        points: [
          'Pricing and totals are validated server-side before order creation.',
          'Payment state is controlled by backend validations and idempotent operations.',
          'Order confirmation email delivery uses durable retry-safe processing.',
        ],
      },
      {
        heading: 'Security Advice',
        points: [
          'Never share OTP codes with anyone.',
          'Reset your password immediately if you detect suspicious activity.',
          'Use only official Aura support channels.',
        ],
      },
    ],
    cta: { label: 'Contact Security Support', to: '/contact' },
  },
  privacy: {
    title: 'Privacy Policy',
    summary: 'How Aura handles account and transaction data with security and purpose limits.',
    sections: [
      {
        heading: 'Privacy Commitments',
        points: [
          'Data is processed for account security, transaction reliability, and support.',
          'Sensitive fields are restricted from standard responses and logs.',
          'Operational events are retained for audit and abuse prevention.',
        ],
      },
    ],
    cta: { label: 'Read Terms', to: '/terms' },
  },
  sitemap: {
    title: 'Sitemap',
    summary: 'Quick links to key marketplace, account, and trust destinations.',
    sections: [
      {
        heading: 'Key Routes',
        points: [
          '/marketplace, /products, /checkout, /orders',
          '/profile, /my-listings, /price-alerts',
          '/security, /privacy, /terms, /contact',
        ],
      },
    ],
    cta: { label: 'Go to Marketplace', to: '/marketplace' },
  },
  epr: {
    title: 'EPR Compliance',
    summary: 'Environmental responsibility and compliance orientation for marketplace operations.',
    sections: [
      {
        heading: 'Compliance Highlights',
        points: [
          'Policy-aligned disposal and recycling commitments.',
          'Consumer awareness and support guidance.',
          'Program updates reflected in legal and compliance content.',
        ],
      },
    ],
    cta: { label: 'Back to Legal', to: '/terms' },
  },
};

export const trustRouteToKey = {
  '/trust': 'security',
  '/contact': 'contact',
  '/about': 'about',
  '/careers': 'careers',
  '/stories': 'stories',
  '/press': 'press',
  '/corporate': 'corporate',
  '/payments': 'payments',
  '/shipping': 'shipping',
  '/returns': 'returns',
  '/faq': 'faq',
  '/report': 'report',
  '/return-policy': 'return-policy',
  '/terms': 'terms',
  '/security': 'security',
  '/privacy': 'privacy',
  '/sitemap': 'sitemap',
  '/epr': 'epr',
};

export const trustRoutes = Object.keys(trustRouteToKey);

export const getTrustPageContent = (key = 'security') => {
  return trustContent[key] || trustContent.security;
};

export const trustMeta = {
  lastUpdated: TRUST_LAST_UPDATED,
};
