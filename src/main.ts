// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // comentario
  app.enableCors({
    origin: ['https://nova-pos-erp.up.railway.app'],
    credentials: true, // <- para cookies/withCredentials
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // exposedHeaders: ['set-cookie'], // opcional
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
