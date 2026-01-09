import { PrismaService } from 'src/prisma/prisma.service';
import { BotFunctions } from '../domain/bot-functions.domain';
import { BotSearchProductoDto } from '../dto/searchDto.dto';
import { Logger } from '@nestjs/common';

export class BotFunctionsRepository implements BotFunctions {
  private readonly logger = new Logger(BotFunctionsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(dto: BotSearchProductoDto) {
    try {
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
