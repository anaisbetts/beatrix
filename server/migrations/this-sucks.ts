import { MigrationProvider } from 'kysely'

import * as m1 from './20250323-create'
import * as m2 from './20250331-add-signal-type-data'

const migrations = [m1, m2]

export const migrator: MigrationProvider = {
  async getMigrations() {
    return Object.fromEntries(migrations.map((m, i) => [`migration-${i}`, m]))
  },
}
