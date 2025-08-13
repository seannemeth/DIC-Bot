import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

export function ok(color: number = 0x2ecc71) { return color; }
export function warn(color: number = 0xf1c40f) { return color; }
export function bad(color: number = 0xe74c3c) { return color; }
export function info(color: number = 0x3498db) { return color; }

export function embed(title: string, description?: string, color = info()) {
  const e = new EmbedBuilder().setTitle(title).setColor(color);
  if (description) e.setDescription(description);
  return e;
}

export function must(value: any, message: string) {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

export function asInt(v: any) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error("Expected integer");
  return n;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function fmtRecord(w: number, l: number, t: number = 0) {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function sum(nums: number[]) { return nums.reduce((a,b)=>a+b,0); }
export function avg(nums: number[]) { return nums.length ? sum(nums)/nums.length : 0; }
export function stdev(nums: number[]) {
  if (!nums.length) return 0;
  const m = avg(nums);
  return Math.sqrt(avg(nums.map(x => (x-m)*(x-m))));
}
