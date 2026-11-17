import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HistoryAnchorDto {
  @ApiProperty({ description: 'Id of the oldest message you already have in this group', example: '3EB0A1B2C3D4E5F6' })
  @IsString() @IsNotEmpty() @MaxLength(128) id: string;

  @ApiProperty({ description: 'Whether that message was sent by this session', example: false })
  @IsBoolean() fromMe: boolean;

  @ApiProperty({ description: 'messageTimestamp of that message (unix seconds)', example: 1794900277 })
  @IsInt() @Min(1) timestamp: number;
}

export class GroupHistoryDto {
  @ApiProperty({ type: HistoryAnchorDto })
  @ValidateNested() @Type(() => HistoryAnchorDto) anchor: HistoryAnchorDto;

  @ApiProperty({ description: 'Messages to fetch before the anchor (WhatsApp sends at most 50)', example: 50 })
  @IsInt() @Min(1) @Max(50) count: number;
}
