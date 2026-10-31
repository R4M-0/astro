import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { htmlToText } from '../../common/html';
import { enqueue, QUEUE_MAIL } from '../jobs/queues';

export interface MailInput {
  to: string;
  subject: string;
  /** every interpolated value must go through escapeHtml (common/html.ts) */
  html: string;
  /** plain-text alternative; derived from `html` when omitted */
  text?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_MAIL) private readonly queue: Queue,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'localhost'),
      port: Number(this.config.get('SMTP_PORT', 1025)),
      secure: false,
      auth: this.config.get('SMTP_USER')
        ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') }
        : undefined,
    });
  }

  /**
   * Hands the mail to the worker queue (retries with backoff) so a slow SMTP
   * server never holds an HTTP request. Falls back to sending inline when the
   * queue is unreachable. Never throws: email failures must not break the flow.
   */
  async send(input: MailInput): Promise<void> {
    try {
      await enqueue(this.queue, 'send', input, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        // bodies can carry one-time links — don't keep them in Redis
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      });
      return;
    } catch (err) {
      this.logger.warn(`mail queue unavailable, sending inline: ${(err as Error).message}`);
    }
    try {
      await this.deliver(input);
    } catch (err) {
      this.logger.error(`Failed to send mail to ${input.to}: ${(err as Error).message}`);
    }
  }

  /** Actual SMTP delivery; throws so the queue can retry. */
  async deliver(input: MailInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', 'noreply@astro.app'),
      ...input,
      text: input.text ?? htmlToText(input.html),
    });
  }
}
