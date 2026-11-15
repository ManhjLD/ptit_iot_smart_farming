#include "network/MQTTClient.h"
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <time.h>
#include <SPIFFS.h>

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 0, 60000);

extern bool remoteRelayCommand;
extern bool remoteRelayStatus;
extern String remoteRelayReason;
extern String remoteRelayCommandId;
extern uint32_t remoteRelayExpiresAt;
extern bool manualOverrideMode;

MQTTClient::MQTTClient(const char* server, int port, const char* user, const char* password, 
                       const char* deviceId, const char* sensorTopic, const char* relayTopic, 
                       const char* statusTopic, const char* relayCommandTopic) 
    : mqttServer(server), mqttPort(port), mqttUser(user), mqttPassword(password), 
      deviceId(deviceId), wifiSsid(nullptr), wifiPassword(nullptr),
      sensorDataTopic(sensorTopic), relayLogTopic(relayTopic), 
      statusTopic(statusTopic), relayCommandTopic(relayCommandTopic),
      lastReconnectAttempt(0), lastWiFiReconnectAttempt(0),
      isConnectedFlag(false), mqttTransportReady(false) {
    
    Serial.println("MQTT Client initialized for EMQX Cloud");
    Serial.printf("Server: %s:%d\n", mqttServer, mqttPort);
    Serial.printf("Device ID: %s\n", deviceId);
    Serial.printf("Topics:\n  Sensor: %s\n  Relay: %s\n  Status: %s\n  Relay Command: %s\n", 
                  sensorDataTopic, relayLogTopic, statusTopic, relayCommandTopic);
}

bool MQTTClient::loadCertificates() {
    Serial.println("Loading CA certificates for EMQX Cloud TLS connection");
    
    if (!SPIFFS.begin(true)) {
        Serial.println("Failed to mount SPIFFS filesystem");
        Serial.println("Run 'pio run --target uploadfs' to upload certificates");
        return false;
    }
    
    Serial.println("SPIFFS filesystem mounted successfully");
    
    Serial.println("Available SPIFFS files:");
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    bool hasFiles = false;
    while(file) {
        if (!file.isDirectory()) {
            Serial.printf("   %s (%d bytes)\n", file.name(), file.size());
            hasFiles = true;
        }
        file = root.openNextFile();
    }
    
    if (!hasFiles) {
        Serial.println("No files found - upload certificates first");
        return false;
    }
    
    Serial.println("Loading EMQX Cloud CA certificate from SPIFFS file");
    
    File certFile = SPIFFS.open("/emqxsl-ca.crt", "r");
    if (!certFile) {
        Serial.println("Failed to open certificate file: /emqxsl-ca.crt");
        Serial.println("Make sure to upload the certificate file first with: pio run --target uploadfs");
        return false;
    }
    
    size_t certSize = certFile.size();
    if (certSize == 0) {
        Serial.println("Certificate file is empty");
        certFile.close();
        return false;
    }
    
    caCertificate = "";
    caCertificate.reserve(certSize);
    while (certFile.available()) {
        int nextByte = certFile.read();
        if (nextByte < 0) {
            break;
        }
        caCertificate += static_cast<char>(nextByte);
    }
    certFile.close();
    
    if (caCertificate.length() != certSize) {
        Serial.printf(
            "Incomplete certificate read: expected %u bytes, got %u\n",
            static_cast<unsigned>(certSize),
            static_cast<unsigned>(caCertificate.length())
        );
        return false;
    }
    
    caCertificate.trim();
    caCertificate.replace("\r\n", "\n");
    caCertificate.replace("\r", "\n");
    
    while (caCertificate.indexOf("\n\n") != -1) {
        caCertificate.replace("\n\n", "\n");
    }
    
    Serial.printf("Certificate loaded from file (%d bytes)\n", caCertificate.length());
    Serial.println("Certificate preview (first 100 chars):");
    Serial.println(caCertificate.substring(0, 100));
    
    if (!caCertificate.startsWith("-----BEGIN CERTIFICATE-----") ||
        !caCertificate.endsWith("-----END CERTIFICATE-----")) {
        Serial.println("Invalid certificate format - must be PEM format");
        Serial.printf("Starts with BEGIN: %s\n", caCertificate.startsWith("-----BEGIN CERTIFICATE-----") ? "YES" : "NO");
        Serial.printf("Ends with END: %s\n", caCertificate.endsWith("-----END CERTIFICATE-----") ? "YES" : "NO");
        return false;
    }
    
    wifiClientSecure.setCACert(caCertificate.c_str());
    
    Serial.println("Certificate validation enabled");
    return true;
}

bool MQTTClient::connectWiFi(const char* ssid, const char* password) {
    wifiSsid = ssid;
    wifiPassword = password;
    lastWiFiReconnectAttempt = millis();
    mqttTransportReady = false;
    isConnectedFlag = false;
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    Serial.print("Connecting to WiFi");

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < MAX_WIFI_ATTEMPTS) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.println("WiFi connected!");
        printConnectionInfo();
        
        Serial.println("Synchronizing time with NTP server...");
        timeClient.begin();
        bool timeSynced = false;
        time_t epochTime = 0;
        for (int attempt = 0; attempt < 3 && !timeSynced; ++attempt) {
            if (timeClient.forceUpdate()) {
                epochTime = timeClient.getEpochTime();
                if (epochTime >= 1704067200) {
                    struct timeval tv = {epochTime, 0};
                    settimeofday(&tv, NULL);
                    timeSynced = true;
                }
            }
            if (!timeSynced) {
                delay(1000);
            }
        }

        if (!timeSynced) {
            Serial.println("NTP time synchronization failed; secure MQTT is disabled");
            return false;
        }

        Serial.printf("Current time: %s", ctime(&epochTime));
        
        if (!loadCertificates()) {
            Serial.println("Certificate loading failed!");
            Serial.println("Cannot establish secure TLS connection without proper certificates");
            return false;
        }
        
        Serial.println("Certificates loaded - ready for secure TLS connection");
        
        mqttClient.setClient(wifiClientSecure);
        mqttClient.setServer(mqttServer, mqttPort);
        if (!mqttClient.setBufferSize(512)) {
            Serial.println("Failed to allocate MQTT packet buffer");
            return false;
        }
        mqttClient.setKeepAlive(60);
        mqttClient.setSocketTimeout(30);
        
        mqttClient.setCallback([this](char* topic, byte* payload, unsigned int length) {
            this->handleMessage(topic, payload, length);
        });
        
        mqttTransportReady = true;
        return true;
    } else {
        Serial.println();
        Serial.println("WiFi connection failed!");
        return false;
    }
}

bool MQTTClient::connectMQTT() {
    if (WiFi.status() != WL_CONNECTED) {
        isConnectedFlag = false;
        return false;
    }
    if (!mqttTransportReady) {
        isConnectedFlag = false;
        Serial.println("MQTT unavailable: TLS transport is not initialized");
        return false;
    }

    if (mqttClient.connected()) {
        isConnectedFlag = true;
        return true;
    }

    Serial.print("Connecting to EMQX Cloud MQTT broker with TLS...");
    
    String clientId = String("ESP32-") + deviceId + "-" + String(random(0xffff), HEX);
    
    bool connected = mqttClient.connect(clientId.c_str(), mqttUser, mqttPassword);
    
    if (connected) {
        Serial.println(" connected successfully with TLS!");
        isConnectedFlag = true;
        
        if (mqttClient.subscribe(relayCommandTopic)) {
            Serial.printf("Successfully subscribed to relay command topic: %s\n", relayCommandTopic);
        } else {
            Serial.printf("Failed to subscribe to relay command topic: %s\n", relayCommandTopic);
        }
        
        publishStatus("online");
        
        return true;
    } else {
        Serial.printf(" failed with TLS, rc=%d\n", mqttClient.state());
        Serial.println("MQTT Connection Error Codes:");
        Serial.println("-4: Connection timeout");
        Serial.println("-3: Connection lost");
        Serial.println("-2: Connect failed (likely TLS certificate issue)");
        Serial.println("-1: Disconnected");
        Serial.println(" 0: Connected");
        Serial.println(" 1: Wrong protocol version");
        Serial.println(" 2: Client ID rejected");
        Serial.println(" 3: Server unavailable");
        Serial.println(" 4: Bad credentials");
        Serial.println(" 5: Not authorized");
        Serial.println("If rc=-2, check certificate store and ensure proper CA certificates are loaded");
        
        isConnectedFlag = false;
        return false;
    }
}

void MQTTClient::loop() {
    const unsigned long now = millis();
    if (WiFi.status() != WL_CONNECTED) {
        isConnectedFlag = false;
        if (mqttClient.connected()) {
            mqttClient.disconnect();
        }
        if (now - lastWiFiReconnectAttempt >= WIFI_RECONNECT_INTERVAL) {
            lastWiFiReconnectAttempt = now;
            Serial.println("WiFi disconnected, attempting to reconnect...");
            if (!WiFi.reconnect()) {
                Serial.println("WiFi reconnect request failed; will retry");
            }
        }
        return;
    }

    if (!mqttTransportReady) {
        isConnectedFlag = false;
        if (wifiSsid && wifiPassword &&
            now - lastWiFiReconnectAttempt >= WIFI_RECONNECT_INTERVAL) {
            Serial.println("WiFi is connected but secure MQTT transport is not ready; retrying setup");
            connectWiFi(wifiSsid, wifiPassword);
        }
        return;
    }

    if (!mqttClient.connected()) {
        if (now - lastReconnectAttempt > RECONNECT_INTERVAL) {
            lastReconnectAttempt = now;
            Serial.println("MQTT connection lost, attempting to reconnect...");
            if (connectMQTT()) {
                lastReconnectAttempt = 0;
            }
        }
    } else {
        mqttClient.loop();
    }
}

void MQTTClient::handleMessage(char* topic, byte* payload, unsigned int length) {
    // Convert payload to string
    String message = "";
    for (int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    
    Serial.println("=== MQTT MESSAGE RECEIVED ===");
    Serial.printf("Topic: %s\n", topic);
    Serial.printf("Message: %s\n", message.c_str());
    Serial.printf("Length: %u\n", length);
    Serial.println("=============================");
    

    if (String(topic) == String(relayCommandTopic)) {
  
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, message);
        
        if (error) {
            Serial.println("Failed to parse relay command JSON");
            return;
        }
        
        const String targetDeviceId = doc["device_id"] | "";
        const String commandId = doc["command_id"] | "";
        const String commandType = doc["command"] | "";
        const uint32_t expiresAt = doc["expires_at_epoch"] | 0UL;
        if (targetDeviceId != deviceId) {
            Serial.printf("Ignoring relay command targeted to another device: %s\n", targetDeviceId.c_str());
            return;
        }
        if (commandType != "set_relay" || commandId.length() == 0 || !doc["relayStatus"].is<bool>() || expiresAt == 0) {
            Serial.println("Ignoring malformed relay command");
            return;
        }

        const time_t nowEpoch = time(nullptr);
        if (nowEpoch < 1704067200 || expiresAt <= static_cast<uint32_t>(nowEpoch)) {
            Serial.println("Ignoring expired relay command or command received before time synchronization");
            return;
        }

        remoteRelayCommand = true;
        remoteRelayStatus = doc["relayStatus"];
        remoteRelayCommandId = commandId;
        remoteRelayExpiresAt = expiresAt;
        remoteRelayReason = doc["reason"] | "Remote MQTT command";
        Serial.printf("Relay command %s received for %s: %s\n",
                      commandId.c_str(), deviceId,
                      remoteRelayStatus ? "ON" : "OFF");
    }
}

bool MQTTClient::publishSensorData(float temp, float humidity, int soilMoisture, float soilTemp, bool rain, String waterLevel) {
    if (!mqttClient.connected()) {
        Serial.println("MQTT not connected, cannot publish sensor data");
        return false;
    }

    JsonDocument doc;
    doc["temperature"] = temp;
    doc["humidity"] = humidity;
    doc["soilMoisture"] = soilMoisture;
    doc["soilTemperature"] = soilTemp;
    doc["rainDetected"] = rain;
    doc["waterLevel"] = waterLevel;

    String jsonString;
    serializeJson(doc, jsonString);

    if (mqttClient.publish(sensorDataTopic, jsonString.c_str())) {
        Serial.println("Sensor data published successfully");
        Serial.println("Data: " + jsonString);
        return true;
    } else {
        Serial.println("Failed to publish sensor data");
        return false;
    }
}

bool MQTTClient::publishRelayLog(bool relayStatus, String reason, String commandId) {
    if (!mqttClient.connected()) {
        Serial.println("MQTT not connected, cannot publish relay log");
        return false;
    }

    JsonDocument doc;
    doc["relayStatus"] = relayStatus;
    doc["triggerReason"] = reason;
    if (commandId.length() > 0) {
        doc["command_id"] = commandId;
    }

    String jsonString;
    serializeJson(doc, jsonString);

    if (mqttClient.publish(relayLogTopic, jsonString.c_str())) {
        Serial.println("Relay log published successfully");
        Serial.println("Data: " + jsonString);
        return true;
    } else {
        Serial.println("Failed to publish relay log");
        return false;
    }
}

bool MQTTClient::publishStatus(String status) {
    if (!mqttClient.connected()) {
        Serial.println("MQTT not connected, cannot publish status");
        return false;
    }

    JsonDocument doc;
    doc["device_id"] = deviceId;
    doc["timestamp"] = timeClient.getFormattedTime();
    doc["status"] = status;

    String jsonString;
    serializeJson(doc, jsonString);

    if (mqttClient.publish(statusTopic, jsonString.c_str())) {
        Serial.println("Status published successfully: " + status);
        return true;
    } else {
        Serial.println("Failed to publish status");
        return false;
    }
}

bool MQTTClient::publishCommandAck(String commandId, bool executed, bool actualState, String reason) {
    if (!mqttClient.connected()) {
        Serial.println("MQTT not connected, cannot publish relay command acknowledgement");
        return false;
    }

    JsonDocument doc;
    doc["command_id"] = commandId;
    doc["device_id"] = deviceId;
    doc["executed"] = executed;
    doc["actual_state"] = actualState;
    doc["reason"] = reason;

    String jsonString;
    serializeJson(doc, jsonString);
    String ackTopic = String("sf/") + deviceId + "/ack";

    if (mqttClient.publish(ackTopic.c_str(), jsonString.c_str())) {
        Serial.printf("Relay command acknowledgement published to %s: %s\n",
                      ackTopic.c_str(), jsonString.c_str());
        return true;
    }

    Serial.printf("Failed to publish relay command acknowledgement to %s\n", ackTopic.c_str());
    return false;
}

bool MQTTClient::isConnected() {
    return isConnectedFlag && mqttClient.connected();
}

void MQTTClient::printConnectionInfo() {
    Serial.println("=== Connection Information ===");
    Serial.print("WiFi SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("DNS: ");
    Serial.println(WiFi.dnsIP());
    Serial.println("============================");
}

void MQTTClient::disconnect() {
    if (mqttClient.connected()) {
        publishStatus("offline");
        mqttClient.disconnect();
    }
    isConnectedFlag = false;
    Serial.println("MQTT client disconnected");
}
