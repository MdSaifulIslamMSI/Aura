const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || '').trim();
const apply = process.argv.includes('--apply');

const dashboardSteps = [
  'Cloudflare dashboard steps:',
  '1. Open the zone for this app.',
  '2. Cache Rules: cache static assets with hashed filenames for one year.',
  '3. Cache Rules: bypass cache when Authorization header exists.',
  '4. Cache Rules: bypass cache when Cookie header exists.',
  '5. Cache Rules: bypass cache for /api/auth/*, /api/admin/*, /api/user/*, /api/me, /api/payment/*, /api/upload/*, /api/uploads/*, and /api/webhooks/*.',
  '6. Optional: cache explicitly public API GET routes for 60-120 seconds.',
  '7. Purge cache after each deploy.',
];

if (!token || !zoneId) {
  console.log('Cloudflare credentials are not configured; no API calls will be made.');
  console.log(dashboardSteps.join('\n'));
  process.exit(0);
}

console.log(`Cloudflare zone detected: ${zoneId}`);
console.log('Safe cache plan:');
console.log('- Cache hashed JS/CSS/images/fonts aggressively.');
console.log('- Bypass authenticated, cookie, private API, upload, payment, admin, and webhook traffic.');
console.log('- Use short TTL for explicitly public API GET routes only.');

if (!apply) {
  console.log('Dry run only. Pass --apply after manually reviewing the plan.');
  process.exit(0);
}

console.log('Apply mode is intentionally conservative. Configure detailed cache rules in the dashboard or extend this script with reviewed Cloudflare Rulesets API calls.');
