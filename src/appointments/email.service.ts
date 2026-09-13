import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import * as nodemailer from 'nodemailer';

/**
 * Sends transactional mail through AWS SES (preferred) or SMTP.
 * SES uses the default AWS credential chain (env, shared config, IAM role).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly ses?: SESv2Client;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    this.from =
      this.config.get<string>('SES_FROM') ||
      this.config.get<string>('SMTP_FROM') ||
      'MenoDAO <noreply@menodao.org>';

    const region =
      this.config.get<string>('AWS_REGION') ||
      this.config.get<string>('AWS_DEFAULT_REGION') ||
      'us-east-1';
    const sesDisabled = this.config.get<string>('SES_DISABLED') === 'true';
    if (!sesDisabled) {
      this.ses = new SESv2Client({ region });
      this.logger.log(`Email via AWS SES (${region}) from ${this.from}`);
    }

    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') || 587),
        secure: this.config.get('SMTP_SECURE') === 'true',
        auth: { user, pass },
      });
      this.logger.log(`SMTP fallback configured (${host})`);
    }
  }

  async send(
    to: string | string[],
    subject: string,
    text: string,
  ): Promise<boolean> {
    const recipients = (Array.isArray(to) ? to : [to]).filter((addr) =>
      addr.includes('@'),
    );
    if (recipients.length === 0) {
      this.logger.warn('Skipping email; no valid recipients');
      return false;
    }
    if (this.ses) {
      try {
        await this.ses.send(
          new SendEmailCommand({
            FromEmailAddress: this.from,
            Destination: { ToAddresses: recipients },
            Content: {
              Simple: {
                Subject: { Data: subject, Charset: 'UTF-8' },
                Body: { Text: { Data: text, Charset: 'UTF-8' } },
              },
            },
          }),
        );
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error(
          `SES send failed to ${recipients.join(', ')}: ${message}`,
        );
      }
    }
    if (!this.transporter) {
      this.logger.log(
        `[DEV EMAIL] To: ${recipients.join(', ')}\nSubject: ${subject}\n${text}`,
      );
      return true;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: recipients.join(', '),
        subject,
        text,
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(
        `Failed to email ${recipients.join(', ')}: ${message}`,
      );
      return false;
    }
  }
}
