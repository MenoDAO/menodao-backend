import { ConfigService } from '@nestjs/config';

export const getJwtConfig = (configService: ConfigService) => {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. Cannot start the application.',
    );
  }
  return { secret };
};
