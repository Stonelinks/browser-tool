import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config.js";

export interface AnalyzeOptions {
  pngPath: string;
  question: string;
  model?: string;
}

export interface AnalyzeSuccess {
  success: true;
  analysis: string;
  model: string;
}

export interface AnalyzeFailure {
  success: false;
  error: string;
}

export type AnalyzeResult = AnalyzeSuccess | AnalyzeFailure;

export async function analyzeScreenshot(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "ANTHROPIC_API_KEY not set; browser_vision is unavailable.",
    };
  }
  const cfg = getConfig();
  const model = opts.model ?? cfg.visionModel;
  const client = new Anthropic({ apiKey });
  let b64: string;
  try {
    const data = await Bun.file(opts.pngPath).arrayBuffer();
    b64 = Buffer.from(data).toString("base64");
  } catch (err) {
    return { success: false, error: `failed to read screenshot: ${(err as Error).message}` };
  }
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: b64 },
            },
            {
              type: "text",
              text: `You are analyzing a screenshot of a web browser.\n\nUser's question: ${opts.question}\n\nProvide a detailed and helpful answer based on what you see in the screenshot.`,
            },
          ],
        },
      ],
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    return { success: true, analysis: text, model };
  } catch (err) {
    return { success: false, error: `Anthropic API call failed: ${(err as Error).message}` };
  }
}
