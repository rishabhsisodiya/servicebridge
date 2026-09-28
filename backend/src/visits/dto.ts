import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVisitDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;
}

export class UpdateVisitDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  workDone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatoryName?: string;

  /** Optimistic concurrency: must match the visit's current version. */
  @IsInt()
  version!: number;
}

export class AddSpareDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  /** Whole units only. */
  @IsInt()
  @Min(1)
  @Max(999999)
  quantity!: number;
}

export class UpdateSpareDto {
  @IsInt()
  @Min(1)
  @Max(999999)
  quantity!: number;
}

export class RefuseSignatureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
