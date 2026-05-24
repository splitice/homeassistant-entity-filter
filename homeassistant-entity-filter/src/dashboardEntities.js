const DIRECT_ENTITY_KEYS = new Set(["entity", "camera_image", "battery_soc"]);
const TEMPLATE_HELPERS = [
  "states",
  "state_attr",
  "is_state",
  "is_state_attr",
  "has_value",
  "expand",
];
const TEMPLATE_ENTITY_PATTERN = new RegExp(
  `\\b(?:${TEMPLATE_HELPERS.join("|")})\\(\\s*(['"])([^'"\\n]+)\\1`,
  "g",
);

export const DEFAULT_DASHBOARD_EXTRACTION_RULES = Object.freeze([
  Object.freeze({
    card_type: "custom:mushroom-template-badge",
    mode: "template_entities",
    fields: Object.freeze(["content", "icon", "color"]),
  }),
]);

export function extractDashboardEntities(
  config,
  extractionRules = DEFAULT_DASHBOARD_EXTRACTION_RULES,
) {
  const entities = new Set();
  const visited = new WeakSet();
  visitNode(Array.isArray(config?.views) ? config.views : [], entities, visited, extractionRules);
  return entities;
}

function visitNode(node, entities, visited, extractionRules) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  if (Array.isArray(node)) {
    for (const entry of node) {
      visitNode(entry, entities, visited, extractionRules);
    }
    return;
  }

  extractStructuredEntities(node, entities);
  applyExtractionRules(node, entities, extractionRules);

  for (const [key, value] of Object.entries(node)) {
    if ((key === "entities" || key === "badges") && Array.isArray(value)) {
      for (const entry of value) {
        addEntityReference(entities, entry);
      }
    }
    visitNode(value, entities, visited, extractionRules);
  }
}

function extractStructuredEntities(node, entities) {
  for (const [key, value] of Object.entries(node)) {
    if (isEntityValuedKey(key)) {
      addEntityReference(entities, value);
    }
  }

  addEntityReference(entities, node.target?.entity_id);
  addEntityReference(entities, node.data?.entity_id);
  addEntityReference(entities, node.service_data?.entity_id);

  addConditionEntities(entities, node.visibility);
  addConditionEntities(entities, node.conditions);
}

function applyExtractionRules(node, entities, extractionRules) {
  if (typeof node.type !== "string") {
    return;
  }

  for (const rule of extractionRules) {
    if (node.type !== rule.card_type) {
      continue;
    }
    for (const field of rule.fields) {
      if (typeof node[field] !== "string") {
        continue;
      }
      if (rule.mode === "template_entities") {
        for (const entityId of extractTemplateEntities(node[field])) {
          entities.add(entityId);
        }
      }
    }
  }
}

function addConditionEntities(entities, value) {
  if (!Array.isArray(value)) {
    return;
  }
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      addEntityReference(entities, entry.entity);
    }
  }
}

function addEntityReference(entities, value) {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (looksLikeEntityId(normalized)) {
      entities.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      addEntityReference(entities, entry);
    }
  }
}

function isEntityValuedKey(key) {
  return DIRECT_ENTITY_KEYS.has(key) || key.endsWith("_entity") || key.endsWith("_sensor");
}

function extractTemplateEntities(text) {
  const entities = new Set();
  TEMPLATE_ENTITY_PATTERN.lastIndex = 0;

  let match;
  while ((match = TEMPLATE_ENTITY_PATTERN.exec(text)) !== null) {
    const entityId = match[2].trim();
    if (looksLikeEntityId(entityId)) {
      entities.add(entityId);
    }
  }

  return entities;
}

function looksLikeEntityId(value) {
  return typeof value === "string" && value.includes(".");
}
