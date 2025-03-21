import { configDotenv } from 'dotenv'

import index from '../site/index.html'

configDotenv()

async function main() {
  const port = process.env.PORT || '5432'

  console.log('Starting server on port', port)
  Bun.serve({
    port: port,
    routes: {
      '/': index,
    },
  })
}

main()
  //.then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
