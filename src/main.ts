import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS - environment-aware configuration
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://menodao.org',
    'https://www.menodao.org',
    'https://app.menodao.org',
    'https://dev.menodao.org',
    'https://menodao.co.ke',
    'https://www.menodao.co.ke',
  ];
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : defaultOrigins;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('MenoDAO API')
    .setDescription('API for MenoDAO dental health membership platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;

  // Preserve raw body for HMAC validation on the webhook route.
  // This must be registered before app.listen() so it runs ahead of the
  // NestJS global body parser on this specific route.
  app.use('/whatsapp/webhook', (req: any, res: any, next: any) => {
    express.raw({ type: 'application/json' })(req, res, (err) => {
      if (err) return next(err);
      req.rawBody = req.body;
      req.body = JSON.parse(req.body.toString());
      next();
    });
  });

  await app.listen(port);
  console.log(`🚀 MenoDAO API running on http://localhost:${port}`);
  console.log(`📚 API Docs available at http://localhost:${port}/api/docs`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Allowed Origins: ${allowedOrigins.join(', ')}`);
  // Force redeploy - treatment history endpoints
}

bootstrap();
