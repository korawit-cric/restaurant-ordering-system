import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.DATABASE_URL ||
      !process.env.APP_ORIGIN?.startsWith('https://'))
  ) {
    throw new Error('Production requires DATABASE_URL and an HTTPS APP_ORIGIN');
  }
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT || 3011), '0.0.0.0');
}
void bootstrap();
