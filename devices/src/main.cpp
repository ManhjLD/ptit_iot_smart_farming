#include <Arduino.h>
#include "config.h"
#include "utils/SensorCalibration.h"
#include "sensors/DHT11Sensor.h"
#include "sensors/SoilMoistureSensor.h"
#include "sensors/SoilTemperatureSensor.h"
#include "sensors/RainSensor.h"
#include "sensors/WaterLevelSensor.h"
#include "actuators/RelayController.h"
#include "actuators/ModemRelay.h"
#include "network/MQTTClient.h"
#include <time.h>

void initializeComponents();
bool readAllSensors();
void controlPump();
void processRemoteRelayCommand();
void sendDataToMQTT();
void testSensors();
DHT11Sensor dht11(Pins::DHT11_PIN, DHT11Config::DHT_TYPE);
SoilMoistureSensor soilSensor(Pins::SOIL_MOISTURE_PIN); 
SoilTemperatureSensor soilTempSensor(Pins::SOIL_TEMP_PIN);
RainSensor rainSensor(Pins::RAIN_SENSOR_PIN);
WaterLevelSensor waterSensor(Pins::WATER_LEVEL_PIN);
RelayController relay(Pins::RELAY_PIN);
ModemRelay modemRelay(Pins::MODEM_RELAY_PIN);

MQTTClient mqttClient(MQTT_SERVER, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD,
                      CLIENT_ID, SENSOR_TOPIC, RELAY_TOPIC, STATUS_TOPIC, COMMAND_TOPIC);

bool remoteRelayCommand = false;
bool remoteRelayStatus = false;
String remoteRelayReason = "";
String remoteRelayCommandId = "";
uint32_t remoteRelayExpiresAt = 0;
bool manualOverrideMode = false; 
unsigned long lastSensorRead = 0;
unsigned long lastDataSent = 0;

bool sensorDataValid = false;

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    modemRelay.begin();  
    delay(2000);
    
    Serial.println("=== Smart Irrigation System with MQTT ===");
    
    initializeComponents();
    
    if (mqttClient.connectWiFi(WIFI_SSID, WIFI_PASSWORD)) {
        Serial.println("WiFi connected successfully!");
        
        if (mqttClient.connectMQTT()) {
            Serial.println("MQTT connected successfully!");
        } else {
            Serial.println("MQTT connection failed - will retry automatically");
        }
    } else {
        Serial.println("WiFi or secure transport setup failed!");
    }

    testSensors();
    
    Serial.println("Smart Irrigation System Ready!");
}

void loop() {
    unsigned long currentTime = millis();
    
    mqttClient.loop();
    processRemoteRelayCommand();
    
    if (currentTime - lastSensorRead >= Timing::SENSOR_INTERVAL) {
        sensorDataValid = readAllSensors();
        
        if (sensorDataValid) {
            controlPump();
        }
        
        lastSensorRead = currentTime;
    }
    
    if (currentTime - lastDataSent >= Timing::SEND_INTERVAL) {
        if (sensorDataValid) {
            sendDataToMQTT();
        }
        lastDataSent = currentTime;
    }
    
    delay(100);
}

void initializeComponents() {
    Serial.println("Initializing components...");

    dht11.begin();
    soilTempSensor.begin();
    rainSensor.begin();
    relay.begin();
    
    Serial.printf("DHT11 on GPIO%d, Soil moisture on GPIO%d, Relay on GPIO%d\n", 
                  Pins::DHT11_PIN, Pins::SOIL_MOISTURE_PIN, Pins::RELAY_PIN);
    Serial.printf("Rain sensor on GPIO%d, Water level on GPIO%d, Modem relay on GPIO%d\n", 
                  Pins::RAIN_SENSOR_PIN, Pins::WATER_LEVEL_PIN, Pins::MODEM_RELAY_PIN);
}

bool readAllSensors() {

    bool dhtOk = dht11.readData();
    bool soilOk = soilSensor.readData();
    bool soilTempOk = soilTempSensor.readData();
    bool rainOk = rainSensor.readData();
    bool waterOk = waterSensor.readData();
    
    if (dhtOk) dht11.printDebugInfo();
    if (soilOk) soilSensor.printDebugInfo();
    if (soilTempOk) soilTempSensor.printDebugInfo();
    if (rainOk) rainSensor.printDebugInfo();
    if (waterOk) waterSensor.printDebugInfo();
    
    bool allValid = dhtOk && soilOk && soilTempOk && rainOk && waterOk;
    
    if (allValid) {
        String modeStatus = manualOverrideMode ? " [MANUAL OVERRIDE]" : " [AUTO MODE]";
        Serial.printf("Summary - Air: %.1f°C, Humid: %.1f%%, Soil: %d%%, SoilTemp: %.1f°C, Water: %s, Rain: %s%s\n",
                      dht11.getTemperature(), dht11.getHumidity(), 
                      soilSensor.getPercentage(),
                      soilTempSensor.getTemperature(),
                      waterSensor.getStatus().c_str(),
                      rainSensor.isRainDetected() ? "true" : "false",
                      modeStatus.c_str());
    } else {
        Serial.println("Some sensor readings are invalid!");
    }
    
    return allValid;
}

void controlPump() {
    String reason;
    bool relayTriggered = false;
    
    if (manualOverrideMode) {
        Serial.printf("Manual Override Mode: Relay stays ON (Soil: %d%%, but ignoring automatic control)\n", 
                     soilSensor.getPercentage());
        return; 
    } else {
        relay.control(soilSensor.getPercentage(), reason);
        relayTriggered = relay.hasStateChanged();
    }
    
    if (relayTriggered) {
        relay.printDebugInfo(reason);
        
        bool success = mqttClient.publishRelayLog(relay.isRelayActive(), reason);
        if (!success) {
            Serial.println("Warning: Failed to publish relay log to MQTT");
        }
        
        relay.updateLastState();
    }
}

void processRemoteRelayCommand() {
    if (!remoteRelayCommand) return;

    const String commandId = remoteRelayCommandId;
    const bool desiredState = remoteRelayStatus;
    const uint32_t expiresAt = remoteRelayExpiresAt;
    remoteRelayCommand = false;
    remoteRelayCommandId = "";
    remoteRelayExpiresAt = 0;

    const uint32_t nowEpoch = static_cast<uint32_t>(time(nullptr));
    if (nowEpoch < 1704067200 || expiresAt <= nowEpoch) {
        mqttClient.publishCommandAck(commandId, false, relay.isRelayActive(),
                                     "Command expired or device clock is unsynchronized");
        return;
    }

    if (desiredState && !sensorDataValid) {
        mqttClient.publishCommandAck(commandId, false, relay.isRelayActive(),
                                     "Pump start blocked because sensor readings are invalid");
        return;
    }
    if (desiredState && rainSensor.isRainDetected()) {
        mqttClient.publishCommandAck(commandId, false, relay.isRelayActive(),
                                     "Pump start blocked because rain is detected");
        return;
    }
    if (desiredState && waterSensor.getStatus().equalsIgnoreCase("Low")) {
        mqttClient.publishCommandAck(commandId, false, relay.isRelayActive(),
                                     "Pump start blocked because reservoir water is low");
        return;
    }

    const bool previousState = relay.isRelayActive();
    String reason = remoteRelayReason;
    if (desiredState) {
        manualOverrideMode = true;
        reason += " (Manual Override Mode)";
    } else {
        manualOverrideMode = false;
        reason += " (Returning to Automatic Mode)";
    }
    relay.setRelayState(desiredState);
    const bool actualState = relay.isRelayActive();
    Serial.printf("Processed relay command %s for %s: requested=%s actual=%s\n",
                  commandId.c_str(), CLIENT_ID,
                  desiredState ? "ON" : "OFF",
                  actualState ? "ON" : "OFF");

    if (actualState != previousState) {
        relay.printDebugInfo(reason);
        if (!mqttClient.publishRelayLog(actualState, reason, commandId)) {
            Serial.println("Warning: Failed to publish relay state for command");
        }
    }
    relay.updateLastState();

    const bool executed = actualState == desiredState;
    if (!mqttClient.publishCommandAck(
            commandId,
            executed,
            actualState,
            executed ? "Command executed" : "Relay state did not match requested state")) {
        Serial.println("Warning: Failed to publish relay command acknowledgement");
    }
}

void sendDataToMQTT() {  
    bool success = mqttClient.publishSensorData(
        dht11.getTemperature(),
        dht11.getHumidity(),
        soilSensor.getPercentage(),
        soilTempSensor.getTemperature(),
        rainSensor.isRainDetected(),
        waterSensor.getStatus()
    );
    
    if (success) {
        Serial.println("✓ Sensor data published to MQTT successfully");
    } else {
        Serial.println("✗ Failed to publish sensor data to MQTT");
    }
}

void testSensors() {
    Serial.println("Testing sensors...");
    
    dht11.readData();
    soilSensor.readData();
    soilTempSensor.readData();
    rainSensor.readData();
    waterSensor.readData();
    
    Serial.printf("Initial readings - Soil: %d, SoilTemp: %.1f°C, Rain: %s, Water: %d\n",
                  soilSensor.getRawValue(),
                  soilTempSensor.getTemperature(),
                  rainSensor.isRainDetected() ? "Rain detected" : "No rain",
                  waterSensor.getRawValue());
}