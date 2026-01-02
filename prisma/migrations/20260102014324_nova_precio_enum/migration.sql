/*
  Warnings:

  - The values [AGROSERVICIO,FINCA] on the enum `RolPrecio` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "RolPrecio_new" AS ENUM ('PUBLICO', 'NOVA', 'DISTRIBUIDOR', 'PROMOCION');
ALTER TABLE "PrecioProducto" ALTER COLUMN "rol" TYPE "RolPrecio_new" USING ("rol"::text::"RolPrecio_new");
ALTER TYPE "RolPrecio" RENAME TO "RolPrecio_old";
ALTER TYPE "RolPrecio_new" RENAME TO "RolPrecio";
DROP TYPE "RolPrecio_old";
COMMIT;
