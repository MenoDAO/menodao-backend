export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

export interface IWhatsappClient {
  /**
   * Sends a plain text message to a WhatsApp user.
   * @param to Phone number in international format (e.g. "254712345678").
   * @param body The text message content to send.
   */
  sendTextMessage(to: string, body: string): Promise<void>;

  /**
   * Identifies a recent outbound message echoed back by providers that report sent messages.
   */
  isRecentlySentTextMessage?(to: string, body: string): boolean;

  /**
   * Marks an inbound message as read if supported by the provider.
   * @param messageId Unique ID of the message.
   */
  markMessageAsRead(messageId: string): Promise<void>;

  /**
   * Downloads media content (such as an audio voice note) given its media ID.
   * @param mediaId The provider-specific media identifier.
   */
  downloadMedia(mediaId: string): Promise<Buffer>;
}
