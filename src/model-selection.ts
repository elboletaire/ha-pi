import type { Model } from "@mariozechner/pi-ai";
import type { Api } from "@mariozechner/pi-ai";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AvailableModelSummary {
  provider: string;
  id: string;
  name: string;
}

export function selectInitialModel(
  preferred: Array<ModelRef | null | undefined>,
  availableModels: Array<Model<Api>>
): Model<Api> | null {
  const availableByKey = new Map(
    availableModels.map((model) => [`${model.provider}/${model.id}`, model])
  );

  for (const ref of preferred) {
    if (!ref?.provider || !ref.modelId) continue;
    const model = availableByKey.get(`${ref.provider}/${ref.modelId}`);
    if (model) return model;
  }

  return availableModels[0] ?? null;
}

export function summarizeAvailableModels(models: Array<Model<Api>>): AvailableModelSummary[] {
  return models.map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
  }));
}
