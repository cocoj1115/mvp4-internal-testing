import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateIllustrationB64(prompt: string): Promise<string> {
  const response = await client.images.generate({
    model: "gpt-image-2",
    prompt,
    n: 1,
    size: "1024x1024",
  });

  const b64 = (response.data ?? [])[0]?.b64_json;
  if (!b64) {
    throw new Error("No image returned");
  }

  return b64;
}
