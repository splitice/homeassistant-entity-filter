const EMPTY_REQUIRED_SET = new Set();

export class RuleEngine {
  constructor(rules = [], defaultAction = "allow") {
    this.defaultAction = defaultAction;
    this.rules = rules.map((rule, index) => compileRule(rule, index));
  }

  resolve(entityId, requiredEntities = EMPTY_REQUIRED_SET) {
    for (const rule of this.rules) {
      if (rule.matches(entityId)) {
        return {
          action: rule.action,
          rateLimitMs: rule.action === "allow" ? rule.rateLimitMs : null,
          matchedRule: rule.name,
          matchedExplicitRule: true,
        };
      }
    }

    if (requiredEntities.has(entityId)) {
      return {
        action: "allow",
        rateLimitMs: null,
        matchedRule: "required",
        matchedExplicitRule: false,
      };
    }

    return {
      action: this.defaultAction,
      rateLimitMs: null,
      matchedRule: "default",
      matchedExplicitRule: false,
    };
  }

  requiresEntityCatalogForExplicitSet() {
    if (this.defaultAction === "allow") {
      return true;
    }
    return this.rules.some((rule) => rule.action === "allow" && rule.matchType === "regex");
  }

  resolveExplicitAllowedSet({ requiredEntities = EMPTY_REQUIRED_SET, entityCatalog = null } = {}) {
    if (this.requiresEntityCatalogForExplicitSet()) {
      if (!entityCatalog) {
        return null;
      }
      const allowed = new Set();
      for (const entityId of entityCatalog) {
        if (this.resolve(entityId, requiredEntities).action === "allow") {
          allowed.add(entityId);
        }
      }
      return allowed;
    }

    const candidates = new Set(requiredEntities);
    for (const rule of this.rules) {
      if (rule.action === "allow" && rule.matchType === "exact") {
        candidates.add(rule.match);
      }
    }

    const allowed = new Set();
    for (const entityId of candidates) {
      if (this.resolve(entityId, requiredEntities).action === "allow") {
        allowed.add(entityId);
      }
    }
    return allowed;
  }
}

function compileRule(rule, index) {
  if (rule.match_type === "regex") {
    try {
      const matcher = new RegExp(rule.match);
      return {
        name: rule.name ?? `rule-${index + 1}`,
        action: rule.action,
        matchType: "regex",
        match: rule.match,
        rateLimitMs: rule.rate_limit_ms ?? null,
        matches(entityId) {
          return matcher.test(entityId);
        },
      };
    } catch (error) {
      throw new Error(`invalid regex for ${rule.name ?? `rule-${index + 1}`}: ${error.message}`);
    }
  }

  return {
    name: rule.name ?? `rule-${index + 1}`,
    action: rule.action,
    matchType: "exact",
    match: rule.match,
    rateLimitMs: rule.rate_limit_ms ?? null,
    matches(entityId) {
      return entityId === rule.match;
    },
  };
}
