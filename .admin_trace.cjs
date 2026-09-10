const fs = require('fs');
const m = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));
const html = fs.readFileSync('dist/index.html', 'utf8');
const entryFiles = [...html.matchAll(/assets\/[A-Za-z0-9._-]+\.js/g)].map((x) => x[0]);

const keyByFile = {};
const adminKeys = [];
for (const [key, value] of Object.entries(m)) {
  if (value.file) keyByFile[value.file] = key;
  if (/\/pages\/Admin\//.test(key) || (value.name || '').startsWith('admin-')) adminKeys.push(key);
}

const reachable = new Set();
const queue = entryFiles.map((f) => keyByFile[f]).filter(Boolean);
while (queue.length) {
  const key = queue.shift();
  if (!key || reachable.has(key)) continue;
  reachable.add(key);
  for (const imp of m[key].imports || []) queue.push(imp);
  for (const imp of m[key].dynamicImports || []) queue.push(imp);
}

console.log('manifest entries:', Object.keys(m).length);
console.log('admin chunks in build:', adminKeys.length);
const adminReachable = adminKeys.filter((key) => reachable.has(key));
console.log('admin chunks transitively reachable from the public shell:', adminReachable.length);
adminReachable.forEach((key) => {
  const importers = Object.entries(m)
    .filter(([, v]) => (v.imports || []).includes(key) || (v.dynamicImports || []).includes(key))
    .map(([k]) => k)
    .filter((k) => !k.includes('/pages/Admin/'));
  console.log('  -', m[key].name || key, '<= reachable via:', importers.slice(0, 5).join(', ') || '(direct from entry)');
});
