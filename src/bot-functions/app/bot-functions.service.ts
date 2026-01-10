import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateBotFunctionDto } from '../dto/create-bot-function.dto';
import { UpdateBotFunctionDto } from '../dto/update-bot-function.dto';
import { BotSearchProductoDto } from '../dto/searchDto.dto';
import { BOT_FUNCTIONS, BotFunctions } from '../domain/bot-functions.domain';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BotFunctionsService {
  private readonly logger = new Logger(BotFunctionsService.name);
  constructor(
    private readonly prisma: PrismaService,

    // @Inject(BOT_FUNCTIONS)
    // private readonly bot_functions_repo: BotFunctions,
  ) {}
  async search(dto: BotSearchProductoDto) {
    try {
      if (!dto) {
        this.logger.warn('DTO recibido es null o undefined');
        return [];
      }

      this.logger.log(
        `DTO recibido desde BOT:\n${JSON.stringify(dto, null, 2)}`,
      );

      const { producto, categorias } = dto;

      const where: any = {
        nombre: {
          contains: producto,
          mode: 'insensitive',
        },
      };

      if (categorias?.length) {
        where.categorias = {
          some: {
            OR: categorias.map((tag) => ({
              nombre: {
                contains: tag,
                mode: 'insensitive',
              },
            })),
          },
        };
      }

      const search = await this.prisma.producto.findMany({
        where,
        select: {
          nombre: true,
          precios: {
            take: 1,
            orderBy: {
              orden: 'desc',
            },
            select: {
              precio: true,
            },
          },
          stock: {
            select: {
              cantidad: true,
              sucursal: {
                select: {
                  nombre: true,
                },
              },
            },
          },
        },
      });

      const formatted = search.map((prod) => {
        const stocks = prod.stock.reduce(
          (acc, stck) => {
            const key = stck.sucursal.nombre;
            acc[key] = (acc[key] ?? 0) + stck.cantidad;
            return acc;
          },
          {} as Record<string, number>,
        );

        return {
          nombre: prod.nombre,
          cantidadDisponible: stocks,
          precio: prod.precios?.[0]?.precio ?? 0,
        };
      });

      return formatted;
    } catch (error) {
      this.logger.error('Error: ', error);
      throw error;
    }
  }
}
