import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export const MAX_AUTOMATION_NAME_LENGTH = 120;
export const MAX_AUTOMATION_KEYWORD_LENGTH = 120;
export const MAX_AUTOMATION_RESPONSE_LENGTH = 4096;
export const MAX_PROVIDER_SESSION_ID_LENGTH = 200;

export class CreateAutomationDto {
  @IsString()
  @MaxLength(MAX_AUTOMATION_NAME_LENGTH)
  name!: string;

  @IsString()
  @MaxLength(MAX_PROVIDER_SESSION_ID_LENGTH)
  providerSessionId!: string;

  @IsString()
  @MaxLength(MAX_AUTOMATION_KEYWORD_LENGTH)
  keyword!: string;

  @IsString()
  @MaxLength(MAX_AUTOMATION_RESPONSE_LENGTH)
  responseText!: string;
}

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_AUTOMATION_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PROVIDER_SESSION_ID_LENGTH)
  providerSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AUTOMATION_KEYWORD_LENGTH)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AUTOMATION_RESPONSE_LENGTH)
  responseText?: string;
}

export class AutomationConfirmationDto {
  @IsBoolean()
  confirm!: boolean;
}
