import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ConnectionDbDto {
  @IsString()
  @MinLength(1, { message: 'Enter the database host.' })
  @MaxLength(253)
  @Matches(/^[A-Za-z0-9.-]+$/, {
    message: 'Enter only the host name or IP address, without http:// or a port.',
  })
  host: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsString()
  @Matches(/^[A-Za-z0-9_]+$/, { message: 'Use only letters, numbers and underscores.' })
  @MaxLength(64)
  database: string;

  @IsString()
  @MinLength(1, { message: 'Enter the database user.' })
  @MaxLength(80)
  user: string;

  /** Required when first adding database access; omit on edit to keep the saved one. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsBoolean()
  ssl: boolean;

  /** Most queries run at once against the ERP database. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Use at least 1.' })
  @Max(20, { message: 'Use at most 20, so ERPTick never overloads the ERP database.' })
  connectionLimit?: number;
}

const API_TOKEN = /^[A-Za-z0-9]+$/;
const API_TOKEN_MESSAGE = 'Paste the value exactly as ERPNext shows it (letters and numbers only).';

export class ConnectionInputDto {
  @IsString()
  @MinLength(3, { message: 'Use at least 3 characters.' })
  @MaxLength(60)
  name: string;

  @IsString()
  @MaxLength(200)
  baseUrl: string;

  @IsString()
  @Length(8, 64, { message: 'The API key should be 8–64 characters.' })
  @Matches(API_TOKEN, { message: API_TOKEN_MESSAGE })
  apiKey: string;

  @IsString()
  @Length(8, 64, { message: 'The API secret should be 8–64 characters.' })
  @Matches(API_TOKEN, { message: API_TOKEN_MESSAGE })
  apiSecret: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectionDbDto)
  db?: ConnectionDbDto;
}

/** "Test before saving": same fields, name optional. */
export class TestDraftDto extends ConnectionInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  declare name: string;

  /** When editing: blank secrets fall back to this saved connection's values. */
  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  declare apiKey: string;

  @IsOptional()
  declare apiSecret: string;
}

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Use at least 3 characters.' })
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseUrl?: string;

  /** Omit to keep the saved key. */
  @IsOptional()
  @IsString()
  @Length(8, 64, { message: 'The API key should be 8–64 characters.' })
  @Matches(API_TOKEN, { message: API_TOKEN_MESSAGE })
  apiKey?: string;

  /** Omit to keep the saved secret. */
  @IsOptional()
  @IsString()
  @Length(8, 64, { message: 'The API secret should be 8–64 characters.' })
  @Matches(API_TOKEN, { message: API_TOKEN_MESSAGE })
  apiSecret?: string;

  /** Omit to keep, null to remove database access. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @ValidateNested()
  @Type(() => ConnectionDbDto)
  db?: ConnectionDbDto | null;

  @IsInt()
  version: number;
}

export class SetPurposesDto {
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  MASTER_SYNC?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  WRITEBACK?: string | null;
}
