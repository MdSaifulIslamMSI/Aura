import net from 'node:net';

const tryTcp = (urlString) => new Promise((resolve) => {
  if (!urlString) {
    resolve({ ok: false, reason: 'missing_url' });
    return;
  }

  let url;
  try {
    url = new URL(urlString);
  } catch {
    resolve({ ok: false, reason: 'invalid_url' });
    return;
  }

  const socket = net.createConnection({
    host: url.hostname,
    port: Number(url.port || 6379),
    timeout: 1000,
  });

  socket.on('connect', () => {
    socket.destroy();
    resolve({ ok: true });
  });
  socket.on('timeout', () => {
    socket.destroy();
    resolve({ ok: false, reason: 'timeout' });
  });
  socket.on('error', (error) => resolve({ ok: false, reason: error.code || error.message }));
});

const redis = await tryTcp(process.env.REDIS_URL || 'redis://localhost:6379');
if (redis.ok) {
  console.log('Redis reachable.');
} else {
  console.warn(`Redis not reachable (${redis.reason}); continuing because Redis is optional for local checks.`);
}

console.log('Local performance services validation completed.');
