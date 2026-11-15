#ifndef SENSOR_CALIBRATION_H
#define SENSOR_CALIBRATION_H

#include <Arduino.h>

// GPIO Pin Definitions
namespace Pins {
    const int DHT11_PIN = 4;           // GPIO4
    const int SOIL_MOISTURE_PIN = 35;  // GPIO35 (ADC1 - safe with WiFi)
    const int SOIL_TEMP_PIN = 27;      // GPIO27 for DS18B20 soil temperature sensor
    const int RELAY_PIN = 5;           // GPIO5 for relay control
    const int MODEM_RELAY_PIN = 19;    // GPIO19 for modem power relay
    const int RAIN_SENSOR_PIN = 18;    // GPIO18 for digital rain detection
    const int WATER_LEVEL_PIN = 34;    // GPIO34 for water level sensor (analog - ADC capable)
}

namespace DHT11Config {
    const int DHT_TYPE = 11;           // DHT11 sensor type
}

namespace DS18B20Config {
    const int RESOLUTION_BITS = 12;    // 12-bit resolution (0.0625°C precision)
    const unsigned long CONVERSION_TIME = 750; // 750ms for 12-bit conversion
}

namespace SoilMoistureCalibration {
    extern const int DRY_VALUE;    // 0% moisture (completely dry)
    extern const int WET_VALUE;    // 100% moisture (completely wet)
    
    int convertToPercentage(int rawValue);
}

// Water Level Sensor Calibration
namespace WaterLevelCalibration {
    const int DRY_VALUE = 0;          // Sensor value when dry (no water)
    const int WET_VALUE = 1050;       // Sensor value when sensor is fully submerged
    const int SENSOR_HEIGHT_CM = 5;   // Actual height of your sensor in cm
    
    extern const int LOW_THRESHOLD;     
    extern const int MEDIUM_THRESHOLD;  
    
    String determineStatus(int rawValue);
}

namespace RelayThresholds {
    const int SOIL_MOISTURE_THRESHOLD = 10;   // 0-10% soil moisture triggers pump
    
}

namespace Timing {
    const unsigned long SENSOR_INTERVAL = 2000;  
    const unsigned long SEND_INTERVAL = 120000;  
}

namespace CalibrationUtils {
    bool validateSoilMoistureReading(int rawValue);
    bool validateWaterLevelReading(int rawValue);
    bool validateTemperatureReading(float temperature);
    bool validateSoilTemperatureReading(float temperature);
    bool validateHumidityReading(float humidity);
    void printCalibrationInfo();
    void printSensorReadings(int soilRaw, int soilPercent, int waterRaw, String waterStatus, float soilTemp);
}

#endif