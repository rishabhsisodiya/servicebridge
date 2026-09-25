import { Controller, Get, Param, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RequirePermissions } from '../auth/decorators';
import { CatalogService } from './catalog.service';
import type { CoverageFilter } from './coverage';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

class PageDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

class CustomersQuery extends PageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  territory?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

class EquipmentQuery extends PageDto {
  @IsOptional()
  @IsIn(['amc', 'amc_expiring', 'warranty', 'chargeable'])
  coverage?: CoverageFilter;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

class ItemsQuery extends PageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  group?: string;
}

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('customers')
  @RequirePermissions('customers.view')
  customers(@Query() q: CustomersQuery) {
    return this.catalog.customers(q);
  }

  @Get('customers/:id')
  @RequirePermissions('customers.view')
  customer(@Param('id') id: string) {
    return this.catalog.customer(id);
  }

  @Get('equipment')
  @RequirePermissions('equipment.view')
  equipment(@Query() q: EquipmentQuery) {
    return this.catalog.equipment(q);
  }

  @Get('equipment/:id')
  @RequirePermissions('equipment.view')
  machine(@Param('id') id: string) {
    return this.catalog.machine(id);
  }

  @Get('items')
  @RequirePermissions('items.view')
  items(@Query() q: ItemsQuery) {
    return this.catalog.items(q);
  }
}
