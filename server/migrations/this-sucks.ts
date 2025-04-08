import { MigrationProvider } from 'kysely'

// NB: We do this because Kysely migrators assume that they can roll through
// a directory of migrators as plain JavaScript files, which isn't true in Bun,
// in both dev mode and single-file executable mode.
import * as m1 from './20250323-create'
import * as m2 from './20250331-add-signal-type-data'
import * as m3 from './20250405-add-service-log'
import * as m4 from './20250407-add-query-indexes'
import * as m5 from './20250408-add-logs-table'
import * as m6 from './20250408-column-is-dead-to-signals'
import * as m7 from './20250409-add-column-exec-info-to-signals'

const migrations = [m1, m2, m3, m4, m5, m6, m7]

export const migrator: MigrationProvider = {
  async getMigrations() {
    return Object.fromEntries(migrations.map((m, i) => [`migration-${i}`, m]))
  },
}
