import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { WebAuthnModule } from '../webauthn/webauthn.module';
import { BotModule } from './bot.module';

describe('BotModule dependency wiring', () => {
  it('compiles the module graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.register({
          global: true,
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        CaptchaModule,
        WebAuthnModule,
        PrismaModule,
        BotModule,
      ],
    }).compile();
    expect(moduleRef).toBeDefined();
  });
});
