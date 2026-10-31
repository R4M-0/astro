import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { MailService } from '../../core/mail/mail.service';

class ContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  company: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Marketing-site contact form → email to the sales/support inbox (CONTACT_EMAIL). */
@ApiTags('public')
@Controller('public')
export class PublicContactController {
  constructor(private readonly mail: MailService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('contact')
  @HttpCode(200)
  async contact(@Body() dto: ContactDto) {
    const to = process.env.CONTACT_EMAIL ?? process.env.SMTP_FROM ?? 'contact@astro.app';
    await this.mail.send({
      to,
      subject: `[Astro] Demande de contact — ${dto.company}`,
      html:
        `<p><b>Nom :</b> ${esc(dto.name)}<br/><b>Email :</b> ${esc(dto.email)}<br/><b>Société :</b> ${esc(dto.company)}</p>` +
        `<p style="white-space:pre-wrap">${esc(dto.message)}</p>`,
    });
    return { received: true };
  }
}
