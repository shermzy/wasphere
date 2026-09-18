import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ProjectTargetsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
