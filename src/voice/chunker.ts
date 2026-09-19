/**
 * Sentence chunking for streamed TTS. Thin alias over the engine's sentence
 * segmentation so the server-side speech gate and client-side speech queue
 * split text identically.
 */
export { takeCompleteSentences as takeSpeakableChunks, type SentenceTake as ChunkResult } from "@/engine/parsing/sentences";
