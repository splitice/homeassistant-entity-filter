import test from "node:test";
import assert from "node:assert/strict";
import { BootstrapManager } from "../src/bootstrap.js";

test("BootstrapManager applies configured dashboard extraction rules to required entities", async () => {
  const calls = [];
  const manager = new BootstrapManager({
    homeAssistantUrl: "http://example.com",
    requiredEntities: ["sensor.always_required"],
    dashboards: ["dashboard-kiosk"],
    dashboardExtractionRules: [
      {
        card_type: "custom:test-card",
        mode: "template_entities",
        fields: ["markdown"],
      },
    ],
    openConnection: async () => ({
      async call(message) {
        calls.push(message);

        if (message.type === "get_states") {
          return [{ entity_id: "sensor.catalog_only" }];
        }

        if (message.type === "lovelace/config") {
          return {
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
                          entity: "sensor.evap_combined_mode_power",
                          switch_entity: "switch.ikea_of_sweden_inspelning_smart_plug",
                        },
                      ],
                      battery_labels: [
                        {
                          entity: "sensor.goodwe_actual_battery_remaining",
                        },
                      ],
                    },
                  },
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
                      ],
                    },
                    visibility: [{ entity: "binary_sensor.abc_emergency_home_active_alert" }],
                  },
                  {
                    type: "custom:mushroom-template-badge",
                    content: "{{ states('sensor.wan_ingress_mbit_s') }}",
                    icon: "{{ state_attr('input_text.climate_weather_fact_1_icon', 'icon') }}",
                    color: "{{ is_state('sensor.next_bin_night', 'tonight') }}",
                  },
                  {
                    type: "custom:test-card",
                    markdown: "{{ expand('sensor.custom_template_entity') }}",
                  },
                ],
              },
            ],
          };
        }

        throw new Error(`unexpected bootstrap command: ${message.type}`);
      },

      async close() {},
    }),
  });

  const result = await manager.load("token", 5000);

  assert.deepEqual(calls.map((message) => message.type), ["get_states", "lovelace/config"]);
  assert.equal(calls[1].url_path, "dashboard-kiosk");
  assert.deepEqual([...result.entityCatalog], ["sensor.catalog_only"]);
  assert.deepEqual([...result.requiredEntities].sort(), [
    "binary_sensor.abc_emergency_home_active_alert",
    "input_text.climate_weather_fact_1_icon",
    "sensor.020000e2e5f6_laundry_time_remaining",
    "sensor.always_required",
    "sensor.custom_template_entity",
    "sensor.evap_combined_mode_power",
    "sensor.givtcp_pv_power",
    "sensor.goodwe_actual_battery_remaining",
    "sensor.goodwe_battery_power",
    "sensor.goodwe_battery_state_of_charge",
    "sensor.goodwe_pv_power",
    "sensor.next_bin_night",
    "sensor.wan_ingress_mbit_s",
    "switch.ikea_of_sweden_inspelning_smart_plug",
    "vacuum.rob",
  ]);
});
