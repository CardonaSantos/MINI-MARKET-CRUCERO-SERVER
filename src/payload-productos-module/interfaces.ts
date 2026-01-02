import { RolPrecio } from '@prisma/client';

export interface PrecioPorRolRaw {
  rol: RolPrecio;
  precio: string | number;
}

export interface ProductoRaw {
  codigoproducto: string | null;
  nombre: string | null;
  descripcion: string | null;
  codigoproveedor: string | null;
  categorias: string[];
  tipoempaque: string | null;

  stockminimo: number | null;
  stockvencimiento: number | string | null;
  stockactual: number | string | null;

  preciocosto: string | number;

  precios: PrecioPorRolRaw[];
}

// OTROS

// interfaces.ts

export interface StockJsonRaw {
  sucursalId: number;
  total: number;
  fechaVencimiento: string | null;
}

export interface ProductoJsonRaw {
  id?: number; // Lo ignoramos al crear, pero viene en el JSON
  nombre: string;
  codigo: string; // Antes era codigoproducto
  costo: number; // Antes era preciocosto
  descripcion: string | null;

  // Arrays
  precios: number[]; // Ejemplo: [1500, 1200]
  categorias: string[]; // Ejemplo: ["SAMSUNG", "CELULARES"]
  stockTotal: StockJsonRaw[];
}
