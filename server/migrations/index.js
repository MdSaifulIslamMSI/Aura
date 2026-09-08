// Registry of ordered schema/data migrations executed by
// scripts/run_migrations.js (npm run migrate:run / migrate:status).
//
// Rules:
// - Append-only: never edit or reorder an entry once it has been applied; the
//   runner records migrationId + checksum in the SchemaMigration ledger.
// - Each entry: { id, description, up }. `up` receives no arguments and must
//   be idempotent enough to survive a crash between applying and recording.
// - One-off scripts under server/scripts/migrate_*.js predate this runner and
//   stay as documented legacy; new migrations register here.
const registry = [];

module.exports = { registry };
