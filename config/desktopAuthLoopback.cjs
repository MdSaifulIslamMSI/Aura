const DESKTOP_AUTH_LOOPBACK_PORTS = Object.freeze(
    Array.from({ length: 11 }, (_value, index) => 47831 + index)
);

const DESKTOP_AUTH_LOOPBACK_ORIGINS = Object.freeze(
    DESKTOP_AUTH_LOOPBACK_PORTS.map((port) => `http://127.0.0.1:${port}`)
);

const DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES = Object.freeze(
    DESKTOP_AUTH_LOOPBACK_ORIGINS.map((origin) => `${origin}/desktop-auth/complete`)
);

const DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES = Object.freeze(
    DESKTOP_AUTH_LOOPBACK_ORIGINS.flatMap((origin) => [
        `${origin}/desktop-auth/complete`,
        `${origin}/desktop-auth/cancel`,
    ])
);

module.exports = {
    DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES,
    DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES,
    DESKTOP_AUTH_LOOPBACK_ORIGINS,
    DESKTOP_AUTH_LOOPBACK_PORTS,
};
