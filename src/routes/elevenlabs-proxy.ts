import { Hono } from 'hono';
import { z } from 'zod';
import {
  ElevenLabsProxyError,
  listElevenLabsVoices,
  resolveProxyConfig,
  synthesizeAndStoreSpeech,
} from '../services/elevenlabs-proxy.js';
import type { ApiResponse, ElevenLabsAudioAsset } from '../types.js';

export const elevenLabsProxyRouter = new Hono();

const synthesizeSchema = z.object({
  text: z.string().min(1).max(10000),
  modelId: z.string().min(1).max(128).optional(),
  outputFormat: z.string().min(1).max(128).optional(),
  voiceSettings: z.record(z.string(), z.unknown()).optional(),
});

function getStatusForError(error: unknown): number {
  if (error instanceof ElevenLabsProxyError) {
    return error.status;
  }
  return 400;
}

function toHttpStatus(status: number): 400 | 500 | 502 {
  if (status === 500) return 500;
  if (status === 502) return 502;
  return 400;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

elevenLabsProxyRouter.get('/v1/voices', async (c) => {
  try {
    const config = resolveProxyConfig({
      apiKey: c.req.header('x-api-key') || undefined,
      appSlug: c.req.header('x-app-slug') || undefined,
    });
    const voices = await listElevenLabsVoices(config);

    return c.json<ApiResponse<Record<string, unknown>>>({
      success: true,
      data: voices,
    });
  } catch (error) {
    const status = toHttpStatus(getStatusForError(error));
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: getErrorMessage(error),
      },
      status
    );
  }
});

elevenLabsProxyRouter.post('/v1/text-to-speech/:voiceId', async (c) => {
  try {
    const { voiceId } = c.req.param();
    const payload = await c.req.json();
    const validated = synthesizeSchema.parse(payload);

    const config = resolveProxyConfig({
      apiKey: c.req.header('x-api-key') || undefined,
      appSlug: c.req.header('x-app-slug') || undefined,
    });

    const asset = await synthesizeAndStoreSpeech(
      {
        voiceId,
        text: validated.text,
        modelId: validated.modelId,
        outputFormat: validated.outputFormat,
        voiceSettings: validated.voiceSettings,
      },
      config
    );

    return c.json<ApiResponse<ElevenLabsAudioAsset>>(
      {
        success: true,
        data: asset,
      },
      201
    );
  } catch (error) {
    const status = toHttpStatus(getStatusForError(error));
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: getErrorMessage(error),
      },
      status
    );
  }
});

export default elevenLabsProxyRouter;
