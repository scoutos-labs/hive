/**
 * Proxy endpoints for OnHyper-backed vendor integrations.
 *
 * These routes keep vendor credentials server-side and normalize the response
 * shape so tests and clients do not need to know about the upstream proxy.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import { addToSet, audioAssetKey, audioAssetsListKey, db, generateId } from '../db/index.js';
import { getValidatedBody, validateBody, z } from '../middleware/validate.js';
import type { ApiResponse, ElevenLabsAudioAsset } from '../types.js';

const elevenLabsTtsSchema = z.object({
  text: z.string().min(1),
  modelId: z.string().optional(),
});

type ElevenLabsTtsBody = {
  text: string;
  modelId?: string;
};

function getOnHyperConfig() {
  const apiKey = process.env.ONHYPER_API_KEY || process.env.HYPER_API_KEY;
  const appSlug = process.env.ONHYPER_APP_SLUG || process.env.HYPER_APP_SLUG;
  const baseUrl = process.env.ONHYPER_BASE_URL || 'https://onhyper.com';
  // HyperMicro uploads reuse the same OnHyper auth headers but may point at a
  // different path than the ElevenLabs proxy endpoint.
  const uploadPath = process.env.HYPERMICRO_UPLOAD_PATH || '/proxy/hypermicro/v1/storage/objects';

  if (!apiKey) {
    throw new Error('Missing OnHyper API key');
  }

  if (!appSlug) {
    throw new Error('Missing OnHyper app slug');
  }

  return { apiKey, appSlug, baseUrl, uploadPath };
}

function buildProxyHeaders(config: ReturnType<typeof getOnHyperConfig>) {
  return {
    'x-api-key': config.apiKey,
    'x-app-slug': config.appSlug,
  };
}

async function readUpstreamError(response: Response) {
  const text = await response.text();

  if (!text) {
    return `Upstream request failed with status ${response.status}`;
  }

  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error || text;
  } catch {
    return text;
  }
}

export const proxyRouter = new Hono();

proxyRouter.get('/elevenlabs/v1/voices', async (c) => {
  try {
    const config = getOnHyperConfig();
    const response = await fetch(`${config.baseUrl}/proxy/elevenlabs/v1/voices`, {
      headers: buildProxyHeaders(config),
    });

    if (!response.ok) {
      const error = await readUpstreamError(response);
      return c.json<ApiResponse<never>>({ success: false, error }, 502);
    }

    const body = await response.json();
    return c.json<ApiResponse<unknown>>({ success: true, data: body });
  } catch (error) {
    return c.json<ApiResponse<never>>({
      success: false,
      error: error instanceof Error ? error.message : 'Proxy request failed',
    }, 500);
  }
});

proxyRouter.post('/elevenlabs/v1/text-to-speech/:voiceId', validateBody(elevenLabsTtsSchema), async (c) => {
  try {
    const { voiceId } = c.req.param();
    const body = getValidatedBody<ElevenLabsTtsBody>(c);
    const config = getOnHyperConfig();

    const ttsResponse = await fetch(`${config.baseUrl}/proxy/elevenlabs/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        ...buildProxyHeaders(config),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!ttsResponse.ok) {
      const error = await readUpstreamError(ttsResponse);
      return c.json<ApiResponse<never>>({ success: false, error }, 502);
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    const contentType = ttsResponse.headers.get('content-type') || 'application/octet-stream';
    const textHash = createHash('sha256').update(body.text).digest('hex');
    const base64Data = Buffer.from(audioBuffer).toString('base64');

    const uploadResponse = await fetch(`${config.baseUrl}${config.uploadPath}`, {
      method: 'POST',
      headers: {
        ...buildProxyHeaders(config),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contentType,
        dataBase64: base64Data,
        metadata: {
          voiceId,
          textHash,
          size: audioBuffer.byteLength,
        },
      }),
    });

    if (!uploadResponse.ok) {
      const error = await readUpstreamError(uploadResponse);
      return c.json<ApiResponse<never>>({ success: false, error }, 502);
    }

    const uploadBody = await uploadResponse.json() as { key: string; url?: string };
    const asset: ElevenLabsAudioAsset = {
      id: generateId('audio'),
      voiceId,
      textHash,
      timestamp: Date.now(),
      size: audioBuffer.byteLength,
      contentType,
      storageKey: uploadBody.key,
      storageUrl: uploadBody.url,
      createdAt: Date.now(),
    };

    await db.put(audioAssetKey(asset.id), asset);
    await addToSet(audioAssetsListKey(), asset.id);

    return c.json<ApiResponse<ElevenLabsAudioAsset>>({ success: true, data: asset }, 201);
  } catch (error) {
    return c.json<ApiResponse<never>>({
      success: false,
      error: error instanceof Error ? error.message : 'Proxy request failed',
    }, 500);
  }
});

export default proxyRouter;
