export interface WaboxappWebhookPayload {
  event?: string;
  token?: string;
  uid?: string;
  contact?: {
    uid?: string;
  };
  message?: {
    uid?: string;
    ack?: number;
    custom_uid?: string;
    body?: {
      type?: string;
      text?: string;
    };
  };
  m?: {
    uid?: string;
    ack?: number;
    custom_uid?: string;
  };
}
