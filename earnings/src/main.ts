import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Keep the application running since it relies on BullMQ consumers and Cron jobs
  app.enableShutdownHooks();
}
bootstrap();
