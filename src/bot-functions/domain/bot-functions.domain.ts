import { BotSearchProductoDto } from '../dto/searchDto.dto';

export const BOT_FUNCTIONS = Symbol('BOT_FUNCTIONS');

export interface BotFunctions {
  search(dto: BotSearchProductoDto): Promise<any>;
}
