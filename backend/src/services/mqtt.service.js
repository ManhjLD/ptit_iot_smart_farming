import mqtt from 'mqtt';
const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = Number(process.env.MQTT_PORT);
const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL || 'mqtts';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
function assertEnv() {
    const missing = [];
    if (!MQTT_HOST)
        missing.push('MQTT_HOST');
    if (!MQTT_PORT || Number.isNaN(MQTT_PORT))
        missing.push('MQTT_PORT');
    if (!MQTT_USERNAME)
        missing.push('MQTT_USERNAME');
    if (!MQTT_PASSWORD)
        missing.push('MQTT_PASSWORD');
    if (missing.length) {
        throw new Error(`Missing MQTT env vars: ${missing.join(', ')}. Check your .env or deployment environment.`);
    }
}
const options = {
    host: MQTT_HOST,
    port: MQTT_PORT,
    protocol: MQTT_PROTOCOL,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clean: true,
    connectTimeout: 10_000,
    reconnectPeriod: 2_000,
    rejectUnauthorized: true,
};
let client = null;
let isReady = false;
const createClient = () => {
    assertEnv();
    if (client)
        return client;
    client = mqtt.connect(options);
    client.on('connect', () => {
        isReady = true;
        console.log('🔌 MQTT connected:', `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`);
    });
    client.on('reconnect', () => {
        isReady = false;
        console.log('♻️  MQTT reconnecting...');
    });
    client.on('close', () => {
        isReady = false;
        console.log('🔒 MQTT connection closed');
    });
    client.on('error', (err) => {
        console.error('❌ MQTT error:', err.message);
    });
    return client;
};
export const getMqttClient = () => {
    return createClient();
};
export const waitForMqttReady = (timeoutMs = 10_000) => new Promise((resolve, reject) => {
    if (!client)
        createClient();
    if (isReady)
        return resolve();
    const onConnect = () => {
        cleanup();
        resolve();
    };
    const onError = (err) => {
        cleanup();
        reject(err);
    };
    const cleanup = () => {
        client?.off('connect', onConnect);
        client?.off('error', onError);
        clearTimeout(timer);
    };
    client?.once('connect', onConnect);
    client?.once('error', onError);
    const timer = setTimeout(() => {
        cleanup();
        reject(new Error('MQTT connection timeout'));
    }, timeoutMs);
});
export const publishMessage = async (topic, payload, qos = 0, retain = false) => {
    const isServerless = !!process.env.VERCEL;
    const data = typeof payload === 'string' || Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(JSON.stringify(payload));
    if (isServerless) {
        assertEnv();
        const conn = mqtt.connect({
            host: MQTT_HOST,
            port: MQTT_PORT,
            protocol: MQTT_PROTOCOL,
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD,
            clean: true,
            connectTimeout: 5_000,
            reconnectPeriod: 0,
            rejectUnauthorized: true,
        });
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('MQTT connect timeout')), 6_000);
            conn.once('connect', () => {
                clearTimeout(t);
                resolve();
            });
            conn.once('error', (e) => {
                clearTimeout(t);
                reject(e);
            });
        });
        await new Promise((resolve, reject) => {
            conn.publish(topic, data, { qos, retain }, (err) => err ? reject(err) : resolve());
        });
        await new Promise((resolve) => conn.end(true, {}, (_err) => resolve()));
        return;
    }
    const cli = getMqttClient();
    await waitForMqttReady(5_000);
    await new Promise((resolve, reject) => {
        cli.publish(topic, data, { qos, retain }, (err) => {
            if (err)
                return reject(err);
            resolve();
        });
    });
};
export const disconnectMqtt = async () => new Promise((resolve) => {
    if (!client)
        return resolve();
    try {
        client.end(true, {}, () => {
            resolve();
        });
    }
    catch {
        resolve();
    }
    finally {
        client = null;
        isReady = false;
    }
});
export const mqttStatus = () => ({ connected: !!client && isReady });
