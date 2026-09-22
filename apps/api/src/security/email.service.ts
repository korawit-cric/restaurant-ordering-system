import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  assertConfigured() {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      throw new ServiceUnavailableException('Email delivery is not configured');
  }

  link(path: string) {
    const origin = process.env.APP_ORIGIN || 'http://localhost:3010';
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
      throw new ServiceUnavailableException('Email links require HTTPS');
    return new URL(path, `${origin}/`).toString();
  }

  async send(to: string, subject: string, text: string) {
    this.assertConfigured();
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [to],
          subject,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      this.logger.error('Email provider request failed');
      throw new ServiceUnavailableException('Email delivery failed');
    }
    if (!response.ok) {
      this.logger.error(`Email provider returned HTTP ${response.status}`);
      throw new ServiceUnavailableException('Email delivery failed');
    }
  }
}
