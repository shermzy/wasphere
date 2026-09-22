import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { ApiKeyPermissionGuard } from '../auth/api-key-permission.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ContactsService } from './contacts.service';

class ListContactsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(30) tag?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

class CreateContactDto {
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsString() @MaxLength(100) savedName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
}

class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(100) savedName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class BulkContactsDto {
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(500) ids: string[];
  @IsIn(['addTag', 'removeTag', 'delete']) action: 'addTag' | 'removeTag' | 'delete';
  @IsOptional() @IsString() @MaxLength(30) tag?: string;
}

class ExportContactsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(10000) ids?: string[];
}

class ImportRowDto {
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ImportContactsDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ImportRowDto)
  contacts: ImportRowDto[];
}

interface AuthedRequest extends Request {
  user: { userId: string };
}

@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/contacts')
@UseGuards(CombinedAuthGuard, ApiKeyPermissionGuard, CapabilityGuard)
@RequireCapability('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequiresPermission('contacts:read')
  @ApiOperation({ summary: 'List/search contacts (the contact book)' })
  list(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Query() q: ListContactsQueryDto) {
    return this.contacts.list(req.user.userId, ws, q);
  }

  @Get('tags')
  @RequiresPermission('contacts:read')
  @ApiOperation({ summary: 'Distinct tags used across the workspace' })
  tags(@Req() req: AuthedRequest, @Param('workspaceId') ws: string) {
    return this.contacts.listTags(req.user.userId, ws);
  }

  @Post()
  @RequiresPermission('contacts:write')
  @ApiOperation({ summary: 'Manually add a contact by phone number' })
  create(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Body() dto: CreateContactDto) {
    return this.contacts.create(req.user.userId, ws, dto);
  }

  @Post('bulk')
  @RequiresPermission('contacts:write')
  @ApiOperation({ summary: 'Tag or delete many contacts at once' })
  bulk(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Body() dto: BulkContactsDto) {
    return this.contacts.bulk(req.user.userId, ws, dto);
  }

  @Post('export')
  @RequiresPermission('contacts:read')
  @ApiOperation({ summary: 'Export contacts to CSV (all, or a selected subset)' })
  export(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Body() dto: ExportContactsDto) {
    return this.contacts.exportCsv(req.user.userId, ws, dto.ids);
  }

  @Post('import')
  @RequiresPermission('contacts:write')
  @ApiOperation({ summary: 'Bulk-import contacts (new numbers added, existing skipped)' })
  import(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Body() dto: ImportContactsDto) {
    return this.contacts.importContacts(req.user.userId, ws, dto.contacts);
  }

  @Patch(':contactId')
  @RequiresPermission('contacts:write')
  @ApiOperation({ summary: 'Update a contact (saved name, tags, notes)' })
  update(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Param('contactId') id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(req.user.userId, ws, id, dto);
  }

  @Delete(':contactId')
  @RequiresPermission('contacts:write')
  @ApiOperation({ summary: 'Delete a contact from the book' })
  remove(@Req() req: AuthedRequest, @Param('workspaceId') ws: string, @Param('contactId') id: string) {
    return this.contacts.remove(req.user.userId, ws, id);
  }
}
