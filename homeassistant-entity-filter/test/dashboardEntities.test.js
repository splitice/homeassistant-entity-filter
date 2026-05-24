import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DASHBOARD_EXTRACTION_RULES,
  extractDashboardEntities,
} from "../src/dashboardEntities.js";

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

test("extractDashboardEntities extracts picture-entity camera_image references", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            type: "picture-entity",
            camera_image: "camera.backyard_camera",
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities], ["camera.backyard_camera"]);
});

test("extractDashboardEntities recursively visits arbitrary nested objects and arrays", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            type: "custom:outer-card",
            arbitrary_payload: {
              nested_cards: [
                {
                  type: "custom:inner-card",
                  temperature_entity: "sensor.upper_floor_avg_temperature",
                  layout: {
                    card_config: {
                      humidity_sensor: "sensor.hall_humidity",
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "sensor.hall_humidity",
    "sensor.upper_floor_avg_temperature",
  ]);
});

test("extractDashboardEntities covers compact-power-card nested entities", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            type: "custom:compact-power-card",
            entities: {
              pv: { entity: "sensor.goodwe_pv_power" },
              grid: { entity: "sensor.givtcp_pv_power" },
              battery: [
                {
                  entity: "sensor.goodwe_battery_power",
                  battery_soc: "sensor.goodwe_battery_state_of_charge",
                },
              ],
              devices: [
                {
                  entity: "sensor.ground_lighting_energy",
                  switch_entity: "switch.ikea_of_sweden_inspelning_smart_plug",
                },
                {
                  entity: "sensor.evap_combined_mode_power",
                },
              ],
              battery_labels: [
                {
                  entity: "sensor.goodwe_actual_battery_remaining",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "sensor.evap_combined_mode_power",
    "sensor.givtcp_pv_power",
    "sensor.goodwe_actual_battery_remaining",
    "sensor.goodwe_battery_power",
    "sensor.goodwe_battery_state_of_charge",
    "sensor.goodwe_pv_power",
    "sensor.ground_lighting_energy",
    "switch.ikea_of_sweden_inspelning_smart_plug",
  ]);
});

test("extractDashboardEntities covers bubble-card sub buttons and nested actions", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            type: "custom:bubble-card",
            sub_button: {
              main: [
                {
                  entity: "sensor.020000e2e5f6_laundry_time_remaining",
                  tap_action: {
                    action: "perform-action",
                    data: {
                      entity_id: "vacuum.rob",
                    },
                  },
                },
                {
                  button_action: {
                    tap_action: {
                      action: "perform-action",
                      target: {
                        entity_id: "light.rumpus_lights",
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "light.rumpus_lights",
    "sensor.020000e2e5f6_laundry_time_remaining",
    "vacuum.rob",
  ]);
});

test("extractDashboardEntities covers generic visibility and condition entities", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            type: "custom:conditional-card",
            visibility: [
              { entity: "binary_sensor.abc_emergency_home_active_alert" },
              { entity: "vacuum.rob" },
            ],
            conditions: [
              { entity: "input_select.heatpump_mode_user" },
              { entity: "sensor.020000e2e5f6_laundry_machine_state" },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "binary_sensor.abc_emergency_home_active_alert",
    "input_select.heatpump_mode_user",
    "sensor.020000e2e5f6_laundry_machine_state",
    "vacuum.rob",
  ]);
});

test("extractDashboardEntities parses action entity ids regardless of action type", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        cards: [
          {
            tap_action: {
              action: "perform-action",
              target: {
                entity_id: ["switch.pool", "switch.garden"],
              },
            },
            hold_action: {
              action: "fire-dom-event",
              service_data: {
                entity_id: "script.scene_on",
              },
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "script.scene_on",
    "switch.garden",
    "switch.pool",
  ]);
});

test("extractDashboardEntities applies the built-in mushroom template badge rule by default", () => {
  const entities = extractDashboardEntities({
    views: [
      {
        badges: [
          {
            type: "custom:mushroom-template-badge",
            content:
              "{{ states('sensor.wan_ingress_mbit_s') }} {{ states(\"sensor.wan_egress_mbit_s\") }}",
            icon: "{{ state_attr('input_text.climate_weather_fact_1_icon', 'icon') }}",
            color:
              "{{ is_state('sensor.next_bin_night', 'tomorrow') }} {{ has_value(\"input_text.climate_weather_fact_1\") }}",
          },
        ],
      },
    ],
  });

  assert.deepEqual([...entities].sort(), [
    "input_text.climate_weather_fact_1",
    "input_text.climate_weather_fact_1_icon",
    "sensor.next_bin_night",
    "sensor.wan_egress_mbit_s",
    "sensor.wan_ingress_mbit_s",
  ]);
});

test("extractDashboardEntities applies custom template extraction rules in addition to the built-in defaults", () => {
  const entities = extractDashboardEntities(
    {
      views: [
        {
          cards: [
            {
              type: "custom:test-card",
              markdown: "{{ expand('sensor.custom_template_entity') }}",
            },
          ],
          badges: [
            {
              type: "custom:mushroom-template-badge",
              content: "{{ states('sensor.built_in_template_entity') }}",
            },
          ],
        },
      ],
    },
    [
      ...DEFAULT_DASHBOARD_EXTRACTION_RULES,
      {
        card_type: "custom:test-card",
        mode: "template_entities",
        fields: ["markdown"],
      },
    ],
  );

  assert.deepEqual([...entities].sort(), [
    "sensor.built_in_template_entity",
    "sensor.custom_template_entity",
  ]);
});
