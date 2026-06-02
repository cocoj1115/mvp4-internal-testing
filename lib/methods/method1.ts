import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function resolveGap(
  diagnosedGap: string,
  attempt2Response: string
): Promise<"fully" | "partially" | "not at all"> {
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are evaluating whether a student addressed a specific reasoning gap in their revised response.",
      },
      {
        role: "user",
        content: `Diagnosed gap from attempt 1: ${diagnosedGap}\nStudent's attempt 2 response: ${attempt2Response}\nDid the student address the diagnosed gap?\nAnswer with exactly one of: fully / partially / not at all`,
      },
    ],
  });

  const raw = completion.choices[0].message.content?.trim().toLowerCase() ?? "";
  if (raw.includes("not at all")) return "not at all";
  if (raw.includes("partially")) return "partially";
  if (raw.includes("fully")) return "fully";
  return "not at all";
}
