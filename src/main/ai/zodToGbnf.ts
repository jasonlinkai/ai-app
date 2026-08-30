import { z } from "zod";
import type { GbnfJsonSchema } from "node-llama-cpp";

/**
 * Converts a Zod schema into the JSON-schema shape node-llama-cpp's
 * grammar-constrained function calling expects (GbnfJsonSchema), using
 * Zod's own built-in JSON Schema generator (z.toJSONSchema, added in Zod
 * v4) rather than a hand-rolled Zod-AST walker. The two schema shapes
 * agree on the fields that matter here (type/properties/items/enum/
 * description, ...); the only field GbnfJsonSchema doesn't recognize is
 * the draft-version `$schema` marker Zod adds at the root, which is
 * stripped below.
 */
export function zodToGbnfSchema(schema: z.ZodType): GbnfJsonSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown> &
    GbnfJsonSchema;
  delete jsonSchema.$schema;
  return jsonSchema;
}
