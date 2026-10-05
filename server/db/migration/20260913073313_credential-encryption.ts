// Purpose: Retires development-only plaintext credentials before encrypted storage is used.

import type {DatabaseMigration} from '@openchart/server/db/migration';

const migration: DatabaseMigration.Migration = {
  id: '20260913073313_credential-encryption',
  /**
   * Removes old plaintext grants; providers must be connected again. Host keys
   * are unavailable to database migrations. Other application data is preserved.
   * @example yield* migration.up(transaction);
   */
  up: tx => tx.run('DELETE FROM credential'),
};

export default migration;
