import nodemailer from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: string; contentType: string }[];
}

/** Transport abstraction: dev mode only records, SMTP sends via any EU provider. */
export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

/** Development/test transport: messages stay visible in the outbox (dev mailbox page). */
export const devMailer: Mailer = { send: async () => undefined };

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    send: async (m) => {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, attachments: m.attachments });
    },
  };
}

/**
 * WhatsApp Business is prepared but disabled (D-029): enabling needs a provider contract
 * (WhatsApp Business Platform), message templates approved by Meta and a DPA.
 */
export interface WhatsappSender {
  send(to: string, text: string): Promise<void>;
}
export const disabledWhatsapp: WhatsappSender = {
  send: async () => {
    throw new Error('WhatsApp disabled');
  },
};
