#ifndef CONFIG_H
#define CONFIG_H

// Copy this file to config.h and replace the placeholders with local credentials.
#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "replace-with-wifi-password"

#define MQTT_SERVER "your-mqtt-broker-host"
#define MQTT_PORT 8883
#define MQTT_USERNAME "your-device-service-user"
#define MQTT_PASSWORD "replace-with-mqtt-password"
#define CLIENT_ID "esp32-01"

#define SENSOR_TOPIC "sf/" CLIENT_ID "/sensor"
#define RELAY_TOPIC "sf/" CLIENT_ID "/relay"
#define COMMAND_TOPIC "sf/devices/relay/command"
#define STATUS_TOPIC "sf/" CLIENT_ID "/status"

#endif
