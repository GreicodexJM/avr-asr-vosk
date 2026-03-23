/**
 * index.js
 * This file is the main entry point for the application using Vosk ASR.
 */
require("dotenv").config();

const express = require("express");
const vosk = require("vosk");
const fs = require("fs");

const app = express();

const modelPath = process.env.MODEL_PATH || "model";
if (!fs.existsSync(modelPath)) {
  console.log(
    "Please download the model from https://alphacephei.com/vosk/models and unpack as " +
      modelPath +
      " in the current folder."
  );
  process.exit();
}

const VOSK_SAMPLE_RATE = 16000;

/**
 * Resample audio to 16kHz using linear interpolation.
 * Handles any integer or fractional input sample rate.
 * @param {Buffer} audioBuffer - Input audio buffer (16-bit PCM, little-endian)
 * @param {number} inputRate - Sample rate of the input audio in Hz
 * @returns {Buffer} - Resampled audio buffer at 16kHz
 */
const resampleAudio = (audioBuffer, inputRate) => {
  if (!audioBuffer || audioBuffer.length === 0) {
    console.warn("Empty or null audio buffer received");
    return Buffer.alloc(0);
  }

  if (audioBuffer.length % 2 !== 0) {
    console.warn("Audio buffer length is odd, truncating last byte");
    audioBuffer = audioBuffer.slice(0, audioBuffer.length - 1);
  }

  const inputSamples = audioBuffer.length / 2;
  if (inputSamples === 0) return Buffer.alloc(0);

  if (inputRate === VOSK_SAMPLE_RATE) return audioBuffer;

  const ratio = inputRate / VOSK_SAMPLE_RATE; // input positions per output sample
  const outputSamples = Math.round(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;

    const s0 = audioBuffer.readInt16LE(srcIndex * 2);
    const s1 = srcIndex + 1 < inputSamples
      ? audioBuffer.readInt16LE((srcIndex + 1) * 2)
      : s0;

    outputBuffer.writeInt16LE(Math.round(s0 + frac * (s1 - s0)), i * 2);
  }

  return outputBuffer;
};

/**
 * Handles an audio stream from the client and uses Vosk ASR
 * to recognize the speech and stream the transcript back to the client.
 *
 * @param {Object} req - The Express request object
 * @param {Object} res - The Express response object
 */
const handleAudioStream = async (req, res) => {
  try {
    const inputRate = parseInt(req.headers["x-sample-rate"], 10) || 8000;
    const model = new vosk.Model(modelPath);
    const rec = new vosk.Recognizer({ model: model, sampleRate: VOSK_SAMPLE_RATE });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    req.on("data", async (chunk) => {      
      try {
        const resampledChunk = resampleAudio(chunk, inputRate);

        if (resampledChunk.length === 0) {
          console.warn("Warning: Resampled chunk is empty");
          return;
        }

        if (rec.acceptWaveform(resampledChunk)) {
          const result = rec.result();
          console.log("Partial result:", result);
          if (result.text) {
            res.write(result.text);
          }
        }
      } catch (error) {
        console.error("Error processing audio chunk:", error);
        console.error("Chunk details - Original:", chunk.length, "Resampled:", resampledChunk?.length || 0);
      }
    });

    req.on("end", () => {
      console.log("Audio stream ended");
      try {
        rec.free();
        model.free();
        res.end();
      } catch (error) {
        console.error("Error getting final result:", error);
        res.end();
      }
    });
    req.on("error", (err) => {
      console.error("Error receiving audio stream:", err);
      req.destroy();
      res.status(500).json({ message: "Error receiving audio stream" });
    });
  } catch (err) {
    console.error("Error handling audio stream:", err);
    res.status(500).json({ message: err.message });
  }
};

app.post("/speech-to-text-stream", handleAudioStream);

const port = process.env.PORT || 6010;
app.listen(port, () => {
  console.log(`Vosk ASR endpoint listening on port ${port}`);
});
