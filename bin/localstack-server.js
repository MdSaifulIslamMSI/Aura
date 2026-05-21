const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

fs.writeFileSync(path.join(__dirname, 'localstack-server.pid'), String(process.pid));

// In-memory storage
const buckets = new Map();
const ssmParameters = new Map();

// Pre-seed buckets
['aura-uploads', 'aura-assets', 'aura-backups'].forEach(b => buckets.set(b, new Map()));

// Pre-seed SSM parameters
const seedParams = {
  '/aura/dev/DB_HOST': 'localhost',
  '/aura/dev/JWT_SECRET': 'aura-jwt-dev-secret-2026',
  '/aura/dev/SESSION_SECRET': 'aura-session-dev-secret-2026',
  '/aura/dev/ENCRYPTION_KEY': 'aura-encryption-key-dev-2026',
  '/aura/dev/SENTRY_DSN': process.env.SENTRY_DSN || 'https://examplePublicKey@o0.ingest.us.sentry.io/0',
  '/aura/dev/DATADOG_API_KEY': process.env.DATADOG_API_KEY || '',
};
Object.entries(seedParams).forEach(([k, v]) => ssmParameters.set(k, { Name: k, Value: v, Type: 'String', Version: 1, LastModifiedDate: new Date().toISOString(), ARN: `arn:aws:ssm:ap-south-1:000000000000:parameter${k}` }));

function collectBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // Health endpoint
  if (url.includes('/_localstack/health') || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      services: { s3: 'running', ssm: 'running', sts: 'running' },
      edition: 'community',
      version: '3.0.0-local'
    }));
  }

  // STS – GetCallerIdentity
  if (url === '/' && method === 'POST') {
    const body = await collectBody(req);
    if (body.includes('GetCallerIdentity')) {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:sts::000000000000:user/localstack-test</Arn>
    <UserId>LOCALSTACKUSERID</UserId>
    <Account>000000000000</Account>
  </GetCallerIdentityResult>
</GetCallerIdentityResponse>`);
    }

    // SSM operations
    const target = req.headers['x-amz-target'] || '';

    if (target.includes('PutParameter')) {
      const params = JSON.parse(body);
      ssmParameters.set(params.Name, {
        Name: params.Name,
        Value: params.Value,
        Type: params.Type || 'String',
        Version: (ssmParameters.get(params.Name)?.Version || 0) + 1,
        LastModifiedDate: new Date().toISOString(),
        ARN: `arn:aws:ssm:ap-south-1:000000000000:parameter${params.Name}`
      });
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Version: ssmParameters.get(params.Name).Version, Tier: 'Standard' }));
    }

    if (target.endsWith('GetParametersByPath')) {
      let params;
      try { params = JSON.parse(body); } catch { params = {}; }
      const prefix = params.Path || params.path || '/aura/dev';
      const recursive = params.Recursive !== false;
      const matching = [];
      for (const [name, value] of ssmParameters) {
        if (recursive ? name.startsWith(prefix) : name.startsWith(prefix) && name.slice(prefix.length).split('/').filter(Boolean).length <= 1) {
          matching.push(value);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Parameters: matching }));
    }

    if (target.endsWith('GetParameters')) {
      let params;
      try { params = JSON.parse(body); } catch { params = {}; }
      const names = params.Names || [];
      const matching = [];
      const invalid = [];
      for (const name of names) {
        const param = ssmParameters.get(name);
        if (param) {
          matching.push(param);
        } else {
          invalid.push(name);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Parameters: matching, InvalidParameters: invalid }));
    }

    if (target.endsWith('GetParameter')) {
      const params = JSON.parse(body);
      const param = ssmParameters.get(params.Name);
      if (!param) {
        res.writeHead(400, { 'Content-Type': 'application/x-amz-json-1.1' });
        return res.end(JSON.stringify({ __type: 'ParameterNotFound', message: `Parameter ${params.Name} not found.` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Parameter: param }));
    }

    if (target.endsWith('DescribeParameters')) {
      const all = Array.from(ssmParameters.values()).map(p => ({
        Name: p.Name, Type: p.Type, Version: p.Version,
        LastModifiedDate: p.LastModifiedDate, ARN: p.ARN, DataType: 'text'
      }));
      res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Parameters: all }));
    }
  }

  // S3 operations
  const s3Match = url.match(/^\/([a-z0-9][a-z0-9.-]+)(\/.+)?$/);

  // S3 – List Buckets (GET /)
  if (url === '/' && method === 'GET') {
    const bucketXml = Array.from(buckets.keys()).map(b =>
      `<Bucket><Name>${b}</Name><CreationDate>${new Date().toISOString()}</CreationDate></Bucket>`
    ).join('');
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Buckets>${bucketXml}</Buckets>
  <Owner><ID>localstack</ID><DisplayName>localstack</DisplayName></Owner>
</ListAllMyBucketsResult>`);
  }

  // S3 – Create Bucket (PUT /bucket-name)
  if (s3Match && method === 'PUT' && !s3Match[2]) {
    const bucketName = s3Match[1];
    if (!buckets.has(bucketName)) buckets.set(bucketName, new Map());
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Location': `/${bucketName}` });
    return res.end();
  }

  // S3 – List Objects (GET /bucket-name or GET /bucket-name?list-type=2)
  if (s3Match && method === 'GET' && !s3Match[2]) {
    const bucketName = s3Match[1];
    if (!buckets.has(bucketName)) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      return res.end(`<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>`);
    }
    const objects = buckets.get(bucketName);
    const contentXml = Array.from(objects.entries()).map(([key, obj]) =>
      `<Contents><Key>${key}</Key><Size>${obj.size}</Size><LastModified>${obj.modified}</LastModified></Contents>`
    ).join('');
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${bucketName}</Name><KeyCount>${objects.size}</KeyCount>
  ${contentXml}
</ListBucketResult>`);
  }

  // S3 – Put Object (PUT /bucket-name/key)
  if (s3Match && method === 'PUT' && s3Match[2]) {
    const bucketName = s3Match[1];
    const key = s3Match[2].slice(1);
    if (!buckets.has(bucketName)) buckets.set(bucketName, new Map());
    const body = await collectBody(req);
    buckets.get(bucketName).set(key, { data: body, size: body.length, modified: new Date().toISOString() });
    res.writeHead(200, { 'Content-Type': 'application/xml', ETag: `"${Date.now()}"` });
    return res.end();
  }

  // S3 – Get Object (GET /bucket-name/key)
  if (s3Match && method === 'GET' && s3Match[2]) {
    const bucketName = s3Match[1];
    const key = s3Match[2].slice(1);
    const obj = buckets.get(bucketName)?.get(key);
    if (!obj) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      return res.end(`<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`);
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': obj.size });
    return res.end(obj.data);
  }

  // Default fallback
  res.writeHead(200, { 'Content-Type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><MockResponse><Status>OK</Status></MockResponse>`);
});

const PORT = 4566;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Aura LocalStack emulator listening on http://127.0.0.1:${PORT}`);
  console.log(`  S3 buckets: ${Array.from(buckets.keys()).join(', ')}`);
  console.log(`  SSM params: ${ssmParameters.size} pre-seeded`);
});
