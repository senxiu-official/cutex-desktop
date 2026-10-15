// The notification sound (method `sound`): the same generated two-tone chime as the big alert window
// (ownerAlert/model.ts chimeNotes; no audio assets). Urgent rings twice.
import { chimeNotes } from "../ownerAlert/model";

let audio: AudioContext | null = null;

export function playChime(urgent: boolean): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.05;
    for (const note of chimeNotes(urgent)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + note.dur + 0.05);
    }
  } catch {
    // no audio device: silent
  }
}

/** Whether this renderer can play it. */
export function chimeSupported(): boolean {
  return typeof AudioContext !== "undefined";
}
