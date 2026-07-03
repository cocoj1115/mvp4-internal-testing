import OpenAI from "openai";
import { CompareProvider } from "@/lib/compare/types";

export interface CompareChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompareLlmRequest {
  provider: CompareProvider;
  modelId: string;
  temperature: number;
  messages: CompareChatMessage[];
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface CompareLlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function envModelOverride(provider: CompareProvider, modelId: string): string {
  const normalized = modelId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const key = `${provider.toUpperCase()}_MODEL_${normalized}`;
  return process.env[key] ?? modelId;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function systemMessage(messages: CompareChatMessage[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
}

function nonSystemMessages(messages: CompareChatMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
}

function shouldOmitAnthropicTemperature(modelId: string): boolean {
  const model = modelId.toLowerCase();
  return model.includes("opus-4-8");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAI(request: CompareLlmRequest): Promise<CompareLlmResponse> {
  const completion = await openai.chat.completions.create({
    model: envModelOverride("openai", request.modelId),
    temperature: request.temperature,
    response_format: request.jsonMode ? { type: "json_object" } : undefined,
    messages: request.messages,
  });

  const usage = completion.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;

  return {
    text: completion.choices[0]?.message.content ?? "",
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
  };
}

async function callAnthropic(request: CompareLlmRequest): Promise<CompareLlmResponse> {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = envModelOverride("anthropic", request.modelId);
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 1200,
    system: systemMessage(request.messages),
    messages: nonSystemMessages(request.messages),
  };

  if (!shouldOmitAnthropicTemperature(model)) {
    body.temperature = request.temperature;
  }

  let lastError = "";

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => null)) as
      | {
          content?: Array<{ type?: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
          error?: { message?: string; type?: string };
        }
      | null;

    if (!res.ok) {
      const message = json?.error?.message ?? `Anthropic request failed (${res.status}).`;
      const transient =
        res.status === 429 ||
        res.status === 500 ||
        res.status === 503 ||
        res.status === 529 ||
        /overloaded/i.test(message) ||
        json?.error?.type === "overloaded_error";
      lastError = message;

      if (transient && attempt < 4) {
        await sleep(750 * 2 ** (attempt - 1));
        continue;
      }

      throw new Error(message);
    }

    const text =
      json?.content
        ?.map((block) => (block.type === "text" ? block.text ?? "" : ""))
        .join("")
        .trim() ?? "";
    const inputTokens = json?.usage?.input_tokens ?? 0;
    const outputTokens = json?.usage?.output_tokens ?? 0;

    return {
      text,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  throw new Error(lastError || "Anthropic request failed.");
}

function googleRole(role: CompareChatMessage["role"]) {
  return role === "assistant" ? "model" : "user";
}

async function callGoogle(request: CompareLlmRequest): Promise<CompareLlmResponse> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured.");

  const model = envModelOverride("google", request.modelId);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = systemMessage(request.messages);
  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: googleRole(message.role),
      parts: [{ text: message.content }],
    }));

  if (system) {
    contents.unshift({
      role: "user",
      parts: [{ text: `System instructions:\n${system}` }],
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: request.temperature,
        responseMimeType: request.jsonMode ? "application/json" : "text/plain",
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      },
    }),
  });

  const json = (await res.json().catch(() => null)) as
    | {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
        error?: { message?: string };
      }
    | null;

  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Google request failed (${res.status}).`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";
  const inputTokens = json?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = json?.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    text,
    inputTokens,
    outputTokens,
    totalTokens: json?.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
  };
}

export async function callCompareLlm(request: CompareLlmRequest): Promise<CompareLlmResponse> {
  if (request.provider === "openai") return callOpenAI(request);
  if (request.provider === "anthropic") return callAnthropic(request);
  return callGoogle(request);
}
