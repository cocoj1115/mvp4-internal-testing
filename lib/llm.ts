import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;
let _google: OpenAI | null = null;

function openai(): OpenAI {
  return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

function anthropic(): Anthropic {
  return (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

function google(): OpenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local");
  return (_google ??= new OpenAI({
    apiKey: key,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  }));
}

export type LLMMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LLMResult {
  content: string;
  tokenCount: number;
}

function stripJsonFences(text: string): string {
  // Extract content from code fences (no start/end anchors — Claude sometimes adds trailing text)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1].trim();
  // Fallback: find the outermost JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function getProvider(model: string): "anthropic" | "google" | "openai" {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google";
  return "openai";
}

export async function chatComplete(params: {
  model: string;
  temperature?: number;
  messages: LLMMessage[];
  jsonMode?: boolean;
  maxTokens?: number;
}): Promise<LLMResult> {
  const { model, temperature, messages, jsonMode = false, maxTokens = 4096 } = params;
  const provider = getProvider(model);

  if (provider === "google") {
    const client = google();
    const completion = await client.chat.completions.create({
      model,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      messages,
    });
    return {
      content: completion.choices[0].message.content ?? "",
      tokenCount: completion.usage?.total_tokens ?? 0,
    };
  }

  if (provider === "anthropic") {
    const systemMsg = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const systemContent = [
      systemMsg?.content ?? "",
      jsonMode ? "\n\nRespond with ONLY valid JSON. No markdown, no explanation outside the JSON." : "",
    ].join("").trim();

    const response = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(systemContent ? { system: systemContent } : {}),
      messages: otherMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
    return {
      content: jsonMode ? stripJsonFences(raw) : raw,
      tokenCount: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  const completion = await openai().chat.completions.create({
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    messages,
  });

  return {
    content: completion.choices[0].message.content ?? "",
    tokenCount: completion.usage?.total_tokens ?? 0,
  };
}
