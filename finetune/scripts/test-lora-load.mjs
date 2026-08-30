// Loads a base GGUF model, once without and once with the LoRA adapter,
// and generates from the same prompt both times so the difference (if any)
// is visible. Run with: node finetune/scripts/test-lora-load.mjs
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import path from "node:path";

const BASE_MODEL = path.resolve("finetune/test-base/qwen2.5-1.5b-instruct-q4_k_m.gguf");
const LORA_ADAPTER = path.resolve("finetune/adapters/demo.gguf");
const PROMPT = "say hi to Nancy";

async function run(withLora) {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: BASE_MODEL });
  const context = await model.createContext(
    withLora ? { lora: { adapters: [{ filePath: LORA_ADAPTER, scale: 1 }] } } : {}
  );
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });
  const reply = await session.prompt(PROMPT, { maxTokens: 100 });
  await context.dispose();
  await model.dispose();
  return reply;
}

console.log(`Prompt: "${PROMPT}"\n`);

console.log("=== WITHOUT LoRA ===");
console.log(await run(false));

console.log("\n=== WITH LoRA (trained on say_hello examples) ===");
console.log(await run(true));
