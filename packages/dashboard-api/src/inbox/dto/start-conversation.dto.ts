import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type StartConversationKind = 'text' | 'template';

@ValidatorConstraint({ name: 'startConversationShape', async: false })
class StartConversationShapeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const payload = args.object as Record<string, unknown>;
    const templateFields = ['templateName', 'languageCode', 'bodyParams'];
    const hasTemplateFields = templateFields.some((field) => payload[field] !== undefined);
    const kind = payload.kind as StartConversationKind | undefined;

    if (kind === 'template') {
      return typeof payload.templateName === 'string'
        && typeof payload.languageCode === 'string'
        && typeof payload.text === 'undefined'
        && (!Array.isArray(payload.bodyParams)
          || payload.bodyParams.every((param) => typeof param === 'string' && param.trim().length > 0));
    }
    if (kind === 'text') {
      return typeof payload.text === 'string' && !hasTemplateFields;
    }
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    const kind = (args.object as { kind?: string }).kind;
    return kind === 'template'
      ? 'Template starts require templateName and languageCode, with no text field.'
      : 'Start a conversation with text or an approved template payload.';
  }
}

/** Start a brand-new conversation by sending the first message to a number. */
export class StartConversationDto {
  @ApiProperty({ description: 'Session to send from' })
  @Validate(StartConversationShapeConstraint)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId!: string;

  @ApiProperty({ description: 'Recipient phone number (digits, country code; no +)' })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/\D/g, '') : value)
  @IsString()
  @IsNotEmpty()
  @Length(6, 40)
  to!: string;

  @ApiProperty({ enum: ['text', 'template'], description: 'Payload discriminator.' })
  @IsIn(['text', 'template'])
  kind!: StartConversationKind;

  @ApiPropertyOptional({ description: 'First message text (text starts)' })
  @ValidateIf((payload) => payload.kind === 'text')
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text?: string;

  @ApiPropertyOptional({ description: 'Approved Meta template name (template starts)' })
  @ValidateIf((payload) => payload.kind === 'template')
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(512)
  templateName?: string;

  @ApiPropertyOptional({ description: 'Meta template language code, for example en_US' })
  @ValidateIf((payload) => payload.kind === 'template')
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(15)
  languageCode?: string;

  @ApiPropertyOptional({ description: 'Template body values for {{1}}, {{2}}, …', type: [String] })
  @ValidateIf((payload) => payload.kind === 'template')
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  bodyParams?: string[];
}
