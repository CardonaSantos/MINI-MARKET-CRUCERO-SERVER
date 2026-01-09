import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class BotSearchProductoDto {
  @IsOptional()
  @IsInt()
  producto: string;

  @IsArray()
  categorias: Array<string>;
}
