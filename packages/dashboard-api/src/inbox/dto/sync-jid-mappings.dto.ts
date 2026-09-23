import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class JidMappingDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^\d+@lid$/)
  lidJid!: string;

  @IsString()
  @MaxLength(40)
  @Matches(/^\d+@s\.whatsapp\.net$/)
  phoneJid!: string;
}

export class SyncJidMappingsDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => JidMappingDto)
  mappings!: JidMappingDto[];
}
