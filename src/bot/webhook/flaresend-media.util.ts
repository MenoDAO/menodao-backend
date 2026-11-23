/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- provider payloads are untyped JSON */

export type FlaresendMediaKind = 'AUDIO' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface FlaresendMedia {
  kind: FlaresendMediaKind;
  descriptor: any;
  mimeType: string;
  caption: string | null;
  originalFilename?: string;
}

const MEDIA_KEYS: Record<FlaresendMediaKind, string[]> = {
  AUDIO: ['audioMessage', 'audio', 'voiceMessage', 'voice', 'pttMessage'],
  IMAGE: ['imageMessage', 'image', 'pictureMessage'],
  VIDEO: ['videoMessage', 'video', 'gifMessage'],
  DOCUMENT: ['documentMessage', 'document', 'fileMessage'],
};

const DEFAULT_MIME: Record<FlaresendMediaKind, string> = {
  AUDIO: 'audio/ogg',
  IMAGE: 'image/jpeg',
  VIDEO: 'video/mp4',
  DOCUMENT: 'application/octet-stream',
};

const TYPE_ALIASES: Record<string, FlaresendMediaKind> = {
  audio: 'AUDIO',
  voice: 'AUDIO',
  ptt: 'AUDIO',
  image: 'IMAGE',
  picture: 'IMAGE',
  video: 'VIDEO',
  gif: 'VIDEO',
  document: 'DOCUMENT',
  file: 'DOCUMENT',
};

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasMediaPayload(value: Record<string, any>): boolean {
  return [
    'url',
    'mediaUrl',
    'media_url',
    'downloadUrl',
    'download_url',
    'link',
    'fileUrl',
    'signedUrl',
    'directPath',
    'base64',
    'data',
    'file',
    'fileBase64',
    'media',
    'id',
    'mediaId',
    'media_id',
    'fileId',
  ].some((key) => value[key] !== undefined && value[key] !== null);
}

function mimeFrom(value: Record<string, any>, kind: FlaresendMediaKind): string {
  const mime =
    typeof value.mimetype === 'string'
      ? value.mimetype
      : typeof value.mimeType === 'string'
        ? value.mimeType
        : typeof value.type === 'string' && value.type.includes('/')
          ? value.type
          : null;
  return mime || DEFAULT_MIME[kind];
}

function captionFrom(value: Record<string, any>): string | null {
  const caption = value.caption ?? value.title ?? value.text;
  return typeof caption === 'string' && caption.trim() ? caption.trim() : null;
}

function filenameFrom(value: Record<string, any>): string | undefined {
  const filename =
    value.fileName ?? value.filename ?? value.name ?? value.fileNameFromClient;
  return typeof filename === 'string' && filename.trim()
    ? filename.trim()
    : undefined;
}

function wrapUrlString(value: string, kind: FlaresendMediaKind): Record<string, any> {
  return /^https?:\/\//i.test(value) || value.startsWith('/')
    ? { url: value, mimetype: DEFAULT_MIME[kind] }
    : { base64: value, mimetype: DEFAULT_MIME[kind] };
}

/**
 * FlareSend webhook media shapes vary by version. This accepts Baileys-style
 * `audioMessage` objects, flat `{ type: "audio", url: ... }` payloads, nested
 * `message.message`, and string URL/base64 shorthand.
 */
export function extractFlaresendMedia(payload: any): FlaresendMedia | null {
  const containers: Record<string, any>[] = [];
  const root = isObject(payload) ? payload : {};
  const data = isObject(root.data) ? root.data : root;
  if (isObject(data)) containers.push(data);
  if (isObject(data.message)) containers.push(data.message);
  if (isObject(data.message?.message)) containers.push(data.message.message);

  for (const container of containers) {
    for (const kind of ['AUDIO', 'VIDEO', 'IMAGE', 'DOCUMENT'] as const) {
      for (const key of MEDIA_KEYS[kind]) {
        const value = container[key];
        if (value === undefined || value === null || value === false) continue;
        const descriptor = isObject(value)
          ? value
          : typeof value === 'string'
            ? wrapUrlString(value, kind)
            : null;
        if (!descriptor) continue;
        return {
          kind,
          descriptor,
          mimeType: mimeFrom(descriptor, kind),
          caption: captionFrom(descriptor) ?? captionFrom(container),
          originalFilename: filenameFrom(descriptor),
        };
      }
    }

    const type =
      typeof container.type === 'string'
        ? TYPE_ALIASES[container.type.toLowerCase()]
        : undefined;
    if (type && hasMediaPayload(container)) {
      return {
        kind: type,
        descriptor: container,
        mimeType: mimeFrom(container, type),
        caption: captionFrom(container),
        originalFilename: filenameFrom(container),
      };
    }
  }
  return null;
}

export function extractFlaresendAudio(payload: any): FlaresendMedia | null {
  const media = extractFlaresendMedia(payload);
  return media?.kind === 'AUDIO' ? media : null;
}

export function extractFlaresendFieldMedia(
  payload: any,
): FlaresendMedia | null {
  const media = extractFlaresendMedia(payload);
  return media && media.kind !== 'AUDIO' ? media : null;
}
