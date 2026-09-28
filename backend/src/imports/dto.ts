import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

export const IMPORT_ENTITIES = ['customers', 'equipment'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const ROW_MODES = ['create', 'update-fill', 'update-overwrite', 'skip'] as const;
export type RowMode = (typeof ROW_MODES)[number];

export class ConfirmRowDto {
  @Type(() => Number)
  @IsInt()
  index!: number;

  @IsIn(ROW_MODES as unknown as string[])
  mode!: RowMode;
}

export class ConfirmImportDto {
  @IsString()
  validationId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmRowDto)
  rows?: ConfirmRowDto[];
}
