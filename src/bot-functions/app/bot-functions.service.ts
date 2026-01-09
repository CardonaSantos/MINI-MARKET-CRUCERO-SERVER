import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateBotFunctionDto } from '../dto/create-bot-function.dto';
import { UpdateBotFunctionDto } from '../dto/update-bot-function.dto';
import { BotSearchProductoDto } from '../dto/searchDto.dto';
import { BOT_FUNCTIONS, BotFunctions } from '../domain/bot-functions.domain';

@Injectable()
export class BotFunctionsService {
  private readonly logger = new Logger(BotFunctionsService.name);
  constructor(
    @Inject(BOT_FUNCTIONS)
    private readonly bot_functions_repo: BotFunctions,
  ) {}

  async makeSearchProducts(dto: BotSearchProductoDto) {
    try {
      return await this.bot_functions_repo.search(dto);
    } catch (error) {
      this.logger.log('Error: ', error);
    }
  }
}
