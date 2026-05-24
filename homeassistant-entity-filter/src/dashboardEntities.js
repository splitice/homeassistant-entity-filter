export function extractDashboardEntities(config) {
  const entities = new Set();
  const views = Array.isArray(config?.views) ? config.views : [];

  for (const view of views) {
    if (view && typeof view === "object" && !Array.isArray(view)) {
      addEntities(entities, view);
    }
  }

  return entities;
}

function addEntities(entities, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  addEntityId(entities, value);
  if (Array.isArray(value.entities)) {
    for (const entity of value.entities) {
      addEntityId(entities, entity);
    }
  }
  if (value.card) {
    addEntities(entities, value.card);
  }
  if (Array.isArray(value.cards)) {
    for (const card of value.cards) {
      addEntities(entities, card);
    }
  }
  if (Array.isArray(value.elements)) {
    for (const element of value.elements) {
      addEntities(entities, element);
    }
  }
  if (Array.isArray(value.badges)) {
    for (const badge of value.badges) {
      addEntityId(entities, badge);
    }
  }
  if (Array.isArray(value.sections)) {
    for (const section of value.sections) {
      addEntities(entities, section);
    }
  }
}

function addEntityId(entities, entity) {
  if (!entity) {
    return;
  }

  if (typeof entity === "string") {
    if (looksLikeEntityId(entity)) {
      entities.add(entity);
    }
    return;
  }

  if (typeof entity !== "object" || Array.isArray(entity)) {
    return;
  }

  if (typeof entity.entity === "string" && looksLikeEntityId(entity.entity)) {
    entities.add(entity.entity);
  }
  if (typeof entity.camera_image === "string" && looksLikeEntityId(entity.camera_image)) {
    entities.add(entity.camera_image);
  }
  if (entity.tap_action) {
    addFromAction(entities, entity.tap_action);
  }
  if (entity.hold_action) {
    addFromAction(entities, entity.hold_action);
  }
}

function addFromAction(entities, action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return;
  }
  if (action.action !== "call-service") {
    return;
  }

  for (const key of ["target", "data", "service_data"]) {
    const container = action[key];
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      continue;
    }
    addEntityIdValue(entities, container.entity_id);
  }
}

function addEntityIdValue(entities, value) {
  if (typeof value === "string") {
    if (looksLikeEntityId(value)) {
      entities.add(value);
    }
    return;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const entry of value) {
    if (typeof entry === "string" && looksLikeEntityId(entry)) {
      entities.add(entry);
    }
  }
}

function looksLikeEntityId(value) {
  return typeof value === "string" && value.includes(".");
}
