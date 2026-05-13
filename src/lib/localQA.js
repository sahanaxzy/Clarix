/**
 * localQA.js — Utility exports only.
 * The main AI answering pipeline is now in libraryAsk.js.
 * This file is kept for backward compatibility but the on-device
 * extractive QA model is no longer used for answering questions.
 */

/** Used by cloud answers in libraryAsk (no-op passthrough now). */
export function shortenTechStackReply(_question, answer) {
  return String(answer || '').trim()
}
