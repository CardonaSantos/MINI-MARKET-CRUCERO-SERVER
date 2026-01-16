import { MetodoPago, Rol } from '@prisma/client';

export function exigeCajaPorRolYMetodo(rol: Rol, metodo: MetodoPago) {
  const esEfectivo = metodo === 'EFECTIVO' || metodo === 'CONTADO';
  if (!esEfectivo) return false;
  if (rol === 'VENDEDOR') return true;
  return true;
}
