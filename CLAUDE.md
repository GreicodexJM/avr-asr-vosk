# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AVR ASR Vosk** is a real-time speech-to-text microservice using the Vosk offline ASR engine, part of the Agent Voice Response ecosystem. It accepts raw audio streams via HTTP and returns transcribed text via Server-Sent Events.

## Commands

```bash
# Install dependencies
npm install

# Run development server (nodemon + inspector on port 9229)
npm run start:dev

# Run production server
npm run start

# Build Docker image (linux/amd64, tags: latest + version from package.json)
npm run dc:build

# Push Docker images to Docker Hub
npm run dc:push
```

No test runner or linter is configured.

## Setup Requirement

A Vosk model must be present before running. Download and place it at the path specified by `MODEL_PATH` (default: `./model`):

```bash
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 model
```

Copy `.env.example` to `.env` and configure:
- `PORT` — server port (default: 6033)
- `MODEL_PATH` — path to Vosk model directory (default: `model`)

## Architecture

The entire application lives in `index.js`. There are no modules or subdirectories beyond config.

**Request flow:**
1. Client POSTs a raw audio stream to `POST /speech-to-text-stream`
   - Expected format: 8kHz, 16-bit PCM, mono, little-endian
2. `handleAudioStream` sets up SSE headers and listens on the request stream
3. Each incoming audio chunk is **upsampled from 8kHz → 16kHz** via `upsampleAudio()` (linear interpolation), because Vosk requires 16kHz input
4. Upsampled chunks are fed to a `vosk.Recognizer` instance
5. Partial and final transcription results are streamed back via `res.write()`
6. On stream end, `rec.free()` and `model.free()` are called to release native resources

**Key design notes:**
- The Vosk model (`vosk.Model`) is loaded once at startup; the process exits if the model path is missing
- A new `vosk.Recognizer` is created per request and freed on stream end/error
- The upsampling in `upsampleAudio()` handles edge cases (empty buffer, odd-length buffer) and must produce a Buffer with exactly `2 × input samples` bytes

## Docker

The Dockerfile uses a 3-stage build:
1. **dev** — `node:16-bullseye` with `python3` and `build-essential` to compile the native `vosk` module
2. **build** — copies `node_modules` from dev stage
3. **prod** — `node:16-bullseye-slim` with only `libstdc++6` runtime; runs as non-root `node` user

Node 16 is intentional — later versions have FFI/native module compatibility issues with `vosk`.

CI (`.github/workflows/main.yml`) builds and pushes to `agentvoiceresponse/avr-asr-vosk` on push to `main`.
