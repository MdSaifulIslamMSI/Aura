// Minimal backend used only by the edge WAF verification stack. It answers
// 200 for every request so that any non-200 observed by the verification
// script is attributable to the WAF itself, never to the backend.
import http from 'node:http';

const port = Number(process.env.PORT || 8000);

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  })
  .listen(port, () => {
    console.log(`[aura-api-mock] listening on :${port}`);
  });
