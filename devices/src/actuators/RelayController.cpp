#include "actuators/RelayController.h"

RelayController::RelayController(int relayPin) : pin(relayPin) {
    isActive = false;
    lastState = false;
}

void RelayController::begin() {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    isActive = false;
    lastState = false;
    Serial.printf("Relay controller initialized on GPIO%d\n", pin);
}

bool RelayController::shouldActivate(int soilMoisture) {
    return (soilMoisture <= SOIL_THRESHOLD);  // Only check soil moisture
}

void RelayController::control(int soilMoisture, String& reason) {
    bool shouldActivate = this->shouldActivate(soilMoisture);
    
    if (shouldActivate) {
        reason = "Low soil moisture detected (" + String(soilMoisture) + "%)";
    } else {
        reason = "Soil moisture sufficient (" + String(soilMoisture) + "%)";
    }
    
    // Update relay state - HIGH-triggered relay (HIGH = ON, LOW = OFF)
    isActive = shouldActivate;
    digitalWrite(pin, isActive ? HIGH : LOW);
}

void RelayController::setRelayState(bool state) {
    isActive = state;
    digitalWrite(pin, isActive ? HIGH : LOW);
}

bool RelayController::isRelayActive() const {
    return isActive;
}

bool RelayController::hasStateChanged() {
    return (isActive != lastState);
}

void RelayController::updateLastState() {
    lastState = isActive;
}

void RelayController::printDebugInfo(const String& reason) const {
    String status = isActive ? "ACTIVATED" : "DEACTIVATED";
    Serial.println("=== WATER PUMP " + status + " ===");
    Serial.println("Reason: " + reason);
    Serial.printf("Relay control signal: GPIO%d=%s (active-high)\n",
                  pin, isActive ? "HIGH" : "LOW");
}