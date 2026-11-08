export interface FlaresendMessageContextInfo {
  deviceListMetadata?: {
    senderKeyHash?: string;
    senderTimestamp?: string;
    recipientKeyHash?: string;
    recipientTimestamp?: string;
  };
  deviceListMetadataVersion?: number;
  messageSecret?: string;
}

export interface FlaresendMessageContent {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
    [key: string]: any;
  };
  imageMessage?: {
    caption?: string;
    mimetype?: string;
    [key: string]: any;
  };
  videoMessage?: {
    caption?: string;
    mimetype?: string;
    [key: string]: any;
  };
  audioMessage?: {
    mimetype?: string;
    seconds?: number;
    [key: string]: any;
  };
  buttonsResponseMessage?: {
    selectedButtonId?: string;
    selectedDisplayText?: string;
  };
  templateButtonReplyMessage?: {
    selectedId?: string;
    selectedDisplayText?: string;
  };
  interactiveResponseMessage?: {
    body?: {
      text?: string;
    };
  };
  [key: string]: any;
}

export interface FlaresendMessageData {
  from: string; // e.g. "254712345678@s.whatsapp.net"
  pushName?: string;
  name?: string;
  id: string;
  timestamp: number;
  message?: FlaresendMessageContent;
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
  };
  fromMe?: boolean;
}

export interface FlaresendWebhookPayload {
  event: string; // e.g. "message_received"
  instanceId?: string;
  data?: FlaresendMessageData;
  timestamp?: string;
}
