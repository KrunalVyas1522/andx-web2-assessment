import axios from 'axios';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080/v1/events';

const HOSTILE_PAYLOADS = [
  '{"v":2,"type":"view_snapshot","event_id":12345,"clip_id":"c_0001"}', // event_id as integer
  '{"v":2,"type":"view_snapshot","event_id":"0d9a51f2c37be801","clip_id":true}', // bool as string
  '{"v":2,"type":"view_snapshot","event_id":"0d9a51f2c37be801",\0}', // NUL byte injection
  '[{"v":2,"type":"view_snapshot"}]', // Array instead of object line
  '{"v":2,"type":"view_snapshot","event_id":"0d9a51f2c37be801","view_count": 9999999999999999999999999999}' // Huge int
];

async function inject() {
  console.log('Injecting hostile payloads...');
  for (const payload of HOSTILE_PAYLOADS) {
    try {
      await axios.post(GATEWAY_URL, payload, {
        headers: { 'Content-Type': 'application/x-ndjson' }
      });
      console.log(`Sent payload cleanly: ${payload.substring(0, 30)}...`);
    } catch (error: any) {
      console.log(`Payload rejected (expected): ${error.response?.status} - ${payload.substring(0, 30)}...`);
    }
  }
}

inject();
