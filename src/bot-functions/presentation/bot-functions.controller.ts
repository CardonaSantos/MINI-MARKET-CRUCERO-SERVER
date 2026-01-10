import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { BotFunctionsService } from '../app/bot-functions.service';
import { CreateBotFunctionDto } from '../dto/create-bot-function.dto';
import { UpdateBotFunctionDto } from '../dto/update-bot-function.dto';
import { ConfigService } from '@nestjs/config';
import { BotSearchProductoDto } from '../dto/searchDto.dto';
// bot-functions/make-search-products
@Controller('bot-functions')
export class BotFunctionsController {
  constructor(
    private readonly botFunctionsService: BotFunctionsService,
    private readonly config: ConfigService,
  ) {}

  @Post('make-search-products')
  create(
    @Body() dto: BotSearchProductoDto,
    @Headers('x-internal-secret') secretKey: string,
    @Req() req: Request,
  ) {
    console.log('RAW BODY:', req.body);
    console.log('DTO TRANSFORMADO:', dto);

    const INTERNAL_SECRET = this.config.get('INTERNAL_SECRET');

    if (INTERNAL_SECRET !== secretKey) {
      throw new UnauthorizedException('TOKEN NO AUTORIZADO');
    }

    return this.botFunctionsService.search(dto);
  }
}
