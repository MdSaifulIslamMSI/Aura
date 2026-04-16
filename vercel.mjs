const backendOrigin = String(
    process.env.AURA_BACKEND_ORIGIN
    || process.env.AWS_BACKEND_BASE_URL
    || 'http://127.0.0.1:5000'
).trim().replace(/\/+$/, '');

export const config = {
    outputDirectory: 'app/dist',
    headers: [
        {
            source: '/((?!api/|uploads/).*)',
            headers: [
                {
                    key: 'Content-Security-Policy',
                    value: "default-src 'self'; script-src 'self' https://apis.google.com https://checkout.razorpay.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; media-src 'self' https: data: blob:; frame-src 'self' https://checkout.razorpay.com https://www.google.com https://www.recaptcha.net https://*.firebaseapp.com https://*.web.app; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';",
                },
                {
                    key: 'Permissions-Policy',
                    value: 'camera=(self), geolocation=(self), microphone=(self), payment=(self)',
                },
                {
                    key: 'Referrer-Policy',
                    value: 'strict-origin-when-cross-origin',
                },
                {
                    key: 'X-Content-Type-Options',
                    value: 'nosniff',
                },
                {
                    key: 'X-Frame-Options',
                    value: 'DENY',
                },
                {
                    key: 'Cross-Origin-Opener-Policy',
                    value: 'same-origin-allow-popups',
                },
            ],
        },
        {
            source: '/index.html',
            headers: [
                {
                    key: 'Cache-Control',
                    value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                },
            ],
        },
        {
            source: '/manifest.json',
            headers: [
                {
                    key: 'Cache-Control',
                    value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                },
            ],
        },
        {
            source: '/sw.js',
            headers: [
                {
                    key: 'Cache-Control',
                    value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                },
            ],
        },
        {
            source: '/((?!api/|uploads/|assets/|manifest\\.json$|sw\\.js$|favicon\\.ico$|robots\\.txt$|.*\\.[^/]+$).*)',
            headers: [
                {
                    key: 'Cache-Control',
                    value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                },
            ],
        },
    ],
    rewrites: [
        {
            source: '/api/(.*)',
            destination: `${backendOrigin}/api/$1`,
        },
        {
            source: '/health',
            destination: `${backendOrigin}/health`,
        },
        {
            source: '/health/ready',
            destination: `${backendOrigin}/health/ready`,
        },
        {
            source: '/uploads/(.*)',
            destination: `${backendOrigin}/uploads/$1`,
        },
        {
            source: '/((?!api/|uploads/|assets/|manifest\\.json$|sw\\.js$|favicon\\.ico$|robots\\.txt$|.*\\.[^/]+$).*)',
            destination: '/index.html',
        },
    ],
};
