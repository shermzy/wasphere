import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAiReplyDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  conversationId!: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Short operator tone hint' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tone?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Short operator instruction' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruction?: string;
}
