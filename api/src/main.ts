import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require('express');
  app.use(express.json({ limit: '10mb' }));
  // Default API port is 8081
  const port = process.env.API_PORT || 8081;
  await app.listen(port);
}
bootstrap();
