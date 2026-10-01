import type { ZodTypeAny } from 'zod';

/**
 * Zod → JSON Schema (draft 2020-12), for readers that are not TypeScript:
 * another team's importer, a validator in another language, or a model
 * that is handed the format instead of the source.
 *
 * Describes the PARSED shape — what `Offer.parse` returns and what a
 * mapping writes — so a field with a default is required. Named schemas
 * become `$defs` and are referenced, which keeps a document schema from
 * repeating `Offer` at every use. `docs` supplies descriptions the zod
 * objects do not carry at runtime (the JSDoc above each field); see
 * `scripts/export-schema.ts`, which reads them off the source.
 */
export interface JsonSchemaOptions {
  /** Schemas to emit once under `$defs`, by name. */
  names?: Map<ZodTypeAny, string>;
  /** Field descriptions: schema name → property → text. */
  docs?: Record<string, Record<string, string>>;
}

type Json = Record<string, unknown>;

export function toJsonSchema(root: ZodTypeAny, rootName: string, options: JsonSchemaOptions = {}): Json {
  const names = options.names ?? new Map<ZodTypeAny, string>();
  const docs = options.docs ?? {};
  const defs: Record<string, Json> = {};

  const convert = (schema: ZodTypeAny, owner: string | null, top = false): Json => {
    const named = names.get(schema);
    if (named && !top) {
      if (!(named in defs)) {
        defs[named] = {};
        defs[named] = convert(schema, named, true);
      }
      return { $ref: `#/$defs/${named}` };
    }
    const def = schema._def as Record<string, unknown> & { typeName: string };
    const described = (json: Json): Json => (def['description'] ? { description: def['description'], ...json } : json);
    switch (def.typeName) {
      case 'ZodString': {
        const json: Json = { type: 'string' };
        for (const check of (def['checks'] as { kind: string; value?: number }[]) ?? []) {
          if (check.kind === 'min') json['minLength'] = check.value;
          if (check.kind === 'max') json['maxLength'] = check.value;
          if (check.kind === 'url') json['format'] = 'uri';
        }
        return described(json);
      }
      case 'ZodNumber': {
        const json: Json = { type: 'number' };
        for (const check of (def['checks'] as { kind: string; value?: number; inclusive?: boolean }[]) ?? []) {
          if (check.kind === 'int') json['type'] = 'integer';
          if (check.kind === 'min') json[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
          if (check.kind === 'max') json[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
        }
        return described(json);
      }
      case 'ZodBoolean': return described({ type: 'boolean' });
      case 'ZodLiteral': return described({ const: def['value'] });
      case 'ZodEnum': return described({ enum: def['values'] });
      case 'ZodNativeEnum': return described({ enum: Object.values(def['values'] as object) });
      case 'ZodNull': return { type: 'null' };
      case 'ZodAny': case 'ZodUnknown': return described({});
      case 'ZodArray': {
        const json: Json = { type: 'array', items: convert(def['type'] as ZodTypeAny, owner) };
        if (def['minLength']) json['minItems'] = (def['minLength'] as { value: number }).value;
        if (def['maxLength']) json['maxItems'] = (def['maxLength'] as { value: number }).value;
        return described(json);
      }
      case 'ZodTuple':
        return described({ type: 'array', prefixItems: (def['items'] as ZodTypeAny[]).map((item) => convert(item, owner)) });
      case 'ZodRecord':
        return described({ type: 'object', additionalProperties: convert(def['valueType'] as ZodTypeAny, owner) });
      case 'ZodUnion': case 'ZodDiscriminatedUnion': {
        const options = def['options'] as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
        const list = Array.isArray(options) ? options : [...options.values()];
        return described({ anyOf: list.map((option) => convert(option, owner)) });
      }
      case 'ZodIntersection':
        return described({ allOf: [convert(def['left'] as ZodTypeAny, owner), convert(def['right'] as ZodTypeAny, owner)] });
      case 'ZodNullable': {
        const inner = convert(def['innerType'] as ZodTypeAny, owner);
        return described({ anyOf: [inner, { type: 'null' }] });
      }
      case 'ZodOptional': return convert(def['innerType'] as ZodTypeAny, owner);
      case 'ZodDefault': {
        const inner = convert(def['innerType'] as ZodTypeAny, owner);
        const value = (def['defaultValue'] as () => unknown)();
        return described({ ...inner, default: value });
      }
      case 'ZodCatch': case 'ZodBranded': case 'ZodReadonly':
        return convert((def['innerType'] ?? def['type']) as ZodTypeAny, owner);
      case 'ZodEffects': return described(convert(def['schema'] as ZodTypeAny, owner));
      case 'ZodPipeline': return convert(def['out'] as ZodTypeAny, owner);
      case 'ZodLazy': return convert((def['getter'] as () => ZodTypeAny)(), owner);
      case 'ZodObject': {
        const shape = (def['shape'] as () => Record<string, ZodTypeAny>)();
        const properties: Record<string, Json> = {};
        const required: string[] = [];
        for (const [key, value] of Object.entries(shape)) {
          // An inline object's fields are documented under "Owner.key".
          const property = convert(value, owner ? `${owner}.${key}` : null);
          const doc = owner ? docs[owner]?.[key] : undefined;
          properties[key] = doc && !property['description'] ? { description: doc, ...property } : property;
          if (value._def.typeName !== 'ZodOptional') required.push(key);
        }
        const json: Json = { type: 'object', properties, required };
        if ((def['unknownKeys'] as string) === 'strict') json['additionalProperties'] = false;
        return described(json);
      }
      default:
        return described({});
    }
  };

  const body = convert(root, rootName, true);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: rootName,
    ...body,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
  };
}
