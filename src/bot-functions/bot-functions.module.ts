import { Module } from '@nestjs/common';
import { BotFunctionsService } from './app/bot-functions.service';
import { BotFunctionsController } from './presentation/bot-functions.controller';
import { BotFunctionsRepository } from './infraestructure/bot-functions.repository';
import { BOT_FUNCTIONS } from './domain/bot-functions.domain';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BotFunctionsController],
  providers: [
    BotFunctionsService,
    {
      useClass: BotFunctionsRepository,
      provide: BOT_FUNCTIONS,
    },
  ],
})
export class BotFunctionsModule {}

// providers: [
//   BotService,
//   {
//     useClass: BotRepository,
//     provide: BOT_REPOSITORY,
//   },
// ],
