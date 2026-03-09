# ElevenLabs Proxy Integration (OnHyper)

This task adds an OnHyper-backed ElevenLabs proxy flow for `agent-talk` with HyperMicro persistence.

## Routes

- `GET /proxy/elevenlabs/v1/voices`
  - Proxies to `ONHYPER_BASE_URL/proxy/elevenlabs/v1/voices`
  - Returns normalized JSON response envelope (`{ success, data }`)

- `POST /proxy/elevenlabs/v1/text-to-speech/:voiceId`
  - Proxies MP3 synthesis to `ONHYPER_BASE_URL/proxy/elevenlabs/v1/text-to-speech/:voiceId`
  - Uploads resulting MP3 to `HYPERMICRO_UPLOAD_PATH`
  - Persists an `audio!{id}` LMDB record with metadata and storage refs
  - Returns JSON payload for frontend usage (`voiceId`, `textHash`, `size`, `contentType`, `storageKey`, `storageUrl`)

## Required Env

- `ONHYPER_API_KEY` or `HYPER_API_KEY`
- `ONHYPER_APP_SLUG` or `HYPER_APP_SLUG`

## Optional Env

- `ONHYPER_BASE_URL` (default: `https://onhyper.io`)
- `HYPERMICRO_UPLOAD_PATH` (default: `/proxy/hypermicro/v1/storage/objects`)

## curl Examples

```bash
# Voice list
curl -s http://127.0.0.1:3000/proxy/elevenlabs/v1/voices | jq

# TTS + storage
curl -s -X POST http://127.0.0.1:3000/proxy/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from agent-talk","modelId":"eleven_turbo_v2_5"}' | jq
```

## hyper-cli Local Proxy Example

`hyper-cli` can be pointed at local Hive to test `/proxy/*` routes from a local browser/app workflow.

```json
{
  "name": "agent-talk-local",
  "slug": "agent-talk-local",
  "apiKey": "oh_live_local_dev_key",
  "staticDir": "./docs/landing",
  "port": 3100,
  "baseUrl": "http://127.0.0.1:3000"
}
```

Then run:

```bash
./hyper --config ./hyper.local.json
curl -s http://127.0.0.1:3100/proxy/elevenlabs/v1/voices | jq
```

The hyper-cli hop keeps frontend code identical to deployed OnHyper usage (`/proxy/*`), while targeting local Hive during development.
