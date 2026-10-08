import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Default API port is 8081
  const port = process.env.API_PORT || 8081;
  await app.listen(port);
}
bootstrap();
