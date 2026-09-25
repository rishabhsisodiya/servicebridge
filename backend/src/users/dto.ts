import { Role, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  regionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class InviteUserDto {
  @IsString()
  @MinLength(2, { message: 'Enter their full name.' })
  @MaxLength(80)
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsEnum(Role, { message: 'Choose a role.' })
  role: Role;

  @IsOptional()
  @IsString()
  regionId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter their full name.' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Choose a role.' })
  role?: Role;

  /** null removes the region. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  regionId?: string | null;

  /** The version the editor loaded; a stale version is rejected. */
  @IsInt()
  version: number;
}
