import { createHash } from 'node:crypto';
import {
  addToSet,
  audioAssetKey,
  audioAssetsListKey,
  db,
  generateId,
} from '../db/index.js';
import type { ElevenLabsAudioAsset } from '../types.js';

const DEFAULT_ONHYPER_BASE_URL = 'https://onhyper.io';
const DEFAULT_HYPERMICRO_UPLOAD_PATH = '/proxy/hypermicro/v1/storage/objects';

export class ElevenLabsProxyError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  appSlug: string;
  hypermicroUploadPath: string;
}

function normalizeBaseUrl(rawBaseUrl?: string): string {
  const base = rawBaseUrl?.trim() || DEFAULT_ONHYPER_BASE_URL;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function sanitizeStorageSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

async function parseUpstreamError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = await response.json() as Record<string, unknown>;
      const message =
        typeof parsed.error === 'string'
          ? parsed.error
          : typeof parsed.message === 'string'
            ? parsed.message
            : null;
      if (message) return message;
      return JSON.stringify(parsed);
    } catch {
      // Continue to text fallback.
    }
  }

  const text = await response.text();
  return text || `Upstream request failed with status ${response.status}`;
}

async function proxyJsonRequest(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await parseUpstreamError(response);
    throw new ElevenLabsProxyError(502, message);
  }

  return await response.json() as Record<string, unknown>;
}

export function resolveProxyConfig(overrides?: Partial<ProxyConfig>): ProxyConfig {
  const apiKey = overrides?.apiKey || process.env.ONHYPER_API_KEY || process.env.HYPER_API_KEY;
  if (!apiKey) {
    throw new ElevenLabsProxyError(
      500,
      'Missing OnHyper API key. Set ONHYPER_API_KEY or HYPER_API_KEY.'
    );
  }

  const appSlug = overrides?.appSlug || process.env.ONHYPER_APP_SLUG || process.env.HYPER_APP_SLUG;
  if (!appSlug) {
    throw new ElevenLabsProxyError(
      500,
      'Missing OnHyper app slug. Set ONHYPER_APP_SLUG or HYPER_APP_SLUG.'
    );
  }

  return {
    baseUrl: normalizeBaseUrl(overrides?.baseUrl || process.env.ONHYPER_BASE_URL),
    apiKey,
    appSlug,
    hypermicroUploadPath:
      overrides?.hypermicroUploadPath || process.env.HYPERMICRO_UPLOAD_PATH || DEFAULT_HYPERMICRO_UPLOAD_PATH,
  };
}

function createProxyHeaders(config: ProxyConfig, extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra);
  headers.set('X-API-Key', config.apiKey);
  headers.set('X-App-Slug', config.appSlug);
  return headers;
}

export async function listElevenLabsVoices(config: ProxyConfig): Promise<Record<string, unknown>> {
  const url = `${config.baseUrl}/proxy/elevenlabs/v1/voices`;
  return await proxyJsonRequest(url, {
    method: 'GET',
    headers: createProxyHeaders(config, {
      Accept: 'application/json',
    }),
  });
}

export async function synthesizeAndStoreSpeech(
  input: {
    voiceId: string;
    text: string;
    modelId?: string;
    voiceSettings?: Record<string, unknown>;
    outputFormat?: string;
  },
  config: ProxyConfig
): Promise<ElevenLabsAudioAsset> {
  const ttsUrl = `${config.baseUrl}/proxy/elevenlabs/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`;
  const ttsPayload: Record<string, unknown> = {
    text: input.text,
  };

  if (input.modelId) ttsPayload.model_id = input.modelId;
  if (input.voiceSettings) ttsPayload.voice_settings = input.voiceSettings;
  if (input.outputFormat) ttsPayload.output_format = input.outputFormat;

  const ttsResponse = await fetch(ttsUrl, {
    method: 'POST',
    headers: createProxyHeaders(config, {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'Accept-Encoding': 'identity',
    }),
    body: JSON.stringify(ttsPayload),
  });

  if (!ttsResponse.ok) {
    const message = await parseUpstreamError(ttsResponse);
    throw new ElevenLabsProxyError(502, message);
  }

  const contentType = ttsResponse.headers.get('content-type') || 'audio/mpeg';
  const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

  if (!audioBuffer.byteLength) {
    throw new ElevenLabsProxyError(502, 'ElevenLabs upstream returned empty audio output.');
  }

  const timestamp = Date.now();
  const textHash = createHash('sha256').update(input.text).digest('hex');
  const keyVoiceId = sanitizeStorageSegment(input.voiceId);
  const storageKey = `agent-talk/audio/${timestamp}-${keyVoiceId}-${textHash.slice(0, 16)}.mp3`;

  const uploadUrl = `${config.baseUrl}${config.hypermicroUploadPath.startsWith('/') ? '' : '/'}${config.hypermicroUploadPath}`;
  const uploadPayload = {
    key: storageKey,
    contentType,
    dataBase64: audioBuffer.toString('base64'),
    metadata: {
      voiceId: input.voiceId,
      textHash,
      timestamp,
      size: audioBuffer.byteLength,
      contentType,
    },
  };

  const storageResponse = await proxyJsonRequest(uploadUrl, {
    method: 'POST',
    headers: createProxyHeaders(config, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify(uploadPayload),
  });

  const audioAsset: ElevenLabsAudioAsset = {
    id: generateId('audio'),
    voiceId: input.voiceId,
    textHash,
    timestamp,
    size: audioBuffer.byteLength,
    contentType,
    storageKey: typeof storageResponse.key === 'string' ? storageResponse.key : storageKey,
    storageUrl: typeof storageResponse.url === 'string' ? storageResponse.url : undefined,
    createdAt: timestamp,
  };

  await db.put(audioAssetKey(audioAsset.id), audioAsset);
  await addToSet(audioAssetsListKey(), audioAsset.id);

  return audioAsset;
}
