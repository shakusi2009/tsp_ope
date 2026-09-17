import { getBootstrapSummary, runMigrations } from './database.js';

const result = runMigrations();
const summary = getBootstrapSummary(result.databasePath);

console.log(
  JSON.stringify(
    {
      status: 'ok',
      databasePath: result.databasePath,
      appliedMigrations: result.appliedMigrations,
      summary
    },
    null,
    2
  )
);
