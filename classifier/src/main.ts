import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  console.log('Classifier service is running...');
  // It will keep running because BullMQ workers hold the process open
}
bootstrap();
