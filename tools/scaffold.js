const fs = require('fs');
const path = require('path');

const apps = ['aggregator', 'earnings'];

const packageJson = (name) => `{
  "name": "${name}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/bullmq": "^10.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "bullmq": "^5.0.0",
    "pg": "^8.0.0",
    "typeorm": "^0.3.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}`;

const tsconfig = `{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}`;

const nestCli = `{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}`;

const appModule = `import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
`;

const mainTs = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
}
bootstrap();
`;

apps.forEach(app => {
  const dir = path.join(__dirname, app);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), packageJson(app));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), tsconfig);
  fs.writeFileSync(path.join(dir, 'nest-cli.json'), nestCli);
  
  const src = path.join(dir, 'src');
  if (!fs.existsSync(src)) fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.module.ts'), appModule);
  fs.writeFileSync(path.join(src, 'main.ts'), mainTs);
});

console.log('Scaffolded');
