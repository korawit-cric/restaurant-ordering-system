import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../.env') });
export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  migrations: { path: path.join(__dirname, 'prisma/migrations') },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5444/restaurant_ordering',
  },
});
