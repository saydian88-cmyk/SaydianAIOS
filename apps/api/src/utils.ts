import { createHash, randomUUID } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toDate(value: unknown): Date | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function startOfShanghaiDay(value = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(number("year"), number("month") - 1, number("day")) - 8 * 60 * 60 * 1000);
}

export function localDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function makeIdempotencyKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${sha256(parts.join(":"))}`;
}

export function opaqueId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
