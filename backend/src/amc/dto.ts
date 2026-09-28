import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const AmcContractStatuses = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;

export class AmcContractQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateAmcContractDto {
  @IsString()
  customerId!: string;

  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD for startsOn.' })
  startsOn!: string;

  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD for endsOn.' })
  endsOn!: string;

  @IsOptional()
  @IsEnum(['PER_VISIT', 'PER_HOUR', 'PER_KM', 'FIXED'] as never[], {
    message: 'billingUnit must be PER_VISIT, PER_HOUR, PER_KM or FIXED.',
  })
  billingUnit?: 'PER_VISIT' | 'PER_HOUR' | 'PER_KM' | 'FIXED';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  preferredEngineerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  /** Machines to cover. Each must belong to the customer. */
  @IsOptional()
  @IsString({ each: true })
  equipmentIds?: string[];
}

export class UpdateAmcContractDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD for startsOn.' })
  startsOn?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD for endsOn.' })
  endsOn?: string;

  @IsOptional()
  @IsEnum(['PER_VISIT', 'PER_HOUR', 'PER_KM', 'FIXED'] as never[], {
    message: 'billingUnit must be PER_VISIT, PER_HOUR, PER_KM or FIXED.',
  })
  billingUnit?: 'PER_VISIT' | 'PER_HOUR' | 'PER_KM' | 'FIXED';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  serviceTypeId?: string | null;

  @IsOptional()
  @IsString()
  preferredEngineerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string | null;

  @IsInt()
  version!: number;
}

export class AmcVersionDto {
  @IsInt()
  version!: number;
}

export class AddPlannedVisitDto {
  @IsString()
  @Matches(DATE_RE, { message: 'Use YYYY-MM-DD for plannedOn.' })
  plannedOn!: string;

  /** Optional machine this visit is for; must be covered by the contract. */
  @IsOptional()
  @IsString()
  equipmentId?: string;
}
