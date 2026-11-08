import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { BotModule } from './bot.module';

describe('BotModule dependency wiring', () => {
  it('compiles the module graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        BotModule,
      ],
    }).compile();
    expect(moduleRef).toBeDefined();
  });
});
