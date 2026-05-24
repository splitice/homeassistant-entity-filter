import test from "node:test";
import assert from "node:assert/strict";
import { extractDashboardEntities } from "../src/dashboardEntities.js";

test("extractDashboardEntities walks nested Lovelace structures", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        badges: ["binary_sensor.front_door"],
        cards: [
          {
            entity: "light.kitchen",
            entities: ["switch.ac", { entity: "sensor.oven", hold_action: { action: "call-service", service_data: { entity_id: ["script.scene_on"] } } }],
            tap_action: {
              action: "call-service",
              target: { entity_id: "script.master_toggle" },
            },
            card: {
              camera_image: "camera.porch",
            },
          },
        ],
        sections: [
          {
            elements: [{ entity: "climate.house" }],
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "binary_sensor.front_door",
    "camera.porch",
    "climate.house",
    "light.kitchen",
    "script.master_toggle",
    "script.scene_on",
    "sensor.oven",
    "switch.ac",
  ]);
});
