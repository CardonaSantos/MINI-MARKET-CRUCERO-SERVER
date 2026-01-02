import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, PrismaClient } from '@prisma/client';
import { ProductoJsonRaw, ProductoRaw } from './interfaces';
import { rawPayloadDataProducts } from 'src/assets/productos';

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function splitCategorias(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .flatMap((x) =>
        String(x)
          .split(',')
          .map((p) => p.trim()),
      )
      .filter((s) => s.length > 0);
  }
  if (!isNonEmptyString(v)) return [];
  return String(v)
    .split(',')
    .map((p) => p.trim())
    .filter((s) => s.length > 0);
}

/**
 * Normaliza importes en formatos:
 *  "1.234,56" -> 1234.56
 *  "1,234.56" -> 1234.56
 *  "1234,56"  -> 1234.56
 *  "1234.56"  -> 1234.56
 *  "120"      -> 120
 * Retorna number | null si no parsea.
 */
function parseMoney(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;

  let s = String(input).trim();
  if (!s) return null;

  // quita símbolos no numéricos salvo , . y -
  s = s.replace(/[^\d.,-]/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // coma decimal -> quitar puntos de miles, coma -> punto
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // punto decimal -> quitar comas de miles
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // asumir coma decimal
    s = s.replace(',', '.');
  } else {
    // punto decimal o entero; quitar comas perdidas
    s = s.replace(/,/g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseEntero(input: unknown, defaultValue = 0): number {
  const n = parseMoney(input);
  if (n === null) return defaultValue;
  return Math.trunc(n);
}

function ensurePrecioDecimal(value: number): Prisma.Decimal {
  // Prisma acepta number, pero Decimal te protege de binario
  return new Prisma.Decimal(value.toFixed(2));
}

function normalizeProveedorCode(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (
    ['n/a', 'na', 's/n', 'sn', '-', '--', 'sin', 'null', 'none'].includes(low)
  )
    return null;
  return s;
}

// --- NUEVO HELPER DE FECHA ---
function parseDate(input: unknown): Date | null {
  if (!input) return null;
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return null;
  return d;
}

@Injectable()
export class PayloadProductosModuleService {
  private readonly logger = new Logger(PayloadProductosModuleService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asegura que existan las sucursales base antes de cargar stock.
   */
  private async ensureSucursales(tx: PrismaClient | Prisma.TransactionClient) {
    const sucursalesData = [
      { id: 1, nombre: 'Sucursal Principal', tipo: 'TIENDA' },
      { id: 2, nombre: 'Sucursal San Marcos', tipo: 'TIENDA' },
      { id: 3, nombre: 'Sucursal San Antonio', tipo: 'TIENDA' },
    ];

    for (const suc of sucursalesData) {
      await tx.sucursal.upsert({
        where: { id: suc.id },
        create: {
          id: suc.id, // Forzamos el ID
          nombre: suc.nombre,
          tipoSucursal: 'TIENDA', // Enum default
          direccion: 'Dirección pendiente',
          estadoOperacion: true,
        },
        update: {
          // Si ya existe, solo actualizamos el nombre por si cambió
          nombre: suc.nombre,
        },
      });
    }
    this.logger.log('🏢 Sucursales verificadas/creadas (Ids: 1, 2, 3)');
  }

  /**
   * Procesa 1 producto con todas sus relaciones (Categorias, Precios, Stock Multi-Sucursal)
   */
  private async upsertProductoTx(
    tx: PrismaClient | Prisma.TransactionClient,
    p: ProductoJsonRaw,
  ): Promise<number> {
    // 1. Validaciones y limpieza básica
    const codigoProducto = trimOrNull(p.codigo);
    const nombre = trimOrNull(p.nombre);
    const descripcion = trimOrNull(p.descripcion);
    const costo = p.costo || 0;

    if (!codigoProducto || !nombre) {
      throw new BadRequestException(
        `Falta código o nombre en producto: ${JSON.stringify(p)}`,
      );
    }

    const producto = await tx.producto.upsert({
      where: { codigoProducto },
      create: {
        codigoProducto,
        nombre,
        descripcion,
        precioCostoActual: costo,
      },
      update: {
        nombre,
        descripcion,
        precioCostoActual: costo,
      },
      select: { id: true },
    });

    if (p.categorias && p.categorias.length > 0) {
      for (const catNombre of p.categorias) {
        const nombreLimpio = catNombre.trim();
        if (!nombreLimpio) continue;

        await tx.categoria.upsert({
          where: { nombre: nombreLimpio },
          create: {
            nombre: nombreLimpio,
            productos: { connect: { id: producto.id } },
          },
          update: {
            productos: { connect: { id: producto.id } },
          },
        });
      }
    }

    // 4. Precios (Array de números, ordenados de mayor a menor)
    // Borramos precios anteriores "ESTANDAR" para evitar duplicados al re-correr el script
    await tx.precioProducto.deleteMany({
      where: {
        productoId: producto.id,
        tipo: 'ESTANDAR',
      },
    });

    if (p.precios && p.precios.length > 0) {
      let orden = 1;
      for (const precioValor of p.precios) {
        await tx.precioProducto.create({
          data: {
            productoId: producto.id,
            precio: ensurePrecioDecimal(precioValor),
            tipo: 'ESTANDAR',
            estado: 'APROBADO',
            rol: 'PUBLICO', // Rol fijo según requerimiento
            orden: orden++, // 1, 2, 3...
            usado: false,
          },
        });
      }
    }

    // 5. Stock por Sucursal
    if (p.stockTotal && p.stockTotal.length > 0) {
      for (const itemStock of p.stockTotal) {
        const cantidad = itemStock.total || 0;

        // Si la cantidad es 0, decidimos si crear el registro o no.
        // Generalmente es mejor NO crear registro de stock si es 0 para no llenar la tabla,
        // pero si tu lógica requiere que exista en 0, quita este if.
        if (cantidad <= 0) continue;

        const fechaVencimiento = parseDate(itemStock.fechaVencimiento);
        const sucursalId = itemStock.sucursalId;

        // Verificar si ya existe stock para este producto en esa sucursal
        const existeStock = await tx.stock.findFirst({
          where: {
            productoId: producto.id,
            sucursalId: sucursalId,
          },
        });

        if (!existeStock) {
          // Crear stock inicial
          await tx.stock.create({
            data: {
              productoId: producto.id,
              sucursalId: sucursalId,
              cantidad: cantidad,
              cantidadInicial: cantidad,
              precioCosto: Number(costo), // Guardamos el costo histórico del lote
              costoTotal: Number(costo) * cantidad,
              fechaIngreso: new Date(),
              fechaVencimiento: fechaVencimiento ?? undefined,
            },
          });
        } else {
          // Opcional: Actualizar stock existente si es una recarga
          // En este script de carga inicial, asumimos que si existe no lo tocamos
          // o podríamos sumar. Por seguridad, lo dejamos idempotente (no duplica).
        }
      }
    }

    return producto.id;
  }

  /**
   * Carga Masiva Principal
   */
  async cargaMasiva() {
    // Casting forzado porque importamos JSON directo, asegura que TS confíe en la estructura
    const data: ProductoJsonRaw[] =
      rawPayloadDataProducts as unknown as ProductoJsonRaw[];

    try {
      if (!Array.isArray(data)) {
        throw new BadRequestException('Payload inválido: se esperaba un array');
      }

      const total = data.length;
      let successCount = 0;
      const createdIds: number[] = [];
      const failures: any[] = [];

      this.logger.log(`🚀 Iniciando carga masiva de ${total} productos...`);

      // 1. Asegurar Sucursales (Una sola vez antes del bucle)
      await this.prisma.$transaction(async (tx) => {
        await this.ensureSucursales(tx);
      });

      // 2. Procesar Productos
      for (let index = 0; index < total; index++) {
        const p = data[index];
        const codigoRef = p.codigo || `INDEX_${index}`;

        try {
          const id = await this.prisma.$transaction(
            async (tx) => {
              return this.upsertProductoTx(tx, p);
            },
            { timeout: 10000 }, // Timeout un poco más alto por si hay muchas relaciones
          );

          successCount++;
          createdIds.push(id);
          // Log menos ruidoso, cada 50 items o si falla
          if (index % 50 === 0) {
            this.logger.log(`⏳ Procesando... ${index}/${total}`);
          }
        } catch (err: any) {
          failures.push({
            index,
            codigo: codigoRef,
            error: err.message,
          });
          this.logger.error(`❌ Error en ${codigoRef}: ${err.message}`);
        }
      }

      this.logger.log(
        `✅ Carga finalizada. OK: ${successCount}, Fail: ${failures.length}`,
      );

      return {
        total,
        successCount,
        failedCount: failures.length,
        failures,
      };
    } catch (error) {
      this.logger.error('Error fatal en carga masiva', error);
      throw new InternalServerErrorException(
        'Error fatal ejecutando la carga masiva.',
      );
    }
  }

  // --- DELETE ALL (Mismo de antes, solo referencia) ---
  async deleteAllProductos() {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          TRUNCATE TABLE "Producto", "Categoria", "Stock", "PrecioProducto" RESTART IDENTITY CASCADE;
        `);
      });
      return { ok: true, message: 'Tablas limpiadas correctamente' };
    } catch (e) {
      throw new InternalServerErrorException(e);
    }
  }

  // //retorno producto creado
  // /**
  //  * Crea/actualiza 1 producto completo (producto + tipoPresentacion + categorias + precios)
  //  * en UNA transacción. Retorna el id del producto.
  //  */
  // private async upsertProductoTx(
  //   tx: PrismaClient | Prisma.TransactionClient,
  //   p: ProductoRaw,
  //   sucursalId: number,
  // ): Promise<number> {
  //   // -------- Validaciones mínimas
  //   const codigoProducto = trimOrNull(p.codigoproducto);
  //   const nombre = trimOrNull(p.nombre);
  //   const descripcion = trimOrNull(p.descripcion);
  //   const tipoEmpaque = trimOrNull(p.tipoempaque);
  //   const categorias = splitCategorias(p.categorias);
  //   const stockMinimo = parseEntero(p.stockminimo, 0);
  //   let codigoProveedor = normalizeProveedorCode(p.codigoproveedor);

  //   const stockActual = parseEntero(p.stockactual, 0);
  //   const fechaVencimiento = parseDate(p.stockvencimiento);

  //   if (codigoProveedor) {
  //     // Optimización: Usar findFirst en lugar de findUnique si codigoProveedor no es @unique en schema
  //     const holder = await tx.producto.findFirst({
  //       where: { codigoProveedor },
  //       select: { id: true, codigoProducto: true },
  //     });

  //     if (holder && holder.codigoProducto !== codigoProducto) {
  //       this.logger.warn(
  //         `codigoProveedor duplicado "${codigoProveedor}" en prod "${codigoProducto}". Pertenece a "${holder.codigoProducto}". Se guardará NULL.`,
  //       );
  //       codigoProveedor = null;
  //     }
  //   }

  //   if (!codigoProducto) throw new BadRequestException('Falta codigoproducto');
  //   if (!nombre)
  //     throw new BadRequestException(`Falta nombre para ${codigoProducto}`);

  //   const costo = parseMoney(p.preciocosto);
  //   if (costo === null)
  //     throw new BadRequestException(`Costo inválido para ${codigoProducto}`);

  //   // -------- Upsert del producto base
  //   const producto = await tx.producto.upsert({
  //     where: { codigoProducto },
  //     create: {
  //       codigoProducto,
  //       nombre,
  //       descripcion: descripcion ?? undefined,
  //       codigoProveedor: codigoProveedor ?? undefined,
  //       precioCostoActual: costo, // Asegurar Decimal
  //       stockThreshold: {
  //         create: { stockMinimo },
  //       },
  //     },
  //     update: {
  //       nombre,
  //       descripcion: descripcion ?? undefined,
  //       // Si codigoProveedor es null, lo desconectamos (set: null) o no hacemos nada
  //       ...(codigoProveedor !== undefined ? { codigoProveedor } : {}),
  //       precioCostoActual: costo,

  //       // CORRECCIÓN CRÍTICA 1: Usar upsert anidado para evitar error si ya existe el threshold
  //       stockThreshold: {
  //         upsert: {
  //           create: { stockMinimo },
  //           update: { stockMinimo },
  //         },
  //       },
  //     },
  //     select: { id: true },
  //   });

  //   // -------- Tipo de empaque
  //   if (tipoEmpaque) {
  //     await tx.tipoPresentacion.upsert({
  //       where: { nombre: tipoEmpaque },
  //       create: {
  //         nombre: tipoEmpaque,
  //         activo: true,
  //         productos: { connect: { id: producto.id } },
  //       },
  //       update: {
  //         productos: { connect: { id: producto.id } },
  //       },
  //     });
  //   }

  //   // -------- Categorías
  //   if (categorias.length > 0) {
  //     for (const cat of categorias) {
  //       await tx.categoria.upsert({
  //         where: { nombre: cat },
  //         create: {
  //           nombre: cat,
  //           productos: { connect: { id: producto.id } },
  //         },
  //         update: {
  //           productos: { connect: { id: producto.id } },
  //         },
  //       });
  //     }
  //   }

  //   // -------- Precios
  //   if (Array.isArray(p.precios) && p.precios.length > 0) {
  //     await tx.precioProducto.deleteMany({
  //       where: {
  //         productoId: producto.id,
  //         tipo: 'ESTANDAR',
  //       },
  //     });

  //     let orden = 1;

  //     for (const pr of p.precios) {
  //       const valor = parseMoney(pr.precio);
  //       if (valor === null) {
  //         this.logger.warn(
  //           `Precio inválido (${pr.precio}) rol=${pr.rol} producto=${codigoProducto}`,
  //         );
  //         continue;
  //       }

  //       await tx.precioProducto.create({
  //         data: {
  //           productoId: producto.id,
  //           precio: ensurePrecioDecimal(valor),
  //           rol: pr.rol,
  //           tipo: 'ESTANDAR',
  //           estado: 'APROBADO',
  //           orden: orden++,
  //         },
  //       });
  //     }
  //   }

  //   if (stockActual > 0) {
  //     // IDEMPOTENCIA: Verificar si ya existe stock para este producto en esta sucursal
  //     const existeStock = await tx.stock.findFirst({
  //       where: {
  //         productoId: producto.id,
  //         sucursalId: 1,
  //         // Opcional: Podríamos filtrar por lote/vencimiento si quisieras permitir multiples lotes
  //       },
  //     });

  //     if (!existeStock) {
  //       // Solo creamos el stock inicial si NO existe inventario previo en esta sucursal
  //       await tx.stock.create({
  //         data: {
  //           productoId: producto.id,
  //           sucursalId: 1,
  //           cantidad: stockActual,
  //           cantidadInicial: stockActual, // Asumimos que lo que entra es el inicial de este lote
  //           precioCosto: costo,
  //           costoTotal: costo * stockActual, // Calculo automático
  //           fechaIngreso: new Date(),
  //           fechaVencimiento: fechaVencimiento ?? undefined, // null si no tiene

  //           // Relaciones opcionales dejadas en null (entregaStock, compra, etc)
  //           // ya que es una carga inicial "hardcoded".
  //         },
  //       });
  //       this.logger.debug(
  //         `📦 Stock inicial creado: ${stockActual} unids para ${codigoProducto}`,
  //       );
  //     } else {
  //       // Si ya existe, podemos optar por NO hacer nada (seguro) o SUMAR (peligroso en scripts de seed)
  //       // Aquí decido no hacer nada para mantener la idempotencia.
  //       // Si quisieras actualizar el stock existente, usarías tx.stock.update({...})
  //     }
  //   }

  //   return producto.id;
  // }

  // /**
  //  * Carga masiva: procesa cada producto en su **propia transacción**.
  //  * Devuelve resumen con contadores y errores.
  //  */
  // async cargaMasiva() {
  //   // Importa tu payload como sea que lo tengas disponible
  //   const data: ProductoRaw[] = rawPayloadDataProducts;

  //   try {
  //     if (!Array.isArray(data)) {
  //       throw new BadRequestException('Payload inválido: se esperaba un array');
  //     }

  //     const total = data.length;
  //     let successCount = 0;
  //     const createdIds: number[] = [];
  //     const failures: Array<{
  //       index: number;
  //       codigoProducto?: string | null;
  //       error: string;
  //     }> = [];

  //     for (let index = 0; index < data.length; index++) {
  //       const p = data[index];
  //       const codigoProducto = trimOrNull(p?.codigoproducto);

  //       try {
  //         const id = await this.prisma.$transaction(
  //           async (tx) => {
  //             return this.upsertProductoTx(tx, p, 1);
  //           },
  //           { timeout: 10000 },
  //         );

  //         successCount++;
  //         createdIds.push(id);
  //         this.logger.log(
  //           `✔️ Producto procesado OK (index=${index}) codigoProducto=${codigoProducto}`,
  //         );
  //       } catch (err: any) {
  //         const msg =
  //           err instanceof HttpException
  //             ? err.message
  //             : err?.message || 'Error desconocido';

  //         failures.push({
  //           index,
  //           codigoProducto,
  //           error: msg,
  //         });

  //         this.logger.error(
  //           `❌ Falló producto (index=${index}) codigoProducto=${codigoProducto}: ${msg}`,
  //           err?.stack,
  //         );
  //       }
  //     }

  //     const failedCount = failures.length;

  //     const resumen = {
  //       total,
  //       successCount,
  //       failedCount,
  //       createdIds,
  //       failures,
  //     };

  //     this.logger.log(
  //       `Resumen carga masiva -> total=${total}, ok=${successCount}, fail=${failedCount}`,
  //     );

  //     return resumen;
  //   } catch (error) {
  //     this.logger.error('Error fatal en carga masiva', error?.stack);
  //     if (error instanceof HttpException) throw error;
  //     throw new InternalServerErrorException(
  //       'Fatal error: Error inesperado en módulo carga masiva',
  //     );
  //   }
  // }

  // //Deshacer cambio
  // async deleteAllProductos() {
  //   try {
  //     await this.prisma.$transaction(async (tx) => {
  //       // ⚠️ Ajusta la lista con tus tablas “raíz” que quieres vaciar.
  //       // CASCADE limpia dependientes (precios, stock, joins M2M, etc.)
  //       await tx.$executeRawUnsafe(`
  //         TRUNCATE TABLE
  //           "Producto",
  //           "Categoria",
  //           "TipoPresentacion",
  //           "StockThreshold"
  //         RESTART IDENTITY CASCADE;
  //       `);
  //     });

  //     this.logger.log('TRUNCATE CASCADE completado (PostgreSQL).');
  //     return { ok: true };
  //   } catch (e) {
  //     if (e instanceof Prisma.PrismaClientKnownRequestError) {
  //       this.logger.error(
  //         `Prisma ${e.code} meta=${JSON.stringify(e.meta)}`,
  //         e.stack,
  //       );
  //     } else {
  //       this.logger.error('Error en TRUNCATE CASCADE', (e as any)?.stack);
  //     }
  //     throw e;
  //   }
  // }
}
