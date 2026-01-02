import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ensureOneDoc,
  isValidDpi,
  isValidNit,
  normalizeDpi,
  normalizeNit,
  nullIfEmpty,
} from './helpers/helpersClient';
import { ClienteToSelect } from './interfaces';
import { CreateClientDto, UpdateClientDto } from './dto/create-client.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);
  constructor(private readonly prisma: PrismaService) {}

  // Recomendado: una sola puerta de entrada que use el tx si viene
  async createClienteTx(
    tx: Prisma.TransactionClient | null,
    dto: CreateClientDto,
  ) {
    if (tx) {
      return this.create(dto, tx);
    }
    return this.prisma.$transaction(async (trx) => {
      return this.create(dto, trx);
    });
  }

  async create(
    createClientDto: CreateClientDto,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      // Normalizar y validar
      // const dpi = normalizeDpi(createClientDto.dpi);
      // const nit = normalizeNit(createClientDto.nit);
      // ensureOneDoc(dpi, nit);

      const rawDpi = (createClientDto.dpi || '').trim();
      const rawNit = (createClientDto.nit || '').trim();

      const dpi = rawDpi === '' ? null : rawDpi;
      const nit = rawNit === '' ? null : rawNit;

      // if (dpi && !isValidDpi(dpi))
      //   throw new BadRequestException('DPI inválido.');
      // if (nit && !isValidNit(nit))
      //   throw new BadRequestException('NIT inválido.');

      const nombre = (createClientDto.nombre ?? '').trim();
      if (!nombre) throw new BadRequestException('El nombre es obligatorio.');

      const db = tx ?? this.prisma;

      const client = await db.cliente.create({
        data: {
          nombre,
          apellidos: createClientDto.apellidos
            ? createClientDto.apellidos
            : null,
          telefono: createClientDto.telefono ? createClientDto.telefono : null,
          direccion: createClientDto.direccion
            ? createClientDto.direccion
            : null,
          observaciones: createClientDto.observaciones
            ? createClientDto.observaciones
            : null,

          dpi: dpi,
          nit: nit,
        },
      });

      return client;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // constraint única (puede venir como índice compuesto)
        const target =
          (error.meta?.target as string[] | undefined)?.join(', ') ?? 'valor';
        throw new ConflictException(`Ya existe un cliente con ${target}`);
      }

      // Preserva HttpExceptions específicas; si no, lanza 500 genérico
      if (error instanceof HttpException) throw error;

      this.logger.error(error);
      throw new InternalServerErrorException('Error en el servidor');
    }
  }

  async Customers() {
    try {
      const clientes = await this.prisma.cliente.findMany({
        select: {
          id: true,
          nombre: true,
          apellidos: true,
          telefono: true,
          dpi: true,
          nit: true, // 👈 nuevo
          direccion: true,
          observaciones: true,
          actualizadoEn: true,
          _count: { select: { compras: true } },
        },
        orderBy: { creadoEn: 'desc' },
      });
      return clientes;
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Error al encontrar los clientes');
    }
  }

  async findCustomersToWarranty() {
    try {
      return await this.prisma.cliente.findMany({
        orderBy: { creadoEn: 'desc' },
      });
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('Error al encontrar customers');
    }
  }

  async update(id: number, updateClientDto: UpdateClientDto) {
    try {
      this.logger.log('el dto updater es: ', updateClientDto);

      // Normalizar y validar
      const dpi = normalizeDpi(updateClientDto.dpi);
      const nit = normalizeNit(updateClientDto.nit);
      this.logger.log('El DPI es: ', dpi);
      this.logger.log('El NIT es: ', nit);

      ensureOneDoc(dpi, nit);
      if (dpi && !isValidDpi(dpi))
        throw new BadRequestException('DPI inválido.');
      if (nit && !isValidNit(nit))
        throw new BadRequestException('NIT inválido.');

      const userUpdated = await this.prisma.cliente.update({
        where: { id },
        data: {
          nombre: updateClientDto.nombre.trim(),
          apellidos: nullIfEmpty(updateClientDto.apellidos),
          telefono: nullIfEmpty(updateClientDto.telefono),
          direccion: nullIfEmpty(updateClientDto.direccion),
          observaciones: nullIfEmpty(updateClientDto.observaciones),
          dpi,
          nit,
        },
      });

      return userUpdated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = (error.meta?.target as string[])?.[0] ?? 'valor';
          throw new ConflictException(`${target.toUpperCase()} ya existe`);
        }
      }
      this.logger.error(error);
      throw new InternalServerErrorException('Error al editar cliente');
    }
  }

  async removeAll() {
    try {
      return await this.prisma.cliente.deleteMany({});
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('Error');
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.cliente.delete({ where: { id } });
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Error al intentar eliminar el cliente');
    }
  }

  async getClientToCredit() {
    try {
      return await this.prisma.cliente.findMany({
        select: {
          id: true,
          nombre: true,
          telefono: true,
          dpi: true,
          nit: true, // 👈 nuevo
          creadoEn: true,
        },
        orderBy: { creadoEn: 'desc' },
      });
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Error al conseguir customers');
    }
  }

  async getClientesToSelect(): Promise<ClienteToSelect[]> {
    try {
      const clientes = await this.prisma.cliente.findMany({
        select: {
          id: true,
          nombre: true,
          apellidos: true,
          actualizadoEn: true,
          creadoEn: true,
          telefono: true,
          observaciones: true,
          dpi: true, // 👈 si los necesitas en el select
          nit: true, // 👈 idem
        },
      });

      const formattClientes = clientes.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        apellidos: c.apellidos,
        observaciones: c.observaciones,
        telefono: c.telefono,
        creadoEn: c.creadoEn,
        actualizadoEn: c.actualizadoEn,
        dpi: c.dpi,
        nit: c.nit,
      }));

      return formattClientes;
    } catch (error) {
      this.logger.error(
        'El error generado en get clientes to select es: ',
        error,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Fatal error: Error inesperado en modulo clientes',
      );
    }
  }
}
